from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import (
    DailySummary,
    FundamentalReport,
    IndexObservation,
    IngestionRun,
    Membership,
    Sector,
    Security,
)
from . import sources

log = logging.getLogger(__name__)

# The YONEPSE market snapshot publishes market capitalisation in NPR millions.
# Multiply once at ingestion so every stored monetary value is plain NPR.
MARKET_CAP_SOURCE_UNIT = 1_000_000.0


def _to_date(value: Any) -> date | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        parsed = pd.to_datetime(value)
        if pd.isna(parsed):
            return None
        return parsed.date()
    except Exception:
        return None


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            value = value.replace(",", "").strip()
            if value in {"", "-", "NA", "N/A", "nan"}:
                return None
        out = float(value)
        if pd.isna(out):
            return None
        return out
    except Exception:
        return None


def _run(session: Session, source: str) -> IngestionRun:
    run = IngestionRun(source=source, status="RUNNING")
    session.add(run)
    session.commit()
    return run


def _finish(session: Session, run: IngestionRun, rows: int, status: str = "SUCCESS", message: str = ""):
    run.finished_at = datetime.utcnow()
    run.rows_written = rows
    run.status = status
    run.message = message[:4000] if message else None
    session.commit()


def upsert_sectors(session: Session) -> int:
    run = _run(session, "sectors")
    rows = 0
    try:
        remote = sources.fetch_yonepse_sector_indices()
        meta = {m.get("indexCode"): m for m in remote if m.get("indexCode")}
        for s in sources.SECTOR_SOURCES:
            sector = session.scalar(select(Sector).where(Sector.code == s.code))
            info = meta.get(s.yonepse_index_code, {})
            if sector is None:
                sector = Sector(code=s.code, name=s.name)
                session.add(sector)
            sector.name = s.name
            sector.index_code = s.yonepse_index_code
            sector.index_name = info.get("indexName") or s.subindex_symbol
            sector.description = info.get("description")
            sector.active = (info.get("activeStatus") or "A") == "A"
            sector.source = "yonepse"
            sector.updated_at = datetime.utcnow()
            rows += 1
        session.commit()
        _finish(session, run, rows)
        return rows
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        _finish(session, run, 0, "FAILED", str(exc))
        raise


def _upsert_index_frame(
    session: Session, frame: pd.DataFrame, index_code: str, sector_code: str | None, url: str
) -> int:
    if frame.empty:
        return 0
    frame = frame.copy()
    frame["trade_date"] = pd.to_datetime(frame["time"]).dt.date
    existing = set(
        session.scalars(
            select(IndexObservation.trade_date).where(IndexObservation.index_code == index_code)
        ).all()
    )
    sector_id = None
    if sector_code:
        sector_id = session.scalar(select(Sector.id).where(Sector.code == sector_code))
    payload = []
    for row in frame.itertuples():
        if row.trade_date in existing:
            continue
        payload.append(
            {
                "index_code": index_code,
                "sector_id": sector_id,
                "trade_date": row.trade_date,
                "open": _to_float(getattr(row, "open", None)),
                "high": _to_float(getattr(row, "high", None)),
                "low": _to_float(getattr(row, "low", None)),
                "close": _to_float(row.close),
                "turnover": _to_float(getattr(row, "volume", None)),
                "source": "menaceXnadin/nepse-historical-market-data-csv",
                "source_url": url,
                "retrieved_at": datetime.utcnow(),
                "status": "VERIFIED",
            }
        )
    if payload:
        session.bulk_insert_mappings(IndexObservation, payload)
    return len(payload)


def ingest_index_history(session: Session) -> int:
    run = _run(session, "index_history")
    rows = 0
    try:
        for s in sources.SECTOR_SOURCES:
            url = f"{sources.settings.historical_subindex_base}/{s.subindex_symbol}_unadjusted.csv"
            frame = sources.fetch_sector_index_history(s.subindex_symbol)
            rows += _upsert_index_frame(session, frame, s.subindex_symbol, s.code, url)
            session.commit()
        nepse_url = f"{sources.settings.historical_index_base}/NEPSE_unadjusted.csv"
        nepse = sources.fetch_nepse_index_history()
        rows += _upsert_index_frame(session, nepse, sources.NEPSE_INDEX_CODE, None, nepse_url)
        session.commit()
        _finish(session, run, rows)
        return rows
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        _finish(session, run, 0, "FAILED", str(exc))
        raise


def ingest_securities(session: Session) -> int:
    run = _run(session, "securities")
    rows = 0
    try:
        ref = sources.fetch_security_reference()
        codes = sources.fetch_yonepse_sector_codes()
        snapshot = sources.fetch_yonepse_snapshot()
        snapshot_by_symbol = {str(x.get("symbol", "")).upper(): x for x in snapshot}
        code_sectors = {}
        for sector_name, items in codes.items():
            canonical = sources.normalize_sector(sector_name)
            if not canonical:
                continue
            for item in items or []:
                code_sectors[str(item.get("symbol", "")).upper()] = canonical

        existing = {s.symbol: s for s in session.scalars(select(Security)).all()}
        today = date.today()
        for row in ref.itertuples():
            symbol = str(row.symbol).strip().upper()
            if not symbol:
                continue
            canonical = sources.normalize_sector(getattr(row, "sector", None)) or code_sectors.get(
                symbol
            )
            sector_name = None
            if canonical:
                sector_name = next(
                    (s.name for s in sources.SECTOR_SOURCES if s.code == canonical), None
                )
            snap = snapshot_by_symbol.get(symbol, {})
            sec = existing.get(symbol)
            if sec is None:
                sec = Security(symbol=symbol, name=str(getattr(row, "name", symbol)))
                session.add(sec)
                existing[symbol] = sec
            sec.name = str(getattr(row, "name", sec.name) or symbol)[:240]
            sec.instrument_type = (
                str(getattr(row, "instrument_type", "") or "").strip() or None
            )
            sec.sector_name = sector_name
            sec.status = str(getattr(row, "status", "") or "").strip() or None
            sec.source_category = str(getattr(row, "source_category", "") or "").strip() or None
            mc = _to_float(snap.get("market_cap"))
            if mc is not None:
                # The YONEPSE market snapshot reports market capitalisation in
                # NPR millions (a 4.59e6 sum matches the ~4.6 trillion NPR NEPSE
                # total). Store a single canonical unit: plain NPR.
                sec.market_cap = mc * MARKET_CAP_SOURCE_UNIT
                sec.market_cap_as_of = today
            sec.updated_at = datetime.utcnow()
            rows += 1

        # Replace the current membership snapshot (historical membership is not
        # published by these sources, see DATA_SOURCE_AUDIT.md).
        session.execute(delete(Membership).where(Membership.source == "current-snapshot"))
        for sec in existing.values():
            if sec.sector_name:
                session.add(
                    Membership(
                        symbol=sec.symbol,
                        sector_name=sec.sector_name,
                        effective_from=None,
                        effective_to=None,
                        source="current-snapshot",
                    )
                )
        session.commit()
        _finish(session, run, rows)
        return rows
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        _finish(session, run, 0, "FAILED", str(exc))
        raise


def ingest_daily_summaries(session: Session, symbols: Iterable[str] | None = None) -> int:
    run = _run(session, "daily_summaries")
    rows = 0
    try:
        if symbols is None:
            symbols = session.scalars(
                select(Security.symbol).where(
                    Security.instrument_type == "ordinary", Security.status == "listed"
                )
            ).all()
        symbols = sorted({str(s).upper() for s in symbols})
        sector_by_symbol = {
            s.symbol: s.sector_name
            for s in session.scalars(select(Security)).all()
            if s.sector_name
        }
        for symbol in symbols:
            frame = sources.fetch_security_csv(symbol)
            if frame is None or frame.empty or "published_date" not in frame:
                continue
            frame = frame.copy()
            frame["trade_date"] = pd.to_datetime(frame["published_date"]).dt.date
            frame = frame.sort_values("trade_date")
            frame["prev_close"] = frame["close"].shift(1)
            existing = set(
                session.scalars(
                    select(DailySummary.trade_date).where(DailySummary.symbol == symbol)
                ).all()
            )
            payload = []
            for row in frame.itertuples():
                if row.trade_date in existing:
                    continue
                close = _to_float(row.close)
                prev = _to_float(getattr(row, "prev_close", None))
                pct = _to_float(getattr(row, "per_change", None))
                change = None
                if close is not None and prev is not None:
                    change = close - prev
                    if pct is None and prev:
                        pct = (close / prev - 1.0) * 100.0
                payload.append(
                    {
                        "symbol": symbol,
                        "trade_date": row.trade_date,
                        "close": close,
                        "prev_close": prev,
                        "change": change,
                        "pct_change": pct,
                        "volume": _to_float(getattr(row, "traded_quantity", None)),
                        "turnover": _to_float(getattr(row, "traded_amount", None)),
                        "status": str(getattr(row, "status", "") or "") or None,
                        "sector_name": sector_by_symbol.get(symbol),
                        "source": "binayabaral/nepal-market-data",
                        "retrieved_at": datetime.utcnow(),
                    }
                )
            if payload:
                session.bulk_insert_mappings(DailySummary, payload)
                rows += len(payload)
            session.commit()
            log.info("summary %s: +%d", symbol, len(payload))
        _finish(session, run, rows)
        return rows
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        _finish(session, run, 0, "FAILED", str(exc))
        raise


def ingest_fundamentals(session: Session) -> int:
    run = _run(session, "fundamentals")
    rows = 0
    try:
        data = sources.fetch_yonepse_financials()
        # The source publishes a full snapshot of the latest filings. Replace the
        # table so an amended filing (same symbol/fiscal year/quarter/type but a
        # newer document) refreshes the stored row instead of being skipped as a
        # duplicate. The fetch happens first, so a network failure leaves the
        # previous data intact; the whole rewrite is one transaction.
        session.execute(delete(FundamentalReport))
        # The source can repeat the same (symbol, fiscal year, quarter, report
        # type) with different filings. Keep the latest published filing and
        # disclose that duplicates were collapsed.
        by_key: dict[tuple, dict] = {}
        for company in data:
            symbol = str(company.get("symbol", "")).upper()
            for report in company.get("reports", []) or []:
                key = (
                    symbol,
                    report.get("fy"),
                    report.get("quarter"),
                    report.get("type"),
                )
                docs = report.get("documents") or []
                published = _to_date(docs[0].get("submitted_date")) if docs else None
                candidate = {
                    "symbol": symbol,
                    "report_type": str(report.get("type") or "Unknown"),
                    "quarter": report.get("quarter"),
                    "fiscal_year": report.get("fy"),
                    "period_end": None,
                    "published_date": published,
                    "pe": _to_float(report.get("pe")),
                    "eps": _to_float(report.get("eps")),
                    "paid_up_capital": _to_float(report.get("paid_up_capital")),
                    "profit": _to_float(report.get("profit")),
                    "net_worth_per_share": _to_float(report.get("net_worth_per_share")),
                    "source": "yonepse",
                    "source_url": f"{sources.settings.yonepse_base}/data/company/financials.json",
                    "retrieved_at": datetime.utcnow(),
                    "status": "PROVISIONAL",
                }
                prev = by_key.get(key)
                if prev is None or (
                    candidate["published_date"]
                    and (prev["published_date"] is None or candidate["published_date"] >= prev["published_date"])
                ):
                    by_key[key] = candidate
        payload = list(by_key.values())
        if payload:
            session.bulk_insert_mappings(FundamentalReport, payload)
            rows = len(payload)
        session.commit()
        _finish(session, run, rows)
        return rows
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        _finish(session, run, 0, "FAILED", str(exc))
        raise


def ingest_all(session: Session, include_summaries: bool = True) -> dict[str, int]:
    out = {
        "sectors": upsert_sectors(session),
        "index_history": ingest_index_history(session),
        "securities": ingest_securities(session),
        "fundamentals": ingest_fundamentals(session),
    }
    if include_summaries:
        out["daily_summaries"] = ingest_daily_summaries(session)
    return out
