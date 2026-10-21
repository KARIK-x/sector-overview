"""Sector breadth primitives.

A security with no observation on a date is *not* treated as unchanged. Only
traded/observed securities enter the advance-decline denominator; the rest are
reported separately as unavailable.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class BreadthCounts:
    advances: int
    declines: int
    unchanged: int
    traded: int
    unavailable: int
    eligible: int
    advance_pct: float | None
    decline_pct: float | None
    net_advances: int
    ad_ratio: float | None


def breadth_counts(
    changes: Sequence[float | None], eligible: int | None = None, unavailable: int = 0
) -> BreadthCounts:
    advances = sum(1 for c in changes if c is not None and c > 0)
    declines = sum(1 for c in changes if c is not None and c < 0)
    unchanged = sum(1 for c in changes if c is not None and c == 0)
    traded = advances + declines + unchanged
    denom = traded
    advance_pct = advances / denom if denom else None
    decline_pct = declines / denom if denom else None
    net = advances - declines
    ad_ratio = advances / declines if declines else None
    total_eligible = eligible if eligible is not None else traded + unavailable
    return BreadthCounts(
        advances=advances,
        declines=declines,
        unchanged=unchanged,
        traded=traded,
        unavailable=unavailable,
        eligible=total_eligible,
        advance_pct=advance_pct,
        decline_pct=decline_pct,
        net_advances=net,
        ad_ratio=ad_ratio,
    )


def pct_above_moving_average(series: Sequence[Sequence[float | None]], window: int) -> float | None:
    """Percentage of securities whose latest close is above their own MA."""
    if window <= 0:
        return None
    above = 0
    total = 0
    for values in series:
        clean = [v for v in values if v is not None]
        if len(clean) < window:
            continue
        ma = float(np.mean(clean[-window:]))
        total += 1
        if clean[-1] > ma:
            above += 1
    return above / total if total else None


def new_highs_lows(
    series: Sequence[Sequence[float | None]], window: int = 252
) -> tuple[int, int, int]:
    highs = 0
    lows = 0
    total = 0
    for values in series:
        clean = [v for v in values if v is not None]
        if len(clean) < 2:
            continue
        total += 1
        lookback = clean[-window:]
        if clean[-1] >= max(lookback):
            highs += 1
        if clean[-1] <= min(lookback):
            lows += 1
    return highs, lows, total


def breadth_thrust(advance_pct: Sequence[float | None], window: int = 10) -> float | None:
    clean = [v for v in advance_pct if v is not None]
    if len(clean) < window:
        return None
    return float(np.mean(clean[-window:]))


def divergence(
    breadth_values: Sequence[float | None], index_values: Sequence[float | None], window: int = 20
) -> str | None:
    """Describe a simple, transparent breadth/price divergence over a window."""
    b = [v for v in breadth_values if v is not None]
    i = [v for v in index_values if v is not None]
    if len(b) < window + 1 or len(i) < window + 1:
        return None
    b_change = b[-1] - b[-1 - window]
    i_change = i[-1] / i[-1 - window] - 1 if i[-1 - window] else 0.0
    if i_change > 0 and b_change < 0:
        return "PRICE_UP_BREADTH_DOWN"
    if i_change < 0 and b_change > 0:
        return "PRICE_DOWN_BREADTH_UP"
    return None
