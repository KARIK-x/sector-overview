"""Sector rotation quadrant model.

Axis contract (do not change without updating tests and the UI):
  x = absolute sector strength (cumulative return over the lookback)
  y = relative strength vs NEPSE (sector cumulative return - NEPSE return)

Quadrants:
  top-right    WINNING   absolute > 0 and relative > 0
  top-left     ADVANCING absolute <= 0 and relative > 0
  bottom-right LOSING    absolute > 0 and relative <= 0
  bottom-left  LAGGING   absolute <= 0 and relative <= 0
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from . import cumulative_return

QUADRANTS = ("WINNING", "ADVANCING", "LOSING", "LAGGING")


@dataclass(frozen=True)
class RotationMetrics:
    absolute_strength: float | None
    relative_strength: float | None
    rs_ratio: float | None
    quadrant: str | None


def classify_quadrant(
    absolute_strength: float | None,
    relative_strength: float | None,
    absolute_threshold: float = 0.0,
    relative_threshold: float = 0.0,
) -> str | None:
    if absolute_strength is None or relative_strength is None:
        return None
    if absolute_strength > absolute_threshold and relative_strength > relative_threshold:
        return "WINNING"
    if absolute_strength <= absolute_threshold and relative_strength > relative_threshold:
        return "ADVANCING"
    if absolute_strength > absolute_threshold and relative_strength <= relative_threshold:
        return "LOSING"
    return "LAGGING"


def relative_strength_ratio(
    sector_values: Sequence[float | None], market_values: Sequence[float | None], window: int
) -> float | None:
    if window <= 0:
        return None
    pairs = [
        (float(s), float(m))
        for s, m in zip(sector_values, market_values, strict=False)
        if s is not None and m is not None and math.isfinite(s) and math.isfinite(m)
    ]
    if len(pairs) < window + 1:
        return None
    s0, m0 = pairs[-1 - window]
    s1, m1 = pairs[-1]
    if s0 == 0 or m0 == 0:
        return None
    return (s1 / s0) / (m1 / m0)


def compute_rotation(
    sector_values: Sequence[float | None],
    market_values: Sequence[float | None],
    window: int,
    absolute_threshold: float = 0.0,
    relative_threshold: float = 0.0,
) -> RotationMetrics:
    abs_ret = cumulative_return(sector_values, window)
    mkt_ret = cumulative_return(market_values, window)
    rel = None if abs_ret is None or mkt_ret is None else abs_ret - mkt_ret
    ratio = relative_strength_ratio(sector_values, market_values, window)
    quadrant = classify_quadrant(abs_ret, rel, absolute_threshold, relative_threshold)
    return RotationMetrics(abs_ret, rel, ratio, quadrant)


def transition(previous: str | None, current: str | None) -> str | None:
    if previous is None or current is None:
        return None
    if previous == current:
        return None
    return f"{previous}->{current}"


def momentum_direction(current: float | None, previous: float | None) -> str | None:
    if current is None or previous is None:
        return None
    if current > previous:
        return "IMPROVING"
    if current < previous:
        return "DETERIORATING"
    return "FLAT"


@dataclass(frozen=True)
class RotationPoint:
    trade_date: date
    sector_code: str
    sector_name: str
    absolute_strength: float | None
    relative_strength: float | None
    rs_ratio: float | None
    quadrant: str | None
