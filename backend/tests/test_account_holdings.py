from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.account.imports import commit_import
from app.account.ledger import build_holdings
from app.account.models import AccountVault, BankAccount, PriceOverride, Transaction
from app.account.schemas import CommitMessage, ImportCommitRequest
from app.models import DailySummary, Security


def setup_vault(session):
    vault = AccountVault(
        id=str(uuid.uuid4()),
        label="Holdings",
        key_hash=uuid.uuid4().hex * 2,
        investor_category="RESIDENT_INDIVIDUAL",
        settings_json={},
    )
    session.add(vault)
    session.flush()
    account = BankAccount(
        vault_id=vault.id,
        name="Primary",
        opening_balance=Decimal("1000000"),
        opening_balance_date=date(2025, 1, 1),
        is_default=True,
    )
    session.add(account)
    session.flush()
    for symbol, name in (("HIDCLP", "HIDCL"), ("NABIL", "Nabil Bank")):
        if session.get(Security, symbol) is None:
            session.add(Security(symbol=symbol, name=name, instrument_type="ordinary", status="listed"))
    session.commit()
    return vault, account


def import_text(session, vault, *messages: str):
    return commit_import(
        session,
        vault,
        ImportCommitRequest(
            source_type="PASTE",
            messages=[CommitMessage(raw_text=message, approved=True) for message in messages],
        ),
    )


def test_wacc_and_partial_sale(session):
    vault, _ = setup_vault(session)
    import_text(
        session,
        vault,
        "RK316455, you bought HIDCLP-100.0@100.00 on 2026-04-01 BAmt 100100.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.1.",
        "RK316455, you bought HIDCLP-100.0@200.00 on 2026-04-02 BAmt 200200.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.2.",
        "RK316455,You Sold HIDCLP 150.0@300.00 on 2026-04-15. Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.3",
    )
    txs = list(session.scalars(select(Transaction).order_by(Transaction.trade_date, Transaction.line_no)).all())
    sell = next(tx for tx in txs if tx.side == "SELL")
    assert sell.cost_basis is not None
    assert sell.cgt > 0
    assert sell.realized_pnl > 0
    assert sell.fee_snapshot_json["tax"]["status"] == "CALCULATED"
    assert sell.fee_snapshot_json["tax"]["rules"][0]["code"].endswith("2082")

    session.add(
        DailySummary(symbol="HIDCLP", trade_date=date(2026, 4, 20), close=400.0, source="test")
    )
    session.commit()
    holdings = build_holdings(session, vault, as_of=date(2026, 4, 20))
    row = holdings["rows"][0]
    assert row["symbol"] == "HIDCLP"
    assert Decimal(row["quantity"]) == Decimal("50")
    assert row["market_price"] == "400.00"
    assert row["market_value"] == "20000.00"
    assert Decimal(holdings["summary"]["realized_pnl"]) > 0
    assert holdings["method"] == "WACC"


def test_manual_price_override(session):
    vault, _ = setup_vault(session)
    import_text(
        session,
        vault,
        "RK316455, you bought HIDCLP-10.0@100.00 on 2026-04-01 BAmt 1100.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.1.",
    )
    session.add(
        PriceOverride(
            vault_id=vault.id,
            symbol="HIDCLP",
            price=Decimal("250"),
            as_of=date(2026, 4, 20),
            note="manual",
        )
    )
    session.commit()
    holdings = build_holdings(session, vault, as_of=date(2026, 4, 20))
    row = holdings["rows"][0]
    assert row["market_price_source"] == "MANUAL"
    assert row["market_price"] == "250.00"
    assert row["unrealized_pnl"] is not None


def test_oversold_is_explicit_not_silent(session):
    vault, _ = setup_vault(session)
    import_text(
        session,
        vault,
        "RK316455, you bought HIDCLP-10.0@100.00 on 2026-04-01 BAmt 1100.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.1.",
        "RK316455,You Sold HIDCLP 20.0@100.00 on 2026-04-15. Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.2",
    )
    sell = session.scalar(select(Transaction).where(Transaction.side == "SELL"))
    assert sell.reconciliation_status == "AWAITING_INFO"
    assert sell.cost_basis is not None
    holdings = build_holdings(session, vault, as_of=date(2026, 4, 20), include_closed=True)
    row = holdings["rows"][0]
    assert row["quantity"] == "0.0000"
    assert row["status"] == "COST_BASIS_INCOMPLETE"


def test_long_and_mixed_holding_period(session):
    vault, _ = setup_vault(session)
    import_text(
        session,
        vault,
        "RK316455, you bought NABIL-100.0@100.00 on 2025-01-01 BAmt 100100.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.1.",
        "RK316455, you bought NABIL-100.0@200.00 on 2026-01-01 BAmt 200200.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.2.",
        "RK316455,You Sold NABIL 200.0@300.00 on 2026-04-15. Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.3",
    )
    sell = session.scalar(select(Transaction).where(Transaction.side == "SELL"))
    tax = sell.fee_snapshot_json["tax"]
    assert tax["status"] == "ESTIMATED_MIXED_HOLDING"
    assert Decimal(tax["long_quantity"]) == Decimal("100")
    assert Decimal(tax["short_quantity"]) == Decimal("100")
    assert len(tax["rules"]) == 2


def test_closed_position_realized_pnl_in_summary(session):
    vault, _ = setup_vault(session)
    import_text(
        session,
        vault,
        "RK316455, you bought HIDCLP-10.0@100.00 on 2026-04-01 BAmt 1100.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.1.",
        "RK316455,You Sold HIDCLP 10.0@200.00 on 2026-04-15. Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.2",
    )
    holdings = build_holdings(session, vault, as_of=date(2026, 4, 20))
    assert holdings["rows"] == []
    assert Decimal(holdings["summary"]["realized_pnl"]) > 0
    closed = build_holdings(session, vault, as_of=date(2026, 4, 20), include_closed=True)
    assert closed["rows"][0]["status"] == "CLOSED"


def test_holdings_as_of_excludes_future_trades(session):
    vault, _ = setup_vault(session)
    import_text(
        session,
        vault,
        "RK316455, you bought HIDCLP-100.0@100.00 on 2026-04-01 BAmt 100100.00. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.1.",
        "RK316455,You Sold HIDCLP 100.0@200.00 on 2026-04-15. Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.2",
    )
    holdings = build_holdings(session, vault, as_of=date(2026, 4, 10))
    assert holdings["rows"][0]["quantity"] == "100.0000"
    assert Decimal(holdings["summary"]["realized_pnl"]) == Decimal("0.00")
