from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..calculations.rotation import QUADRANTS
from ..db import get_session
from ..ingestion.sources import SECTOR_BY_CODE, SECTOR_BY_NAME
from ..services import analytics, cache

router = APIRouter(prefix="/api")

TTL = 90.0


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "NEPSE Sector Intelligence"}


@router.get("/meta")
def meta() -> dict:
    return {
        "name": "NEPSE Sector Intelligence",
        "version": "0.1.0",
        "quadrants": list(QUADRANTS),
        "horizons": list(analytics.HORIZONS),
        "statuses": [
            "VERIFIED",
            "PROVISIONAL",
            "INCOMPLETE",
            "UNAVAILABLE",
            "STALE",
            "FAILED_VALIDATION",
        ],
    }


@router.get("/sectors")
def sectors(session: Session = Depends(get_session)):
    return cache.memo("sectors", TTL, lambda: analytics.sector_meta(session))


@router.get("/dashboard")
def dashboard(session: Session = Depends(get_session)):
    return cache.memo("dashboard", TTL, lambda: analytics.dashboard_payload(session))


@router.get("/heatmap")
def heatmap(session: Session = Depends(get_session)):
    return cache.memo("heatmap", TTL, lambda: analytics.heatmap_payload(session))


@router.get("/rotation")
def rotation(
    window: int = Query(20, ge=2, le=252),
    abs_threshold: float = Query(0.0),
    rel_threshold: float = Query(0.0),
    session: Session = Depends(get_session),
):
    key = f"rotation:{window}:{abs_threshold}:{rel_threshold}"
    return cache.memo(
        key, TTL, lambda: analytics.rotation_payload(session, window, abs_threshold, rel_threshold)
    )


@router.get("/rotation/trails")
def rotation_trails(
    window: int = Query(20, ge=2, le=252),
    sessions: int = Query(30, ge=2, le=250),
    abs_threshold: float = Query(0.0),
    rel_threshold: float = Query(0.0),
    session: Session = Depends(get_session),
):
    key = f"trails:{window}:{sessions}:{abs_threshold}:{rel_threshold}"
    return cache.memo(
        key,
        TTL,
        lambda: analytics.rotation_trails(session, window, sessions, abs_threshold, rel_threshold),
    )


@router.get("/rotation/history")
def rotation_history(
    window: int = Query(20, ge=2, le=252),
    sessions: int = Query(120, ge=10, le=250),
    session: Session = Depends(get_session),
):
    return cache.memo(
        f"rotation-history:{window}:{sessions}",
        TTL,
        lambda: analytics.rotation_history(session, window, sessions),
    )


@router.get("/compare")
def compare(
    codes: str = Query(..., min_length=2, max_length=200),
    start: str | None = Query(None),
    end: str | None = Query(None),
    session: Session = Depends(get_session),
):
    try:
        return cache.memo(
            f"compare:{codes}:{start}:{end}",
            TTL,
            lambda: analytics.compare_series(session, codes.split(","), start, end),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown series: {exc.args[0]}") from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sectors/{code}")
def sector_detail(code: str, session: Session = Depends(get_session)):
    resolved = code.upper()
    try:
        return cache.memo(
            f"sector:{resolved}", TTL, lambda: analytics.sector_detail(session, resolved)
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown sector code: {code}") from exc


@router.get("/breadth")
def breadth(sector: str | None = Query(None), session: Session = Depends(get_session)):
    if sector:
        return cache.memo(
            f"breadth:{sector}", TTL, lambda: analytics.sector_breadth(session, sector)
        )
    return cache.memo("breadth", TTL, lambda: analytics.breadth_summary(session))


@router.get("/liquidity")
def liquidity(sector: str | None = Query(None), session: Session = Depends(get_session)):
    if sector:
        return cache.memo(
            f"liquidity:{sector}", TTL, lambda: analytics.sector_liquidity(session, sector)
        )
    return cache.memo("liquidity", TTL, lambda: analytics.liquidity_summary(session))


@router.get("/risk")
def risk(sector: str | None = Query(None), session: Session = Depends(get_session)):
    if sector:
        source = SECTOR_BY_NAME.get(sector.lower()) or SECTOR_BY_CODE.get(sector.upper())
        if source is None:
            raise HTTPException(status_code=404, detail=f"Unknown sector: {sector}")
        return cache.memo(
            f"risk:{source.code}", TTL, lambda: analytics.sector_risk(session, source.code)
        )
    return cache.memo("risk", TTL, lambda: analytics.risk_summary(session))


@router.get("/fundamentals")
def fundamentals(session: Session = Depends(get_session)):
    return cache.memo("fundamentals", TTL, lambda: analytics.fundamentals_payload(session))


@router.get("/factors")
def factors(
    weight_momentum_20: float = Query(25, ge=0, le=100),
    weight_relative_20: float = Query(25, ge=0, le=100),
    weight_momentum_accel: float = Query(15, ge=0, le=100),
    weight_low_volatility: float = Query(10, ge=0, le=100),
    weight_liquidity: float = Query(10, ge=0, le=100),
    weight_trend: float = Query(15, ge=0, le=100),
    session: Session = Depends(get_session),
):
    weights = {
        "momentum_20": weight_momentum_20,
        "relative_20": weight_relative_20,
        "momentum_accel": weight_momentum_accel,
        "low_volatility": weight_low_volatility,
        "liquidity": weight_liquidity,
        "trend": weight_trend,
    }
    return cache.memo(
        f"factors:{tuple(sorted(weights.items()))}", TTL, lambda: analytics.factors_payload(session, weights)
    )


@router.get("/research")
def research(session: Session = Depends(get_session)):
    return cache.memo("research", TTL, lambda: analytics.research_payload(session))


@router.get("/events")
def events(session: Session = Depends(get_session)):
    return analytics.events_payload(session)


@router.get("/data-quality")
def data_quality(session: Session = Depends(get_session)):
    return cache.memo("data-quality", TTL, lambda: analytics.data_quality_payload(session))


@router.get("/methodology")
def methodology() -> dict:
    return analytics.methodology_payload()
