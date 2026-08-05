from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # -------------------------
    # App
    # -------------------------
    app_name: str = "Astra LMS API"

    # -------------------------
    # Database
    # -------------------------
    database_url: str = "sqlite:///./astra_lms.db"

    # -------------------------
    # Authentication
    # -------------------------
    jwt_secret_key: str = "change_me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # -------------------------
    # Gemini AI
    # -------------------------
    gemini_api_key: str = ""
    gemini_chat_model: str = "gemini-3.6-flash"
    gemini_embedding_model: str = "gemini-embedding-001"

    # -------------------------
    # Qdrant
    # -------------------------
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "astra_documents"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()