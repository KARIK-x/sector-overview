from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.account.fees import (
    ChargeLine,
    _allocate,
    calculate_bill_charges,
    cgt_rate,
    ensure_default_fee_rules,
)
from app.account.models import FeeRule  # noqa: F401  (register metadata)
from app.models import Security


@pytest.fixture()
def seeded(session):
    ensure_default_fee_rules(session)
    return session


def test_equity_commission_sebon_and_dp(session):
    ensure_default_fee_rules(session)
    result = calculate_bill_charges(
        session,
        side="BUY",
        trade_date=date(2026, 4, 15),
        investor_category="RESIDENT_INDIVIDUAL",
        lines=[
            {"line_no": 0, "symbol": "HIDCLP", "quantity": "500", "price": "213.84"},
            {"line_no": 1, "symbol": "JBBL", "quantity": "200", "price": "377.57"},
        ],
    )
    assert result.gross == Decimal("182434.00")
    assert result.commission == Decimal("602.03")
    assert result.sebon_fee == Decimal("27.37")
    assert result.dp_charge == Decimal("50.00")
    assert result.total_charges == Decimal("679.40")
    assert [line.dp_charge for line in result.lines] == [Decimal("25.00"), Decimal("25.00")]
    assert sum((line.total_charges for line in result.lines), Decimal("0")) == result.total_charges
    assert result.status == "CALCULATED"


def test_minimum_commission(session):
    ensure_default_fee_rules(session)
    result = calculate_bill_charges(
        session,
        side="BUY",
        trade_date=date(2026, 4, 15),
        investor_category="RESIDENT_INDIVIDUAL",
        lines=[{"line_no": 0, "symbol": "NABIL", "quantity": "10", "price": "100"}],
    )
    assert result.commission == Decimal("10.00")
    assert result.sebon_fee == Decimal("0.15")
    assert result.dp_charge == Decimal("25.00")


def test_tier_boundaries(session):
    ensure_default_fee_rules(session)

    def commission(amount: str) -> Decimal:
        return calculate_bill_charges(
            session,
            side="BUY",
            trade_date=date(2026, 4, 15),
            investor_category="RESIDENT_INDIVIDUAL",
            lines=[{"line_no": 0, "symbol": "NABIL", "quantity": "1", "price": amount}],
        ).commission

    assert commission("50000") == Decimal("180.00")
    assert commission("500000") == Decimal("1650.00")
    assert commission("500000.01") == Decimal("1550.00")
    assert commission("2000000") == Decimal("6200.00")
    assert commission("2000000.01") == Decimal("5400.00")
    assert commission("10000000") == Decimal("27000.00")
    assert commission("10000000.01") == Decimal("24000.00")


def test_mutual_fund_rates(session):
    ensure_default_fee_rules(session)
    session.add(Security(symbol="NIBLGF", name="NIBL Growth Fund", instrument_type="mutual_fund"))
    session.commit()
    result = calculate_bill_charges(
        session,
        side="BUY",
        trade_date=date(2026, 4, 15),
        investor_category="RESIDENT_INDIVIDUAL",
        lines=[{"line_no": 0, "symbol": "NIBLGF", "quantity": "100000", "price": "10"}],
    )
    assert result.commission == Decimal("1200.00")
    assert result.sebon_fee == Decimal("100.00")
    assert result.dp_charge == Decimal("25.00")


def test_duplicate_symbol_gets_one_dp_charge(session):
    ensure_default_fee_rules(session)
    result = calculate_bill_charges(
        session,
        side="BUY",
        trade_date=date(2026, 4, 15),
        investor_category="RESIDENT_INDIVIDUAL",
        lines=[
            {"line_no": 0, "symbol": "NABIL", "quantity": "10", "price": "100"},
            {"line_no": 1, "symbol": "NABIL", "quantity": "20", "price": "100"},
        ],
    )
    assert result.dp_charge == Decimal("25.00")
    assert [line.dp_charge for line in result.lines] == [Decimal("25.00"), Decimal("0.00")]


def test_cgt_rates_before_and_after_shrawan_2083(session):
    ensure_default_fee_rules(session)
    old_long, _ = cgt_rate(
        session,
        trade_date=date(2026, 7, 16),
        investor_category="RESIDENT_INDIVIDUAL",
        holding_period="LONG",
    )
    old_short, _ = cgt_rate(
        session,
        trade_date=date(2026, 7, 16),
        investor_category="RESIDENT_INDIVIDUAL",
        holding_period="SHORT",
    )
    new_long, _ = cgt_rate(
        session,
        trade_date=date(2026, 7, 17),
        investor_category="RESIDENT_INDIVIDUAL",
        holding_period="LONG",
    )
    new_short, _ = cgt_rate(
        session,
        trade_date=date(2026, 7, 17),
        investor_category="RESIDENT_INDIVIDUAL",
        holding_period="SHORT",
    )
    assert old_long == Decimal("0.05")
    assert old_short == Decimal("0.075")
    assert new_long == Decimal("0.075")
    assert new_short == Decimal("0.10")


def test_cgt_resident_entity_and_nonresident(session):
    ensure_default_fee_rules(session)
    entity, _ = cgt_rate(
        session,
        trade_date=date(2026, 4, 15),
        investor_category="RESIDENT_ENTITY",
        holding_period="ANY",
    )
    nonresident, _ = cgt_rate(
        session,
        trade_date=date(2026, 4, 15),
        investor_category="NON_RESIDENT",
        holding_period="ANY",
    )
    assert entity == Decimal("0.10")
    assert nonresident == Decimal("0.25")


def test_tiny_bill_charge_allocation_never_goes_negative():
    lines = [
        ChargeLine(line_no=index, symbol="TEST", gross=Decimal("33.33"))
        for index in range(6)
    ]
    allocated = _allocate(Decimal("0.03"), lines)
    assert all(value >= 0 for value in allocated)
    assert sum(allocated, Decimal("0.00")) == Decimal("0.03")


def test_rule_selection_is_by_trade_date(session):
    ensure_default_fee_rules(session)
    rules = session.query(FeeRule).filter(FeeRule.code.like("CGT_INDIVIDUAL%")).all()
    old = [r for r in rules if r.code == "CGT_INDIVIDUAL_LONG_2082"][0]
    new = [r for r in rules if r.code == "CGT_INDIVIDUAL_LONG_2083"][0]
    assert old.effective_from <= date(2026, 4, 15) <= (old.effective_to or date.max)
    assert new.effective_from <= date(2026, 7, 20)
