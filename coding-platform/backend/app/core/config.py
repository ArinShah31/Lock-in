from pydantic_settings import BaseSettings, SettingsConfigDict


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
    enable_exam_run_testcases: bool = True
    code_runner_timeout_seconds: int = 10
    code_runner_max_output_bytes: int = 10240
    code_runner_truncated_error_chars: int = 500

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
