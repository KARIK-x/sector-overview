"""HTTP helpers with bounded retries, timeouts, caching, and raw archival.

Raw responses are cached under ``data/raw`` only for public, documented sources
and are used for auditability. They are git-ignored.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import httpx
import pandas as pd

from ..config import settings

USER_AGENT = (
    "NEPSE-Sector-Intelligence/0.1 (independent research project; "
    "public documented sources only)"
)


def _cache_path(url: str, suffix: str) -> Path:
    digest = hashlib.sha256(url.encode()).hexdigest()[:20]
    return settings.raw_path / f"{digest}{suffix}"


def fetch_text(
    url: str,
    *,
    timeout: float = 45.0,
    retries: int = 3,
    use_cache: bool = False,
    suffix: str = ".txt",
) -> str:
    cache = _cache_path(url, suffix)
    if use_cache and cache.exists():
        return cache.read_text(encoding="utf-8", errors="replace")

    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if settings.github_token and "github" in url:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
                resp = client.get(url)
                resp.raise_for_status()
                text = resp.text
            if use_cache:
                cache.write_text(text, encoding="utf-8")
            return text
        except Exception as exc:  # noqa: BLE001 - retried and re-raised below
            last_error = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}") from last_error


def fetch_json(url: str, **kwargs: Any) -> Any:
    text = fetch_text(url, suffix=".json", **kwargs)
    return json.loads(text)


def fetch_csv(url: str, **kwargs: Any) -> pd.DataFrame:
    from io import StringIO

    text = fetch_text(url, suffix=".csv", **kwargs)
    return pd.read_csv(StringIO(text))
