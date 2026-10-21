"""Concentration metrics for sector capitalization and turnover."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from . import hhi, top_n_share


@dataclass(frozen=True)
class Concentration:
    hhi: float | None
    effective_n: float | None
    top1_share: float | None
    top5_share: float | None
    total: float | None
    count: int


def concentration(shares: Sequence[float | None]) -> Concentration:
    clean = [max(0.0, float(s)) for s in shares if s is not None and s >= 0]
    total = sum(clean) if clean else 0.0
    h = hhi(clean)
    return Concentration(
        hhi=h,
        effective_n=(1.0 / h) if h else None,
        top1_share=top_n_share(clean, 1) if total else None,
        top5_share=top_n_share(clean, 5) if total else None,
        total=total if clean else None,
        count=len(clean),
    )
