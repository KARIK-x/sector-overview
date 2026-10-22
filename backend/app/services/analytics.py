from __future__ import annotations

import math
from datetime import date
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from ..calculations import (
    annualized_volatility,
    beta,
    correlation,
    current_drawdown,
    cvar_historical,
    daily_returns,
    drawdown_series,
    max_drawdown,
    moving_average,
    trend_slope,
    var_historical,
)
from ..calculations import (
    macd as macd_calc,
)
from ..calculations import (
    rsi as rsi_calc,
)
from ..calculations.breadth import (
    breadth_counts,
    new_highs_lows,
    pct_above_moving_average,
)
from ..calculations.concentration import concentration
from ..calculations.factors import score_factors
from ..calculations.fundamentals import (
    CompanyFundamental,
    book_value_status,
)
from ..calculations.fundamentals import (
    aggregate as aggregate_fundamentals,
)
from ..calculations.rotation import (
    compute_rotation,
    momentum_direction,
    transition,
)
from ..ingestion.sources import NEPSE_INDEX_CODE, SECTOR_BY_CODE, SECTOR_BY_NAME, SECTOR_SOURCES
from ..models import (
    DailySummary,
    DataIssue,
    FundamentalReport,
    IndexObservation,
    IngestionRun,
    Sector,
    Security,
)

HORIZONS = (1, 5, 10, 20, 60, 120, 252)

FORBIDDEN_OHLC_KEY = "ohlc"


def _pct(value: float | None) -> float | None:
    return value


def sector_symbol(code: str) -> str:
    return SECTOR_BY_CODE[code].subindex_symbol


def load_index_frame(session: Session) -> pd.DataFrame:
    rows = session.execute(
        select(
            IndexObservation.index_code,
            IndexObservation.trade_date,
            IndexObservation.close,
        )
    ).all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["index_code", "trade_date", "close"])
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    df = df.dropna(subset=["close"])
    pivot = df.pivot_table(
        index="trade_date", columns="index_code", values="close", aggfunc="last"
    ).sort_index()
    pivot.index = pd.to_datetime(pivot.index)
    return pivot


def sector_meta(session: Session) -> list[dict[str, Any]]:
    sectors = session.scalars(select(Sector).order_by(Sector.name)).all()
    return [
        {
            "code": s.code,
            "name": s.name,
            "index_code": s.index_code,
            "index_name": s.index_name,
            "description": s.description,
            "active": s.active,
            "subindex_symbol": sector_symbol(s.code),
        }
        for s in sectors
    ]


def _pair(frame: pd.DataFrame, code: str) -> pd.DataFrame:
    sym = sector_symbol(code)
    if sym not in frame.columns or NEPSE_INDEX_CODE not in frame.columns:
        return pd.DataFrame(columns=[sym, NEPSE_INDEX_CODE])
    return frame[[sym, NEPSE_INDEX_CODE]].dropna()


def _ret(series: pd.Series, window: int) -> float | None:
    if window <= 0 or len(series) < window + 1:
        return None
    start = float(series.iloc[-1 - window])
    end = float(series.iloc[-1])
    if start == 0:
        return None
    return end / start - 1.0


def _date_str(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return pd.Timestamp(value).date().isoformat()


def _latest(frame: pd.DataFrame) -> date | None:
    if frame.empty:
        return None
    return pd.Timestamp(frame.index.max()).date()


def rotation_rows(frame: pd.DataFrame, window: int, abs_thr: float, rel_thr: float) -> list[dict]:
    rows: list[dict] = []
    latest = _latest(frame)
    if latest is None:
        return rows
    for code in SECTOR_BY_CODE:
        pair = _pair(frame, code)
        if len(pair) < window + 1:
            rows.append(
                {
                    "code": code,
                    "name": SECTOR_BY_CODE[code].name,
                    "absolute_strength": None,
                    "relative_strength": None,
                    "rs_ratio": None,
                    "quadrant": None,
                    "return_5": None,
                    "return_20": None,
                    "return_60": None,
                    "return_120": None,
                    "momentum_change": None,
                    "momentum_direction": None,
                    "latest_date": None,
                    "observations": len(pair),
                    "status": "INSUFFICIENT_HISTORY",
                }
            )
            continue
        metrics = compute_rotation(
            pair[sector_symbol(code)].tolist(), pair[NEPSE_INDEX_CODE].tolist(), window, abs_thr, rel_thr
        )
        r20 = _ret(pair[sector_symbol(code)], 20)
        prior20 = None
        if len(pair) >= 40:
            prior20 = float(pair[sector_symbol(code)].iloc[-21]) / float(
                pair[sector_symbol(code)].iloc[-41]
            ) - 1.0
        mom_change = None if r20 is None or prior20 is None else r20 - prior20
        rows.append(
            {
                "code": code,
                "name": SECTOR_BY_CODE[code].name,
                "absolute_strength": metrics.absolute_strength,
                "relative_strength": metrics.relative_strength,
                "rs_ratio": metrics.rs_ratio,
                "quadrant": metrics.quadrant,
                "return_5": _ret(pair[sector_symbol(code)], 5),
                "return_20": r20,
                "return_60": _ret(pair[sector_symbol(code)], 60),
                "return_120": _ret(pair[sector_symbol(code)], 120),
                "momentum_change": mom_change,
                "momentum_direction": momentum_direction(r20, prior20),
                "latest_date": _date_str(pair.index.max()),
                "observations": len(pair),
                "status": "OK" if len(pair) >= 252 else "PARTIAL_HISTORY",
            }
        )
    return rows


def sector_context(session: Session) -> tuple[dict[str, dict[str, Any]], date | None]:
    """Latest-day cross-section used to size and annotate sector bubbles.

    One query for turnover/breadth (grouped by sector), one for market cap, and
    one for the per-security turnover needed to compute within-sector HHI. Every
    value is ``None`` when the source has no observation; nothing is zero-filled.
    """
    ctx: dict[str, dict[str, Any]] = {}
    latest = session.scalar(
        select(func.max(DailySummary.trade_date)).where(DailySummary.pct_change.is_not(None))
    )
    if latest is None:
        return ctx, None

    rows = session.execute(
        select(
            DailySummary.sector_name,
            func.sum(DailySummary.turnover),
            func.sum(DailySummary.volume),
            func.count(DailySummary.symbol),
            func.sum(case((DailySummary.pct_change > 0, 1), else_=0)),
            func.sum(case((DailySummary.pct_change < 0, 1), else_=0)),
            func.sum(case((DailySummary.pct_change == 0, 1), else_=0)),
        )
        .where(DailySummary.trade_date == latest, DailySummary.pct_change.is_not(None))
        .group_by(DailySummary.sector_name)
    ).all()
    total_turnover = sum(float(r[1]) for r in rows if r[1] is not None)
    for name, turnover, volume, traded, advances, declines, unchanged in rows:
        traded_n = int(traded or 0)
        ctx[name] = {
            "turnover": float(turnover) if turnover is not None else None,
            "volume": float(volume) if volume is not None else None,
            "traded": traded_n,
            "advances": int(advances or 0),
            "declines": int(declines or 0),
            "unchanged": int(unchanged or 0),
            "advance_pct": (int(advances or 0) / traded_n) if traded_n else None,
            "turnover_share": (
                float(turnover) / total_turnover
                if turnover is not None and total_turnover
                else None
            ),
        }

    caps = session.execute(
        select(Security.sector_name, func.sum(Security.market_cap))
        .where(Security.sector_name.is_not(None), Security.market_cap.is_not(None))
        .group_by(Security.sector_name)
    ).all()
    for name, cap in caps:
        if name in ctx and cap is not None:
            ctx[name]["market_cap"] = float(cap)

    # Within-sector turnover concentration on the same session. This is the
    # only place security-level turnover is read; it never leaves the sector.
    members = session.execute(
        select(DailySummary.sector_name, DailySummary.symbol, DailySummary.turnover).where(
            DailySummary.trade_date == latest, DailySummary.turnover.is_not(None)
        )
    ).all()
    if members:
        mdf = pd.DataFrame(members, columns=["sector_name", "symbol", "turnover"])
        for name, group in mdf.groupby("sector_name"):
            if name not in ctx:
                continue
            values = group["turnover"].astype(float)
            total = float(values.sum())
            if total <= 0:
                continue
            shares = values / total
            hhi = float((shares**2).sum())
            ctx[name].update(
                {
                    "hhi": hhi,
                    "effective_n": (1.0 / hhi) if hhi > 0 else None,
                    "top1_share": float(shares.max()),
                }
            )
    return ctx, latest


def rotation_payload(session: Session, window: int = 20, abs_thr: float = 0.0, rel_thr: float = 0.0):
    frame = load_index_frame(session)
    rows = rotation_rows(frame, window, abs_thr, rel_thr)
    context, context_date = sector_context(session)

    # Bubble-size and tooltip fields. Volatility is measured on the same sector
    # series and window guard as the risk lab (252 sessions), so the rotation
    # map and the risk table cannot disagree about the same number.
    for row in rows:
        pair = _pair(frame, row["code"])
        context_row = context.get(row["name"], {})
        row.update(
            {
                "volatility": (
                    annualized_volatility(
                        daily_returns(pair[sector_symbol(row["code"])].tolist())[-252:]
                    )
                    if len(pair) >= 30
                    else None
                ),
                "return_5": row.get("return_5"),
                "market_cap": context_row.get("market_cap"),
                "turnover": context_row.get("turnover"),
                "turnover_share": context_row.get("turnover_share"),
                "advance_pct": context_row.get("advance_pct"),
                "traded": context_row.get("traded"),
                "hhi": context_row.get("hhi"),
                "effective_n": context_row.get("effective_n"),
                "top1_share": context_row.get("top1_share"),
                "context_date": _date_str(context_date),
            }
        )

    transitions = rotation_transitions(frame, window, abs_thr, rel_thr, sessions=1)
    return {
        "window": window,
        "absolute_threshold": abs_thr,
        "relative_threshold": rel_thr,
        "latest_date": _date_str(_latest(frame)),
        "context_date": _date_str(context_date),
        "rows": rows,
        "transitions": transitions,
        "axes": {
            "x": "Absolute strength: sector cumulative return over the window",
            "y": "Relative strength: sector return minus NEPSE return over the window",
        },
        "quadrants": {
            "top_right": "WINNING",
            "top_left": "ADVANCING",
            "bottom_right": "LOSING",
            "bottom_left": "LAGGING",
        },
        "bubble_metrics": {
            "market_cap": "Sum of current member market capitalisation (NPR)",
            "turnover": "Latest-session member turnover (NPR)",
            "volatility": "252-session annualised volatility of the sector index",
            "advance_pct": "Share of observed members that advanced on the latest session",
        },
        "notes": [
            "Market cap and turnover are latest-session context, not lookback-window aggregates.",
            "Bubble metrics are disabled when the source has no observation for that sector.",
        ],
    }


def rotation_history(session: Session, window: int = 20, sessions: int = 120) -> dict:
    """Per-session relative-strength rank for every sector.

    Relative return is computed on each sector's own observed dates; the series
    are then aligned on the union calendar. A sector with no observation on a
    date is *not ranked* that session (null), rather than being carried forward.
    Rank 1 is the strongest excess return.
    """
    frame = load_index_frame(session)
    if frame.empty:
        return {"available": False, "reason": "No index observations."}
    relative: dict[str, pd.Series] = {}
    absolute: dict[str, pd.Series] = {}
    for code in SECTOR_BY_CODE:
        pair = _pair(frame, code)
        if len(pair) <= window:
            continue
        sector = pair[sector_symbol(code)]
        market = pair[NEPSE_INDEX_CODE]
        sector_ret = sector / sector.shift(window) - 1.0
        market_ret = market / market.shift(window) - 1.0
        absolute[code] = sector_ret
        relative[code] = sector_ret - market_ret
    if not relative:
        return {"available": False, "reason": "Insufficient index history for this window."}
    rel_df = pd.DataFrame(relative).dropna(how="all").tail(sessions)
    abs_df = pd.DataFrame(absolute).reindex(rel_df.index)
    ranks = rel_df.rank(axis=1, ascending=False, method="min")
    dates = [_date_str(d) for d in rel_df.index]

    def clean(series: pd.Series) -> list[float | None]:
        return [None if pd.isna(v) else float(v) for v in series]

    return {
        "available": True,
        "window": window,
        "sessions": len(rel_df),
        "latest_date": _date_str(rel_df.index.max()) if len(rel_df) else None,
        "dates": dates,
        "series": [
            {
                "code": code,
                "name": SECTOR_BY_CODE[code].name,
                "relative": clean(rel_df[code]),
                "absolute": clean(abs_df[code]) if code in abs_df else [],
                "rank": [None if pd.isna(v) else int(v) for v in ranks[code]],
            }
            for code in rel_df.columns
        ],
        "method": (
            "Rank is computed each session across sectors with an observation on that "
            "date. Missing observations are not ranked and are not carried forward."
        ),
    }


def compare_series(
    session: Session,
    codes: list[str],
    start: str | None = None,
    end: str | None = None,
    limit: int = 2000,
) -> dict:
    """Date-aligned index levels for a multi-sector comparison."""
    frame = load_index_frame(session)
    if frame.empty:
        return {"available": False, "reason": "No index observations."}
    selected: list[tuple[str, str, str]] = []
    for raw in codes:
        code = raw.strip().upper()
        if not code:
            continue
        if code == NEPSE_INDEX_CODE:
            selected.append((NEPSE_INDEX_CODE, "NEPSE Index", NEPSE_INDEX_CODE))
        elif code in SECTOR_BY_CODE:
            selected.append((code, SECTOR_BY_CODE[code].name, sector_symbol(code)))
        else:
            raise KeyError(code)
    if not selected:
        raise ValueError("At least one sector code is required.")
    columns = []
    for _, _, symbol in selected:
        if symbol not in frame.columns:
            raise KeyError(symbol)
        columns.append(symbol)

    index = frame.index
    if start:
        index = index[index >= pd.Timestamp(start)]
    if end:
        index = index[index <= pd.Timestamp(end)]
    if len(index) == 0:
        return {"available": False, "reason": "No observations in the requested range."}
    subset = frame.loc[index, columns]
    if len(subset) > limit:
        step = int(math.ceil(len(subset) / limit))
        subset = subset.iloc[::step]
        if subset.index[-1] != index[-1]:
            subset = pd.concat([subset, frame.loc[[index[-1]], columns]])

    series = []
    for code, name, symbol in selected:
        values = subset[symbol]
        points = [
            {"date": _date_str(d), "close": float(v)}
            for d, v in zip(subset.index, values, strict=True)
            if pd.notna(v)
        ]
        series.append(
            {
                "code": code,
                "name": name,
                "first_date": points[0]["date"] if points else None,
                "last_date": points[-1]["date"] if points else None,
                "points": points,
            }
        )
    first = max((s["first_date"] for s in series if s["first_date"]), default=None)
    return {
        "available": True,
        "start": _date_str(index.min()),
        "end": _date_str(index.max()),
        "common_start": first,
        "series": series,
        "notes": [
            "Index levels are unadjusted. Normalisation, when shown, uses each series' first observation in the range.",
        ],
    }


def rotation_trails(
    session: Session,
    window: int = 20,
    sessions: int = 30,
    abs_thr: float = 0.0,
    rel_thr: float = 0.0,
):
    frame = load_index_frame(session)
    out: dict[str, list[dict]] = {}
    for code in SECTOR_BY_CODE:
        pair = _pair(frame, code)
        points = []
        if len(pair) >= window + 1:
            start = max(window, len(pair) - sessions)
            for i in range(start, len(pair)):
                hist = pair.iloc[: i + 1]
                metrics = compute_rotation(
                    hist[sector_symbol(code)].tolist(),
                    hist[NEPSE_INDEX_CODE].tolist(),
                    window,
                    abs_thr,
                    rel_thr,
                )
                if metrics.absolute_strength is None:
                    continue
                points.append(
                    {
                        "date": _date_str(hist.index[-1]),
                        "absolute_strength": metrics.absolute_strength,
                        "relative_strength": metrics.relative_strength,
                        "rs_ratio": metrics.rs_ratio,
                        "quadrant": metrics.quadrant,
                    }
                )
        out[code] = points
    return {"window": window, "sessions": sessions, "trails": out, "latest_date": _date_str(_latest(frame))}


def rotation_transitions(
    frame: pd.DataFrame,
    window: int = 20,
    abs_thr: float = 0.0,
    rel_thr: float = 0.0,
    sessions: int = 10,
) -> list[dict]:
    events: list[dict] = []
    if frame.empty:
        return events
    for code in SECTOR_BY_CODE:
        pair = _pair(frame, code)
        if len(pair) < window + 2:
            continue
        start = max(window, len(pair) - sessions - 1)
        prev = None
        for i in range(start, len(pair)):
            hist = pair.iloc[: i + 1]
            metrics = compute_rotation(
                hist[sector_symbol(code)].tolist(),
                hist[NEPSE_INDEX_CODE].tolist(),
                window,
                abs_thr,
                rel_thr,
            )
            if prev is None:
                prev = metrics.quadrant
                continue
            tr = transition(prev, metrics.quadrant)
            if tr:
                events.append(
                    {
                        "date": _date_str(hist.index[-1]),
                        "code": code,
                        "name": SECTOR_BY_CODE[code].name,
                        "from": prev,
                        "to": metrics.quadrant,
                        "absolute_strength": metrics.absolute_strength,
                        "relative_strength": metrics.relative_strength,
                    }
                )
            prev = metrics.quadrant
    events.sort(key=lambda e: (e["date"] or "", e["name"]), reverse=True)
    return events[:80]


def heatmap_payload(session: Session):
    frame = load_index_frame(session)
    rows = []
    for code in SECTOR_BY_CODE:
        pair = _pair(frame, code)
        series = pair[sector_symbol(code)] if not pair.empty else pd.Series(dtype=float)
        row = {"code": code, "name": SECTOR_BY_CODE[code].name}
        for h in HORIZONS:
            row[f"r{h}"] = _ret(series, h) if len(series) > h else None
        row["latest_date"] = _date_str(pair.index.max()) if not pair.empty else None
        rows.append(row)
    return {"horizons": list(HORIZONS), "rows": rows, "latest_date": _date_str(_latest(frame))}


def _summary_agg(session: Session, sector_name: str | None = None) -> pd.DataFrame:
    stmt = select(
        DailySummary.trade_date,
        DailySummary.sector_name,
        func.sum(DailySummary.turnover).label("turnover"),
        func.sum(DailySummary.volume).label("volume"),
        func.count(DailySummary.symbol).label("securities"),
    ).where(DailySummary.pct_change.is_not(None))
    if sector_name:
        stmt = stmt.where(DailySummary.sector_name == sector_name)
    stmt = stmt.group_by(DailySummary.trade_date, DailySummary.sector_name).order_by(
        DailySummary.trade_date
    )
    rows = session.execute(stmt).all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["trade_date", "sector_name", "turnover", "volume", "securities"])
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df


def breadth_summary(session: Session, sector_name: str | None = None) -> dict:
    stmt = select(
        DailySummary.sector_name,
        DailySummary.trade_date,
        func.sum(case((DailySummary.pct_change > 0, 1), else_=0)).label("advances"),
        func.sum(case((DailySummary.pct_change < 0, 1), else_=0)).label("declines"),
        func.sum(case((DailySummary.pct_change == 0, 1), else_=0)).label("unchanged"),
        func.count(DailySummary.symbol).label("traded"),
    ).where(DailySummary.pct_change.is_not(None))
    if sector_name:
        stmt = stmt.where(DailySummary.sector_name == sector_name)
    stmt = stmt.group_by(DailySummary.sector_name, DailySummary.trade_date).order_by(
        DailySummary.trade_date
    )
    rows = session.execute(stmt).all()
    if not rows:
        return {"available": False, "reason": "No security daily summaries have been ingested."}
    df = pd.DataFrame(
        rows, columns=["sector_name", "trade_date", "advances", "declines", "unchanged", "traded"]
    )
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    latest = df[df["trade_date"] == df["trade_date"].max()]
    rows_out = []
    for r in latest.itertuples():
        counts = breadth_counts(
            [1] * int(r.advances) + [-1] * int(r.declines) + [0] * int(r.unchanged),
            eligible=int(r.traded),
            unavailable=0,
        )
        rows_out.append(
            {
                "sector_name": r.sector_name,
                "advances": counts.advances,
                "declines": counts.declines,
                "unchanged": counts.unchanged,
                "traded": counts.traded,
                "advance_pct": counts.advance_pct,
                "decline_pct": counts.decline_pct,
                "net_advances": counts.net_advances,
                "ad_ratio": counts.ad_ratio,
            }
        )
    history = (
        df.groupby("trade_date")[["advances", "declines", "unchanged"]].sum().reset_index().tail(260)
    )
    frame = load_index_frame(session)
    index_history: list[dict[str, Any]] = []
    if NEPSE_INDEX_CODE in frame.columns:
        index_series = frame[NEPSE_INDEX_CODE].dropna().tail(260)
        index_history = [
            {"date": _date_str(d), "close": float(v)}
            for d, v in zip(index_series.index, index_series, strict=True)
        ]
    return {
        "available": True,
        "latest_date": _date_str(df["trade_date"].max()),
        "rows": sorted(rows_out, key=lambda x: (x["advance_pct"] or 0), reverse=True),
        "history": [
            {
                "date": _date_str(r.trade_date),
                "advances": int(r.advances),
                "declines": int(r.declines),
                "unchanged": int(r.unchanged),
                "advance_pct": (r.advances / (r.advances + r.declines + r.unchanged))
                if (r.advances + r.declines + r.unchanged)
                else None,
            }
            for r in history.itertuples()
        ],
        "index_history": index_history,
        "method": "Counts use observed security summaries only; a security with no row is not treated as unchanged.",
    }


def _sector_symbols(session: Session, sector_name: str) -> list[str]:
    return session.scalars(
        select(Security.symbol).where(
            Security.sector_name == sector_name,
            Security.instrument_type == "ordinary",
            Security.status == "listed",
        )
    ).all()


def _load_sector_summaries(session: Session, sector_name: str) -> pd.DataFrame:
    rows = session.execute(
        select(
            DailySummary.trade_date,
            DailySummary.symbol,
            DailySummary.close,
            DailySummary.pct_change,
            DailySummary.turnover,
            DailySummary.volume,
        ).where(DailySummary.sector_name == sector_name)
    ).all()
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows, columns=["trade_date", "symbol", "close", "pct_change", "turnover", "volume"])
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    return df


def sector_breadth(session: Session, sector_name: str) -> dict:
    symbols = _sector_symbols(session, sector_name)
    df = _load_sector_summaries(session, sector_name)
    if df.empty or not symbols:
        return {"available": False, "reason": "No security summaries for this sector.", "eligible": len(symbols)}
    latest = df["trade_date"].max()
    today = df[df["trade_date"] == latest]
    observed = set(today["symbol"])
    unavailable = len(set(symbols) - observed)
    counts = breadth_counts(
        today["pct_change"].dropna().tolist(), eligible=len(symbols), unavailable=unavailable
    )
    # Moving-average breadth needs per-symbol close history.
    pivot = df.pivot_table(index="trade_date", columns="symbol", values="close", aggfunc="last")
    ma = {}
    for w in (20, 50, 100, 200):
        ma[str(w)] = pct_above_moving_average([pivot[c].dropna().tolist() for c in pivot.columns], w)
    highs, lows, total = new_highs_lows([pivot[c].dropna().tolist() for c in pivot.columns], 252)
    history = (
        df.dropna(subset=["pct_change"])
        .groupby("trade_date")
        .apply(
            lambda g: pd.Series(
                {
                    "advances": int((g["pct_change"] > 0).sum()),
                    "declines": int((g["pct_change"] < 0).sum()),
                    "unchanged": int((g["pct_change"] == 0).sum()),
                }
            ),
            include_groups=False,
        )
        .reset_index()
        .tail(260)
    )
    adv_pct = [
        (r.advances / (r.advances + r.declines + r.unchanged))
        if (r.advances + r.declines + r.unchanged)
        else None
        for r in history.itertuples()
    ]
    return {
        "available": True,
        "eligible": len(symbols),
        "observed": len(observed),
        "unavailable": unavailable,
        "counts": counts.__dict__,
        "above_ma_pct": ma,
        "new_highs": highs,
        "new_lows": lows,
        "new_highs_lows_denominator": total,
        "history": [
            {
                "date": _date_str(r.trade_date),
                "advances": int(r.advances),
                "declines": int(r.declines),
                "unchanged": int(r.unchanged),
                "advance_pct": adv_pct[i],
            }
            for i, r in enumerate(history.itertuples())
        ],
        "divergence": None,
        "notes": [
            "Historical sector membership is not published by the available sources; the current "
            "official membership is applied to history and this is disclosed as a limitation.",
            "A security without an observation is counted as unavailable, never as unchanged.",
        ],
    }


def liquidity_summary(session: Session) -> dict:
    df = _summary_agg(session)
    if df.empty:
        return {"available": False, "reason": "No security daily summaries have been ingested."}
    latest = df["trade_date"].max()
    today = df[df["trade_date"] == latest].copy()
    total = today["turnover"].sum()
    today["share"] = today["turnover"] / total if total else None
    rows = today.sort_values("turnover", ascending=False)
    history = df.pivot_table(index="trade_date", columns="sector_name", values="turnover", aggfunc="sum").tail(260)
    context, _context_date = sector_context(session)
    frame = load_index_frame(session)
    rows_out = []
    for r in rows.itertuples():
        source = SECTOR_BY_NAME.get(str(r.sector_name).lower())
        ret5 = ret20 = ret60 = None
        if source is not None and not frame.empty:
            pair = _pair(frame, source.code)
            if not pair.empty:
                values = pair[sector_symbol(source.code)]
                ret5 = _ret(values, 5)
                ret20 = _ret(values, 20)
                ret60 = _ret(values, 60)
        ctx = context.get(r.sector_name, {})
        rows_out.append(
            {
                "sector_name": r.sector_name,
                "turnover": float(r.turnover) if pd.notna(r.turnover) else None,
                "volume": float(r.volume) if pd.notna(r.volume) else None,
                "securities": int(r.securities),
                "share": float(r.share) if pd.notna(r.share) else None,
                "return_5": ret5,
                "return_20": ret20,
                "return_60": ret60,
                "market_cap": ctx.get("market_cap"),
                "hhi": ctx.get("hhi"),
                "effective_n": ctx.get("effective_n"),
                "top1_share": ctx.get("top1_share"),
            }
        )
    return {
        "available": True,
        "latest_date": _date_str(latest),
        "total_turnover": float(total),
        "rows": rows_out,
        "history": [
            {"date": _date_str(idx), **{k: (None if pd.isna(v) else float(v)) for k, v in row.items()}}
            for idx, row in history.iterrows()
        ],
        "notes": [
            "Turnover is the sum of observed security traded amounts and is not investor capital inflow.",
            "Historical transaction counts are not present in the verified daily-summary source; only turnover and volume are shown historically.",
        ],
    }


def sector_liquidity(session: Session, sector_name: str) -> dict:
    df = _load_sector_summaries(session, sector_name)
    if df.empty:
        return {"available": False, "reason": "No security summaries for this sector."}
    latest = df["trade_date"].max()
    today = df[df["trade_date"] == latest].copy()
    conc = concentration(today["turnover"].tolist())
    total = today["turnover"].sum()
    today["share"] = today["turnover"] / total if total else None
    top = today.sort_values("turnover", ascending=False).head(10)
    hist = df.groupby("trade_date").agg(turnover=("turnover", "sum"), volume=("volume", "sum")).tail(260)
    return {
        "available": True,
        "latest_date": _date_str(latest),
        "turnover": float(total) if pd.notna(total) else None,
        "volume": float(today["volume"].sum()) if pd.notna(today["volume"].sum()) else None,
        "concentration": conc.__dict__,
        "top": [
            {
                "symbol": r.symbol,
                "turnover": float(r.turnover) if pd.notna(r.turnover) else None,
                "share": float(r.share) if pd.notna(r.share) else None,
            }
            for r in top.itertuples()
        ],
        "history": [
            {
                "date": _date_str(idx),
                "turnover": float(row.turnover) if pd.notna(row.turnover) else None,
                "volume": float(row.volume) if pd.notna(row.volume) else None,
            }
            for idx, row in hist.iterrows()
        ],
        "notes": ["Turnover is trading value, not net investor inflow."],
    }


def risk_summary(session: Session) -> dict:
    frame = load_index_frame(session)
    if frame.empty:
        return {"available": False, "reason": "No index observations."}
    rows = []
    for code in SECTOR_BY_CODE:
        pair = _pair(frame, code)
        if len(pair) < 30:
            continue
        s_ret = daily_returns(pair[sector_symbol(code)].tolist())
        m_ret = daily_returns(pair[NEPSE_INDEX_CODE].tolist())
        values = pair[sector_symbol(code)].tolist()
        rows.append(
            {
                "code": code,
                "name": SECTOR_BY_CODE[code].name,
                "volatility": annualized_volatility(s_ret[-252:]),
                "max_drawdown": max_drawdown(values),
                "current_drawdown": current_drawdown(values),
                "beta": beta(s_ret[-252:], m_ret[-252:]),
                "correlation": correlation(s_ret[-252:], m_ret[-252:]),
                "var_95": var_historical(s_ret[-252:]),
                "cvar_95": cvar_historical(s_ret[-252:]),
                "observations": len(pair),
            }
        )
    matrix = None
    codes = [code for code in SECTOR_BY_CODE if sector_symbol(code) in frame.columns]
    matrix_columns = [sector_symbol(code) for code in codes] + [NEPSE_INDEX_CODE]
    if len(codes) >= 2:
        prices = frame[matrix_columns].tail(253)
        returns = prices.pct_change().dropna(how="all")
        corr = returns.corr(min_periods=30)
        matrix = {
            "codes": codes + [NEPSE_INDEX_CODE],
            "labels": [SECTOR_BY_CODE[code].name for code in codes] + ["NEPSE"],
            "values": [
                [None if pd.isna(v) else round(float(v), 4) for v in row]
                for row in corr.to_numpy()
            ],
            "window": 252,
        }
    return {
        "available": True,
        "latest_date": _date_str(_latest(frame)),
        "rows": rows,
        "correlation_matrix": matrix,
        "notes": [
            "Correlations use pairwise-complete daily returns over the last 252 sessions.",
        ],
    }


def sector_risk(session: Session, code: str) -> dict:
    frame = load_index_frame(session)
    pair = _pair(frame, code)
    if len(pair) < 30:
        return {"available": False, "reason": "Insufficient index history."}
    values = pair[sector_symbol(code)].tolist()
    s_ret = daily_returns(values)
    m_ret = daily_returns(pair[NEPSE_INDEX_CODE].tolist())
    s_series = pd.Series(s_ret, index=pair.index, dtype="float64")
    m_series = pd.Series(m_ret, index=pair.index, dtype="float64")
    roll_corr = s_series.rolling(60, min_periods=40).corr(m_series)
    roll_vol = s_series.rolling(20, min_periods=15).std() * math.sqrt(252)
    rolling = [
        {
            "date": _date_str(d),
            "correlation": None if pd.isna(c) else float(c),
            "volatility": None if pd.isna(v) else float(v),
        }
        for d, c, v in zip(pair.index, roll_corr, roll_vol, strict=True)
        if not (pd.isna(c) and pd.isna(v))
    ][-260:]
    return {
        "available": True,
        "volatility": annualized_volatility(s_ret[-252:]),
        "max_drawdown": max_drawdown(values),
        "current_drawdown": current_drawdown(values),
        "beta": beta(s_ret[-252:], m_ret[-252:]),
        "correlation": correlation(s_ret[-252:], m_ret[-252:]),
        "var_95": var_historical(s_ret[-252:]),
        "cvar_95": cvar_historical(s_ret[-252:]),
        "rolling": rolling,
        "drawdown_series": [
            {"date": _date_str(d), "drawdown": v}
            for d, v in zip(pair.index, drawdown_series(values), strict=False)
            if v is not None
        ][-260:],
    }


def sector_detail(session: Session, code: str) -> dict:
    if code not in SECTOR_BY_CODE:
        raise KeyError(code)
    frame = load_index_frame(session)
    pair = _pair(frame, code)
    if pair.empty:
        return {"code": code, "name": SECTOR_BY_CODE[code].name, "available": False}
    sym = sector_symbol(code)
    values = pair[sym].tolist()
    rows_ret = {f"r{h}": _ret(pair[sym], h) for h in HORIZONS}
    ma20 = moving_average(values, 20)
    ma50 = moving_average(values, 50)
    ma200 = moving_average(values, 200)
    rsi_series = rsi_calc(values)
    macd_line, signal_line, hist = macd_calc(values)
    risk = sector_risk(session, code)
    breadth = sector_breadth(session, SECTOR_BY_CODE[code].name)
    liq = sector_liquidity(session, SECTOR_BY_CODE[code].name)
    fund = sector_fundamentals_row(session, code)
    history = [
        {
            "date": _date_str(d),
            "close": float(v),
            "ma20": ma20[i],
            "ma50": ma50[i],
            "ma200": ma200[i],
        }
        for i, (d, v) in enumerate(zip(pair.index, values, strict=False))
    ][-750:]
    return {
        "code": code,
        "name": SECTOR_BY_CODE[code].name,
        "available": True,
        "index_symbol": sym,
        "latest_date": _date_str(pair.index.max()),
        "latest_close": float(values[-1]),
        "returns": rows_ret,
        "technicals": {
            "ma20": ma20[-1],
            "ma50": ma50[-1],
            "ma200": ma200[-1],
            "rsi14": rsi_series[-1],
            "macd": macd_line[-1],
            "macd_signal": signal_line[-1],
            "macd_hist": hist[-1],
            "trend_slope_60": trend_slope(values, 60),
            "drawdown": current_drawdown(values),
        },
        "risk": risk,
        "breadth": breadth,
        "liquidity": liq,
        "fundamentals": fund,
        "history": history,
        "observations": len(pair),
        "data_quality": {
            "first_date": _date_str(pair.index.min()),
            "last_date": _date_str(pair.index.max()),
            "observations": len(pair),
            "status": "VERIFIED" if len(pair) >= 252 else "PARTIAL_HISTORY",
        },
    }


def _latest_fundamental_rows(session: Session) -> dict[str, FundamentalReport]:
    reports = session.scalars(
        select(FundamentalReport).order_by(
            FundamentalReport.symbol, FundamentalReport.published_date.desc()
        )
    ).all()
    latest: dict[str, FundamentalReport] = {}
    for r in reports:
        if r.symbol not in latest:
            latest[r.symbol] = r
    return latest


def sector_fundamentals_row(session: Session, code: str) -> dict:
    sector = session.scalar(select(Sector).where(Sector.code == code))
    if sector is None:
        return {"available": False, "reason": "Unknown sector"}
    securities = session.scalars(
        select(Security).where(
            Security.sector_name == sector.name,
            Security.instrument_type == "ordinary",
            Security.status == "listed",
        )
    ).all()
    latest = _latest_fundamental_rows(session)
    companies = []
    for sec in securities:
        r = latest.get(sec.symbol)
        if r is None:
            continue
        companies.append(
            CompanyFundamental(
                symbol=sec.symbol,
                profit=r.profit,
                paid_up_capital=r.paid_up_capital,
                net_worth_per_share=r.net_worth_per_share,
                eps=r.eps,
                pe=r.pe,
                market_cap=sec.market_cap,
                report_type=r.report_type,
                fiscal_year=r.fiscal_year,
                published_date=r.published_date,
            )
        )
    agg = aggregate_fundamentals(companies, len(securities))
    return {
        "available": bool(companies),
        "coverage": agg.coverage,
        "symbols_total": agg.symbols_total,
        "symbols_with_reports": agg.symbols_with_reports,
        "aggregate_profit": agg.aggregate_profit,
        "aggregate_equity": agg.aggregate_equity,
        "aggregate_market_cap": agg.aggregate_market_cap,
        "aggregate_pe": agg.aggregate_pe,
        "aggregate_pe_ex_negative": agg.aggregate_pe_ex_negative,
        "aggregate_eps": agg.aggregate_eps,
        "aggregate_roe": agg.aggregate_roe,
        "weighted_net_worth_per_share": agg.weighted_net_worth_per_share,
        "negative_earnings_symbols": agg.negative_earnings_symbols,
        "missing_capital_symbols": agg.missing_capital_symbols,
        "book_value_symbols": agg.book_value_symbols,
        "rejected_book_values": agg.rejected_book_values,
        "notes": agg.notes,
        "companies": [
            {
                "symbol": c.symbol,
                "profit": c.profit,
                "eps": c.eps,
                "pe": c.pe,
                "paid_up_capital": c.paid_up_capital,
                "net_worth_per_share": value if status != "implausible" else None,
                "book_value_reported": c.net_worth_per_share,
                "book_value_status": status,
                "market_cap": c.market_cap,
                "fiscal_year": c.fiscal_year,
                "report_type": c.report_type,
            }
            for c in companies
            for value, status in (book_value_status(c),)
        ],
    }


def fundamentals_payload(session: Session) -> dict:
    rows = []
    for s in SECTOR_SOURCES:
        row = sector_fundamentals_row(session, s.code)
        row.update({"code": s.code, "name": s.name})
        rows.append(row)
    return {
        "available": any(r.get("available") for r in rows),
        "rows": rows,
        "notes": [
            "The verified source exposes EPS, P/E, paid-up capital, net profit and net worth per share only.",
            "Revenue, total assets, liabilities, operating cash flow and dividends are not present and are not fabricated.",
            "Aggregate P/E uses total market cap over total earnings, including loss-making members; a positive-only variant is also provided.",
            "Net worth per share is validated against the price implied by the same report; implausible values are excluded from equity and ROE.",
        ],
    }


def factors_payload(session: Session, weights: dict[str, float] | None = None) -> dict:
    frame = load_index_frame(session)
    board = rotation_rows(frame, 20, 0.0, 0.0)
    risk = {r["code"]: r for r in risk_summary(session).get("rows", [])}
    liq = {r["sector_name"]: r for r in liquidity_summary(session).get("rows", [])}
    values: dict[str, list[float | None]] = {
        "momentum_20": [],
        "relative_20": [],
        "momentum_accel": [],
        "low_volatility": [],
        "liquidity": [],
        "trend": [],
    }
    for row in board:
        values["momentum_20"].append(row["return_20"])
        values["relative_20"].append(row["relative_strength"])
        values["momentum_accel"].append(row["momentum_change"])
        values["low_volatility"].append((risk.get(row["code"]) or {}).get("volatility"))
        values["liquidity"].append((liq.get(row["name"]) or {}).get("turnover"))
        values["trend"].append(row["return_60"])
    weights = weights or {
        "momentum_20": 25,
        "relative_20": 25,
        "momentum_accel": 15,
        "low_volatility": 10,
        "liquidity": 10,
        "trend": 15,
    }
    higher = {
        "momentum_20": True,
        "relative_20": True,
        "momentum_accel": True,
        "low_volatility": False,
        "liquidity": True,
        "trend": True,
    }
    scores = score_factors(values, weights, higher)
    out = []
    for i, row in enumerate(board):
        s = scores[str(i)]
        out.append(
            {
                **row,
                "score": s.total,
                "contributions": s.contributions,
                "weights_used": s.weights_used,
                "coverage": s.coverage,
                "missing_factors": s.missing,
            }
        )
    out.sort(key=lambda x: x["score"] if x["score"] is not None else -1.0, reverse=True)
    return {
        "weights": weights,
        "higher_is_better": higher,
        "rows": out,
        "method": "Cross-sector percentile ranks, weighted and renormalised over available factors. "
        "Missing factors are omitted and disclosed, never scored as worst.",
    }


def data_quality_payload(session: Session) -> dict:
    frame = load_index_frame(session)
    sectors = sector_meta(session)
    counts = dict(
        session.execute(
            select(IndexObservation.index_code, func.count(IndexObservation.id)).group_by(
                IndexObservation.index_code
            )
        ).all()
    )
    ranges = session.execute(
        select(
            IndexObservation.index_code,
            func.min(IndexObservation.trade_date),
            func.max(IndexObservation.trade_date),
        ).group_by(IndexObservation.index_code)
    ).all()
    range_map = {r[0]: {"first": r[1], "last": r[2]} for r in ranges}
    nepse_dates = set(frame.index) if not frame.empty else set()
    coverage = []
    for s in sectors:
        sym = s["subindex_symbol"]
        info = range_map.get(sym, {})
        first = info.get("first")
        last = info.get("last")
        expected = len([d for d in nepse_dates if first and last and first <= d.date() <= last])
        actual = counts.get(sym, 0)
        missing = max(0, expected - actual)
        completeness = 1 - (missing / expected) if expected else 0.0
        # A verified source can still deliver a sparse series. The status shown
        # in a completeness table must reflect completeness, not just provenance,
        # so sparse sub-indices are downgraded to INCOMPLETE.
        if actual == 0:
            status = "UNAVAILABLE"
        elif missing == 0 or completeness >= 0.98:
            status = "VERIFIED"
        else:
            status = "INCOMPLETE"
        coverage.append(
            {
                "code": s["code"],
                "name": s["name"],
                "observations": actual,
                "first_date": _date_str(first),
                "last_date": _date_str(last),
                "expected_sessions": expected,
                "missing_sessions": missing,
                "completeness": completeness,
                "status": status,
            }
        )
    securities_total = session.scalar(select(func.count(Security.symbol))) or 0
    ordinary = session.scalar(
        select(func.count(Security.symbol)).where(Security.instrument_type == "ordinary")
    ) or 0
    classified = session.scalar(
        select(func.count(Security.symbol)).where(Security.sector_name.is_not(None))
    ) or 0
    summaries = session.scalar(select(func.count(DailySummary.id))) or 0
    summary_range = session.execute(
        select(func.min(DailySummary.trade_date), func.max(DailySummary.trade_date))
    ).one()
    funds = session.scalar(select(func.count(FundamentalReport.id))) or 0
    fund_symbols = session.scalar(select(func.count(func.distinct(FundamentalReport.symbol)))) or 0
    runs = session.scalars(select(IngestionRun).order_by(IngestionRun.id.desc()).limit(12)).all()
    issues = session.scalars(select(DataIssue).order_by(DataIssue.id.desc()).limit(50)).all()
    return {
        "index_coverage": coverage,
        "securities": {
            "total": securities_total,
            "ordinary": ordinary,
            "classified": classified,
            "classification_coverage": (classified / securities_total) if securities_total else 0,
        },
        "daily_summaries": {
            "rows": summaries,
            "first_date": _date_str(summary_range[0]),
            "last_date": _date_str(summary_range[1]),
        },
        "fundamentals": {"reports": funds, "symbols": fund_symbols},
        "ingestion_runs": [
            {
                "source": r.source,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                "status": r.status,
                "rows": r.rows_written,
                "message": r.message,
            }
            for r in runs
        ],
        "issues": [
            {
                "dataset": i.dataset,
                "severity": i.severity,
                "code": i.code,
                "message": i.message,
                "detected_at": i.detected_at.isoformat() if i.detected_at else None,
            }
            for i in issues
        ],
        "notes": [
            "Index observations are verified close values from the documented CSV mirror.",
            "Duplicate index observations are prevented by a unique (index_code, trade_date) constraint.",
            "Historical sector membership is unavailable; current membership is applied to history.",
        ],
    }


def market_overview(session: Session) -> dict:
    frame = load_index_frame(session)
    if frame.empty:
        return {"available": False}
    nepse = frame[NEPSE_INDEX_CODE].dropna()
    change = None
    pct = None
    if len(nepse) >= 2:
        change = float(nepse.iloc[-1]) - float(nepse.iloc[-2])
        pct = change / float(nepse.iloc[-2]) if float(nepse.iloc[-2]) else None
    return {
        "available": True,
        "latest_date": _date_str(nepse.index[-1]),
        "nepse_close": float(nepse.iloc[-1]),
        "nepse_change": change,
        "nepse_pct": pct,
        "return_20": _ret(nepse, 20),
        "return_60": _ret(nepse, 60),
        "return_252": _ret(nepse, 252),
    }


def dashboard_payload(session: Session) -> dict:
    frame = load_index_frame(session)
    board = rotation_rows(frame, 20, 0.0, 0.0)
    transitions = rotation_transitions(frame, 20, 0.0, 0.0, sessions=2)
    breadth = breadth_summary(session)
    liq = liquidity_summary(session)
    risk = risk_summary(session)
    heat = heatmap_payload(session)
    leaders = sorted(
        [r for r in board if r["relative_strength"] is not None],
        key=lambda r: r["relative_strength"],
        reverse=True,
    )
    return {
        "market": market_overview(session),
        "rotation": {
            "window": 20,
            "rows": board,
            "transitions": transitions[:12],
        },
        "heatmap": heat,
        "liquidity": {
            # The dashboard only needs the latest cross-section; the 260-session
            # turnover history stays on /api/liquidity.
            "available": liq.get("available"),
            "latest_date": liq.get("latest_date"),
            "total_turnover": liq.get("total_turnover"),
            "rows": liq.get("rows", []),
            "notes": liq.get("notes", []),
        },
        "breadth": breadth,
        "risk": risk,
        "leaders": leaders[:5],
        "laggards": list(reversed(leaders))[:5],
        "data_freshness": {
            "index_latest": _date_str(_latest(frame)),
            "summary_latest": liq.get("latest_date"),
            "breadth_latest": breadth.get("latest_date"),
        },
    }


def research_payload(session: Session) -> dict:
    """Honest, minimal research modules that can be computed from verified data.

    Both modules are vectorised over the trading calendar. The previous
    session-by-session replay was correct but far too slow for an API request.
    """
    frame = load_index_frame(session)
    if frame.empty:
        return {"available": False}

    codes = list(SECTOR_BY_CODE)
    window = 20
    quads = ("WINNING", "ADVANCING", "LOSING", "LAGGING")
    matrix = {q: {q2: 0 for q2 in quads} for q in quads}

    pairs: dict[str, pd.DataFrame] = {}
    arrays: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = {}
    for code in codes:
        pair = _pair(frame, code)
        if pair.empty:
            continue
        pairs[code] = pair
        arrays[code] = (
            pair[sector_symbol(code)].to_numpy(dtype=float),
            pair[NEPSE_INDEX_CODE].to_numpy(dtype=float),
            pair.index.values,
            pair[NEPSE_INDEX_CODE].index.values,
        )

    # --- transition matrix (vectorised) --------------------------------
    for s, m, _idx, _midx in arrays.values():
        if len(s) <= window:
            continue
        with np.errstate(divide="ignore", invalid="ignore"):
            rs = s[window:] / s[:-window] - 1.0
            rm = m[window:] / m[:-window] - 1.0
            rel = rs - rm
        valid = np.isfinite(rs) & np.isfinite(rm)
        classified = np.where(
            (rs > 0) & (rel > 0),
            "WINNING",
            np.where((rs <= 0) & (rel > 0), "ADVANCING", np.where((rs > 0) & (rel <= 0), "LOSING", "LAGGING")),
        ).astype(object)
        classified[~valid] = None
        quadrant = np.concatenate([np.full(window, None, dtype=object), classified])
        for prev, cur in zip(quadrant[:-1], quadrant[1:], strict=False):
            if prev is not None and cur is not None:
                matrix[str(prev)][str(cur)] += 1

    # --- illustrative rotation backtest --------------------------------
    dates = frame.index
    nepse = frame[NEPSE_INDEX_CODE].dropna()
    nepse_values = nepse.to_numpy(dtype=float)
    nepse_dates = nepse.index.values

    equity = [1.0]
    benchmark = [1.0]
    # Limit the demonstration to the most recent ~10 years so it reflects a
    # period in which all 13 sub-indices have meaningful history.
    start_i = max(260, len(dates) - 2520)
    for i in range(start_i, len(dates) - 5, 5):
        cutoff = np.datetime64(dates[i].date())
        end = np.datetime64(dates[i + 5].date())
        scores: list[tuple[str, float]] = []
        for code, (s, m, idx, _midx) in arrays.items():
            pos = int(np.searchsorted(idx, cutoff, side="right")) - 1
            if pos < window:
                continue
            start = s[pos - window]
            if not np.isfinite(start) or start == 0:
                continue
            r = s[pos] / start - 1.0
            mpos = int(np.searchsorted(_midx, cutoff, side="right")) - 1
            if mpos < window:
                continue
            mstart = m[mpos - window]
            if not np.isfinite(mstart) or mstart == 0:
                continue
            mret = m[mpos] / mstart - 1.0
            if np.isfinite(r) and np.isfinite(mret):
                scores.append((code, float(r - mret)))
        scores.sort(key=lambda x: x[1], reverse=True)
        top = [c for c, _ in scores[:3]]
        fwd: list[float] = []
        for code in top:
            s, _m, idx, _midx = arrays[code]
            pos = int(np.searchsorted(idx, cutoff, side="right")) - 1
            end_pos = int(np.searchsorted(idx, end, side="right")) - 1
            if pos >= 0 and end_pos > pos and s[pos] != 0:
                value = s[end_pos] / s[pos] - 1.0
                if np.isfinite(value):
                    fwd.append(float(value))
        if not fwd:
            continue
        equity.append(equity[-1] * (1 + float(np.mean(fwd))))
        npos = int(np.searchsorted(nepse_dates, cutoff, side="right")) - 1
        nend = int(np.searchsorted(nepse_dates, end, side="right")) - 1
        if npos >= 0 and nend > npos and nepse_values[npos] != 0:
            benchmark.append(benchmark[-1] * (nepse_values[nend] / nepse_values[npos]))
        else:
            benchmark.append(benchmark[-1])

    return {
        "available": True,
        "transition_matrix": matrix,
        "backtest": {
            "available": len(equity) > 2,
            "points": len(equity),
            "equity_curve": equity,
            "benchmark_curve": benchmark[: len(equity)],
            "final_equity": equity[-1] if equity else None,
            "final_benchmark": benchmark[-1] if benchmark else None,
            "method": "Long top-3 sectors by 20-session relative strength, equal weight, "
            "rebalanced every 5 sessions, no costs modelled, last ~10 years. Illustrative only.",
        },
        "notes": [
            "Regime detection and probabilistic forecasting are not enabled without a validated, "
            "sufficient history; the module reports that limitation rather than fabricating output.",
        ],
    }


def events_payload(session: Session) -> dict:
    return {
        "available": False,
        "reason": "No verified, licensed sector-level corporate-event feed is available from the selected public sources.",
        "required_source": "Official NEPSE corporate disclosures or a licensed vendor feed with explicit reuse permission.",
        "items": [],
    }


def methodology_payload() -> dict:
    return {
        "returns": "Cumulative return = close[t] / close[t-window] - 1 using trading-session positions.",
        "relative_strength": "Relative excess return = sector cumulative return - NEPSE cumulative return over the same sessions.",
        "rs_ratio": "Sector-to-market relative-strength ratio = (sector_t/sector_t0) / (NEPSE_t/NEPSE_t0).",
        "quadrants": "x = absolute strength, y = relative strength. WINNING: x>0,y>0. ADVANCING: x<=0,y>0. LOSING: x>0,y<=0. LAGGING: x<=0,y<=0.",
        "volatility": "Annualised standard deviation of daily returns, sqrt(252).",
        "beta": "Covariance of sector and NEPSE daily returns divided by NEPSE variance, 252-session window.",
        "drawdown": "Close / running peak - 1.",
        "breadth": "Advances/declines use observed daily summaries only; missing securities are unavailable, not unchanged.",
        "concentration": "Herfindahl-Hirschman index of turnover shares; effective N = 1/HHI.",
        "fundamentals": "Aggregate P/E = total market cap / total net profit (losses included in the denominator); a positive-only variant is also reported. Book value per share is validated against the price implied by the same filing before equity and ROE are computed.",
        "limitations": [
            "Historical sector membership is not published by the selected sources.",
            "Historical transaction counts are unavailable; turnover and volume are used.",
            "No sector-level market capitalization history; current snapshot capitalization is used.",
            "Filing periods differ across members, so aggregates blend the latest report per member.",
            "Corporate events and advanced forecasting are not fabricated.",
        ],
    }
