from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from app.account.calendar import deadline_dates
from app.account.cashflow import build_cashflow
from app.account.models import (
    AccountVault,
    BankAccount,
    Settlement,
    SmsMessage,
    TransactionBill,
)


def make_vault(session, *, opening: str = "30000", opening_date: date = date(2026, 1, 5), settings=None):
    vault = AccountVault(
        id=str(uuid.uuid4()),
        label="Test",
        key_hash=uuid.uuid4().hex * 2,
        investor_category="RESIDENT_INDIVIDUAL",
        settings_json=settings or {},
    )
    session.add(vault)
    session.flush()
    account = BankAccount(
        vault_id=vault.id,
        name="Primary",
        opening_balance=Decimal(opening),
        opening_balance_date=opening_date,
        is_default=True,
    )
    session.add(account)
    session.flush()
    return vault, account


def make_bill(
    session,
    vault,
    account,
    *,
    side: str,
    trade_date: date,
    cash_amount: str,
    deadline: date | None = None,
    settlement: date | None = None,
):
    message = SmsMessage(
        vault_id=vault.id,
        source_type="PASTE",
        raw_text=f"test {uuid.uuid4()}",
        normalized_text=f"test {uuid.uuid4()}",
        fingerprint=uuid.uuid4().hex,
        parser_version="test",
        status="IMPORTED",
        trade_date=trade_date,
        side=side,
        line_count=1,
    )
    session.add(message)
    session.flush()
    bill = TransactionBill(
        vault_id=vault.id,
        sms_message_id=message.id,
        bank_account_id=account.id,
        broker_id="RK316455",
        trade_date=trade_date,
        side=side,
        bill_no="T1",
        cash_amount=Decimal(cash_amount),
        gross_amount=Decimal(cash_amount),
        reconciliation_status="ESTIMATED",
        payment_deadline=deadline,
        settlement_date=settlement,
    )
    session.add(bill)
    session.flush()
    return bill


def test_buy_payment_then_sell_receipt(session):
    vault, account = make_vault(session)
    make_bill(
        session,
        vault,
        account,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="20100",
        deadline=date(2026, 1, 6),
    )
    make_bill(
        session,
        vault,
        account,
        side="SELL",
        trade_date=date(2026, 1, 6),
        cash_amount="14800",
        settlement=date(2026, 1, 8),
    )
    session.commit()

    cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 8),
    )
    by_date = {day["date"]: day for day in cash["days"]}
    assert by_date["2026-01-06"]["projected_payments"] == "20100.00"
    assert by_date["2026-01-06"]["projected_closing_balance"] == "9900.00"
    assert by_date["2026-01-06"]["shortfall"] == "0.00"
    assert by_date["2026-01-08"]["expected_receipts"] == "14800.00"
    assert by_date["2026-01-08"]["projected_closing_balance"] == "24700.00"
    assert cash["metrics"]["actual_bank_balance"] == "30000.00"
    assert cash["metrics"]["potential_shortfall"] == "0.00"


def test_future_sale_does_not_cover_earlier_purchase(session):
    vault, account = make_vault(session, opening="10000")
    make_bill(
        session,
        vault,
        account,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="20000",
        deadline=date(2026, 1, 6),
    )
    make_bill(
        session,
        vault,
        account,
        side="SELL",
        trade_date=date(2026, 1, 6),
        cash_amount="20000",
        settlement=date(2026, 1, 7),
    )
    session.commit()
    cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 7),
    )
    assert cash["shortfalls"][0]["date"] == "2026-01-06"
    assert cash["shortfalls"][0]["amount"] == "10000.00"
    assert cash["metrics"]["potential_shortfall"] == "10000.00"
    assert cash["metrics"]["unconfirmed_receipts"] == "20000.00"


def test_same_day_sale_receipt_is_not_used_for_payment(session):
    vault, account = make_vault(session, opening="1000")
    make_bill(
        session,
        vault,
        account,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="5000",
        deadline=date(2026, 1, 6),
    )
    make_bill(
        session,
        vault,
        account,
        side="SELL",
        trade_date=date(2026, 1, 5),
        cash_amount="5000",
        settlement=date(2026, 1, 6),
    )
    session.commit()
    cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 6),
    )
    day = next(day for day in cash["days"] if day["date"] == "2026-01-06")
    assert day["projected_payments"] == "5000.00"
    assert day["expected_receipts"] == "5000.00"
    assert day["shortfall"] == "4000.00"


def test_partial_payment_and_cash_movement(session):
    vault, account = make_vault(session, opening="30000")
    bill = make_bill(
        session,
        vault,
        account,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="20000",
        deadline=date(2026, 1, 6),
    )
    session.add(
        Settlement(
            vault_id=vault.id,
            bill_id=bill.id,
            direction="PAYMENT",
            amount=Decimal("5000"),
            settlement_date=date(2026, 1, 5),
            bank_account_id=account.id,
        )
    )
    session.commit()
    cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 6),
    )
    by_date = {day["date"]: day for day in cash["days"]}
    assert by_date["2026-01-05"]["actual_payments"] == "5000.00"
    assert by_date["2026-01-06"]["projected_payments"] == "15000.00"
    assert cash["metrics"]["actual_bank_balance"] == "25000.00"


def test_holiday_moves_t_plus_one_deadline(session):
    settings = {"holiday_dates": ["2026-01-06"]}
    vault, account = make_vault(session, settings=settings)
    make_bill(
        session,
        vault,
        account,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="20000",
    )
    session.commit()
    cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 8),
    )
    payment = next(
        event
        for day in cash["days"]
        for event in day["events"]
        if event["kind"] == "PROJECTED_PAYMENT"
    )
    assert payment["amount"] == "-20000.00"
    assert any(day["date"] == "2026-01-07" and day["projected_payments"] == "20000.00" for day in cash["days"])


def test_trading_week_calendar_is_date_aware():
    # Before 6 April 2026, NEPSE traded Sunday-Thursday.
    assert deadline_dates(date(2026, 1, 9), {}, "BUY")["payment_deadline"] == date(2026, 1, 11)
    # From 6 April 2026, NEPSE trades Monday-Friday.
    assert deadline_dates(date(2026, 4, 10), {}, "BUY")["payment_deadline"] == date(2026, 4, 13)
    assert deadline_dates(date(2026, 4, 10), {}, "SELL")["settlement_date"] == date(2026, 4, 14)


def test_multiple_bank_accounts_aggregate_and_filter(session):
    vault, primary = make_vault(session, opening="10000")
    second = BankAccount(
        vault_id=vault.id,
        name="Second",
        opening_balance=Decimal("20000"),
        opening_balance_date=date(2026, 1, 5),
        is_default=False,
    )
    session.add(second)
    session.flush()
    make_bill(
        session,
        vault,
        second,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="5000",
        deadline=date(2026, 1, 6),
    )
    session.commit()
    all_cash = build_cashflow(
        session, vault, as_of=date(2026, 1, 5), start=date(2026, 1, 5), end=date(2026, 1, 7)
    )
    assert all_cash["metrics"]["actual_bank_balance"] == "30000.00"
    filtered = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 7),
        bank_account_id=primary.id,
    )
    assert filtered["metrics"]["actual_bank_balance"] == "10000.00"
    assert filtered["metrics"]["committed_payments"] == "0.00"


def test_actual_payment_reduces_same_day_available_cash(session):
    vault, account = make_vault(session, opening="1000")
    first = make_bill(
        session,
        vault,
        account,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="600",
        deadline=date(2026, 1, 6),
    )
    make_bill(
        session,
        vault,
        account,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="600",
        deadline=date(2026, 1, 6),
    )
    session.add(
        Settlement(
            vault_id=vault.id,
            bill_id=first.id,
            direction="PAYMENT",
            amount=Decimal("600"),
            settlement_date=date(2026, 1, 6),
            bank_account_id=account.id,
        )
    )
    session.commit()

    cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 6),
    )
    day = next(day for day in cash["days"] if day["date"] == "2026-01-06")
    assert day["actual_payments"] == "600.00"
    assert day["projected_payments"] == "600.00"
    assert day["shortfall"] == "200.00"
    assert day["confirmed_shortfall"] == "200.00"
    assert day["projected_closing_balance"] == "-200.00"


def test_filtered_account_includes_settlement_paid_from_that_account(session):
    vault, primary = make_vault(session, opening="1000")
    second = BankAccount(
        vault_id=vault.id,
        name="Second",
        opening_balance=Decimal("2000"),
        opening_balance_date=date(2026, 1, 5),
        is_default=False,
    )
    session.add(second)
    session.flush()
    bill = make_bill(
        session,
        vault,
        second,
        side="BUY",
        trade_date=date(2026, 1, 5),
        cash_amount="500",
        deadline=date(2026, 1, 6),
    )
    session.add(
        Settlement(
            vault_id=vault.id,
            bill_id=bill.id,
            direction="PAYMENT",
            amount=Decimal("200"),
            settlement_date=date(2026, 1, 5),
            bank_account_id=primary.id,
        )
    )
    session.commit()

    primary_cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 6),
        bank_account_id=primary.id,
    )
    primary_day = next(day for day in primary_cash["days"] if day["date"] == "2026-01-05")
    assert primary_day["actual_payments"] == "200.00"
    assert primary_cash["metrics"]["actual_bank_balance"] == "800.00"
    assert primary_cash["commitments"] == []

    second_cash = build_cashflow(
        session,
        vault,
        as_of=date(2026, 1, 5),
        start=date(2026, 1, 5),
        end=date(2026, 1, 6),
        bank_account_id=second.id,
    )
    second_day = next(day for day in second_cash["days"] if day["date"] == "2026-01-06")
    assert second_day["projected_payments"] == "300.00"
    assert second_cash["metrics"]["actual_bank_balance"] == "2000.00"


def test_no_bank_account_returns_empty_state(session):
    vault = AccountVault(
        id=str(uuid.uuid4()), label="Empty", key_hash=uuid.uuid4().hex * 2
    )
    session.add(vault)
    session.commit()
    cash = build_cashflow(session, vault, as_of=date(2026, 1, 5))
    assert cash["available"] is False
    assert cash["days"] == []
