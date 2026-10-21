"""A tiny in-process TTL cache for read-only analytics payloads.

The dataset only changes through an explicit ingestion run, so recomputing every
aggregate on each page load wastes CPU. Results are cached for a short window;
the API exposes freshness on every page so a short TTL is honest rather than
misleading.

This is deliberately simple: one process, one dictionary. A multi-worker
deployment would see per-worker caches, which is acceptable here because the
values are derived from an immutable snapshot of ingested history.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")

_CACHE: dict[str, tuple[float, Any]] = {}
DEFAULT_TTL = 90.0


def memo(key: str, ttl: float, producer: Callable[[], T]) -> T:
    now = time.monotonic()
    hit = _CACHE.get(key)
    if hit is not None and now - hit[0] < ttl:
        return hit[1]  # type: ignore[return-value]
    value = producer()
    _CACHE[key] = (now, value)
    return value


def clear() -> None:
    _CACHE.clear()
