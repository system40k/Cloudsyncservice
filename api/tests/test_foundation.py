from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from app.config import Settings
from app.main import app


def test_liveness_does_not_require_database():
    response = TestClient(app).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_production_rejects_default_secret_and_insecure_cookie():
    settings = Settings(
        environment="production",
        app_secret="development-only-change-me",
        session_cookie_secure=False,
        cognito_issuer="https://issuer.example",
        cognito_client_id="client",
        cognito_authorize_url="https://issuer.example/oauth2/authorize",
        cognito_token_url="https://issuer.example/oauth2/token",
        cognito_logout_url="https://issuer.example/logout",
        app_base_url="https://app.example",
    )
    with pytest.raises(ValueError):
        settings.validate_auth_configuration()


def test_file_limit_is_100_mib_by_default():
    settings = Settings()
    assert settings.max_file_bytes == 100 * 1024 * 1024


def test_file_limit_rejects_zero():
    with pytest.raises(ValidationError):
        Settings(max_file_bytes=0)


def test_auth_me_requires_session():
    response = TestClient(app).get("/auth/me")
    assert response.status_code == 401
