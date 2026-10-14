import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from jwt import PyJWKClient
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User, WebSession

router = APIRouter(prefix="/auth", tags=["authentication"])
settings = get_settings()
_state_signer = URLSafeTimedSerializer(settings.app_secret, salt="cloudsync-oauth-state")
_jwks_client: PyJWKClient | None = None


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name, token, max_age=settings.session_ttl_seconds,
        httponly=True, secure=settings.session_cookie_secure, samesite="lax", path="/",
    )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = db.scalar(select(WebSession).where(WebSession.token_hash == _token_hash(token)))
    now = datetime.now(timezone.utc)
    if session is None:
        raise HTTPException(status_code=401, detail="Session is invalid")
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now:
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Account is unavailable")
    return user


@router.get("/login")
def login(response: Response):
    settings.validate_auth_configuration()
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    signed_state = _state_signer.dumps({"state": state, "nonce": nonce, "verifier": verifier})
    params = {
        "client_id": settings.cognito_client_id,
        "response_type": "code",
        "scope": "openid email",
        "redirect_uri": settings.app_base_url.rstrip("/") + "/auth/callback",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    redirect = RedirectResponse(settings.cognito_authorize_url + "?" + urlencode(params), status_code=302)
    redirect.set_cookie(
        "cloudsync_oauth_state", signed_state, max_age=settings.oauth_state_ttl_seconds,
        httponly=True, secure=settings.session_cookie_secure, samesite="lax", path="/auth/callback",
    )
    return redirect


@router.get("/callback")
async def callback(request: Request, code: str, state: str, db: Session = Depends(get_db)):
    settings.validate_auth_configuration()
    state_cookie = request.cookies.get("cloudsync_oauth_state")
    if not state_cookie:
        raise HTTPException(status_code=400, detail="OAuth state is missing")
    try:
        payload = _state_signer.loads(state_cookie, max_age=settings.oauth_state_ttl_seconds)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=400, detail="OAuth state is invalid or expired") from None
    if not secrets.compare_digest(str(payload.get("state", "")), state):
        raise HTTPException(status_code=400, detail="OAuth state mismatch")

    token_data = {
        "grant_type": "authorization_code",
        "client_id": settings.cognito_client_id,
        "code": code,
        "redirect_uri": settings.app_base_url.rstrip("/") + "/auth/callback",
        "code_verifier": payload["verifier"],
    }
    if settings.cognito_client_secret:
        token_data["client_secret"] = settings.cognito_client_secret
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            token_response = await client.post(
                settings.cognito_token_url,
                data=token_data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Identity provider is unavailable") from None
    if token_response.status_code != 200:
        raise HTTPException(status_code=401, detail="Identity provider rejected the authorization code")
    tokens = token_response.json()
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Identity provider did not return an ID token")

    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(settings.cognito_issuer.rstrip("/") + "/.well-known/jwks.json")
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(
            id_token, signing_key, algorithms=["RS256"],
            audience=settings.cognito_client_id, issuer=settings.cognito_issuer,
            options={"require": ["exp", "iat", "sub", "iss", "aud"]},
        )
    except Exception:
        # Fail closed without returning token, claim, key, or upstream details.
        raise HTTPException(status_code=401, detail="Identity token validation failed") from None
    if not secrets.compare_digest(str(claims.get("nonce", "")), str(payload.get("nonce", ""))):
        raise HTTPException(status_code=401, detail="Identity token nonce mismatch")

    cognito_sub = str(claims["sub"])
    user = db.scalar(select(User).where(User.cognito_sub == cognito_sub))
    if user is None:
        user = User(id=str(uuid.uuid4()), cognito_sub=cognito_sub, email=claims.get("email"))
        db.add(user)
        db.flush()
    elif claims.get("email") and user.email != claims.get("email"):
        user.email = claims.get("email")

    raw_session = secrets.token_urlsafe(32)
    session = WebSession(
        id=str(uuid.uuid4()), token_hash=_token_hash(raw_session), user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.session_ttl_seconds),
    )
    db.add(session)
    db.commit()

    response = RedirectResponse(settings.app_base_url.rstrip("/") + "/", status_code=303)
    _set_session_cookie(response, raw_session)
    response.delete_cookie("cloudsync_oauth_state", path="/auth/callback")
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email}


@router.post("/logout", status_code=303)
def logout(request: Request, db: Session = Depends(get_db)):
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in {item.rstrip("/") for item in settings.allowed_web_origins}:
        raise HTTPException(status_code=403, detail="Origin not allowed")
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        session = db.scalar(select(WebSession).where(WebSession.token_hash == _token_hash(token)))
        if session:
            db.delete(session)
            db.commit()
    logout_params = {
        "client_id": settings.cognito_client_id,
        "logout_uri": settings.app_base_url.rstrip("/") + "/",
    }
    response = RedirectResponse(
        settings.cognito_logout_url + "?" + urlencode(logout_params),
        status_code=303,
    )
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.headers["Cache-Control"] = "no-store"
    return response
