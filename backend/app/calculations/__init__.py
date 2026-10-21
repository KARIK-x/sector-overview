"""Deterministic quantitative primitives.

Every function is written so that missing observations produce ``None`` rather
than a fabricated zero. Tests use hand-verified fixtures (see tests/).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

TRADING_SESSIONS_PER_YEAR = 252
SQRT_YEAR = math.sqrt(TRADING_SESSIONS_PER_YEAR)


def _clean(values: Sequence[float | None]) -> list[float]:
    out: list[float] = []
    for v in values:
        if v is None:
            break
        try:
            f = float(v)
        except (TypeError, ValueError):
            break
        if not math.isfinite(f):
            break
        out.append(f)
    return out


def cumulative_return(values: Sequence[float | None], window: int) -> float | None:
    """Return ``values[-1] / values[-1-window] - 1`` using session positions.

    ``window`` is a number of trading sessions, not calendar days. A missing
    final observation yields ``None`` rather than silently using an older value.
    """
    if window <= 0 or not values or values[-1] is None:
        return None
    clean = _clean(values)
    if len(clean) < window + 1:
        return None
    start = clean[-1 - window]
    if start == 0:
        return None
    return clean[-1] / start - 1.0


def period_return(close: float | None, previous: float | None) -> float | None:
    if close is None or previous is None or previous == 0:
        return None
    return close / previous - 1.0


def daily_returns(values: Sequence[float | None]) -> list[float | None]:
    out: list[float | None] = []
    prev: float | None = None
    for v in values:
        if v is None or prev is None or prev == 0:
            out.append(None)
        else:
            out.append(float(v) / prev - 1.0)
        prev = v
    return out


def ytd_return(dates: Sequence, values: Sequence[float | None]) -> float | None:
    """Return year-to-date using the last close before the current calendar year."""
    if not dates or not values:
        return None
    last_date = dates[-1]
    base_value = None
    for d, v in zip(dates, values, strict=False):
        if d.year < last_date.year and v is not None:
            base_value = v
        elif d.year == last_date.year:
            break
    current = values[-1]
    if base_value in (None, 0) or current is None:
        return None
    return float(current) / float(base_value) - 1.0


def running_peak(values: Sequence[float | None]) -> list[float | None]:
    out: list[float | None] = []
    peak: float | None = None
    for v in values:
        if v is None:
            out.append(None)
            continue
        peak = v if peak is None else max(peak, v)
        out.append(peak)
    return out


def drawdown_series(values: Sequence[float | None]) -> list[float | None]:
    peaks = running_peak(values)
    out: list[float | None] = []
    for v, p in zip(values, peaks, strict=False):
        if v is None or p in (None, 0):
            out.append(None)
        else:
            out.append(float(v) / float(p) - 1.0)
    return out


def max_drawdown(values: Sequence[float | None]) -> float | None:
    dd = [x for x in drawdown_series(values) if x is not None]
    return min(dd) if dd else None


def current_drawdown(values: Sequence[float | None]) -> float | None:
    dd = drawdown_series(values)
    for x in reversed(dd):
        if x is not None:
            return x
    return None


def annualized_volatility(returns: Sequence[float | None]) -> float | None:
    clean = [r for r in returns if r is not None and math.isfinite(r)]
    if len(clean) < 2:
        return None
    return float(np.std(clean, ddof=1) * SQRT_YEAR)


def downside_volatility(returns: Sequence[float | None], mar: float = 0.0) -> float | None:
    clean = [r for r in returns if r is not None and math.isfinite(r)]
    if len(clean) < 2:
        return None
    downside = [min(0.0, r - mar) for r in clean]
    return float(math.sqrt(np.mean(np.square(downside))) * SQRT_YEAR)


def mean(values: Sequence[float | None]) -> float | None:
    clean = [v for v in values if v is not None and math.isfinite(v)]
    return float(np.mean(clean)) if clean else None


def stdev(values: Sequence[float | None]) -> float | None:
    clean = [v for v in values if v is not None and math.isfinite(v)]
    if len(clean) < 2:
        return None
    return float(np.std(clean, ddof=1))


def beta(asset_returns: Sequence[float | None], market_returns: Sequence[float | None]) -> float | None:
    pairs = [
        (a, m)
        for a, m in zip(asset_returns, market_returns, strict=False)
        if a is not None and m is not None and math.isfinite(a) and math.isfinite(m)
    ]
    if len(pairs) < 3:
        return None
    a = np.array([p[0] for p in pairs])
    m = np.array([p[1] for p in pairs])
    var = np.var(m, ddof=1)
    if var == 0:
        return None
    return float(np.cov(a, m, ddof=1)[0][1] / var)


def correlation(x: Sequence[float | None], y: Sequence[float | None]) -> float | None:
    pairs = [
        (a, b)
        for a, b in zip(x, y, strict=False)
        if a is not None and b is not None and math.isfinite(a) and math.isfinite(b)
    ]
    if len(pairs) < 3:
        return None
    a = np.array([p[0] for p in pairs])
    b = np.array([p[1] for p in pairs])
    if np.std(a) == 0 or np.std(b) == 0:
        return None
    return float(np.corrcoef(a, b)[0][1])


def moving_average(values: Sequence[float | None], window: int) -> list[float | None]:
    out: list[float | None] = []
    buf: list[float] = []
    for v in values:
        if v is None:
            out.append(None)
            buf = []
            continue
        buf.append(float(v))
        if len(buf) > window:
            buf.pop(0)
        out.append(sum(buf) / window if len(buf) == window else None)
    return out


def ema(values: Sequence[float | None], window: int) -> list[float | None]:
    alpha = 2.0 / (window + 1)
    out: list[float | None] = []
    prev: float | None = None
    for v in values:
        if v is None:
            out.append(None)
            continue
        prev = float(v) if prev is None else alpha * float(v) + (1 - alpha) * prev
        out.append(prev)
    return out


def rsi(values: Sequence[float | None], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(values)):
        if values[i] is None or values[i - 1] is None:
            continue
        delta = float(values[i]) - float(values[i - 1])
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
        if len(gains) == period:
            avg_gain = sum(gains) / period
            avg_loss = sum(losses) / period
            out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
        elif len(gains) > period:
            avg_gain = (avg_gain * (period - 1) + gains[-1]) / period
            avg_loss = (avg_loss * (period - 1) + losses[-1]) / period
            out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def macd(
    values: Sequence[float | None], fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[list[float | None], list[float | None], list[float | None]]:
    fast_ema = ema(values, fast)
    slow_ema = ema(values, slow)
    line = [
        (f - s) if f is not None and s is not None else None
        for f, s in zip(fast_ema, slow_ema, strict=True)
    ]
    signal_line = ema(line, signal)
    hist = [
        (lead - sig) if lead is not None and sig is not None else None
        for lead, sig in zip(line, signal_line, strict=True)
    ]
    return line, signal_line, hist


def trend_slope(values: Sequence[float | None], window: int) -> float | None:
    clean = [v for v in values[-window:] if v is not None]
    if len(clean) < max(3, window // 2):
        return None
    x = np.arange(len(clean), dtype=float)
    y = np.array(clean, dtype=float)
    slope = np.polyfit(x, y, 1)[0]
    # Normalise by mean level so slopes are comparable across index levels.
    level = float(np.mean(y))
    return float(slope / level) if level else None


def rolling_std(returns: Sequence[float | None], window: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(returns)):
        if i + 1 < window:
            out.append(None)
            continue
        chunk = [r for r in returns[i + 1 - window : i + 1] if r is not None]
        out.append(float(np.std(chunk, ddof=1)) if len(chunk) >= 2 else None)
    return out


def percentile_rank(values: Sequence[float | None]) -> list[float | None]:
    clean = [v for v in values if v is not None]
    if not clean:
        return [None] * len(values)
    out: list[float | None] = []
    for v in values:
        if v is None:
            out.append(None)
        else:
            less = sum(1 for x in clean if x < v)
            equal = sum(1 for x in clean if x == v)
            out.append((less + 0.5 * equal) / len(clean))
    return out


def zscore(value: float | None, population: Sequence[float | None]) -> float | None:
    clean = [v for v in population if v is not None and math.isfinite(v)]
    if value is None or len(clean) < 2:
        return None
    sd = float(np.std(clean, ddof=1))
    if sd == 0:
        return None
    return (value - float(np.mean(clean))) / sd


def hhi(shares: Sequence[float | None]) -> float | None:
    clean = [max(0.0, float(s)) for s in shares if s is not None and s >= 0]
    total = sum(clean)
    if not clean or total == 0:
        return None
    return float(sum((s / total) ** 2 for s in clean))


def top_n_share(shares: Sequence[float | None], n: int) -> float | None:
    clean = sorted((max(0.0, float(s)) for s in shares if s is not None and s >= 0), reverse=True)
    total = sum(clean)
    if not clean or total == 0:
        return None
    return sum(clean[:n]) / total


def effective_n(shares: Sequence[float | None]) -> float | None:
    h = hhi(shares)
    return 1.0 / h if h else None


def safe_ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def var_historical(returns: Sequence[float | None], confidence: float = 0.95) -> float | None:
    clean = [r for r in returns if r is not None and math.isfinite(r)]
    if len(clean) < 20:
        return None
    return float(np.quantile(clean, max(0.0, 1 - confidence), method="lower"))


def cvar_historical(returns: Sequence[float | None], confidence: float = 0.95) -> float | None:
    clean = [r for r in returns if r is not None and math.isfinite(r)]
    if len(clean) < 20:
        return None
    q = np.quantile(clean, max(0.0, 1 - confidence), method="lower")
    tail = [r for r in clean if r <= q]
    return float(np.mean(tail)) if tail else None
