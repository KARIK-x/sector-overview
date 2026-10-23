from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# Money is stored as fixed-precision numeric data.  API responses expose it as
# strings so a JavaScript client never has to round a binary float.
Money = Numeric(20, 2)
Quantity = Numeric(20, 4)
Price = Numeric(20, 4)
Rate = Numeric(14, 8)


def utcnow() -> datetime:
    """Naive UTC timestamp for the existing naive DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class AccountVault(Base):
    __tablename__ = "account_vaults"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    label: Mapped[str] = mapped_column(String(120), default="Personal account")
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    investor_category: Mapped[str] = mapped_column(
        String(32), default="RESIDENT_INDIVIDUAL"
    )
    cost_basis_method: Mapped[str] = mapped_column(String(16), default="WACC")
    default_broker: Mapped[str | None] = mapped_column(String(32), nullable=True)
    settings_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class BankAccount(Base):
    __tablename__ = "account_bank_accounts"
    __table_args__ = (
        UniqueConstraint("vault_id", "name", name="uq_account_bank_name"),
        Index("ix_account_bank_vault", "vault_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(3), default="NPR")
    opening_balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    opening_balance_date: Mapped[date] = mapped_column(Date)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )


class CashMovement(Base):
    __tablename__ = "account_cash_movements"
    __table_args__ = (Index("ix_account_cash_vault_date", "vault_id", "movement_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    bank_account_id: Mapped[int] = mapped_column(
        ForeignKey("account_bank_accounts.id", ondelete="CASCADE"), index=True
    )
    movement_date: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(24))
    amount: Mapped[Decimal] = mapped_column(Money)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    counter_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("account_bank_accounts.id"), nullable=True
    )
    # Both legs of a transfer share a group so a reversal cannot leave one side
    # of the pair active and silently create (or destroy) cash.
    transfer_group: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class SmsImport(Base):
    __tablename__ = "account_sms_imports"
    __table_args__ = (Index("ix_account_import_vault", "vault_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    source_type: Mapped[str] = mapped_column(String(16), default="PASTE")
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="COMPLETED")
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    parsed_count: Mapped[int] = mapped_column(Integer, default=0)
    imported_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected_count: Mapped[int] = mapped_column(Integer, default=0)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    buy_bills: Mapped[int] = mapped_column(Integer, default=0)
    sell_bills: Mapped[int] = mapped_column(Integer, default=0)
    line_count: Mapped[int] = mapped_column(Integer, default=0)
    summary_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SmsMessage(Base):
    __tablename__ = "account_sms_messages"
    __table_args__ = (
        UniqueConstraint("vault_id", "fingerprint", name="uq_account_sms_fingerprint"),
        Index("ix_account_sms_vault_date", "vault_id", "trade_date"),
        Index("ix_account_sms_vault_status", "vault_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    import_id: Mapped[int | None] = mapped_column(
        ForeignKey("account_sms_imports.id", ondelete="SET NULL"), nullable=True
    )
    source_type: Mapped[str] = mapped_column(String(16), default="PASTE")
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender: Mapped[str | None] = mapped_column(String(120), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    raw_text: Mapped[str] = mapped_column(Text)
    normalized_text: Mapped[str] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    parser_version: Mapped[str] = mapped_column(String(48))
    confidence: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="NEEDS_REVIEW")
    warnings_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    errors_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    broker_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trade_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    side: Mapped[str | None] = mapped_column(String(4), nullable=True)
    bill_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bamt: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    payment_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    line_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class TransactionBill(Base):
    __tablename__ = "account_bills"
    __table_args__ = (
        UniqueConstraint("sms_message_id", name="uq_account_bill_message"),
        Index("ix_account_bill_vault_date", "vault_id", "trade_date"),
        Index("ix_account_bill_vault_side", "vault_id", "side"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    sms_message_id: Mapped[int] = mapped_column(
        ForeignKey("account_sms_messages.id", ondelete="CASCADE"), index=True
    )
    bank_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("account_bank_accounts.id", ondelete="SET NULL"), nullable=True
    )
    broker_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    side: Mapped[str] = mapped_column(String(4))
    bill_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bamt: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    gross_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    charges_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cgt_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    calculated_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cash_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    reconciliation_status: Mapped[str] = mapped_column(
        String(32), default="ESTIMATED"
    )
    payment_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    edis_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    settlement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    edis_status: Mapped[str] = mapped_column(String(16), default="PENDING")
    wacc_status: Mapped[str] = mapped_column(String(16), default="PENDING")
    status: Mapped[str] = mapped_column(String(24), default="IMPORTED")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )


class Transaction(Base):
    __tablename__ = "account_transactions"
    __table_args__ = (
        UniqueConstraint("bill_id", "line_no", name="uq_account_tx_bill_line"),
        Index("ix_account_tx_vault_date", "vault_id", "trade_date"),
        Index("ix_account_tx_vault_symbol", "vault_id", "symbol"),
        Index("ix_account_tx_vault_status", "vault_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("account_bills.id", ondelete="CASCADE"), index=True
    )
    source_message_id: Mapped[int] = mapped_column(
        ForeignKey("account_sms_messages.id", ondelete="CASCADE"), index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, default=0)
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    security_name: Mapped[str | None] = mapped_column(String(240), nullable=True)
    security_type: Mapped[str] = mapped_column(String(32), default="EQUITY")
    side: Mapped[str] = mapped_column(String(4))
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    price: Mapped[Decimal] = mapped_column(Price)
    gross_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    commission: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    sebon_fee: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    dp_charge: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    other_charges: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    total_charges: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cgt: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    cost_basis: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    realized_pnl: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    net_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    payment_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    settlement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="IMPORTED")
    reconciliation_status: Mapped[str] = mapped_column(
        String(32), default="ESTIMATED"
    )
    fee_rule_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    fee_snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )


class Settlement(Base):
    __tablename__ = "account_settlements"
    __table_args__ = (
        Index("ix_account_settlement_vault_date", "vault_id", "settlement_date"),
        Index("ix_account_settlement_bill", "bill_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("account_bills.id", ondelete="CASCADE"), index=True
    )
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("account_transactions.id", ondelete="SET NULL"), nullable=True
    )
    direction: Mapped[str] = mapped_column(String(8))
    amount: Mapped[Decimal] = mapped_column(Money)
    settlement_date: Mapped[date] = mapped_column(Date, index=True)
    bank_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("account_bank_accounts.id", ondelete="SET NULL"), nullable=True
    )
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class PriceOverride(Base):
    __tablename__ = "account_price_overrides"
    __table_args__ = (
        UniqueConstraint("vault_id", "symbol", name="uq_account_price_symbol"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    price: Mapped[Decimal] = mapped_column(Price)
    as_of: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )


class FeeRule(Base):
    __tablename__ = "account_fee_rules"
    __table_args__ = (
        UniqueConstraint("code", name="uq_account_fee_rule_code"),
        Index("ix_account_fee_effective", "effective_from", "effective_to"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    version: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(240))
    effective_from: Mapped[date] = mapped_column(Date)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    transaction_type: Mapped[str] = mapped_column(String(8), default="BOTH")
    security_type: Mapped[str] = mapped_column(String(32), default="EQUITY")
    investor_category: Mapped[str] = mapped_column(String(32), default="ANY")
    holding_period: Mapped[str] = mapped_column(String(8), default="ANY")
    calculation: Mapped[str] = mapped_column(String(16), default="PERCENT")
    rate: Mapped[Decimal | None] = mapped_column(Rate, nullable=True)
    brackets: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    minimum: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    maximum: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    rounding: Mapped[str] = mapped_column(String(16), default="HALF_UP")
    source_title: Mapped[str] = mapped_column(String(240))
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification: Mapped[str] = mapped_column(String(16), default="UNVERIFIED")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditEvent(Base):
    __tablename__ = "account_audit_events"
    __table_args__ = (Index("ix_account_audit_vault", "vault_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_id: Mapped[str] = mapped_column(
        ForeignKey("account_vaults.id", ondelete="CASCADE"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(60))
    before_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    after_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
