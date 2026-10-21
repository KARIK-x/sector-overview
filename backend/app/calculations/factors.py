"""Transparent factor scoring.

Missing factor values never receive the worst score. They are omitted and the
remaining weights are renormalised; the coverage is returned so the UI can
disclose it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import percentile_rank


@dataclass
class FactorScore:
    total: float | None
    contributions: dict[str, float]
    weights_used: dict[str, float]
    coverage: float
    missing: list[str]


def score_factors(
    values: dict[str, list[float | None]],
    weights: dict[str, float],
    higher_is_better: dict[str, bool] | None = None,
) -> dict[str, FactorScore]:
    """Percentile-rank each factor across sectors, then apply weights.

    ``values`` maps factor name -> one value per sector (None when missing).
    Returns one FactorScore per sector keyed by index position string.
    """
    higher_is_better = higher_is_better or {}
    n = len(next(iter(values.values()))) if values else 0
    ranks: dict[str, list[float | None]] = {}
    for name, series in values.items():
        ranked = percentile_rank(series)
        if higher_is_better.get(name, True) is False:
            ranked = [None if r is None else 1.0 - r for r in ranked]
        ranks[name] = ranked

    out: dict[str, FactorScore] = {}
    for i in range(n):
        available = {k: v[i] for k, v in ranks.items() if v[i] is not None}
        missing = [k for k in values if k not in available]
        total_weight = sum(weights.get(k, 0.0) for k in available)
        contributions: dict[str, float] = {}
        if total_weight > 0:
            for k, v in available.items():
                w = weights.get(k, 0.0) / total_weight
                contributions[k] = float(v * w * 100.0)
            total = sum(contributions.values())
        else:
            total = None
        out[str(i)] = FactorScore(
            total=total,
            contributions=contributions,
            weights_used={k: weights.get(k, 0.0) / total_weight for k in available}
            if total_weight
            else {},
            coverage=len(available) / len(values) if values else 0.0,
            missing=missing,
        )
    return out


def momentum_acceleration(returns_short: float | None, prior_short: float | None) -> float | None:
    if returns_short is None or prior_short is None:
        return None
    return returns_short - prior_short


def zscore_series(values: list[float | None]) -> list[float | None]:
    clean = [v for v in values if v is not None]
    if len(clean) < 2:
        return [None] * len(values)
    mu = float(np.mean(clean))
    sd = float(np.std(clean, ddof=1))
    if sd == 0:
        return [None] * len(values)
    return [None if v is None else (v - mu) / sd for v in values]
