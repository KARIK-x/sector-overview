from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BASE_DIR / ".env"), extra="ignore")

    database_url: str = f"sqlite:///{BASE_DIR / 'data' / 'sector_intelligence.db'}"
    data_dir: str = str(BASE_DIR / "data")
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
    github_token: str = ""

    # Public, documented sources (see DATA_SOURCE_AUDIT.md).
    yonepse_base: str = "https://shubhamnpk.github.io/yonepse"
    historical_subindex_base: str = (
        "https://raw.githubusercontent.com/menaceXnadin/"
        "nepse-historical-market-data-csv/master/data/subindices/unadjusted"
    )
    historical_index_base: str = (
        "https://raw.githubusercontent.com/menaceXnadin/"
        "nepse-historical-market-data-csv/master/data/index/unadjusted"
    )
    security_reference_url: str = (
        "https://raw.githubusercontent.com/binayabaral/nepal-market-data/main/"
        "data/reference/nepse-symbols.csv"
    )
    security_csv_base: str = (
        "https://raw.githubusercontent.com/binayabaral/nepal-market-data/main/data/nepse"
    )

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = BASE_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def raw_path(self) -> Path:
        p = self.data_path / "raw"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

# Make sure the data directory exists before the engine is created.
settings.data_path.mkdir(parents=True, exist_ok=True)
if settings.database_url.startswith("sqlite"):
    db_file = settings.database_url.split("sqlite:///")[-1]
    if db_file and db_file != ":memory:":
        Path(db_file if os.path.isabs(db_file) else BASE_DIR / db_file).parent.mkdir(
            parents=True, exist_ok=True
        )
