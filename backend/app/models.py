from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Sector(Base):
    __tablename__ = "sectors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    index_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    index_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(64), default="yonepse")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    observations: Mapped[list[IndexObservation]] = relationship(back_populates="sector")


class IndexObservation(Base):
    __tablename__ = "index_observations"
    __table_args__ = (
        UniqueConstraint("index_code", "trade_date", name="uq_index_date"),
        Index("ix_index_code_date", "index_code", "trade_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    index_code: Mapped[str] = mapped_column(String(64), index=True)
    sector_id: Mapped[int | None] = mapped_column(ForeignKey("sectors.id"), nullable=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    open: Mapped[float | None] = mapped_column(Float, nullable=True)
    high: Mapped[float | None] = mapped_column(Float, nullable=True)
    low: Mapped[float | None] = mapped_column(Float, nullable=True)
    close: Mapped[float] = mapped_column(Float)
    turnover: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(96))
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(24), default="VERIFIED")

    sector: Mapped[Sector | None] = relationship(back_populates="observations")


class Security(Base):
    __tablename__ = "securities"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(240))
    instrument_type: Mapped[str | None] = mapped_column(String(48), nullable=True)
    sector_name: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    market_cap: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_cap_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(64), default="binayabaral+nepse")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DailySummary(Base):
    """Minimal security-level daily summary.

    Deliberately excludes intraday OHLC. Only the fields needed for sector
    breadth, participation, turnover, and concentration are stored.
    """

    __tablename__ = "daily_summaries"
    __table_args__ = (
        UniqueConstraint("symbol", "trade_date", name="uq_summary_symbol_date"),
        Index("ix_summary_sector_date", "sector_name", "trade_date"),
        Index("ix_summary_date", "trade_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    close: Mapped[float | None] = mapped_column(Float, nullable=True)
    prev_close: Mapped[float | None] = mapped_column(Float, nullable=True)
    change: Mapped[float | None] = mapped_column(Float, nullable=True)
    pct_change: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume: Mapped[float | None] = mapped_column(Float, nullable=True)
    turnover: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    sector_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    source: Mapped[str] = mapped_column(String(96), default="binayabaral")
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("symbol", "sector_name", "effective_from", name="uq_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    sector_name: Mapped[str] = mapped_column(String(120), index=True)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(96), default="yonepse")


class FundamentalReport(Base):
    __tablename__ = "fundamental_reports"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "fiscal_year", "quarter", "report_type", name="uq_fundamental_report"
        ),
        Index("ix_fund_symbol", "symbol"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    report_type: Mapped[str] = mapped_column(String(48))
    quarter: Mapped[str | None] = mapped_column(String(48), nullable=True)
    fiscal_year: Mapped[str | None] = mapped_column(String(24), nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    published_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    pe: Mapped[float | None] = mapped_column(Float, nullable=True)
    eps: Mapped[float | None] = mapped_column(Float, nullable=True)
    paid_up_capital: Mapped[float | None] = mapped_column(Float, nullable=True)
    profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    net_worth_per_share: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(64), default="yonepse")
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(24), default="PROVISIONAL")


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(96), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="RUNNING")
    rows_written: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)


class DataIssue(Base):
    __tablename__ = "data_issues"
    __table_args__ = (Index("ix_issue_dataset", "dataset"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset: Mapped[str] = mapped_column(String(64))
    severity: Mapped[str] = mapped_column(String(16), default="INFO")
    code: Mapped[str] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(Text)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
