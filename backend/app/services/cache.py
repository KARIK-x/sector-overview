"""A tiny TTL cache for read-only analytics payloads.

The dataset only changes through an explicit ingestion run, so recomputing every
aggregate on each page load wastes CPU. Results are cached for a short window in
memory and, when possible, on disk so a fresh process does not pay the full
computation cost on its first request.

This is deliberately simple: one process, one dictionary, plus one JSON file per
cache key. A multi-worker deployment would see per-worker caches, which is
acceptable here because the values are derived from an immutable snapshot of
ingested history.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")

_CACHE: dict[str, tuple[float, Any]] = {}
DEFAULT_TTL = 90.0


def _data_dir() -> Path:
    return Path(os.getenv("DATA_DIR", "backend/data"))


def _db_path() -> Path | None:
    try:
        from sqlalchemy.engine.url import make_url

        from app.config import settings

        url = make_url(settings.database_url)
    except Exception:  # noqa: BLE001
        return None
    if url.get_backend_name() != "sqlite":
        return None
    database = url.database
    if not database:
        return None
    candidate = Path(database)
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    return candidate


def _cache_dir() -> Path:
    return _data_dir() / "api_cache"


def _disk_path(key: str) -> Path:
    import hashlib

    return _cache_dir() / f"{hashlib.sha256(key.encode()).hexdigest()}.json"


def memo(key: str, ttl: float, producer: Callable[[], T]) -> T:
    """Return a cached value, using memory first and disk when available."""
    now = time.monotonic()
    hit = _CACHE.get(key)
    if hit is not None and now - hit[0] < ttl:
        return hit[1]  # type: ignore[return-value]

    db_path = _db_path()
    db_mtime = db_path.stat().st_mtime if db_path is not None and db_path.exists() else None
    disk = _disk_path(key)
    try:
        with disk.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if (
            isinstance(payload, dict)
            and "value" in payload
            and payload.get("db_mtime") == db_mtime
            and (db_mtime is not None or time.time() - float(payload.get("generated_at", 0)) < ttl)
        ):
            value = payload["value"]
            _CACHE[key] = (now, value)
            return value  # type: ignore[return-value]
    except (OSError, ValueError, TypeError, KeyError):
        pass

    value = producer()
    try:
        _cache_dir().mkdir(parents=True, exist_ok=True)
        payload = {"generated_at": time.time(), "db_mtime": db_mtime, "value": value}
        tmp = disk.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, allow_nan=False, separators=(",", ":"))
        tmp.replace(disk)
    except (OSError, TypeError, ValueError):
        pass
    _CACHE[key] = (now, value)
    return value


def clear() -> None:
    _CACHE.clear()
    try:
        for path in _cache_dir().glob("*.json"):
            path.unlink(missing_ok=True)
        for path in _cache_dir().glob("*.tmp"):
            path.unlink(missing_ok=True)
    except OSError:
        pass
