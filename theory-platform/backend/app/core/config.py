from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Astra Theory Platform"
    database_url: str = "sqlite:///./theory_platform.db"
    jwt_secret_key: str = "change_me_theory_platform_secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    groq_model_fallback: str = "llama-3.1-8b-instant"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    violation_block_threshold: int = 5
    theory_sync_secret: str = "change_me_theory_sync_secret"
    astra_sso_secret: str = "change_me_coding_sso_secret"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
