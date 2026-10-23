from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .calendar import deadline_dates, nepal_today, settings_holidays
from .fees import ZERO, money
from .models import (
    AccountVault,
    BankAccount,
    CashMovement,
    Settlement,
    Transaction,
    TransactionBill,
)

MAX_SCHEDULE_DAYS = 2000


@dataclass
class CashEvent:
    date: date
    account_id: int | None
    kind: str
    amount: Decimal  # signed: payments negative, receipts/deposits positive
    actual: bool
    label: str
    bill_id: int | None = None
    bill_no: str | None = None
    side: str | None = None
    description: str | None = None
    depends_on_unconfirmed: bool = False


@dataclass
class AccountTrack:
    account: BankAccount
    opened: bool = False
    projected: Decimal = ZERO
    confirmed: Decimal = ZERO


def _signed_movement(movement: CashMovement) -> Decimal:
    amount = Decimal(str(movement.amount or 0))
    if movement.kind == "ADJUSTMENT":
        return money(amount)
    if movement.kind in {"WITHDRAWAL", "TRANSFER_OUT"}:
        return money(-abs(amount))
    return money(abs(amount))


def _bill_payment_status(bill: TransactionBill, paid: Decimal, received: Decimal) -> str:
    if bill.side == "BUY":
        due = Decimal(str(bill.cash_amount or 0))
        if due <= 0:
            return "NOTHING_DUE"
        if paid <= 0:
            return "UNPAID"
        if paid + Decimal("0.01") < due:
            return "PARTIAL"
        if paid > due + Decimal("0.01"):
            return "OVERPAID"
        return "PAID"
    due = Decimal(str(bill.cash_amount or 0))
    if due <= 0:
        return "NOTHING_DUE"
    if received <= 0:
        return "UNRECEIVED"
    if received + Decimal("0.01") < due:
        return "PARTIAL"
    if received > due + Decimal("0.01"):
        return "OVERPAID"
    return "RECEIVED"


def _safe_deadline(
    bill: TransactionBill, settings: dict[str, Any]
) -> tuple[date | None, date | None]:
    dates = deadline_dates(bill.trade_date, settings, bill.side)
    return (
        bill.payment_deadline or dates.get("payment_deadline"),
        bill.settlement_date or dates.get("settlement_date"),
    )


def build_cashflow(
    session: Session,
    vault: AccountVault,
    *,
    as_of: date | None = None,
    start: date | None = None,
    end: date | None = None,
    bank_account_id: int | None = None,
) -> dict[str, Any]:
    as_of = as_of or nepal_today()
    settings = vault.settings_json or {}
    accounts = list(
        session.scalars(
            select(BankAccount).where(BankAccount.vault_id == vault.id).order_by(
                BankAccount.is_default.desc(), BankAccount.id
            )
        ).all()
    )
    if bank_account_id is not None:
        if not any(account.id == bank_account_id for account in accounts):
            raise ValueError("That bank account does not belong to this vault.")
        accounts = [account for account in accounts if account.id == bank_account_id]
    if not accounts:
        return {
            "available": False,
            "as_of": as_of.isoformat(),
            "start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
            "accounts": [],
            "days": [],
            "shortfalls": [],
            "metrics": {
                "actual_bank_balance": "0.00",
                "committed_payments": "0.00",
                "expected_receipts": "0.00",
                "projected_available_cash": "0.00",
                "unconfirmed_receipts": "0.00",
                "potential_shortfall": "0.00",
                "max_shortfall": "0.00",
                "next_payment_deadline": None,
                "next_receipt_date": None,
            },
            "assumptions": [],
            "notes": ["Add a bank account to start the cash-flow schedule."],
        }

    account_ids = {account.id for account in accounts}
    default_account = next(
        (account for account in accounts if account.is_default and account.active),
        next((account for account in accounts if account.active), accounts[0]),
    )

    bills = list(
        session.scalars(
            select(TransactionBill)
            .where(
                TransactionBill.vault_id == vault.id,
                TransactionBill.status != "REVERSED",
            )
            .order_by(TransactionBill.trade_date, TransactionBill.id)
        ).all()
    )
    settlements = list(
        session.scalars(
            select(Settlement).where(
                Settlement.vault_id == vault.id,
                Settlement.reversed_at.is_(None),
            )
        ).all()
    )
    movements = list(
        session.scalars(
            select(CashMovement).where(
                CashMovement.vault_id == vault.id,
                CashMovement.reversed_at.is_(None),
            )
        ).all()
    )
    transactions = list(
        session.scalars(
            select(Transaction).where(Transaction.vault_id == vault.id)
        ).all()
    )
    tx_by_bill: dict[int, list[Transaction]] = {}
    for tx in transactions:
        tx_by_bill.setdefault(tx.bill_id, []).append(tx)

    settlements_by_bill: dict[int, list[Settlement]] = {}
    for settlement in settlements:
        settlements_by_bill.setdefault(settlement.bill_id, []).append(settlement)

    events: list[CashEvent] = []
    commitments: list[dict[str, Any]] = []
    notes: list[str] = []
    unassigned_bills = 0

    for bill in bills:
        bill_settlements = settlements_by_bill.get(bill.id, [])
        paid = money(
            sum(
                (
                    Decimal(str(s.amount or 0))
                    for s in bill_settlements
                    if s.direction == "PAYMENT"
                ),
                ZERO,
            )
        )
        received = money(
            sum(
                (
                    Decimal(str(s.amount or 0))
                    for s in bill_settlements
                    if s.direction == "RECEIPT"
                ),
                ZERO,
            )
        )
        due = money(Decimal(str(bill.cash_amount or 0)))
        settled = paid if bill.side == "BUY" else received
        outstanding = max(ZERO, money(due - settled))
        lines = tx_by_bill.get(bill.id, [])
        symbols = ", ".join(sorted({tx.symbol for tx in lines if tx.status != "REVERSED"}))
        label = f"{'Buy' if bill.side == 'BUY' else 'Sell'} bill"
        if bill.bill_no:
            label += f" {bill.bill_no}"
        if symbols:
            label += f" · {symbols}"

        # A settlement belongs to the bank account that actually paid or
        # received it, even when the bill itself is assigned to another bank.
        # Add those actual cash events before filtering projected commitments.
        for settlement in bill_settlements:
            direction = settlement.direction
            if direction not in {"PAYMENT", "RECEIPT"}:
                continue
            account_id = (
                settlement.bank_account_id
                or bill.bank_account_id
                or default_account.id
            )
            if account_id not in account_ids:
                continue
            amount = money(Decimal(str(settlement.amount or 0)))
            signed = -amount if direction == "PAYMENT" else amount
            events.append(
                CashEvent(
                    date=settlement.settlement_date,
                    account_id=account_id,
                    kind="ACTUAL_PAYMENT" if direction == "PAYMENT" else "ACTUAL_RECEIPT",
                    amount=signed,
                    actual=True,
                    label=label,
                    bill_id=bill.id,
                    bill_no=bill.bill_no,
                    side=bill.side,
                    description=settlement.reference or settlement.note,
                )
            )

        if bank_account_id is not None and bill.bank_account_id not in (None, bank_account_id):
            continue
        assigned_account = bill.bank_account_id or default_account.id
        if assigned_account not in account_ids:
            assigned_account = default_account.id
        if bill.bank_account_id is None:
            unassigned_bills += 1

        if outstanding > 0:
            if bill.side == "BUY":
                projected_date, _ = _safe_deadline(bill, settings)
                if projected_date is None:
                    projected_date = bill.trade_date + timedelta(days=1)
                events.append(
                    CashEvent(
                        date=projected_date,
                        account_id=assigned_account,
                        kind="PROJECTED_PAYMENT",
                        amount=-outstanding,
                        actual=False,
                        label=label,
                        bill_id=bill.id,
                        bill_no=bill.bill_no,
                        side=bill.side,
                        description="Broker payment deadline (T+1 unless overridden).",
                    )
                )
            else:
                _, settlement_date = _safe_deadline(bill, settings)
                projected_date = settlement_date or bill.trade_date + timedelta(days=2)
                events.append(
                    CashEvent(
                        date=projected_date,
                        account_id=assigned_account,
                        kind="EXPECTED_RECEIPT",
                        amount=outstanding,
                        actual=False,
                        label=label,
                        bill_id=bill.id,
                        bill_no=bill.bill_no,
                        side=bill.side,
                        description="Expected CDSC cash settlement (T+2 unless overridden).",
                        depends_on_unconfirmed=True,
                    )
                )
        due_date, settlement_date = _safe_deadline(bill, settings)
        commitments.append(
            {
                "bill_id": bill.id,
                "bill_no": bill.bill_no,
                "side": bill.side,
                "trade_date": bill.trade_date.isoformat(),
                "symbols": symbols,
                "broker_id": bill.broker_id,
                "cash_amount": f"{due:.2f}",
                "settled": f"{settled:.2f}",
                "outstanding": f"{outstanding:.2f}",
                "payment_deadline": due_date.isoformat() if due_date else None,
                "settlement_date": settlement_date.isoformat() if settlement_date else None,
                "status": _bill_payment_status(bill, paid, received),
                "reconciliation_status": bill.reconciliation_status,
            }
        )

    for movement in movements:
        if movement.bank_account_id not in account_ids:
            continue
        events.append(
            CashEvent(
                date=movement.movement_date,
                account_id=movement.bank_account_id,
                kind=f"CASH_{movement.kind}",
                amount=_signed_movement(movement),
                actual=True,
                label=movement.kind.replace("_", " ").title(),
                description=movement.note,
            )
        )

    if unassigned_bills:
        notes.append(
            f"{unassigned_bills} bill(s) have no bank account assigned; they use the default account."
        )

    event_dates = [event.date for event in events]
    opening_dates = [account.opening_balance_date for account in accounts]
    earliest_event = min(event_dates) if event_dates else as_of
    earliest = min([*opening_dates, earliest_event, as_of])
    latest = max([*event_dates, as_of, end or as_of])
    requested_start = start or earliest
    requested_end = end or (latest + timedelta(days=30))
    compute_start = min(earliest, requested_start)
    compute_end = max(latest, requested_end)
    if compute_end < compute_start:
        compute_end = compute_start
    if (compute_end - compute_start).days > MAX_SCHEDULE_DAYS:
        compute_start = compute_end - timedelta(days=MAX_SCHEDULE_DAYS)
        notes.append(
            f"The schedule is capped at {MAX_SCHEDULE_DAYS} days; earlier history is not shown."
        )

    tracks = {
        account.id: AccountTrack(account=account)
        for account in accounts
    }
    events_by_date: dict[date, list[CashEvent]] = {}
    for event in events:
        if compute_start <= event.date <= compute_end:
            events_by_date.setdefault(event.date, []).append(event)

    full_days: list[dict[str, Any]] = []
    as_of_confirmed: Decimal | None = None
    as_of_projected: Decimal | None = None

    # If the 2,000-day safety cap dropped earlier history, seed each account
    # with its opening balance and all events before the visible start.
    for track in tracks.values():
        if track.account.opening_balance_date <= compute_start:
            track.opened = True
            track.projected = money(track.account.opening_balance)
            track.confirmed = money(track.account.opening_balance)
    for event in events:
        if event.date >= compute_start:
            continue
        track = tracks.get(event.account_id)
        if track is None or not track.opened:
            continue
        track.projected = money(track.projected + event.amount)
        if event.actual:
            track.confirmed = money(track.confirmed + event.amount)

    current = compute_start
    while current <= compute_end:
        for track in tracks.values():
            if not track.opened and current >= track.account.opening_balance_date:
                track.projected = money(track.account.opening_balance)
                track.confirmed = money(track.account.opening_balance)
                track.opened = True
        day_events = events_by_date.get(current, [])
        opening_projected = money(sum((track.projected for track in tracks.values() if track.opened), ZERO))
        opening_confirmed = money(sum((track.confirmed for track in tracks.values() if track.opened), ZERO))
        actual_payments = money(-sum((e.amount for e in day_events if e.kind == "ACTUAL_PAYMENT"), ZERO))
        actual_receipts = money(sum((e.amount for e in day_events if e.kind == "ACTUAL_RECEIPT"), ZERO))
        projected_payments = money(-sum((e.amount for e in day_events if e.kind == "PROJECTED_PAYMENT"), ZERO))
        expected_receipts = money(sum((e.amount for e in day_events if e.kind == "EXPECTED_RECEIPT"), ZERO))
        other = money(
            sum(
                (
                    e.amount
                    for e in day_events
                    if e.kind.startswith("CASH_")
                ),
                ZERO,
            )
        )
        net_actual = money(actual_receipts - actual_payments + other)
        net_projected = money(net_actual + expected_receipts - projected_payments)
        available_confirmed = max(
            ZERO,
            money(opening_confirmed + other + actual_receipts - actual_payments),
        )
        available_projected = max(
            ZERO,
            money(opening_projected + other + actual_receipts - actual_payments),
        )
        shortfall_confirmed = max(ZERO, money(projected_payments - available_confirmed))
        shortfall_projected = max(ZERO, money(projected_payments - available_projected))
        unconfirmed_opening = max(ZERO, money(opening_projected - opening_confirmed))
        depends = (
            projected_payments > 0
            and unconfirmed_opening > 0
            and shortfall_projected == 0
        )
        if shortfall_projected > 0:
            status = "SHORTFALL_CONFIRMED_CASH" if shortfall_confirmed > 0 else "SHORTFALL"
        elif current < as_of and projected_payments > 0:
            status = "OVERDUE_PAYMENT"
        elif depends:
            status = "DEPENDS_ON_UNCONFIRMED"
        else:
            status = "OK"

        closing_projected = money(opening_projected + net_projected)
        closing_confirmed = money(opening_confirmed + net_actual)
        full_days.append(
            {
                "date": current.isoformat(),
                "opening_balance": f"{opening_projected:.2f}",
                "confirmed_opening_balance": f"{opening_confirmed:.2f}",
                "actual_payments": f"{actual_payments:.2f}",
                "projected_payments": f"{projected_payments:.2f}",
                "actual_receipts": f"{actual_receipts:.2f}",
                "expected_receipts": f"{expected_receipts:.2f}",
                "other_movements": f"{other:.2f}",
                "net_cash_flow": f"{net_projected:.2f}",
                "actual_net_cash_flow": f"{net_actual:.2f}",
                "projected_closing_balance": f"{closing_projected:.2f}",
                "confirmed_closing_balance": f"{closing_confirmed:.2f}",
                "unconfirmed_opening_balance": f"{unconfirmed_opening:.2f}",
                "shortfall": f"{shortfall_projected:.2f}",
                "confirmed_shortfall": f"{shortfall_confirmed:.2f}",
                "status": status,
                "events": [
                    {
                        "kind": event.kind,
                        "amount": f"{event.amount:.2f}",
                        "actual": event.actual,
                        "label": event.label,
                        "bill_id": event.bill_id,
                        "bill_no": event.bill_no,
                        "side": event.side,
                        "description": event.description,
                    }
                    for event in sorted(day_events, key=lambda e: (e.actual, e.kind))
                ],
            }
        )
        for event in day_events:
            track = tracks.get(event.account_id)
            if track is None or not track.opened:
                continue
            track.projected = money(track.projected + event.amount)
            if event.actual:
                track.confirmed = money(track.confirmed + event.amount)
        if current <= as_of:
            as_of_confirmed = closing_confirmed
            as_of_projected = closing_projected
        current += timedelta(days=1)

    if as_of_confirmed is None:
        as_of_confirmed = money(sum((t.confirmed for t in tracks.values() if t.opened), ZERO))
        as_of_projected = money(sum((t.projected for t in tracks.values() if t.opened), ZERO))

    visible_days = [
        day
        for day in full_days
        if (start is None or date.fromisoformat(day["date"]) >= start)
        and (end is None or date.fromisoformat(day["date"]) <= end)
    ]
    shortfalls = [
        {
            "date": day["date"],
            "amount": day["shortfall"],
            "confirmed_amount": day["confirmed_shortfall"],
            "status": day["status"],
        }
        for day in full_days
        if Decimal(day["shortfall"]) > 0
    ]
    first_shortfall = next(
        (item for item in shortfalls if Decimal(item["amount"]) > 0),
        None,
    )
    max_shortfall = max((Decimal(item["amount"]) for item in shortfalls), default=ZERO)
    committed = money(
        sum(
            (
                Decimal(item["outstanding"])
                for item in commitments
                if item["side"] == "BUY"
            ),
            ZERO,
        )
    )
    expected = money(
        sum(
            (
                Decimal(item["outstanding"])
                for item in commitments
                if item["side"] == "SELL"
            ),
            ZERO,
        )
    )
    next_payment = next(
        (
            item["payment_deadline"]
            for item in sorted(
                (c for c in commitments if c["side"] == "BUY" and Decimal(c["outstanding"]) > 0),
                key=lambda c: c["payment_deadline"] or "9999-12-31",
            )
        ),
        None,
    )
    next_receipt = next(
        (
            item["settlement_date"]
            for item in sorted(
                (c for c in commitments if c["side"] == "SELL" and Decimal(c["outstanding"]) > 0),
                key=lambda c: c["settlement_date"] or "9999-12-31",
            )
        ),
        None,
    )
    overdue = money(
        sum(
            (
                Decimal(event.amount)
                for event in events
                if event.kind == "PROJECTED_PAYMENT" and event.date < as_of
            ),
            ZERO,
        )
    )
    # Negative projected payments have already had their sign applied; report
    # overdue as a positive amount for the UI.
    overdue = money(abs(overdue))
    last_visible = visible_days[-1] if visible_days else (full_days[-1] if full_days else None)
    return {
        "available": True,
        "as_of": as_of.isoformat(),
        "start": requested_start.isoformat() if requested_start else None,
        "end": requested_end.isoformat() if requested_end else None,
        "accounts": [
            {
                "id": track.account.id,
                "name": track.account.name,
                "opening_balance": f"{money(track.account.opening_balance):.2f}",
                "opening_balance_date": track.account.opening_balance_date.isoformat(),
                "is_default": track.account.is_default,
                "active": track.account.active,
                "confirmed_balance": f"{money(track.confirmed):.2f}",
                "projected_balance": f"{money(track.projected):.2f}",
            }
            for track in tracks.values()
            if track.account.id in account_ids
        ],
        "days": visible_days,
        "shortfalls": shortfalls,
        "commitments": commitments,
        "metrics": {
            "actual_bank_balance": f"{money(as_of_confirmed):.2f}",
            "projected_available_cash": f"{money(Decimal(last_visible['projected_closing_balance'])):.2f}" if last_visible else f"{money(as_of_projected):.2f}",
            "committed_payments": f"{committed:.2f}",
            "expected_receipts": f"{expected:.2f}",
            "unconfirmed_receipts": f"{expected:.2f}",
            "potential_shortfall": f"{max_shortfall:.2f}",
            "max_shortfall": f"{max_shortfall:.2f}",
            "first_shortfall": first_shortfall,
            "next_payment_deadline": next_payment,
            "next_receipt_date": next_receipt,
            "overdue_payments": f"{overdue:.2f}",
            "confirmed_balance": f"{money(as_of_confirmed):.2f}",
        },
        "assumptions": [
            "BUY payments are projected on the broker's T+1 deadline unless the bill has a saved deadline or a recorded payment.",
            "SELL receipts are projected on CDSC's T+2 cash settlement date. EDIS/WACC is a separate T+1 obligation.",
            "Projected SELL receipts are never treated as confirmed cash. A same-day receipt is not used to cover a payment due earlier that day.",
            "NEPSE traded Monday-Friday from 6 April 2026; before that it traded Sunday-Thursday.",
            f"{len(settings_holidays(settings))} user-configured market holiday(s) are applied.",
            "Cash movements are user-recorded actual movements, not inferred from market data.",
        ],
        "notes": notes,
        "has_data": bool(events),
    }
