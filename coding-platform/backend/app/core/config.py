from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_SECRET_FIELDS = ("jwt_secret_key", "coding_sync_secret", "astra_sso_secret")


class Settings(BaseSettings):
    app_name: str = "Astra Coding Platform"
    database_url: str = "sqlite:///./coding_platform.db"
    jwt_secret_key: str = "change_me_coding_platform_secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    groq_api_key: str = ""
    groq_model: str = "llama-3.1-8b-instant"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    violation_block_threshold: int = 5
    coding_sync_secret: str = "change_me_coding_sync_secret"
    astra_sso_secret: str = "change_me_coding_sso_secret"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def _reject_insecure_secrets(self) -> "Settings":
        insecure = [
            field
            for field in _SECRET_FIELDS
            if not getattr(self, field) or getattr(self, field).lower().startswith("change_me")
        ]
        if insecure:
            raise ValueError(
                "Refusing to start with insecure placeholder secret(s): "
                f"{', '.join(insecure)}. Set real values via environment variables or .env."
            )
        return self


settings = Settings()
