from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Azolla RGB Growth & Stress Analyzer"
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./azolla.db"
    data_dir: Path = Path("data")
    upload_dir: Path = Path("data/uploads")
    processed_dir: Path = Path("data/processed")
    export_dir: Path = Path("data/exports")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
