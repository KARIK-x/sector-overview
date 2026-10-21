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
    s = [v for v in sector_values if v is not None]
    m = [v for v in market_values if v is not None]
    if len(s) < window + 1 or len(m) < window + 1:
        return None
    s0, s1 = s[-1 - window], s[-1]
    m0, m1 = m[-1 - window], m[-1]
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
