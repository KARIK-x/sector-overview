from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .calendar import nepal_today

InvestorCategory = Literal["RESIDENT_INDIVIDUAL", "RESIDENT_ENTITY", "NON_RESIDENT"]
Side = Literal["BUY", "SELL"]
MovementKind = Literal[
    "DEPOSIT", "WITHDRAWAL", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"
]
SettlementDirection = Literal["PAYMENT", "RECEIPT"]
ObligationStatus = Literal["PENDING", "COMPLETED", "NOT_REQUIRED", "WAIVED"]

SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,24}$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VaultCreate(StrictModel):
    label: str = Field(default="Personal account", min_length=1, max_length=120)
    investor_category: InvestorCategory = "RESIDENT_INDIVIDUAL"
    opening_balance: Decimal = Decimal("0")
    opening_balance_date: date = Field(default_factory=nepal_today)
    default_broker: str | None = Field(default=None, max_length=32)
    bank_account_name: str = Field(default="Primary bank", min_length=1, max_length=120)

    @field_validator("label", "bank_account_name")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("opening_balance")
    @classmethod
    def _non_negative(cls, value: Decimal) -> Decimal:
        if value < 0:
            raise ValueError("opening balance cannot be negative")
        return value

    @field_validator("default_broker")
    @classmethod
    def _broker(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().upper()
        if value and not re.fullmatch(r"[A-Z0-9_-]{2,32}", value):
            raise ValueError("broker ID contains unsupported characters")
        return value or None


class VaultSettingsUpdate(StrictModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    investor_category: InvestorCategory | None = None
    default_broker: str | None = Field(default=None, max_length=32)
    holiday_dates: list[str] | None = Field(default=None, max_length=370)
    buy_payment_business_days: int | None = Field(default=None, ge=0, le=10)
    edis_business_days: int | None = Field(default=None, ge=0, le=10)
    sell_settlement_business_days: int | None = Field(default=None, ge=0, le=10)

    @field_validator("holiday_dates")
    @classmethod
    def _holidays(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        cleaned: list[str] = []
        for raw in values:
            try:
                parsed = date.fromisoformat(str(raw).strip()[:10])
            except ValueError as exc:
                raise ValueError(f"invalid holiday date: {raw!r}") from exc
            iso = parsed.isoformat()
            if iso not in cleaned:
                cleaned.append(iso)
        return sorted(cleaned)

    @field_validator("default_broker")
    @classmethod
    def _broker(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().upper()
        if value and not re.fullmatch(r"[A-Z0-9_-]{2,32}", value):
            raise ValueError("broker ID contains unsupported characters")
        return value or None


class BankAccountCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    opening_balance: Decimal = Decimal("0")
    opening_balance_date: date = Field(default_factory=nepal_today)
    is_default: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("opening_balance")
    @classmethod
    def _non_negative(cls, value: Decimal) -> Decimal:
        if value < 0:
            raise ValueError("opening balance cannot be negative")
        return value


class BankAccountUpdate(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    opening_balance: Decimal | None = None
    opening_balance_date: date | None = None
    is_default: bool | None = None
    active: bool | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("opening_balance")
    @classmethod
    def _non_negative(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("opening balance cannot be negative")
        return value


class CashMovementCreate(StrictModel):
    bank_account_id: int
    movement_date: date
    kind: MovementKind
    amount: Decimal
    note: str | None = Field(default=None, max_length=500)
    counter_account_id: int | None = None

    @model_validator(mode="after")
    def _amount_rules(self):
        if self.kind == "ADJUSTMENT":
            if self.amount == 0:
                raise ValueError("adjustment amount cannot be zero")
        elif self.amount <= 0:
            raise ValueError("amount must be greater than zero")
        if self.kind in {"TRANSFER_IN", "TRANSFER_OUT"} and not self.counter_account_id:
            raise ValueError("transfer requires counter_account_id")
        return self


class SettlementCreate(StrictModel):
    direction: SettlementDirection
    amount: Decimal
    settlement_date: date
    bank_account_id: int | None = None
    transaction_id: int | None = None
    reference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("amount")
    @classmethod
    def _positive(cls, value: Decimal) -> Decimal:
        if value <= 0:
            raise ValueError("amount must be greater than zero")
        return value


class RawMessageIn(StrictModel):
    raw_text: str = Field(min_length=1, max_length=20_000)
    sender: str | None = Field(default=None, max_length=120)
    received_at: datetime | None = None


class PreviewRequest(StrictModel):
    source_type: Literal["PASTE", "TXT", "CSV", "XML", "JSON"] = "PASTE"
    filename: str | None = Field(default=None, max_length=255)
    content: str | None = Field(default=None, max_length=2_000_000)
    messages: list[RawMessageIn] | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _has_input(self):
        if not self.content and not self.messages:
            raise ValueError("provide content or messages")
        return self


class LineOverride(StrictModel):
    line_no: int = Field(ge=0, le=99)
    symbol: str = Field(min_length=1, max_length=25)
    quantity: Decimal
    price: Decimal

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str) -> str:
        value = value.strip().upper()
        if not SYMBOL_RE.fullmatch(value):
            raise ValueError("invalid NEPSE symbol")
        return value

    @field_validator("quantity", "price")
    @classmethod
    def _positive(cls, value: Decimal) -> Decimal:
        if value <= 0:
            raise ValueError("must be greater than zero")
        return value


class MessageOverrides(StrictModel):
    broker_id: str | None = Field(default=None, max_length=32)
    trade_date: date | None = None
    side: Side | None = None
    bill_no: str | None = Field(default=None, max_length=64)
    bamt: Decimal | None = None
    payment_url: str | None = Field(default=None, max_length=2048)
    lines: list[LineOverride] | None = Field(default=None, max_length=100)

    @field_validator("bamt")
    @classmethod
    def _bamt(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("BAmt cannot be negative")
        return value

    @field_validator("payment_url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if not value.lower().startswith(("http://", "https://")):
            raise ValueError("payment URL must use http or https")
        return value


class CommitMessage(StrictModel):
    raw_text: str = Field(min_length=1, max_length=20_000)
    sender: str | None = Field(default=None, max_length=120)
    received_at: datetime | None = None
    approved: bool = True
    overrides: MessageOverrides | None = None


class ImportCommitRequest(StrictModel):
    source_type: Literal["PASTE", "TXT", "CSV", "XML", "JSON"] = "PASTE"
    filename: str | None = Field(default=None, max_length=255)
    messages: list[CommitMessage] = Field(min_length=1, max_length=500)


class TransactionUpdate(StrictModel):
    symbol: str | None = Field(default=None, min_length=1, max_length=25)
    side: Side | None = None
    trade_date: date | None = None
    quantity: Decimal | None = None
    price: Decimal | None = None
    bill_no: str | None = Field(default=None, max_length=64)
    bamt: Decimal | None = None
    notes: str | None = Field(default=None, max_length=1000)
    payment_deadline: date | None = None
    settlement_date: date | None = None
    edis_status: ObligationStatus | None = None
    wacc_status: ObligationStatus | None = None
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().upper()
        if not SYMBOL_RE.fullmatch(value):
            raise ValueError("invalid NEPSE symbol")
        return value

    @field_validator("quantity", "price")
    @classmethod
    def _positive(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value <= 0:
            raise ValueError("must be greater than zero")
        return value

    @field_validator("bamt")
    @classmethod
    def _bamt(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("BAmt cannot be negative")
        return value


class BillUpdate(StrictModel):
    bill_no: str | None = Field(default=None, max_length=64)
    bamt: Decimal | None = None
    payment_deadline: date | None = None
    edis_deadline: date | None = None
    settlement_date: date | None = None
    edis_status: ObligationStatus | None = None
    wacc_status: ObligationStatus | None = None
    bank_account_id: int | None = None
    notes: str | None = Field(default=None, max_length=1000)
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("bamt")
    @classmethod
    def _bamt(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value < 0:
            raise ValueError("BAmt cannot be negative")
        return value


class ReasonRequest(StrictModel):
    reason: str = Field(min_length=3, max_length=500)


class PriceOverrideCreate(StrictModel):
    price: Decimal
    as_of: date
    note: str | None = Field(default=None, max_length=500)

    @field_validator("price")
    @classmethod
    def _positive(cls, value: Decimal) -> Decimal:
        if value <= 0:
            raise ValueError("price must be greater than zero")
        return value
