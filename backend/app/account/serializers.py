from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from .fees import ZERO
from .models import (
    AccountVault,
    AuditEvent,
    BankAccount,
    CashMovement,
    FeeRule,
    Settlement,
    SmsMessage,
    Transaction,
    TransactionBill,
)

CENT = Decimal("0.01")
FOUR = Decimal("0.0001")


def money_str(value: Decimal | float | int | str | None) -> str:
    if value is None:
        return "0.00"
    return f"{Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP):.2f}"


def qty_str(value: Decimal | float | int | str | None) -> str:
    if value is None:
        return "0"
    return f"{Decimal(str(value)).quantize(FOUR, rounding=ROUND_HALF_UP):.4f}"


def iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def vault_payload(vault: AccountVault) -> dict[str, Any]:
    settings = vault.settings_json or {}
    return {
        "id": vault.id,
        "label": vault.label,
        "investor_category": vault.investor_category,
        "cost_basis_method": vault.cost_basis_method,
        "default_broker": vault.default_broker,
        "created_at": iso(vault.created_at),
        "last_seen_at": iso(vault.last_seen_at),
        "settings": {
            "holiday_dates": settings.get("holiday_dates") or [],
            "buy_payment_business_days": settings.get("buy_payment_business_days", 1),
            "edis_business_days": settings.get("edis_business_days", 1),
            "sell_settlement_business_days": settings.get("sell_settlement_business_days", 2),
        },
    }


def bank_account_payload(account: BankAccount) -> dict[str, Any]:
    return {
        "id": account.id,
        "name": account.name,
        "currency": account.currency,
        "opening_balance": money_str(account.opening_balance),
        "opening_balance_date": iso(account.opening_balance_date),
        "is_default": account.is_default,
        "active": account.active,
        "created_at": iso(account.created_at),
        "updated_at": iso(account.updated_at),
    }


def cash_movement_payload(movement: CashMovement) -> dict[str, Any]:
    amount = money_str(movement.amount)
    signed = amount
    if movement.kind in {"WITHDRAWAL", "TRANSFER_OUT"}:
        signed = f"-{abs(Decimal(amount)):.2f}"
    elif movement.kind == "ADJUSTMENT":
        signed = money_str(movement.amount)
    return {
        "id": movement.id,
        "bank_account_id": movement.bank_account_id,
        "movement_date": iso(movement.movement_date),
        "kind": movement.kind,
        "amount": amount,
        "signed_amount": signed,
        "note": movement.note,
        "counter_account_id": movement.counter_account_id,
        "transfer_group": movement.transfer_group,
        "reversed_at": iso(movement.reversed_at),
        "reversal_reason": movement.reversal_reason,
        "created_at": iso(movement.created_at),
    }


def settlement_payload(settlement: Settlement) -> dict[str, Any]:
    return {
        "id": settlement.id,
        "bill_id": settlement.bill_id,
        "transaction_id": settlement.transaction_id,
        "direction": settlement.direction,
        "amount": money_str(settlement.amount),
        "settlement_date": iso(settlement.settlement_date),
        "bank_account_id": settlement.bank_account_id,
        "reference": settlement.reference,
        "note": settlement.note,
        "reversed_at": iso(settlement.reversed_at),
        "reversal_reason": settlement.reversal_reason,
        "created_at": iso(settlement.created_at),
    }


def message_payload(
    message: SmsMessage,
    *,
    include_raw: bool = False,
    duplicate_of: int | None = None,
) -> dict[str, Any]:
    out = {
        "id": message.id,
        "import_id": message.import_id,
        "source_type": message.source_type,
        "filename": message.filename,
        "sender": message.sender,
        "received_at": iso(message.received_at),
        "fingerprint": message.fingerprint,
        "parser_version": message.parser_version,
        "confidence": message.confidence,
        "status": message.status,
        "warnings": message.warnings_json or [],
        "errors": message.errors_json or [],
        "broker_id": message.broker_id,
        "trade_date": iso(message.trade_date),
        "side": message.side,
        "bill_no": message.bill_no,
        "bamt": money_str(message.bamt) if message.bamt is not None else None,
        "payment_url": message.payment_url,
        "line_count": message.line_count,
        "created_at": iso(message.created_at),
        "imported_at": iso(message.imported_at),
        "duplicate_of": duplicate_of,
    }
    if include_raw:
        out["raw_text"] = message.raw_text
        out["normalized_text"] = message.normalized_text
    return out


def bill_payload(
    bill: TransactionBill,
    *,
    paid: Decimal = ZERO,
    received: Decimal = ZERO,
    transactions: Iterable[Transaction] | None = None,
) -> dict[str, Any]:
    due = Decimal(str(bill.cash_amount or 0))
    settled = paid if bill.side == "BUY" else received
    outstanding = max(ZERO, (due - settled).quantize(CENT))
    if bill.side == "BUY":
        if due <= 0:
            payment_status = "NOTHING_DUE"
        elif paid <= 0:
            payment_status = "UNPAID"
        elif paid + CENT < due:
            payment_status = "PARTIAL"
        elif paid > due + CENT:
            payment_status = "OVERPAID"
        else:
            payment_status = "PAID"
    else:
        if due <= 0:
            payment_status = "NOTHING_DUE"
        elif received <= 0:
            payment_status = "UNRECEIVED"
        elif received + CENT < due:
            payment_status = "PARTIAL"
        elif received > due + CENT:
            payment_status = "OVERPAID"
        else:
            payment_status = "RECEIVED"
    return {
        "id": bill.id,
        "sms_message_id": bill.sms_message_id,
        "bank_account_id": bill.bank_account_id,
        "broker_id": bill.broker_id,
        "trade_date": iso(bill.trade_date),
        "side": bill.side,
        "bill_no": bill.bill_no,
        "bamt": money_str(bill.bamt) if bill.bamt is not None else None,
        "gross_amount": money_str(bill.gross_amount),
        "charges_total": money_str(bill.charges_total),
        "cgt_total": money_str(bill.cgt_total),
        "calculated_total": money_str(bill.calculated_total),
        "cash_amount": money_str(bill.cash_amount),
        "reconciliation_status": bill.reconciliation_status,
        "payment_deadline": iso(bill.payment_deadline),
        "edis_deadline": iso(bill.edis_deadline),
        "settlement_date": iso(bill.settlement_date),
        "edis_status": bill.edis_status,
        "wacc_status": bill.wacc_status,
        "status": bill.status,
        "notes": bill.notes,
        "paid_amount": money_str(paid),
        "received_amount": money_str(received),
        "outstanding": money_str(outstanding),
        "payment_status": payment_status,
        "created_at": iso(bill.created_at),
        "updated_at": iso(bill.updated_at),
        "transactions": [
            transaction_payload(tx, bill, paid=paid, received=received)
            for tx in (transactions or [])
        ],
    }


def transaction_payload(
    tx: Transaction,
    bill: TransactionBill | None = None,
    *,
    paid: Decimal = ZERO,
    received: Decimal = ZERO,
    message: SmsMessage | None = None,
    include_raw: bool = False,
) -> dict[str, Any]:
    out = {
        "id": tx.id,
        "vault_id": tx.vault_id,
        "bill_id": tx.bill_id,
        "source_message_id": tx.source_message_id,
        "line_no": tx.line_no,
        "symbol": tx.symbol,
        "security_name": tx.security_name,
        "security_type": tx.security_type,
        "side": tx.side,
        "trade_date": iso(tx.trade_date),
        "quantity": qty_str(tx.quantity),
        "price": qty_str(tx.price),
        "gross_amount": money_str(tx.gross_amount),
        "commission": money_str(tx.commission),
        "sebon_fee": money_str(tx.sebon_fee),
        "dp_charge": money_str(tx.dp_charge),
        "other_charges": money_str(tx.other_charges),
        "total_charges": money_str(tx.total_charges),
        "cgt": money_str(tx.cgt),
        "cost_basis": money_str(tx.cost_basis) if tx.cost_basis is not None else None,
        "realized_pnl": money_str(tx.realized_pnl) if tx.realized_pnl is not None else None,
        "net_amount": money_str(tx.net_amount),
        "payment_deadline": iso(tx.payment_deadline),
        "settlement_date": iso(tx.settlement_date),
        "status": tx.status,
        "reconciliation_status": tx.reconciliation_status,
        "fee_rule_version": tx.fee_rule_version,
        "fee_snapshot": tx.fee_snapshot_json or {},
        "notes": tx.notes,
        "reversed_at": iso(tx.reversed_at),
        "reversal_reason": tx.reversal_reason,
        "created_at": iso(tx.created_at),
        "updated_at": iso(tx.updated_at),
        "bill_no": bill.bill_no if bill else None,
        "broker_id": bill.broker_id if bill else None,
        "bamt": money_str(bill.bamt) if bill and bill.bamt is not None else None,
        "bill_cash_amount": money_str(bill.cash_amount) if bill else None,
        "bill_reconciliation_status": bill.reconciliation_status if bill else None,
        "bill_status": bill.status if bill else None,
        "edis_status": bill.edis_status if bill else None,
        "wacc_status": bill.wacc_status if bill else None,
        "paid_amount": money_str(paid),
        "received_amount": money_str(received),
    }
    if bill is not None:
        due = Decimal(str(bill.cash_amount or 0))
        settled = paid if bill.side == "BUY" else received
        out["outstanding"] = money_str(max(ZERO, (due - settled).quantize(CENT)))
    if message is not None:
        out["message_status"] = message.status
        out["message_warnings"] = message.warnings_json or []
        out["message_errors"] = message.errors_json or []
        if include_raw:
            out["raw_text"] = message.raw_text
    return out


def fee_rule_payload(rule: FeeRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "code": rule.code,
        "version": rule.version,
        "description": rule.description,
        "effective_from": iso(rule.effective_from),
        "effective_to": iso(rule.effective_to),
        "transaction_type": rule.transaction_type,
        "security_type": rule.security_type,
        "investor_category": rule.investor_category,
        "holding_period": rule.holding_period,
        "calculation": rule.calculation,
        "rate": str(rule.rate) if rule.rate is not None else None,
        "brackets": rule.brackets,
        "minimum": money_str(rule.minimum) if rule.minimum is not None else None,
        "maximum": money_str(rule.maximum) if rule.maximum is not None else None,
        "rounding": rule.rounding,
        "source_title": rule.source_title,
        "source_url": rule.source_url,
        "verification": rule.verification,
        "notes": rule.notes,
    }


def audit_payload(event: AuditEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "action": event.action,
        "before": event.before_json,
        "after": event.after_json,
        "note": event.note,
        "created_at": iso(event.created_at),
    }
