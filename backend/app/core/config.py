from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Astra LMS API"
    database_url: str = "sqlite:///./astra_lms.db"
    jwt_secret_key: str = "change_me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    groq_api_key_structure: str = ""
    groq_api_key_notes: str = ""
    groq_api_key_quiz: str = ""
    groq_model: str = "llama-3.1-8b-instant"
    youtube_api_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def _all_groq_keys(self) -> list[str]:
        keys: list[str] = []
        for key in (
            self.groq_api_key_structure.strip(),
            self.groq_api_key_notes.strip(),
            self.groq_api_key_quiz.strip(),
        ):
            if key and key not in keys:
                keys.append(key)
        return keys

    def groq_keys_for_stage(self, stage: str) -> list[str]:
        """Pinned key first, then other Groq keys as failover."""
        primary_map = {
            "STRUCTURE": self.groq_api_key_structure,
            "CHAPTER_CONTENT": self.groq_api_key_notes,
            "CHAPTER_QUIZ": self.groq_api_key_quiz,
            "VIDEO": self.groq_api_key_notes,
            "GENERATE_ASSESSMENTS": self.groq_api_key_quiz,
        }
        primary = (primary_map.get(stage) or "").strip()
        keys: list[str] = []
        if primary:
            keys.append(primary)
        for key in self._all_groq_keys():
            if key not in keys:
                keys.append(key)
        return keys

    def groq_keys_for_notes_pool(self) -> list[str]:
        """All configured Groq keys for parallel lesson-note workers."""
        return self._all_groq_keys()


settings = Settings()
