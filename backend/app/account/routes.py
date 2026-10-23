from __future__ import annotations

import csv
import io
import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Security
from .auth import hash_vault_key, new_vault_key, require_vault
from .calendar import nepal_today
from .cashflow import build_cashflow
from .fees import ZERO, calculate_bill_charges, ensure_default_fee_rules, money
from .imports import commit_import, preview_import
from .ledger import build_holdings, recompute_vault_ledger
from .models import (
    AccountVault,
    AuditEvent,
    BankAccount,
    CashMovement,
    FeeRule,
    PriceOverride,
    Settlement,
    SmsImport,
    SmsMessage,
    Transaction,
    TransactionBill,
    utcnow,
)
from .schemas import (
    BankAccountCreate,
    BankAccountUpdate,
    BillUpdate,
    CashMovementCreate,
    ImportCommitRequest,
    PreviewRequest,
    PriceOverrideCreate,
    ReasonRequest,
    SettlementCreate,
    TransactionUpdate,
    VaultCreate,
    VaultSettingsUpdate,
)
from .serializers import (
    audit_payload,
    bank_account_payload,
    bill_payload,
    cash_movement_payload,
    fee_rule_payload,
    message_payload,
    money_str,
    settlement_payload,
    transaction_payload,
    vault_payload,
)

router = APIRouter(prefix="/api/account", tags=["account"])


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------


def _audit(
    session: Session,
    vault: AccountVault,
    entity_type: str,
    entity_id: int | str | None,
    action: str,
    *,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    session.add(
        AuditEvent(
            vault_id=vault.id,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            action=action,
            before_json=jsonable_encoder(before) if before is not None else None,
            after_json=jsonable_encoder(after) if after is not None else None,
            note=note,
        )
    )


def _owned_bill(session: Session, vault: AccountVault, bill_id: int) -> TransactionBill:
    bill = session.scalar(
        select(TransactionBill).where(
            TransactionBill.id == bill_id, TransactionBill.vault_id == vault.id
        )
    )
    if bill is None:
        raise HTTPException(404, "Bill not found in this vault.")
    return bill


def _owned_transaction(session: Session, vault: AccountVault, tx_id: int) -> Transaction:
    tx = session.scalar(
        select(Transaction).where(
            Transaction.id == tx_id, Transaction.vault_id == vault.id
        )
    )
    if tx is None:
        raise HTTPException(404, "Transaction not found in this vault.")
    return tx


def _owned_account(session: Session, vault: AccountVault, account_id: int) -> BankAccount:
    account = session.scalar(
        select(BankAccount).where(
            BankAccount.id == account_id, BankAccount.vault_id == vault.id
        )
    )
    if account is None:
        raise HTTPException(404, "Bank account not found in this vault.")
    return account


def _ensure_on_or_after_opening(
    account: BankAccount, when: date, *, label: str = "Movement"
) -> None:
    """Reject dated cash events that the schedule would silently skip."""
    if when < account.opening_balance_date:
        raise HTTPException(
            400,
            f"{label} date cannot be before {account.name}'s opening balance date "
            f"({account.opening_balance_date.isoformat()}).",
        )


def _owned_settlement(session: Session, vault: AccountVault, settlement_id: int) -> Settlement:
    settlement = session.scalar(
        select(Settlement).where(
            Settlement.id == settlement_id, Settlement.vault_id == vault.id
        )
    )
    if settlement is None:
        raise HTTPException(404, "Settlement not found in this vault.")
    return settlement


def _bill_settlements(session: Session, bill_id: int) -> list[Settlement]:
    return list(
        session.scalars(
            select(Settlement)
            .where(Settlement.bill_id == bill_id)
            .order_by(Settlement.settlement_date, Settlement.id)
        ).all()
    )


def _bill_sums(session: Session, bill_id: int) -> tuple[Decimal, Decimal]:
    rows = session.execute(
        select(Settlement.direction, func.sum(Settlement.amount))
        .where(Settlement.bill_id == bill_id, Settlement.reversed_at.is_(None))
        .group_by(Settlement.direction)
    ).all()
    paid = ZERO
    received = ZERO
    for direction, total in rows:
        if direction == "PAYMENT":
            paid = money(total or 0)
        elif direction == "RECEIPT":
            received = money(total or 0)
    return paid, received


def _bill_map_for_transactions(
    session: Session, txs: list[Transaction]
) -> tuple[dict[int, TransactionBill], dict[int, SmsMessage], dict[int, tuple[Decimal, Decimal]]]:
    bill_ids = {tx.bill_id for tx in txs}
    bills = {
        bill.id: bill
        for bill in session.scalars(
            select(TransactionBill).where(TransactionBill.id.in_(bill_ids))
        ).all()
    } if bill_ids else {}
    message_ids = {tx.source_message_id for tx in txs}
    messages = {
        message.id: message
        for message in session.scalars(
            select(SmsMessage).where(SmsMessage.id.in_(message_ids))
        ).all()
    } if message_ids else {}
    sums: dict[int, tuple[Decimal, Decimal]] = {}
    for bill_id in bill_ids:
        sums[bill_id] = _bill_sums(session, bill_id)
    return bills, messages, sums


def _rows_payload(session: Session, txs: list[Transaction]) -> list[dict[str, Any]]:
    bills, messages, sums = _bill_map_for_transactions(session, txs)
    rows = []
    for tx in txs:
        bill = bills.get(tx.bill_id)
        message = messages.get(tx.source_message_id)
        paid, received = sums.get(tx.bill_id, (ZERO, ZERO))
        rows.append(
            transaction_payload(
                tx,
                bill,
                paid=paid,
                received=received,
                message=message,
                include_raw=False,
            )
        )
    return rows


def _transaction_detail(session: Session, vault: AccountVault, tx: Transaction) -> dict[str, Any]:
    bill = _owned_bill(session, vault, tx.bill_id)
    message = session.get(SmsMessage, tx.source_message_id)
    paid, received = _bill_sums(session, bill.id)
    settlements = _bill_settlements(session, bill.id)
    bill_txs = list(
        session.scalars(
            select(Transaction)
            .where(Transaction.bill_id == bill.id)
            .order_by(Transaction.line_no)
        ).all()
    )
    audit = session.scalars(
        select(AuditEvent)
        .where(
            AuditEvent.vault_id == vault.id,
            or_(
                (AuditEvent.entity_type == "transaction") & (AuditEvent.entity_id == str(tx.id)),
                (AuditEvent.entity_type == "bill") & (AuditEvent.entity_id == str(bill.id)),
                (AuditEvent.entity_type == "settlement") & (AuditEvent.entity_id.in_(
                    [str(s.id) for s in settlements] or ["-1"]
                )),
            ),
        )
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(80)
    ).all()
    return {
        "transaction": transaction_payload(
            tx,
            bill,
            paid=paid,
            received=received,
            message=message,
            include_raw=True,
        ),
        "bill": bill_payload(bill, paid=paid, received=received, transactions=bill_txs),
        "message": message_payload(message, include_raw=True) if message else None,
        "settlements": [settlement_payload(s) for s in settlements],
        "audit": [audit_payload(event) for event in audit],
    }


def _tx_conditions(
    vault: AccountVault,
    *,
    from_date: date | None,
    to_date: date | None,
    side: str | None,
    symbol: str | None,
    status: str | None,
    reconciliation: str | None,
    q: str | None,
) -> list[Any]:
    conditions: list[Any] = [Transaction.vault_id == vault.id]
    if not status:
        conditions.append(Transaction.status != "REVERSED")
    if from_date:
        conditions.append(Transaction.trade_date >= from_date)
    if to_date:
        conditions.append(Transaction.trade_date <= to_date)
    if side:
        conditions.append(Transaction.side == side.upper())
    if symbol:
        conditions.append(Transaction.symbol == symbol.upper())
    if status:
        conditions.append(Transaction.status == status.upper())
    if reconciliation:
        wanted = reconciliation.upper()
        conditions.append(
            or_(
                Transaction.reconciliation_status == wanted,
                TransactionBill.reconciliation_status == wanted,
            )
        )
    if q:
        needle = f"%{q.strip()}%"
        conditions.append(
            or_(
                Transaction.symbol.ilike(needle),
                Transaction.security_name.ilike(needle),
                TransactionBill.bill_no.ilike(needle),
                TransactionBill.broker_id.ilike(needle),
            )
        )
    return conditions


def _filtered_transactions(
    session: Session,
    vault: AccountVault,
    *,
    from_date: date | None = None,
    to_date: date | None = None,
    side: str | None = None,
    symbol: str | None = None,
    status: str | None = None,
    reconciliation: str | None = None,
    q: str | None = None,
    sort: str = "trade_date",
    order: str = "desc",
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[Transaction], int]:
    conditions = _tx_conditions(
        vault,
        from_date=from_date,
        to_date=to_date,
        side=side,
        symbol=symbol,
        status=status,
        reconciliation=reconciliation,
        q=q,
    )
    base = select(Transaction).join(TransactionBill, Transaction.bill_id == TransactionBill.id).where(*conditions)
    all_rows = list(session.scalars(base).all())
    total = len(all_rows)
    sort_map = {
        "trade_date": Transaction.trade_date,
        "symbol": Transaction.symbol,
        "net_amount": Transaction.net_amount,
        "charges": Transaction.total_charges,
        "cgt": Transaction.cgt,
        "created_at": Transaction.created_at,
    }
    sort_col = sort_map.get(sort, Transaction.trade_date)
    direction = sort_col.desc() if order.lower() != "asc" else sort_col.asc()
    paged = list(
        session.scalars(
            base.order_by(direction, Transaction.id.desc())
            .offset(max(0, (page - 1) * page_size))
            .limit(page_size)
        ).all()
    )
    return paged, total


def _filter_options(session: Session, vault: AccountVault) -> dict[str, Any]:
    symbols = list(
        session.scalars(
            select(Transaction.symbol)
            .where(Transaction.vault_id == vault.id, Transaction.status != "REVERSED")
            .distinct()
            .order_by(Transaction.symbol)
        ).all()
    )
    statuses = list(
        session.scalars(
            select(Transaction.status).where(Transaction.vault_id == vault.id).distinct()
        ).all()
    )
    reconciliations = list(
        session.scalars(
            select(Transaction.reconciliation_status)
            .where(Transaction.vault_id == vault.id)
            .distinct()
        ).all()
    )
    bill_reconciliations = list(
        session.scalars(
            select(TransactionBill.reconciliation_status)
            .where(TransactionBill.vault_id == vault.id)
            .distinct()
        ).all()
    )
    return {
        "symbols": symbols,
        "statuses": sorted({s for s in statuses if s}),
        "reconciliations": sorted(
            {s for s in reconciliations + bill_reconciliations if s}
        ),
        "sides": ["BUY", "SELL"],
    }


# ---------------------------------------------------------------------------
# vault and settings
# ---------------------------------------------------------------------------


@router.post("/vaults")
def create_vault(payload: VaultCreate, session: Session = Depends(get_session)):
    ensure_default_fee_rules(session)
    token = new_vault_key()
    vault = AccountVault(
        id=str(uuid.uuid4()),
        label=payload.label,
        key_hash=hash_vault_key(token),
        investor_category=payload.investor_category,
        cost_basis_method="WACC",
        default_broker=payload.default_broker,
        settings_json={
            "holiday_dates": [],
            "buy_payment_business_days": 1,
            "edis_business_days": 1,
            "sell_settlement_business_days": 2,
        },
    )
    session.add(vault)
    session.flush()
    account = BankAccount(
        vault_id=vault.id,
        name=payload.bank_account_name,
        opening_balance=money(payload.opening_balance),
        opening_balance_date=payload.opening_balance_date,
        is_default=True,
        active=True,
    )
    session.add(account)
    _audit(
        session,
        vault,
        "vault",
        vault.id,
        "VAULT_CREATED",
        after={"label": vault.label, "investor_category": vault.investor_category},
        note="Create the encrypted-hash-only private ledger. The bearer key is never stored.",
    )
    session.commit()
    return {
        "token": token,
        "vault": vault_payload(vault),
        "bank_accounts": [bank_account_payload(account)],
        "notice": "Save this recovery key. It is the only credential for this vault and cannot be recovered.",
    }


@router.get("/me")
def me(vault: AccountVault = Depends(require_vault), session: Session = Depends(get_session)):
    accounts = session.scalars(
        select(BankAccount)
        .where(BankAccount.vault_id == vault.id)
        .order_by(BankAccount.is_default.desc(), BankAccount.id)
    ).all()
    tx_count = session.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.vault_id == vault.id, Transaction.status != "REVERSED"
        )
    ) or 0
    message_count = session.scalar(
        select(func.count(SmsMessage.id)).where(SmsMessage.vault_id == vault.id)
    ) or 0
    return {
        "vault": vault_payload(vault),
        "bank_accounts": [bank_account_payload(a) for a in accounts],
        "counts": {"transactions": tx_count, "messages": message_count},
        "has_data": bool(tx_count or message_count),
    }


@router.patch("/settings")
def update_settings(
    payload: VaultSettingsUpdate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    before = vault_payload(vault)
    changed = payload.model_dump(exclude_unset=True)
    old_category = vault.investor_category
    if "label" in changed and changed["label"] is not None:
        vault.label = changed["label"].strip()
    if "investor_category" in changed and changed["investor_category"] is not None:
        vault.investor_category = changed["investor_category"]
    if "default_broker" in changed:
        vault.default_broker = changed["default_broker"]
    settings = dict(vault.settings_json or {})
    for key in ("holiday_dates", "buy_payment_business_days", "edis_business_days", "sell_settlement_business_days"):
        if key in changed and changed[key] is not None:
            settings[key] = changed[key]
    vault.settings_json = settings
    if vault.investor_category != old_category:
        recompute_vault_ledger(session, vault)
    _audit(
        session,
        vault,
        "vault",
        vault.id,
        "SETTINGS_UPDATED",
        before=before,
        after=vault_payload(vault),
        note="Settings saved. Investor-category changes recompute CGT; charge rules stay tied to each trade date; new deadlines use the updated calendar.",
    )
    session.commit()
    return {"vault": vault_payload(vault), "notice": "Settings saved."}


@router.post("/rotate-key")
def rotate_key(
    vault: AccountVault = Depends(require_vault), session: Session = Depends(get_session)
):
    token = new_vault_key()
    vault.key_hash = hash_vault_key(token)
    _audit(
        session,
        vault,
        "vault",
        vault.id,
        "KEY_ROTATED",
        note="The previous bearer key was invalidated. The new key is returned once.",
    )
    session.commit()
    return {
        "token": token,
        "notice": "The old key is now invalid. Store this new recovery key immediately.",
    }


# ---------------------------------------------------------------------------
# bank accounts and cash movements
# ---------------------------------------------------------------------------


@router.get("/bank-accounts")
def list_bank_accounts(
    vault: AccountVault = Depends(require_vault), session: Session = Depends(get_session)
):
    accounts = session.scalars(
        select(BankAccount)
        .where(BankAccount.vault_id == vault.id)
        .order_by(BankAccount.is_default.desc(), BankAccount.id)
    ).all()
    return {"accounts": [bank_account_payload(a) for a in accounts]}


@router.post("/bank-accounts")
def create_bank_account(
    payload: BankAccountCreate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    existing = session.scalar(
        select(BankAccount).where(
            BankAccount.vault_id == vault.id, BankAccount.name == payload.name.strip()
        )
    )
    if existing is not None:
        raise HTTPException(409, "A bank account with that name already exists.")
    count = session.scalar(
        select(func.count(BankAccount.id)).where(BankAccount.vault_id == vault.id)
    ) or 0
    make_default = payload.is_default or count == 0
    if make_default:
        for account in session.scalars(
            select(BankAccount).where(BankAccount.vault_id == vault.id)
        ).all():
            account.is_default = False
    account = BankAccount(
        vault_id=vault.id,
        name=payload.name.strip(),
        opening_balance=money(payload.opening_balance),
        opening_balance_date=payload.opening_balance_date,
        is_default=make_default,
        active=True,
    )
    session.add(account)
    session.flush()
    _audit(
        session,
        vault,
        "bank_account",
        account.id,
        "BANK_ACCOUNT_CREATED",
        after=bank_account_payload(account),
    )
    session.commit()
    return {"account": bank_account_payload(account)}


@router.patch("/bank-accounts/{account_id}")
def update_bank_account(
    account_id: int,
    payload: BankAccountUpdate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    account = _owned_account(session, vault, account_id)
    before = bank_account_payload(account)
    changed = payload.model_dump(exclude_unset=True)
    if "name" in changed and changed["name"] is not None:
        name = changed["name"].strip()
        duplicate = session.scalar(
            select(BankAccount).where(
                BankAccount.vault_id == vault.id,
                BankAccount.name == name,
                BankAccount.id != account.id,
            )
        )
        if duplicate is not None:
            raise HTTPException(409, "A bank account with that name already exists.")
        account.name = name
    if "opening_balance" in changed and changed["opening_balance"] is not None:
        account.opening_balance = money(changed["opening_balance"])
    if "opening_balance_date" in changed and changed["opening_balance_date"] is not None:
        new_opening_date = changed["opening_balance_date"]
        earliest_movement = session.scalar(
            select(func.min(CashMovement.movement_date)).where(
                CashMovement.bank_account_id == account.id,
                CashMovement.reversed_at.is_(None),
            )
        )
        earliest_settlement = session.scalar(
            select(func.min(Settlement.settlement_date)).where(
                Settlement.bank_account_id == account.id,
                Settlement.reversed_at.is_(None),
            )
        )
        dated_events = [
            value for value in (earliest_movement, earliest_settlement) if value is not None
        ]
        if dated_events and new_opening_date > min(dated_events):
            raise HTTPException(
                400,
                "The opening balance date cannot be later than an existing movement "
                "or settlement for this bank account.",
            )
        account.opening_balance_date = new_opening_date
    if "active" in changed and changed["active"] is not None:
        account.active = bool(changed["active"])
    if changed.get("is_default") is True:
        for other in session.scalars(
            select(BankAccount).where(BankAccount.vault_id == vault.id)
        ).all():
            other.is_default = False
        account.is_default = True
        account.active = True
    elif changed.get("is_default") is False:
        account.is_default = False
    if not account.active and account.is_default:
        replacement = session.scalar(
            select(BankAccount)
            .where(
                BankAccount.vault_id == vault.id,
                BankAccount.id != account.id,
                BankAccount.active.is_(True),
            )
            .order_by(BankAccount.id)
            .limit(1)
        )
        account.is_default = False
        if replacement is not None:
            replacement.is_default = True
    _audit(
        session,
        vault,
        "bank_account",
        account.id,
        "BANK_ACCOUNT_UPDATED",
        before=before,
        after=bank_account_payload(account),
    )
    session.commit()
    return {"account": bank_account_payload(account)}


@router.get("/cash-movements")
def list_cash_movements(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    bank_account_id: int | None = None,
    include_reversed: bool = False,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    conditions = [CashMovement.vault_id == vault.id]
    if not include_reversed:
        conditions.append(CashMovement.reversed_at.is_(None))
    if from_date:
        conditions.append(CashMovement.movement_date >= from_date)
    if to_date:
        conditions.append(CashMovement.movement_date <= to_date)
    if bank_account_id:
        _owned_account(session, vault, bank_account_id)
        conditions.append(CashMovement.bank_account_id == bank_account_id)
    rows = session.scalars(
        select(CashMovement)
        .where(*conditions)
        .order_by(CashMovement.movement_date.desc(), CashMovement.id.desc())
    ).all()
    return {"movements": [cash_movement_payload(m) for m in rows]}


@router.post("/cash-movements")
def create_cash_movement(
    payload: CashMovementCreate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    account = _owned_account(session, vault, payload.bank_account_id)
    _ensure_on_or_after_opening(account, payload.movement_date)
    counterpart: BankAccount | None = None
    if payload.counter_account_id:
        counterpart = _owned_account(session, vault, payload.counter_account_id)
        if counterpart.id == account.id:
            raise HTTPException(400, "Transfer accounts must be different.")
        _ensure_on_or_after_opening(counterpart, payload.movement_date)
    if payload.kind in {"TRANSFER_IN", "TRANSFER_OUT"} and counterpart is None:
        raise HTTPException(400, "A transfer requires a counterpart account.")

    created: list[CashMovement] = []
    if payload.kind in {"TRANSFER_IN", "TRANSFER_OUT"}:
        if payload.kind == "TRANSFER_OUT":
            primary_amount = payload.amount
            counterpart_amount = payload.amount
            primary_kind, counterpart_kind = "TRANSFER_OUT", "TRANSFER_IN"
        else:
            primary_amount = payload.amount
            counterpart_amount = payload.amount
            primary_kind, counterpart_kind = "TRANSFER_IN", "TRANSFER_OUT"
        transfer_group = uuid.uuid4().hex
        primary = CashMovement(
            vault_id=vault.id,
            bank_account_id=account.id,
            movement_date=payload.movement_date,
            kind=primary_kind,
            amount=money(primary_amount),
            note=payload.note,
            counter_account_id=counterpart.id,
            transfer_group=transfer_group,
        )
        secondary = CashMovement(
            vault_id=vault.id,
            bank_account_id=counterpart.id,
            movement_date=payload.movement_date,
            kind=counterpart_kind,
            amount=money(counterpart_amount),
            note=payload.note
            or (
                f"Transfer from {account.name}"
                if counterpart_kind == "TRANSFER_IN"
                else f"Transfer to {account.name}"
            ),
            counter_account_id=account.id,
            transfer_group=transfer_group,
        )
        session.add_all([primary, secondary])
        session.flush()
        created.extend([primary, secondary])
    else:
        movement = CashMovement(
            vault_id=vault.id,
            bank_account_id=account.id,
            movement_date=payload.movement_date,
            kind=payload.kind,
            amount=money(payload.amount),
            note=payload.note,
        )
        session.add(movement)
        session.flush()
        created.append(movement)
    _audit(
        session,
        vault,
        "cash_movement",
        created[0].id,
        "CASH_MOVEMENT_CREATED",
        after={"movements": [cash_movement_payload(m) for m in created]},
    )
    session.commit()
    return {"movements": [cash_movement_payload(m) for m in created]}


@router.post("/cash-movements/{movement_id}/reverse")
def reverse_cash_movement(
    movement_id: int,
    payload: ReasonRequest,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    movement = session.scalar(
        select(CashMovement).where(
            CashMovement.id == movement_id, CashMovement.vault_id == vault.id
        )
    )
    if movement is None:
        raise HTTPException(404, "Cash movement not found in this vault.")
    if movement.reversed_at is not None:
        raise HTTPException(409, "This cash movement is already reversed.")

    targets = [movement]
    if movement.transfer_group:
        targets = list(
            session.scalars(
                select(CashMovement).where(
                    CashMovement.vault_id == vault.id,
                    CashMovement.transfer_group == movement.transfer_group,
                    CashMovement.reversed_at.is_(None),
                )
            ).all()
        )
    reversed_at = utcnow()
    for target in targets:
        before = cash_movement_payload(target)
        target.reversed_at = reversed_at
        target.reversal_reason = payload.reason
        _audit(
            session,
            vault,
            "cash_movement",
            target.id,
            "CASH_MOVEMENT_REVERSED",
            before=before,
            note=payload.reason,
        )
    session.commit()
    return {
        "movement": cash_movement_payload(movement),
        "movements": [cash_movement_payload(target) for target in targets],
    }


# ---------------------------------------------------------------------------
# cash flow
# ---------------------------------------------------------------------------


@router.get("/cashflow")
def cashflow(
    start: date | None = None,
    end: date | None = None,
    as_of: date | None = None,
    bank_account_id: int | None = None,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    if start and end and start > end:
        raise HTTPException(400, "The start date must be on or before the end date.")
    try:
        return build_cashflow(
            session,
            vault,
            as_of=as_of or nepal_today(),
            start=start,
            end=end,
            bank_account_id=bank_account_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# ---------------------------------------------------------------------------
# imports and messages
# ---------------------------------------------------------------------------


@router.post("/imports/preview")
def import_preview(
    payload: PreviewRequest,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    try:
        return preview_import(session, vault, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/imports/commit")
def import_commit(
    payload: ImportCommitRequest,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    try:
        result = commit_import(session, vault, payload)
        return result
    except ValueError as exc:
        session.rollback()
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        session.rollback()
        raise


@router.get("/imports")
def list_imports(
    limit: int = Query(default=30, ge=1, le=100),
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    rows = session.scalars(
        select(SmsImport)
        .where(SmsImport.vault_id == vault.id)
        .order_by(SmsImport.created_at.desc(), SmsImport.id.desc())
        .limit(limit)
    ).all()
    return {
        "imports": [
            {
                "id": row.id,
                "source_type": row.source_type,
                "filename": row.filename,
                "status": row.status,
                "message_count": row.message_count,
                "parsed_count": row.parsed_count,
                "imported_count": row.imported_count,
                "rejected_count": row.rejected_count,
                "review_count": row.review_count,
                "duplicate_count": row.duplicate_count,
                "buy_bills": row.buy_bills,
                "sell_bills": row.sell_bills,
                "line_count": row.line_count,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            }
            for row in rows
        ]
    }


@router.get("/messages")
def list_messages(
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    conditions = [SmsMessage.vault_id == vault.id]
    if status:
        conditions.append(SmsMessage.status == status.upper())
    rows = session.scalars(
        select(SmsMessage)
        .where(*conditions)
        .order_by(SmsMessage.created_at.desc(), SmsMessage.id.desc())
        .limit(limit)
    ).all()
    return {"messages": [message_payload(m, include_raw=False) for m in rows]}


@router.get("/messages/{message_id}")
def get_message(
    message_id: int,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    message = session.scalar(
        select(SmsMessage).where(
            SmsMessage.id == message_id, SmsMessage.vault_id == vault.id
        )
    )
    if message is None:
        raise HTTPException(404, "Message not found in this vault.")
    bill = session.scalar(
        select(TransactionBill).where(TransactionBill.sms_message_id == message.id)
    )
    payload = message_payload(message, include_raw=True)
    if bill is not None:
        paid, received = _bill_sums(session, bill.id)
        txs = session.scalars(
            select(Transaction).where(Transaction.bill_id == bill.id).order_by(Transaction.line_no)
        ).all()
        payload["bill"] = bill_payload(bill, paid=paid, received=received, transactions=txs)
    return {"message": payload}


# ---------------------------------------------------------------------------
# transactions
# ---------------------------------------------------------------------------


@router.get("/transactions")
def list_transactions(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    side: str | None = None,
    symbol: str | None = None,
    status: str | None = None,
    reconciliation: str | None = None,
    q: str | None = Query(default=None, max_length=100),
    sort: str = "trade_date",
    order: str = "desc",
    page: int = Query(default=1, ge=1, le=100_000),
    page_size: int = Query(default=50, ge=1, le=200),
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    paged, total = _filtered_transactions(
        session,
        vault,
        from_date=from_date,
        to_date=to_date,
        side=side,
        symbol=symbol,
        status=status,
        reconciliation=reconciliation,
        q=q,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
    )
    conditions = _tx_conditions(
        vault,
        from_date=from_date,
        to_date=to_date,
        side=side,
        symbol=symbol,
        status=status,
        reconciliation=reconciliation,
        q=q,
    )
    all_rows = list(
        session.scalars(
            select(Transaction)
            .join(TransactionBill, Transaction.bill_id == TransactionBill.id)
            .where(*conditions)
        ).all()
    )
    buy_value = money(sum((tx.gross_amount for tx in all_rows if tx.side == "BUY"), ZERO))
    sell_value = money(sum((tx.gross_amount for tx in all_rows if tx.side == "SELL"), ZERO))
    charges = money(sum((tx.total_charges for tx in all_rows), ZERO))
    cgt = money(sum((tx.cgt for tx in all_rows), ZERO))
    realized = money(sum((tx.realized_pnl for tx in all_rows if tx.realized_pnl is not None), ZERO))
    return {
        "rows": _rows_payload(session, paged),
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "count": total,
            "buy_count": sum(1 for tx in all_rows if tx.side == "BUY"),
            "sell_count": sum(1 for tx in all_rows if tx.side == "SELL"),
            "buy_value": f"{buy_value:.2f}",
            "sell_value": f"{sell_value:.2f}",
            "charges_total": f"{charges:.2f}",
            "cgt_total": f"{cgt:.2f}",
            "realized_pnl": f"{realized:.2f}",
        },
        "filter_options": _filter_options(session, vault),
    }


@router.get("/transactions/export.csv")
def export_transactions_csv(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    side: str | None = None,
    symbol: str | None = None,
    status: str | None = None,
    reconciliation: str | None = None,
    q: str | None = Query(default=None, max_length=100),
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    conditions = _tx_conditions(
        vault,
        from_date=from_date,
        to_date=to_date,
        side=side,
        symbol=symbol,
        status=status,
        reconciliation=reconciliation,
        q=q,
    )
    rows = list(
        session.scalars(
            select(Transaction)
            .join(TransactionBill, Transaction.bill_id == TransactionBill.id)
            .where(*conditions)
            .order_by(Transaction.trade_date.desc(), Transaction.id.desc())
        ).all()
    )
    if len(rows) > 20_000:
        raise HTTPException(400, "Narrow the filter; more than 20,000 rows would be exported.")
    bills, messages, sums = _bill_map_for_transactions(session, rows)

    def safe(value: Any) -> str:
        text = "" if value is None else str(value)
        # Spreadsheet apps can treat leading whitespace or tabs as a prefix to
        # a formula, so inspect the first non-whitespace character too.
        if text.lstrip()[:1] in {"=", "+", "-", "@"} or text[:1] in {"\t", "\r"}:
            return f"'{text}"
        return text

    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(
        [
            "trade_date",
            "side",
            "symbol",
            "security_name",
            "quantity",
            "price",
            "gross_amount",
            "commission",
            "sebon_fee",
            "dp_charge",
            "other_charges",
            "total_charges",
            "cgt",
            "cost_basis",
            "realized_pnl",
            "net_amount",
            "bill_no",
            "broker_id",
            "bamt",
            "paid_amount",
            "received_amount",
            "payment_status",
            "reconciliation_status",
            "payment_deadline",
            "settlement_date",
            "notes",
        ]
    )
    for tx in rows:
        bill = bills.get(tx.bill_id)
        paid, received = sums.get(tx.bill_id, (ZERO, ZERO))
        bill_info = bill_payload(bill, paid=paid, received=received) if bill else {}
        writer.writerow(
            [
                tx.trade_date.isoformat(),
                tx.side,
                safe(tx.symbol),
                safe(tx.security_name),
                f"{tx.quantity:.4f}",
                f"{tx.price:.4f}",
                f"{tx.gross_amount:.2f}",
                f"{tx.commission:.2f}",
                f"{tx.sebon_fee:.2f}",
                f"{tx.dp_charge:.2f}",
                f"{tx.other_charges:.2f}",
                f"{tx.total_charges:.2f}",
                f"{tx.cgt:.2f}",
                f"{tx.cost_basis:.2f}" if tx.cost_basis is not None else "",
                f"{tx.realized_pnl:.2f}" if tx.realized_pnl is not None else "",
                f"{tx.net_amount:.2f}",
                safe(bill.bill_no if bill else ""),
                safe(bill.broker_id if bill else ""),
                f"{bill.bamt:.2f}" if bill and bill.bamt is not None else "",
                money_str(paid),
                money_str(received),
                bill_info.get("payment_status", ""),
                tx.reconciliation_status,
                tx.payment_deadline.isoformat() if tx.payment_deadline else "",
                tx.settlement_date.isoformat() if tx.settlement_date else "",
                safe(tx.notes),
            ]
        )
    filename = f"nepse-transactions-{nepal_today().isoformat()}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/transactions/{transaction_id}")
def get_transaction(
    transaction_id: int,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    tx = _owned_transaction(session, vault, transaction_id)
    return _transaction_detail(session, vault, tx)


def _recalculate_bill(
    session: Session,
    vault: AccountVault,
    bill: TransactionBill,
    *,
    refresh_deadlines: bool = False,
) -> None:
    txs = list(
        session.scalars(
            select(Transaction)
            .where(Transaction.bill_id == bill.id, Transaction.status != "REVERSED")
            .order_by(Transaction.line_no)
        ).all()
    )
    if not txs:
        return
    charges = calculate_bill_charges(
        session,
        side=bill.side,
        trade_date=bill.trade_date,
        investor_category=vault.investor_category,
        lines=[
            {
                "line_no": tx.line_no,
                "symbol": tx.symbol,
                "quantity": tx.quantity,
                "price": tx.price,
            }
            for tx in txs
        ],
    )
    for tx, charge in zip(txs, charges.lines, strict=False):
        tx.side = bill.side
        tx.trade_date = bill.trade_date
        tx.security_name = charge.security_name
        tx.security_type = charge.security_type
        tx.gross_amount = charge.gross
        tx.commission = charge.commission
        tx.sebon_fee = charge.sebon_fee
        tx.dp_charge = charge.dp_charge
        tx.other_charges = charge.other_charges
        tx.total_charges = charge.total_charges
        tx.net_amount = (
            money(charge.gross + charge.total_charges)
            if bill.side == "BUY"
            else money(charge.gross - charge.total_charges)
        )
        tx.fee_rule_version = charges.version
        snapshot = dict(tx.fee_snapshot_json or {})
        snapshot["version"] = charges.version
        snapshot["charges"] = charges.snapshot
        tx.fee_snapshot_json = snapshot
        if refresh_deadlines:
            from .calendar import deadline_dates

            dates = deadline_dates(bill.trade_date, vault.settings_json or {}, bill.side)
            bill.payment_deadline = dates["payment_deadline"]
            bill.edis_deadline = dates["edis_deadline"]
            bill.settlement_date = dates["settlement_date"]
            tx.payment_deadline = dates["payment_deadline"]
            tx.settlement_date = dates["settlement_date"]
    bill.gross_amount = charges.gross
    bill.charges_total = charges.total_charges
    if bill.side == "BUY":
        bill.calculated_total = money(charges.gross + charges.total_charges)
        bill.cash_amount = money(bill.bamt) if bill.bamt is not None else bill.calculated_total
        bill.edis_status = "NOT_REQUIRED"
        bill.wacc_status = "NOT_REQUIRED"
    else:
        bill.calculated_total = money(charges.gross - charges.total_charges)
        bill.cash_amount = bill.calculated_total
        if bill.edis_status == "NOT_REQUIRED":
            bill.edis_status = "PENDING"
        if bill.wacc_status == "NOT_REQUIRED":
            bill.wacc_status = "PENDING"
    bill.reconciliation_status = charges.status
    session.flush()
    recompute_vault_ledger(session, vault)


@router.patch("/transactions/{transaction_id}")
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    tx = _owned_transaction(session, vault, transaction_id)
    bill = _owned_bill(session, vault, tx.bill_id)
    if tx.status == "REVERSED":
        raise HTTPException(
            409,
            "Reversed transactions are read-only. Import or create a new correcting transaction instead.",
        )
    changed = payload.model_dump(exclude_unset=True)
    if (
        changed.get("side") is not None
        and changed["side"] != bill.side
    ):
        active_settlements = session.scalar(
            select(func.count(Settlement.id)).where(
                Settlement.bill_id == bill.id, Settlement.reversed_at.is_(None)
            )
        ) or 0
        if active_settlements:
            raise HTTPException(
                409,
                "Reverse the recorded payment/receipt before changing the bill side.",
            )
    before = {
        "transaction": transaction_payload(tx, bill),
        "bill": bill_payload(bill),
    }
    refresh_deadlines = False
    if "symbol" in changed and changed["symbol"] is not None:
        tx.symbol = changed["symbol"]
        security = session.get(Security, tx.symbol)
        tx.security_name = security.name if security else tx.security_name
    if "quantity" in changed and changed["quantity"] is not None:
        tx.quantity = changed["quantity"]
        tx.gross_amount = money(tx.quantity * tx.price)
    if "price" in changed and changed["price"] is not None:
        tx.price = changed["price"]
        tx.gross_amount = money(tx.quantity * tx.price)
    if "side" in changed and changed["side"] is not None:
        bill.side = changed["side"]
        refresh_deadlines = True
    if "trade_date" in changed and changed["trade_date"] is not None:
        bill.trade_date = changed["trade_date"]
        refresh_deadlines = True
    if "bill_no" in changed:
        bill.bill_no = changed["bill_no"]
    if "bamt" in changed:
        bill.bamt = money(changed["bamt"]) if changed["bamt"] is not None else None
    if "notes" in changed:
        tx.notes = changed["notes"]
    if "edis_status" in changed and changed["edis_status"] is not None:
        bill.edis_status = changed["edis_status"]
    if "wacc_status" in changed and changed["wacc_status"] is not None:
        bill.wacc_status = changed["wacc_status"]
    if "payment_deadline" in changed:
        bill.payment_deadline = changed["payment_deadline"]
    if "settlement_date" in changed:
        bill.settlement_date = changed["settlement_date"]
    _recalculate_bill(session, vault, bill, refresh_deadlines=refresh_deadlines)
    # Explicit saved dates win over the generated deadline.
    if "payment_deadline" in changed:
        bill.payment_deadline = changed["payment_deadline"]
        for row in session.scalars(select(Transaction).where(Transaction.bill_id == bill.id)).all():
            row.payment_deadline = changed["payment_deadline"]
    if "settlement_date" in changed:
        bill.settlement_date = changed["settlement_date"]
        for row in session.scalars(select(Transaction).where(Transaction.bill_id == bill.id)).all():
            row.settlement_date = changed["settlement_date"]
    _audit(
        session,
        vault,
        "transaction",
        tx.id,
        "TRANSACTION_CORRECTED",
        before=before,
        after={"transaction": transaction_payload(tx, bill), "bill": bill_payload(bill)},
        note=payload.reason,
    )
    session.commit()
    tx = _owned_transaction(session, vault, transaction_id)
    return _transaction_detail(session, vault, tx)


@router.post("/transactions/{transaction_id}/reverse")
def reverse_transaction(
    transaction_id: int,
    payload: ReasonRequest,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    tx = _owned_transaction(session, vault, transaction_id)
    bill = _owned_bill(session, vault, tx.bill_id)
    if tx.status == "REVERSED":
        raise HTTPException(409, "This transaction is already reversed.")
    settlements = session.scalar(
        select(func.count(Settlement.id)).where(
            Settlement.bill_id == bill.id, Settlement.reversed_at.is_(None)
        )
    ) or 0
    if settlements:
        raise HTTPException(
            409,
            "Reverse the recorded payment/receipt first, then reverse the transaction.",
        )
    before = transaction_payload(tx, bill)
    tx.status = "REVERSED"
    tx.reversed_at = utcnow()
    tx.reversal_reason = payload.reason
    recompute_vault_ledger(session, vault)
    _audit(
        session,
        vault,
        "transaction",
        tx.id,
        "TRANSACTION_REVERSED",
        before=before,
        after=transaction_payload(tx, bill),
        note=payload.reason,
    )
    session.commit()
    return _transaction_detail(session, vault, tx)


# ---------------------------------------------------------------------------
# bills and settlements
# ---------------------------------------------------------------------------


@router.get("/bills/{bill_id}")
def get_bill(
    bill_id: int,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    bill = _owned_bill(session, vault, bill_id)
    paid, received = _bill_sums(session, bill.id)
    txs = session.scalars(
        select(Transaction).where(Transaction.bill_id == bill.id).order_by(Transaction.line_no)
    ).all()
    return {
        "bill": bill_payload(bill, paid=paid, received=received, transactions=txs),
        "settlements": [settlement_payload(s) for s in _bill_settlements(session, bill.id)],
    }


@router.patch("/bills/{bill_id}")
def update_bill(
    bill_id: int,
    payload: BillUpdate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    bill = _owned_bill(session, vault, bill_id)
    before = bill_payload(bill)
    changed = payload.model_dump(exclude_unset=True)
    if "bank_account_id" in changed:
        if changed["bank_account_id"] is None:
            bill.bank_account_id = None
        else:
            _owned_account(session, vault, changed["bank_account_id"])
            bill.bank_account_id = changed["bank_account_id"]
    if "bill_no" in changed:
        bill.bill_no = changed["bill_no"]
    if "bamt" in changed:
        bill.bamt = money(changed["bamt"]) if changed["bamt"] is not None else None
    if "payment_deadline" in changed:
        bill.payment_deadline = changed["payment_deadline"]
    if "edis_deadline" in changed:
        bill.edis_deadline = changed["edis_deadline"]
    if "settlement_date" in changed:
        bill.settlement_date = changed["settlement_date"]
    if "edis_status" in changed and changed["edis_status"] is not None:
        bill.edis_status = changed["edis_status"]
    if "wacc_status" in changed and changed["wacc_status"] is not None:
        bill.wacc_status = changed["wacc_status"]
    if "notes" in changed:
        bill.notes = changed["notes"]
    _recalculate_bill(session, vault, bill)
    # The bill is the source of truth for obligations. Keep the per-line copy in
    # sync when a deadline is edited on the bill itself; holdings/cash flow read
    # the bill, but transaction detail must not show a stale date.
    for row in session.scalars(
        select(Transaction).where(Transaction.bill_id == bill.id)
    ).all():
        row.payment_deadline = bill.payment_deadline
        row.settlement_date = bill.settlement_date
    _audit(
        session,
        vault,
        "bill",
        bill.id,
        "BILL_UPDATED",
        before=before,
        after=bill_payload(bill),
        note=payload.reason,
    )
    session.commit()
    paid, received = _bill_sums(session, bill.id)
    txs = session.scalars(
        select(Transaction).where(Transaction.bill_id == bill.id).order_by(Transaction.line_no)
    ).all()
    return {
        "bill": bill_payload(bill, paid=paid, received=received, transactions=txs),
        "settlements": [settlement_payload(s) for s in _bill_settlements(session, bill.id)],
    }


@router.post("/bills/{bill_id}/settlements")
def create_settlement(
    bill_id: int,
    payload: SettlementCreate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    bill = _owned_bill(session, vault, bill_id)
    if bill.status == "REVERSED":
        raise HTTPException(
            409, "A reversed bill cannot accept a new payment or receipt."
        )
    if bill.side == "BUY" and payload.direction != "PAYMENT":
        raise HTTPException(400, "A BUY bill accepts PAYMENT settlements.")
    if bill.side == "SELL" and payload.direction != "RECEIPT":
        raise HTTPException(400, "A SELL bill accepts RECEIPT settlements.")
    if payload.settlement_date < bill.trade_date:
        raise HTTPException(400, "Settlement date cannot be before the trade date.")
    settlement_account: BankAccount | None = None
    if payload.bank_account_id is not None:
        settlement_account = _owned_account(session, vault, payload.bank_account_id)
    elif bill.bank_account_id is not None:
        settlement_account = _owned_account(session, vault, bill.bank_account_id)
    if settlement_account is not None:
        _ensure_on_or_after_opening(
            settlement_account, payload.settlement_date, label="Settlement"
        )
    if payload.transaction_id is not None:
        tx = _owned_transaction(session, vault, payload.transaction_id)
        if tx.bill_id != bill.id:
            raise HTTPException(400, "That transaction belongs to a different bill.")
    paid, received = _bill_sums(session, bill.id)
    due = Decimal(str(bill.cash_amount or 0))
    settled = paid if bill.side == "BUY" else received
    outstanding = max(ZERO, money(due - settled))
    if outstanding <= 0:
        raise HTTPException(409, "This bill has no outstanding amount.")
    if money(payload.amount) > outstanding + Decimal("0.01"):
        raise HTTPException(400, f"Amount exceeds the outstanding NPR {outstanding:.2f}.")
    settlement = Settlement(
        vault_id=vault.id,
        bill_id=bill.id,
        transaction_id=payload.transaction_id,
        direction=payload.direction,
        amount=money(payload.amount),
        settlement_date=payload.settlement_date,
        bank_account_id=payload.bank_account_id or bill.bank_account_id,
        reference=payload.reference,
        note=payload.note,
    )
    session.add(settlement)
    session.flush()
    _audit(
        session,
        vault,
        "settlement",
        settlement.id,
        "SETTLEMENT_RECORDED",
        after=settlement_payload(settlement),
    )
    session.commit()
    paid, received = _bill_sums(session, bill.id)
    return {
        "settlement": settlement_payload(settlement),
        "bill": bill_payload(bill, paid=paid, received=received),
    }


@router.post("/settlements/{settlement_id}/reverse")
def reverse_settlement(
    settlement_id: int,
    payload: ReasonRequest,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    settlement = _owned_settlement(session, vault, settlement_id)
    if settlement.reversed_at is not None:
        raise HTTPException(409, "This settlement is already reversed.")
    before = settlement_payload(settlement)
    settlement.reversed_at = utcnow()
    settlement.reversal_reason = payload.reason
    _audit(
        session,
        vault,
        "settlement",
        settlement.id,
        "SETTLEMENT_REVERSED",
        before=before,
        note=payload.reason,
    )
    session.commit()
    return {"settlement": settlement_payload(settlement)}


# ---------------------------------------------------------------------------
# holdings
# ---------------------------------------------------------------------------


@router.get("/holdings")
def holdings(
    as_of: date | None = None,
    include_closed: bool = False,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    return build_holdings(
        session, vault, as_of=as_of or nepal_today(), include_closed=include_closed
    )


@router.post("/holdings/{symbol}/price")
def set_price_override(
    symbol: str,
    payload: PriceOverrideCreate,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    symbol = symbol.upper()
    if not symbol or not symbol.isalnum():
        raise HTTPException(400, "Invalid symbol.")
    existing = session.scalar(
        select(PriceOverride).where(
            PriceOverride.vault_id == vault.id, PriceOverride.symbol == symbol
        )
    )
    before = None
    if existing is None:
        existing = PriceOverride(
            vault_id=vault.id,
            symbol=symbol,
            price=money(payload.price),
            as_of=payload.as_of,
            note=payload.note,
        )
        session.add(existing)
    else:
        before = {
            "price": money_str(existing.price),
            "as_of": existing.as_of.isoformat(),
            "note": existing.note,
        }
        existing.price = money(payload.price)
        existing.as_of = payload.as_of
        existing.note = payload.note
    session.flush()
    _audit(
        session,
        vault,
        "price_override",
        existing.id,
        "PRICE_OVERRIDE_SET",
        before=before,
        after={
            "symbol": symbol,
            "price": money_str(existing.price),
            "as_of": existing.as_of.isoformat(),
            "note": existing.note,
        },
    )
    session.commit()
    return {
        "symbol": symbol,
        "price": money_str(existing.price),
        "as_of": existing.as_of.isoformat(),
        "note": existing.note,
    }


@router.delete("/holdings/{symbol}/price")
def clear_price_override(
    symbol: str,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    existing = session.scalar(
        select(PriceOverride).where(
            PriceOverride.vault_id == vault.id,
            PriceOverride.symbol == symbol.upper(),
        )
    )
    if existing is None:
        raise HTTPException(404, "No manual price exists for that symbol.")
    _audit(
        session,
        vault,
        "price_override",
        existing.id,
        "PRICE_OVERRIDE_CLEARED",
        before={"symbol": existing.symbol, "price": money_str(existing.price)},
    )
    session.delete(existing)
    session.commit()
    return {"deleted": True}


# ---------------------------------------------------------------------------
# fee rules, audit and overview
# ---------------------------------------------------------------------------


@router.get("/fee-rules")
def fee_rules(
    as_of: date | None = None,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    ensure_default_fee_rules(session)
    conditions = []
    if as_of:
        conditions = [
            FeeRule.effective_from <= as_of,
            or_(FeeRule.effective_to.is_(None), FeeRule.effective_to >= as_of),
        ]
    rows = session.scalars(
        select(FeeRule).where(*conditions).order_by(FeeRule.code, FeeRule.effective_from.desc())
    ).all()
    sources = []
    seen = set()
    for row in rows:
        key = (row.source_title, row.source_url)
        if key not in seen:
            seen.add(key)
            sources.append({"title": row.source_title, "url": row.source_url})
    return {
        "as_of": as_of.isoformat() if as_of else None,
        "rules": [fee_rule_payload(row) for row in rows],
        "sources": sources,
        "note": "Rules are selected by trade date. PARTIAL or UNVERIFIED rules are reported as estimates, never as reconciled actuals.",
    }


@router.get("/audit")
def list_audit(
    limit: int = Query(default=100, ge=1, le=500),
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    rows = session.scalars(
        select(AuditEvent)
        .where(AuditEvent.vault_id == vault.id)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(limit)
    ).all()
    return {"events": [audit_payload(row) for row in rows]}


@router.get("/overview")
def overview(
    as_of: date | None = None,
    vault: AccountVault = Depends(require_vault),
    session: Session = Depends(get_session),
):
    as_of = as_of or nepal_today()
    cash = build_cashflow(
        session,
        vault,
        as_of=as_of,
        start=as_of - timedelta(days=90),
        end=as_of + timedelta(days=90),
    )
    holding_data = build_holdings(session, vault, as_of=as_of)
    accounts = session.scalars(
        select(BankAccount)
        .where(BankAccount.vault_id == vault.id)
        .order_by(BankAccount.is_default.desc(), BankAccount.id)
    ).all()
    active_txs = list(
        session.scalars(
            select(Transaction)
            .where(Transaction.vault_id == vault.id, Transaction.status != "REVERSED")
            .order_by(Transaction.trade_date.desc(), Transaction.id.desc())
        ).all()
    )
    recent = active_txs[:8]
    charges = money(sum((tx.total_charges for tx in active_txs), ZERO))
    cgt = money(sum((tx.cgt for tx in active_txs), ZERO))
    realized = money(
        sum((tx.realized_pnl for tx in active_txs if tx.realized_pnl is not None), ZERO)
    )
    monthly: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {"charges": ZERO, "cgt": ZERO, "gross": ZERO, "count": Decimal("0")}
    )
    for tx in active_txs:
        key = tx.trade_date.strftime("%Y-%m")
        monthly[key]["charges"] += tx.total_charges
        monthly[key]["cgt"] += tx.cgt
        monthly[key]["gross"] += tx.gross_amount
        monthly[key]["count"] += Decimal("1")
    charges_series = [
        {
            "month": key,
            "charges": f"{money(value['charges']):.2f}",
            "cgt": f"{money(value['cgt']):.2f}",
            "gross": f"{money(value['gross']):.2f}",
            "count": int(value["count"]),
        }
        for key, value in sorted(monthly.items())
    ]
    message_counts = dict(
        session.execute(
            select(SmsMessage.status, func.count(SmsMessage.id))
            .where(SmsMessage.vault_id == vault.id)
            .group_by(SmsMessage.status)
        ).all()
    )
    upcoming = []
    for commitment in cash["commitments"]:
        if Decimal(commitment["outstanding"]) <= 0:
            continue
        due_date = (
            commitment["payment_deadline"]
            if commitment["side"] == "BUY"
            else commitment["settlement_date"]
        )
        upcoming.append(
            {
                **commitment,
                "type": "PAYMENT" if commitment["side"] == "BUY" else "RECEIPT",
                "due_date": due_date,
                "overdue": bool(due_date and date.fromisoformat(due_date) < as_of),
            }
        )
    upcoming.sort(key=lambda item: (item["due_date"] or "9999-12-31", item["bill_id"]))
    import_count = session.scalar(
        select(func.count(SmsImport.id)).where(SmsImport.vault_id == vault.id)
    ) or 0
    notes = list(cash.get("notes") or []) + list(holding_data.get("notes") or [])
    if message_counts.get("NEEDS_REVIEW"):
        notes.append(
            f"{message_counts['NEEDS_REVIEW']} imported message(s) need review before they affect the ledger."
        )
    return {
        "available": True,
        "as_of": as_of.isoformat(),
        "vault": vault_payload(vault),
        "bank_accounts": [bank_account_payload(a) for a in accounts],
        "has_data": bool(active_txs),
        "metrics": {
            "actual_bank_balance": cash["metrics"]["actual_bank_balance"],
            "projected_available_cash": cash["metrics"]["projected_available_cash"],
            "committed_payments": cash["metrics"]["committed_payments"],
            "expected_receipts": cash["metrics"]["expected_receipts"],
            "unconfirmed_receipts": cash["metrics"]["unconfirmed_receipts"],
            "potential_shortfall": cash["metrics"]["potential_shortfall"],
            "max_shortfall": cash["metrics"]["max_shortfall"],
            "first_shortfall": cash["metrics"]["first_shortfall"],
            "overdue_payments": cash["metrics"]["overdue_payments"],
            "next_payment_deadline": cash["metrics"]["next_payment_deadline"],
            "next_receipt_date": cash["metrics"]["next_receipt_date"],
            "realized_pnl": f"{realized:.2f}",
            "unrealized_pnl": holding_data["summary"]["unrealized_pnl"],
            "holdings_cost": holding_data["summary"]["cost_basis"],
            "holdings_value": holding_data["summary"]["market_value"],
            "charges_paid": f"{charges:.2f}",
            "cgt_paid": f"{cgt:.2f}",
            "transaction_count": len(active_txs),
            "open_bills": sum(1 for item in upcoming if item["side"] == "BUY"),
            "open_holdings": holding_data["summary"]["open_positions"],
            "import_count": import_count,
            "unreviewed_messages": message_counts.get("NEEDS_REVIEW", 0),
        },
        "cashflow": {
            "days": cash["days"],
            "shortfalls": cash["shortfalls"],
            "metrics": cash["metrics"],
            "commitments": cash["commitments"],
            "assumptions": cash["assumptions"],
        },
        "holdings": holding_data,
        "upcoming": upcoming[:16],
        "recent_transactions": _rows_payload(session, recent),
        "charges_series": charges_series,
        "message_health": message_counts,
        "notes": notes,
    }
