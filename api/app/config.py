from functools import lru_cache
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CLOUDSYNC_", env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg://cloudsync:cloudsync@localhost:5432/cloudsync"
    app_secret: str = Field(default="development-only-change-me", min_length=24)
    cognito_issuer: str | None = None
    cognito_client_id: str | None = None
    cognito_client_secret: str | None = None
    cognito_authorize_url: str | None = None
    cognito_token_url: str | None = None
    cognito_logout_url: str | None = None
    app_base_url: str = "http://localhost:8001"
    allowed_web_origins: list[str] = ["http://localhost:8001"]
    session_cookie_name: str = "cloudsync_session"
    session_cookie_secure: bool = False
    session_ttl_seconds: int = 8 * 60 * 60
    oauth_state_ttl_seconds: int = 600
    max_file_bytes: int = 100 * 1024 * 1024

    @field_validator("max_file_bytes")
    @classmethod
    def validate_file_limit(cls, value: int) -> int:
        if value < 1 or value > 5 * 1024 * 1024 * 1024:
            raise ValueError("max_file_bytes must be between 1 byte and 5 GiB")
        return value

    def validate_auth_configuration(self) -> None:
        required = {
            "cognito_issuer": self.cognito_issuer,
            "cognito_client_id": self.cognito_client_id,
            "cognito_authorize_url": self.cognito_authorize_url,
            "cognito_token_url": self.cognito_token_url,
            "cognito_logout_url": self.cognito_logout_url,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError("Missing Cognito settings: " + ", ".join(missing))
        if self.environment.lower() in {"production", "prod"}:
            if self.app_secret == "development-only-change-me":
                raise ValueError("CLOUDSYNC_APP_SECRET must be set in production")
            if not self.session_cookie_secure:
                raise ValueError("CLOUDSYNC_SESSION_COOKIE_SECURE must be true in production")
            if not self.app_base_url.startswith("https://"):
                raise ValueError("CLOUDSYNC_APP_BASE_URL must use HTTPS in production")


@lru_cache
def get_settings() -> Settings:
    return Settings()
