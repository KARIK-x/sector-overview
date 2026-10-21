from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from ..config import settings
from .http import fetch_csv, fetch_json, fetch_text


@dataclass(frozen=True)
class SectorSource:
    code: str
    name: str
    subindex_symbol: str
    yonepse_index_code: str


# The 13 official NEPSE equity sector sub-indices. The mapping is explicit and
# auditable; names follow the official sub-index names.
SECTOR_SOURCES: tuple[SectorSource, ...] = (
    SectorSource("BANKING", "Commercial Banks", "BANKING", "BANKSUBIND"),
    SectorSource("DEVBANK", "Development Banks", "DEVBANK", "DEVBANKIND"),
    SectorSource("FINANCE", "Finance", "FINANCE", "FININD"),
    SectorSource("HOTELS", "Hotels And Tourism", "HOTELS", "HOTELIND"),
    SectorSource("HYDROPOWER", "Hydro Power", "HYDROPOWER", "HYDPOWIND"),
    SectorSource("INVESTMENT", "Investment", "INVESTMENT", "INVIDX"),
    SectorSource("LIFEINS", "Life Insurance", "LIFEINSU", "LIFINSIND"),
    SectorSource("MANUFACTURE", "Manufacturing And Processing", "MANUFACTURE", "MANPROCIND"),
    SectorSource("MICROFINANCE", "Microfinance", "MICROFINANCE", "MICRFININD"),
    SectorSource("MUTUALFUND", "Mutual Fund", "MUTUAL", "MUTUALIND"),
    SectorSource("NONLIFE", "Non Life Insurance", "NONLIFEINSU", "NONLIFIND"),
    SectorSource("OTHERS", "Others", "OTHERS", "OTHERSIND"),
    SectorSource("TRADING", "Tradings", "TRADING", "TRDIND"),
)

SECTOR_BY_CODE = {s.code: s for s in SECTOR_SOURCES}
SECTOR_BY_YONEPSE = {s.yonepse_index_code: s for s in SECTOR_SOURCES}
SECTOR_BY_NAME = {s.name.lower(): s for s in SECTOR_SOURCES}

# Alternate spellings used by the security reference feed.
SECTOR_NAME_ALIASES = {
    "commercial bank": "BANKING",
    "commercial banks": "BANKING",
    "development bank": "DEVBANK",
    "development banks": "DEVBANK",
    "finance": "FINANCE",
    "hotels and tourism": "HOTELS",
    "hotels & tourism": "HOTELS",
    "hydro power": "HYDROPOWER",
    "hydropower": "HYDROPOWER",
    "investment": "INVESTMENT",
    "life insurance": "LIFEINS",
    "manufacturing and processing": "MANUFACTURE",
    "manufacturing & processing": "MANUFACTURE",
    "microfinance": "MICROFINANCE",
    "micro finance": "MICROFINANCE",
    "mutual fund": "MUTUALFUND",
    "non life insurance": "NONLIFE",
    "non-life insurance": "NONLIFE",
    "others": "OTHERS",
    "trading": "TRADING",
    "tradings": "TRADING",
}

NEPSE_INDEX_CODE = "NEPSE"


def normalize_sector(name: str | None) -> str | None:
    if not isinstance(name, str):
        return None
    cleaned = name.strip()
    if not cleaned:
        return None
    return SECTOR_NAME_ALIASES.get(cleaned.lower())


def fetch_yonepse_sector_indices() -> list[dict]:
    return fetch_json(f"{settings.yonepse_base}/data/market/sector_indices.json", use_cache=True)


def fetch_yonepse_indices() -> list[dict]:
    return fetch_json(f"{settings.yonepse_base}/data/market/indices.json", use_cache=True)


def fetch_yonepse_sector_codes() -> dict:
    return fetch_json(f"{settings.yonepse_base}/data/other/sector_codes.json", use_cache=True)


def fetch_yonepse_snapshot() -> list[dict]:
    return fetch_json(f"{settings.yonepse_base}/data/nepse_data.json", use_cache=True)


def fetch_yonepse_financials() -> list[dict]:
    return fetch_json(f"{settings.yonepse_base}/data/company/financials.json", use_cache=True)


def fetch_security_reference() -> pd.DataFrame:
    return fetch_csv(settings.security_reference_url, use_cache=True)


def fetch_sector_index_history(subindex_symbol: str) -> pd.DataFrame:
    url = f"{settings.historical_subindex_base}/{subindex_symbol}_unadjusted.csv"
    return fetch_csv(url, use_cache=True)


def fetch_nepse_index_history() -> pd.DataFrame:
    url = f"{settings.historical_index_base}/NEPSE_unadjusted.csv"
    return fetch_csv(url, use_cache=True)


def fetch_security_csv(symbol: str) -> pd.DataFrame | None:
    url = f"{settings.security_csv_base}/{symbol}.csv"
    try:
        return fetch_csv(url, use_cache=False, retries=2, timeout=30)
    except Exception:
        return None


def fetch_raw_text(url: str) -> str:
    return fetch_text(url, use_cache=True)
