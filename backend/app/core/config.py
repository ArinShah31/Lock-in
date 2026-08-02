from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Astra LMS API"
    database_url: str = "sqlite:///./astra_lms.db"
    jwt_secret_key: str = "change_me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    # gemini | groq | mock
    ai_provider: str = "gemini"
    gemini_api_key: str = ""
    # Optional comma-separated keys for quota rotation (429/rate limits only).
    gemini_api_keys: str = ""
    gemini_model: str = "gemini-3.6-flash"
    groq_api_key: str = ""
    # High free-tier daily limit; switch to llama-3.3-70b-versatile for higher quality.
    groq_model: str = "llama-3.1-8b-instant"
    uploads_dir: str = "uploads"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def resolve_gemini_api_keys(self) -> list[str]:
        keys: list[str] = []
        for part in self.gemini_api_keys.split(","):
            cleaned = part.strip()
            if cleaned and cleaned not in keys:
                keys.append(cleaned)
        primary = self.gemini_api_key.strip()
        if primary and primary not in keys:
            keys.insert(0, primary)
        return keys


settings = Settings()
