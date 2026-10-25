from __future__ import annotations

import hashlib
import os
import time
import uuid
from typing import Any

import boto3
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from jwt import PyJWKClient
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")
    aws_region: str = os.getenv("AWS_REGION", "us-east-1")
    s3_bucket: str = os.getenv("AMAZON_S3___OBJECT_STORAGE_S3_BUCKET_NAME", "")
    cognito_issuer: str = os.getenv("COGNITO_ISSUER", "")
    cognito_client_id: str = os.getenv("COGNITO_CLIENT_ID", "")
    database_url: str = os.getenv("DATABASE_URL", "")
    max_file_bytes: int = 5 * 1024 * 1024 * 1024


settings = Settings()
app = FastAPI(title="CloudSync API", version="1.0.0")


def _pool() -> ConnectionPool:
    pool = getattr(app.state, "db_pool", None)
    if pool is None:
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is required")
        pool = ConnectionPool(
            settings.database_url,
            kwargs={"row_factory": dict_row},
            open=True,
            min_size=1,
            max_size=10,
        )
        app.state.db_pool = pool
    return pool


def _jwks() -> PyJWKClient:
    client = getattr(app.state, "jwks", None)
    if client is None:
        if not settings.cognito_issuer:
            raise RuntimeError("COGNITO_ISSUER is required")
        client = PyJWKClient(f"{settings.cognito_issuer}/.well-known/jwks.json", cache_jwk_set=True)
        app.state.jwks = client
    return client


def current_subject(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    if not settings.cognito_issuer or not settings.cognito_client_id:
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    token = authorization[7:].strip()
    try:
        signing_key = _jwks().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=settings.cognito_issuer,
            options={"require": ["exp", "iat", "sub"]},
            leeway=30,
        )
        if claims.get("token_use") not in ("access", "id"):
            raise ValueError("unsupported token use")
        if claims.get("client_id", claims.get("aud")) != settings.cognito_client_id:
            raise ValueError("wrong audience")
        return str(claims["sub"])
    except (jwt.PyJWTError, ValueError) as error:
        raise HTTPException(status_code=401, detail="Invalid access token") from error


class UploadIntent(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    size_bytes: int = Field(ge=0)
    sha256_hex: str = Field(pattern=r"^[0-9a-fA-F]{64}$")


@app.on_event("startup")
def startup() -> None:
    if settings.database_url:
        _pool()


@app.on_event("shutdown")
def shutdown() -> None:
    pool = getattr(app.state, "db_pool", None)
    if pool:
        pool.close()


@app.get("/api/v1/status")
def status_check() -> dict[str, Any]:
    database = "unconfigured"
    if settings.database_url:
        try:
            with _pool().connection() as connection:
                connection.execute("SELECT 1")
            database = "ok"
        except Exception:
            database = "unavailable"
    return {"status": "ok" if database != "unavailable" else "degraded", "service": "cloudsync-api", "database": database}


@app.get("/api/v1/files")
def list_files(subject: str = Depends(current_subject)) -> dict[str, list[dict[str, Any]]]:
    with _pool().connection() as connection:
        rows = connection.execute(
            """SELECT id, name, size_bytes, sha256_hex, revision, created_at, updated_at
               FROM file_objects WHERE owner_subject = %s AND deleted_at IS NULL
               ORDER BY updated_at DESC""",
            (subject,),
        ).fetchall()
    return {"files": [dict(row) for row in rows]}


@app.post("/api/v1/files", status_code=201)
def create_upload_intent(
    payload: UploadIntent,
    request: Request,
    subject: str = Depends(current_subject),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    if not idempotency_key or len(idempotency_key) > 128:
        raise HTTPException(status_code=400, detail="A valid Idempotency-Key is required")
    if payload.size_bytes > settings.max_file_bytes:
        raise HTTPException(status_code=413, detail="File exceeds the configured size limit")
    file_id = uuid.uuid4()
    object_key = f"objects/{subject}/{file_id}/1"
    with _pool().connection() as connection:
        row = connection.execute(
            """INSERT INTO file_objects (id, owner_subject, name, size_bytes, sha256_hex, object_key)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, name, size_bytes, sha256_hex, revision""",
            (file_id, subject, payload.name, payload.size_bytes, payload.sha256_hex.lower(), object_key),
        ).fetchone()
        connection.execute(
            "INSERT INTO audit_events (owner_subject, action, resource_id, request_id) VALUES (%s, %s, %s, %s)",
            (subject, "upload_intent.created", file_id, request.headers.get("x-request-id", str(uuid.uuid4()))),
        )
    return {"file": dict(row), "object_key": object_key, "upload": {"method": "PUT", "bucket": settings.s3_bucket}}
