from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.account.models import (  # noqa: F401  (register metadata)
    AccountVault,
    BankAccount,
    SmsMessage,
    Transaction,
    TransactionBill,
)
from app.models import Security

BUY = (
    "RK316455, you bought HIDCLP-500.0@200.00 on 2026-04-15 BAmt 100350.00. "
    "Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.48."
)
SELL = (
    "RK316455,You Sold HIDCLP 200.0@250.00 on 2026-04-15. "
    "Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.49"
)
SAME_DAY_BUY = (
    "RK316455, you bought HIDCLP-100.0@201.00 on 2026-04-15 BAmt 20150.00. "
    "Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.50."
)
BAD = "This is not a broker SMS."


@pytest.fixture()
def client(session):
    from app.main import app

    with TestClient(app) as c:
        yield c


def create_vault(client: TestClient, **overrides):
    payload = {
        "label": "API test",
        "investor_category": "RESIDENT_INDIVIDUAL",
        "opening_balance": "500000",
        "opening_balance_date": "2026-04-01",
        "default_broker": "RK316455",
        "bank_account_name": "Primary",
    }
    payload.update(overrides)
    response = client.post("/api/account/vaults", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    return body["token"], body


def headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def commit(client: TestClient, token: str, *messages: str):
    response = client.post(
        "/api/account/imports/commit",
        headers=headers(token),
        json={
            "source_type": "PASTE",
            "messages": [{"raw_text": message, "approved": True} for message in messages],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def add_security(session, symbol="HIDCLP", name="HIDCL"):
    if session.get(Security, symbol) is None:
        session.add(Security(symbol=symbol, name=name, instrument_type="ordinary", status="listed"))
        session.commit()


def test_vault_auth_and_no_store(session, client):
    add_security(session)
    token, body = create_vault(client)
    assert token
    assert body["vault"]["cost_basis_method"] == "WACC"
    assert "key_hash" not in body["vault"]
    assert body["notice"].startswith("Save this recovery key")
    me = client.get("/api/account/me", headers=headers(token))
    assert me.status_code == 200
    assert me.headers["cache-control"] == "private, no-store"
    assert me.json()["vault"]["label"] == "API test"
    unauth = client.get("/api/account/me")
    assert unauth.status_code == 401
    assert unauth.headers["cache-control"] == "private, no-store"
    wrong = client.get("/api/account/me", headers=headers("not-a-key"))
    assert wrong.status_code == 401


def test_import_list_detail_duplicate_and_csv(session, client):
    add_security(session)
    token, _ = create_vault(client)
    first = commit(client, token, BUY, SELL)
    assert first["summary"]["imported"] == 2
    assert first["summary"]["buy_bills"] == 1
    assert first["summary"]["sell_bills"] == 1
    assert first["summary"]["line_items"] == 2
    tx_list = client.get("/api/account/transactions", headers=headers(token))
    assert tx_list.status_code == 200
    rows = tx_list.json()["rows"]
    assert len(rows) == 2
    assert "raw_text" not in rows[0]
    assert tx_list.json()["summary"]["count"] == 2
    detail = client.get(f"/api/account/transactions/{rows[0]['id']}", headers=headers(token))
    assert detail.status_code == 200
    assert detail.json()["transaction"]["raw_text"]
    assert detail.json()["message"]["raw_text"]
    duplicate = commit(client, token, BUY, SELL)
    assert duplicate["summary"]["duplicates"] == 2
    assert duplicate["summary"]["imported"] == 0
    after = client.get("/api/account/transactions", headers=headers(token)).json()
    assert after["total"] == 2
    csv_response = client.get("/api/account/transactions/export.csv", headers=headers(token))
    assert csv_response.status_code == 200
    assert "text/csv" in csv_response.headers["content-type"]
    assert "attachment;" in csv_response.headers["content-disposition"]
    text = csv_response.text
    assert text.startswith("trade_date,side,symbol")
    assert "HIDCLP" in text
    assert "RK316455, you bought" not in text


def test_same_day_same_security_different_bill_is_not_a_duplicate(session, client):
    add_security(session)
    token, _ = create_vault(client)
    first = commit(client, token, BUY)
    assert first["summary"]["imported"] == 1
    same_day = commit(client, token, SAME_DAY_BUY)
    assert same_day["summary"]["imported"] == 1
    assert same_day["summary"]["duplicates"] == 0
    assert same_day["summary"]["buy_bills"] == 1
    rows = client.get("/api/account/transactions", headers=headers(token)).json()["rows"]
    assert len(rows) == 2
    assert {row["bill_no"] for row in rows} == {"48", "50"}
    assert all(row["trade_date"] == "2026-04-15" for row in rows)
    assert all(row["symbol"] == "HIDCLP" for row in rows)


def test_invalid_message_needs_review_and_unapproved_is_rejected(session, client):
    token, _ = create_vault(client)
    review = commit(client, token, BAD)
    assert review["summary"]["needs_review"] == 1
    messages = client.get("/api/account/messages", headers=headers(token)).json()["messages"]
    assert messages[0]["status"] == "NEEDS_REVIEW"
    rejected = client.post(
        "/api/account/imports/commit",
        headers=headers(token),
        json={"source_type": "PASTE", "messages": [{"raw_text": BUY, "approved": False}]},
    )
    assert rejected.status_code == 200
    assert rejected.json()["summary"]["rejected"] == 1


def test_correction_settlement_and_reversal(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY)
    tx = client.get("/api/account/transactions", headers=headers(token)).json()["rows"][0]
    updated = client.patch(
        f"/api/account/transactions/{tx['id']}",
        headers=headers(token),
        json={"quantity": "400", "reason": "Broker corrected quantity"},
    )
    assert updated.status_code == 200, updated.text
    tx_after = updated.json()["transaction"]
    assert tx_after["quantity"] == "400.0000"
    assert tx_after["gross_amount"] == "80000.00"
    assert updated.json()["audit"]
    bill_id = tx["bill_id"]
    settlement = client.post(
        f"/api/account/bills/{bill_id}/settlements",
        headers=headers(token),
        json={
            "direction": "PAYMENT",
            "amount": "1000",
            "settlement_date": "2026-04-16",
            "reference": "partial",
        },
    )
    assert settlement.status_code == 200, settlement.text
    assert settlement.json()["bill"]["payment_status"] == "PARTIAL"
    settlement_id = settlement.json()["settlement"]["id"]
    reverse_before = client.post(
        f"/api/account/transactions/{tx['id']}/reverse",
        headers=headers(token),
        json={"reason": "duplicate"},
    )
    assert reverse_before.status_code == 409
    reversed_settlement = client.post(
        f"/api/account/settlements/{settlement_id}/reverse",
        headers=headers(token),
        json={"reason": "wrong amount"},
    )
    assert reversed_settlement.status_code == 200
    reversed_tx = client.post(
        f"/api/account/transactions/{tx['id']}/reverse",
        headers=headers(token),
        json={"reason": "duplicate"},
    )
    assert reversed_tx.status_code == 200
    assert reversed_tx.json()["transaction"]["status"] == "REVERSED"


def test_authorization_isolation(session, client):
    add_security(session)
    token1, _ = create_vault(client, label="One")
    commit(client, token1, BUY)
    tx = client.get("/api/account/transactions", headers=headers(token1)).json()["rows"][0]
    token2, _ = create_vault(client, label="Two")
    assert client.get("/api/account/transactions", headers=headers(token2)).json()["rows"] == []
    assert client.get(f"/api/account/transactions/{tx['id']}", headers=headers(token2)).status_code == 404
    assert client.get(f"/api/account/bills/{tx['bill_id']}", headers=headers(token2)).status_code == 404


def test_cashflow_settings_and_rotate_key(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY)
    cash = client.get(
        "/api/account/cashflow",
        headers=headers(token),
        params={"as_of": "2026-04-15", "start": "2026-04-15", "end": "2026-04-20"},
    )
    assert cash.status_code == 200
    assert cash.json()["metrics"]["committed_payments"] == "100350.00"
    deposit = client.post(
        "/api/account/cash-movements",
        headers=headers(token),
        json={
            "bank_account_id": 1,
            "movement_date": "2026-04-15",
            "kind": "DEPOSIT",
            "amount": "5000",
            "note": "top up",
        },
    )
    assert deposit.status_code == 200
    movement_id = deposit.json()["movements"][0]["id"]
    reversed_movement = client.post(
        f"/api/account/cash-movements/{movement_id}/reverse",
        headers=headers(token),
        json={"reason": "synthetic test correction"},
    )
    assert reversed_movement.status_code == 200
    assert reversed_movement.json()["movement"]["reversal_reason"] == "synthetic test correction"
    visible = client.get("/api/account/cash-movements", headers=headers(token))
    assert all(row["id"] != movement_id for row in visible.json()["movements"])
    audited = client.get(
        "/api/account/cash-movements",
        headers=headers(token),
        params={"include_reversed": True},
    )
    audited_row = next(row for row in audited.json()["movements"] if row["id"] == movement_id)
    assert audited_row["reversed_at"]
    assert audited_row["reversal_reason"] == "synthetic test correction"
    settings = client.patch(
        "/api/account/settings",
        headers=headers(token),
        json={"holiday_dates": ["2026-04-16"], "buy_payment_business_days": 1},
    )
    assert settings.status_code == 200
    assert settings.json()["vault"]["settings"]["holiday_dates"] == ["2026-04-16"]
    rotated = client.post("/api/account/rotate-key", headers=headers(token))
    assert rotated.status_code == 200
    new_token = rotated.json()["token"]
    assert client.get("/api/account/me", headers=headers(token)).status_code == 401
    assert client.get("/api/account/me", headers=headers(new_token)).status_code == 200


def test_bill_reconciliation_filter_and_options(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY, SELL)
    response = client.get(
        "/api/account/transactions",
        headers=headers(token),
        params={"reconciliation": "DIFFERENCE"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["rows"][0]["symbol"] == "HIDCLP"
    assert body["rows"][0]["bill_reconciliation_status"] == "DIFFERENCE"
    assert "DIFFERENCE" in body["filter_options"]["reconciliations"]


def test_transfer_reversal_reverses_both_legs(session, client):
    token, _ = create_vault(client)
    me = client.get("/api/account/me", headers=headers(token)).json()
    source = me["bank_accounts"][0]["id"]
    second = client.post(
        "/api/account/bank-accounts",
        headers=headers(token),
        json={
            "name": "Reserve",
            "opening_balance": "0",
            "opening_balance_date": "2026-04-01",
            "is_default": False,
        },
    )
    assert second.status_code == 200, second.text
    target = second.json()["account"]["id"]
    transfer = client.post(
        "/api/account/cash-movements",
        headers=headers(token),
        json={
            "bank_account_id": source,
            "counter_account_id": target,
            "movement_date": "2026-04-15",
            "kind": "TRANSFER_OUT",
            "amount": "1000",
            "note": "synthetic reserve move",
        },
    )
    assert transfer.status_code == 200, transfer.text
    legs = transfer.json()["movements"]
    assert len(legs) == 2
    assert legs[0]["transfer_group"] == legs[1]["transfer_group"]
    assert {leg["kind"] for leg in legs} == {"TRANSFER_OUT", "TRANSFER_IN"}

    reversed_pair = client.post(
        f"/api/account/cash-movements/{legs[0]['id']}/reverse",
        headers=headers(token),
        json={"reason": "synthetic transfer correction"},
    )
    assert reversed_pair.status_code == 200, reversed_pair.text
    assert len(reversed_pair.json()["movements"]) == 2
    assert all(row["reversed_at"] for row in reversed_pair.json()["movements"])

    visible = client.get(
        "/api/account/cash-movements", headers=headers(token)
    ).json()["movements"]
    assert visible == []
    audited = client.get(
        "/api/account/cash-movements",
        headers=headers(token),
        params={"include_reversed": True},
    ).json()["movements"]
    assert {row["id"] for row in audited} == {legs[0]["id"], legs[1]["id"]}
    assert all(row["reversal_reason"] == "synthetic transfer correction" for row in audited)

    cash = client.get(
        "/api/account/cashflow",
        headers=headers(token),
        params={"as_of": "2026-04-15", "start": "2026-04-15", "end": "2026-04-16"},
    ).json()
    assert cash["metrics"]["actual_bank_balance"] == "500000.00"


def test_transfer_in_counterpart_note_points_to_selected_account(session, client):
    token, _ = create_vault(client)
    me = client.get("/api/account/me", headers=headers(token)).json()
    selected = me["bank_accounts"][0]
    second = client.post(
        "/api/account/bank-accounts",
        headers=headers(token),
        json={
            "name": "Reserve",
            "opening_balance": "1000",
            "opening_balance_date": "2026-04-01",
            "is_default": False,
        },
    ).json()["account"]
    transfer = client.post(
        "/api/account/cash-movements",
        headers=headers(token),
        json={
            "bank_account_id": selected["id"],
            "counter_account_id": second["id"],
            "movement_date": "2026-04-15",
            "kind": "TRANSFER_IN",
            "amount": "100",
        },
    )
    assert transfer.status_code == 200, transfer.text
    legs = transfer.json()["movements"]
    outgoing = next(leg for leg in legs if leg["kind"] == "TRANSFER_OUT")
    assert outgoing["note"] == f"Transfer to {selected['name']}"


def test_overview_holdings_and_fee_rules(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY)
    overview = client.get("/api/account/overview", headers=headers(token), params={"as_of": "2026-04-20"})
    assert overview.status_code == 200
    body = overview.json()
    assert body["has_data"] is True
    assert body["metrics"]["transaction_count"] == 1
    assert "cashflow" in body
    assert body["recent_transactions"][0]["symbol"] == "HIDCLP"
    holdings = client.get("/api/account/holdings", headers=headers(token), params={"as_of": "2026-04-20"})
    assert holdings.status_code == 200
    assert holdings.json()["rows"][0]["quantity"] == "500.0000"
    price = client.post(
        "/api/account/holdings/HIDCLP/price",
        headers=headers(token),
        json={"price": "250", "as_of": "2026-04-20", "note": "manual"},
    )
    assert price.status_code == 200
    priced = client.get("/api/account/holdings", headers=headers(token), params={"as_of": "2026-04-20"})
    assert priced.json()["rows"][0]["market_price"] == "250.00"
    assert priced.json()["rows"][0]["market_price_source"] == "MANUAL"
    deleted = client.delete("/api/account/holdings/HIDCLP/price", headers=headers(token))
    assert deleted.status_code == 200
    rules = client.get("/api/account/fee-rules", headers=headers(token))
    assert rules.status_code == 200
    assert rules.json()["rules"]
    assert any(rule["code"] == "BROKER_COMMISSION_EQUITY" for rule in rules.json()["rules"])
    audit = client.get("/api/account/audit", headers=headers(token))
    assert audit.status_code == 200
    assert audit.json()["events"]


def test_csv_injection_is_neutralised(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY)
    tx = client.get("/api/account/transactions", headers=headers(token)).json()["rows"][0]
    client.patch(
        f"/api/account/transactions/{tx['id']}",
        headers=headers(token),
        json={"notes": "=HYPERLINK(\"https://evil\")", "reason": "test"},
    )
    csv_response = client.get("/api/account/transactions/export.csv", headers=headers(token))
    assert "'=HYPERLINK" in csv_response.text
    client.patch(
        f"/api/account/transactions/{tx['id']}",
        headers=headers(token),
        json={"notes": " =HYPERLINK(\"https://evil\")", "reason": "leading whitespace test"},
    )
    csv_response = client.get("/api/account/transactions/export.csv", headers=headers(token))
    assert "' =HYPERLINK" in csv_response.text


def test_side_change_with_active_settlement_is_rejected(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY)
    tx = client.get("/api/account/transactions", headers=headers(token)).json()["rows"][0]
    settlement = client.post(
        f"/api/account/bills/{tx['bill_id']}/settlements",
        headers=headers(token),
        json={
            "direction": "PAYMENT",
            "amount": "1000",
            "settlement_date": "2026-04-16",
            "reference": "partial",
        },
    )
    assert settlement.status_code == 200, settlement.text
    response = client.patch(
        f"/api/account/transactions/{tx['id']}",
        headers=headers(token),
        json={"side": "SELL", "reason": "wrong side"},
    )
    assert response.status_code == 409
    assert "Reverse the recorded payment" in response.json()["detail"]


def test_reversed_transaction_is_read_only(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY)
    tx = client.get("/api/account/transactions", headers=headers(token)).json()["rows"][0]
    reversed_tx = client.post(
        f"/api/account/transactions/{tx['id']}/reverse",
        headers=headers(token),
        json={"reason": "synthetic reversal"},
    )
    assert reversed_tx.status_code == 200
    response = client.patch(
        f"/api/account/transactions/{tx['id']}",
        headers=headers(token),
        json={"quantity": "1", "reason": "should not change"},
    )
    assert response.status_code == 409
    assert "read-only" in response.json()["detail"]


def test_reversed_bill_cannot_accept_new_settlement(session, client):
    add_security(session)
    token, _ = create_vault(client)
    commit(client, token, BUY)
    tx = client.get("/api/account/transactions", headers=headers(token)).json()["rows"][0]
    client.post(
        f"/api/account/transactions/{tx['id']}/reverse",
        headers=headers(token),
        json={"reason": "synthetic reversal"},
    )
    response = client.post(
        f"/api/account/bills/{tx['bill_id']}/settlements",
        headers=headers(token),
        json={
            "direction": "PAYMENT",
            "amount": "1000",
            "settlement_date": "2026-04-16",
        },
    )
    assert response.status_code == 409
    assert "reversed bill" in response.json()["detail"]


def test_cash_movement_before_opening_date_is_rejected(session, client):
    token, _ = create_vault(client)
    account_id = client.get("/api/account/me", headers=headers(token)).json()["bank_accounts"][0]["id"]
    response = client.post(
        "/api/account/cash-movements",
        headers=headers(token),
        json={
            "bank_account_id": account_id,
            "movement_date": "2026-03-31",
            "kind": "DEPOSIT",
            "amount": "1000",
        },
    )
    assert response.status_code == 400
    assert "opening balance date" in response.json()["detail"]
