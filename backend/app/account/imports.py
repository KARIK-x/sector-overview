from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Security
from .calendar import deadline_dates, nepal_today
from .fees import ZERO, calculate_bill_charges, ensure_default_fee_rules, money
from .ledger import recompute_vault_ledger
from .models import (
    AccountVault,
    AuditEvent,
    BankAccount,
    SmsImport,
    SmsMessage,
    Transaction,
    TransactionBill,
    utcnow,
)
from .parser import (
    ParsedLine,
    ParsedMessage,
    RawMessage,
    apply_known_symbols,
    enforce_message_limits,
    parse_file,
    parse_sms,
    split_messages,
)
from .schemas import CommitMessage, ImportCommitRequest, PreviewRequest
from .serializers import message_payload


def _known_symbols(session: Session) -> set[str]:
    return set(session.scalars(select(Security.symbol)).all())


def _raw_messages(request: PreviewRequest) -> list[RawMessage]:
    if request.messages:
        messages = [
            RawMessage(
                raw_text=item.raw_text,
                sender=item.sender,
                received_at=item.received_at,
                filename=request.filename,
                source_type=request.source_type,
            )
            for item in request.messages
        ]
    else:
        content = request.content or ""
        if request.source_type in {"CSV", "XML", "JSON"} or (
            request.filename
            and request.filename.rsplit(".", 1)[-1].lower() in {"csv", "xml", "json"}
        ):
            messages = parse_file(request.filename, content)
        else:
            messages = [
                RawMessage(
                    chunk,
                    filename=request.filename,
                    source_type=request.source_type,
                )
                for chunk in split_messages(content)
            ]
    return enforce_message_limits(messages)


def _override_message(parsed: ParsedMessage, overrides) -> ParsedMessage:
    if overrides is None:
        return parsed
    if overrides.broker_id is not None:
        parsed.broker_id = overrides.broker_id.strip().upper() or None
    if overrides.trade_date is not None:
        parsed.trade_date = overrides.trade_date
        parsed.errors = [e for e in parsed.errors if "date" not in e.lower()]
    if overrides.side is not None:
        parsed.side = overrides.side
        parsed.errors = [e for e in parsed.errors if "side" not in e.lower()]
    if overrides.bill_no is not None:
        parsed.bill_no = overrides.bill_no.strip(" .,;") or None
        parsed.warnings = [w for w in parsed.warnings if w != "MISSING_BILL_NO"]
    if overrides.bamt is not None:
        parsed.bamt = overrides.bamt
        parsed.warnings = [w for w in parsed.warnings if w != "MISSING_BAMT"]
    if overrides.payment_url is not None:
        parsed.payment_url = overrides.payment_url
    if overrides.lines is not None:
        parsed.lines = [
            ParsedLine(
                line_no=line.line_no,
                symbol=line.symbol,
                quantity=line.quantity,
                price=line.price,
                gross=money(line.quantity * line.price),
                raw=f"{line.symbol} {line.quantity}@{line.price}",
            )
            for line in sorted(overrides.lines, key=lambda item: item.line_no)
        ]
        parsed.lines = [
            ParsedLine(
                line_no=index,
                symbol=line.symbol,
                quantity=line.quantity,
                price=line.price,
                gross=line.gross,
                raw=line.raw,
            )
            for index, line in enumerate(parsed.lines)
        ]
        parsed.errors = [e for e in parsed.errors if "security lines" not in e.lower()]
        parsed.warnings = [w for w in parsed.warnings if w not in {"MULTIPLE_SECURITIES"}]
        if len(parsed.lines) > 1:
            parsed.warnings.append("MULTIPLE_SECURITIES")
    if parsed.lines and parsed.trade_date and parsed.side:
        parsed.errors = [e for e in parsed.errors if e]
        parsed.status = "PARSED" if not parsed.errors else "NEEDS_REVIEW"
    elif not parsed.lines:
        parsed.status = "ERROR"
    else:
        parsed.status = "NEEDS_REVIEW"
    return parsed


def preview_import(session: Session, vault: AccountVault, request: PreviewRequest) -> dict[str, Any]:
    raws = _raw_messages(request)
    known = _known_symbols(session)
    messages: list[dict[str, Any]] = []
    for raw in raws:
        parsed = apply_known_symbols(parse_sms(raw.raw_text), known)
        existing = session.scalar(
            select(SmsMessage).where(
                SmsMessage.vault_id == vault.id,
                SmsMessage.fingerprint == parsed.fingerprint,
            )
        )
        row = parsed.as_dict()
        row["sender"] = raw.sender
        row["received_at"] = raw.received_at.isoformat() if raw.received_at else None
        row["duplicate_of"] = (
            existing.id if existing is not None and existing.status == "IMPORTED" else None
        )
        row["previous_message_id"] = existing.id if existing is not None else None
        row["previous_status"] = existing.status if existing is not None else None
        messages.append(row)
    return {
        "batch": {
            "source_type": request.source_type,
            "filename": request.filename,
            "message_count": len(messages),
        },
        "messages": messages,
        "summary": {
            "total": len(messages),
            "parsed": sum(1 for row in messages if row["status"] == "PARSED"),
            "needs_review": sum(1 for row in messages if row["status"] == "NEEDS_REVIEW"),
            "errors": sum(1 for row in messages if row["status"] == "ERROR"),
            "duplicates": sum(1 for row in messages if row["duplicate_of"]),
            "buy": sum(1 for row in messages if row["side"] == "BUY"),
            "sell": sum(1 for row in messages if row["side"] == "SELL"),
            "unknown_symbols": sorted(
                {
                    warning.split(":", 1)[1]
                    for row in messages
                    for warning in row["warnings"]
                    if warning.startswith("UNKNOWN_SYMBOL:")
                }
            ),
        },
    }


def _default_account(session: Session, vault: AccountVault) -> BankAccount:
    account = session.scalar(
        select(BankAccount)
        .where(BankAccount.vault_id == vault.id, BankAccount.active.is_(True))
        .order_by(BankAccount.is_default.desc(), BankAccount.id)
        .limit(1)
    )
    if account is not None:
        return account
    # Every bank may have been deactivated.  Reuse the existing row instead of
    # creating a duplicate "Primary bank" name, which would violate the
    # per-vault uniqueness constraint.
    account = session.scalar(
        select(BankAccount)
        .where(BankAccount.vault_id == vault.id)
        .order_by(BankAccount.is_default.desc(), BankAccount.id)
        .limit(1)
    )
    if account is not None:
        account.active = True
        account.is_default = True
        return account
    account = BankAccount(
        vault_id=vault.id,
        name="Primary bank",
        opening_balance=ZERO,
        opening_balance_date=nepal_today(),
        is_default=True,
        active=True,
    )
    session.add(account)
    session.flush()
    return account


def _valid_commit_parse(item: CommitMessage, known: set[str]) -> ParsedMessage:
    parsed = apply_known_symbols(parse_sms(item.raw_text), known)
    parsed = _override_message(parsed, item.overrides)
    return parsed


def commit_import(session: Session, vault: AccountVault, request: ImportCommitRequest) -> dict[str, Any]:
    ensure_default_fee_rules(session)
    known = _known_symbols(session)
    batch = SmsImport(
        vault_id=vault.id,
        source_type=request.source_type,
        filename=request.filename,
        status="IMPORTING",
        message_count=len(request.messages),
    )
    session.add(batch)
    session.flush()
    account = _default_account(session, vault)
    holidays = vault.settings_json or {}
    counters = {
        "imported": 0,
        "rejected": 0,
        "needs_review": 0,
        "duplicates": 0,
        "buy_bills": 0,
        "sell_bills": 0,
        "line_items": 0,
        "parsed": 0,
    }
    result_messages: list[dict[str, Any]] = []

    for item in request.messages:
        parsed = _valid_commit_parse(item, known)
        existing = session.scalar(
            select(SmsMessage).where(
                SmsMessage.vault_id == vault.id,
                SmsMessage.fingerprint == parsed.fingerprint,
            )
        )
        if existing is not None and existing.status == "IMPORTED":
            counters["duplicates"] += 1
            result_messages.append(
                message_payload(existing, duplicate_of=existing.id)
            )
            continue
        if not item.approved:
            message = existing or SmsMessage(
                vault_id=vault.id,
                fingerprint=parsed.fingerprint,
                raw_text=item.raw_text,
                normalized_text=parsed.normalized_text,
                parser_version=parsed.parser_version,
            )
            message.import_id = batch.id
            message.source_type = request.source_type
            message.filename = request.filename
            message.sender = item.sender
            message.received_at = item.received_at
            message.raw_text = item.raw_text
            message.normalized_text = parsed.normalized_text
            message.confidence = parsed.confidence
            message.status = "REJECTED"
            message.warnings_json = parsed.warnings
            message.errors_json = parsed.errors or ["Rejected by the user."]
            message.broker_id = parsed.broker_id
            message.trade_date = parsed.trade_date
            message.side = parsed.side
            message.bill_no = parsed.bill_no
            message.bamt = parsed.bamt
            message.payment_url = parsed.payment_url
            message.line_count = len(parsed.lines)
            session.add(message)
            session.flush()
            counters["rejected"] += 1
            result_messages.append(message_payload(message))
            continue

        if parsed.status in {"ERROR", "NEEDS_REVIEW"}:
            message = existing or SmsMessage(
                vault_id=vault.id,
                fingerprint=parsed.fingerprint,
                raw_text=item.raw_text,
                normalized_text=parsed.normalized_text,
                parser_version=parsed.parser_version,
            )
            message.import_id = batch.id
            message.source_type = request.source_type
            message.filename = request.filename
            message.sender = item.sender
            message.received_at = item.received_at
            message.raw_text = item.raw_text
            message.normalized_text = parsed.normalized_text
            message.confidence = parsed.confidence
            message.status = "NEEDS_REVIEW"
            message.warnings_json = parsed.warnings
            message.errors_json = parsed.errors or ["Review the parsed fields before importing."]
            message.broker_id = parsed.broker_id
            message.trade_date = parsed.trade_date
            message.side = parsed.side
            message.bill_no = parsed.bill_no
            message.bamt = parsed.bamt
            message.payment_url = parsed.payment_url
            message.line_count = len(parsed.lines)
            session.add(message)
            session.flush()
            counters["needs_review"] += 1
            result_messages.append(message_payload(message))
            continue

        assert parsed.trade_date is not None and parsed.side is not None
        message = existing or SmsMessage(
            vault_id=vault.id,
            fingerprint=parsed.fingerprint,
            raw_text=item.raw_text,
            normalized_text=parsed.normalized_text,
            parser_version=parsed.parser_version,
        )
        message.import_id = batch.id
        message.source_type = request.source_type
        message.filename = request.filename
        message.sender = item.sender
        message.received_at = item.received_at
        message.raw_text = item.raw_text
        message.normalized_text = parsed.normalized_text
        message.confidence = parsed.confidence
        message.broker_id = parsed.broker_id
        message.trade_date = parsed.trade_date
        message.side = parsed.side
        message.bill_no = parsed.bill_no
        message.bamt = parsed.bamt
        message.payment_url = parsed.payment_url
        message.line_count = len(parsed.lines)
        message.warnings_json = parsed.warnings
        message.errors_json = parsed.errors
        message.status = "IMPORTING"
        session.add(message)
        session.flush()

        bill = session.scalar(
            select(TransactionBill).where(TransactionBill.sms_message_id == message.id)
        )
        if bill is None:
            bill = TransactionBill(
                vault_id=vault.id,
                sms_message_id=message.id,
                bank_account_id=account.id,
                broker_id=parsed.broker_id or vault.default_broker,
                trade_date=parsed.trade_date,
                side=parsed.side,
                bill_no=parsed.bill_no,
                bamt=parsed.bamt,
            )
            session.add(bill)
            session.flush()
        else:
            bill.bank_account_id = bill.bank_account_id or account.id
            bill.broker_id = parsed.broker_id or vault.default_broker
            bill.trade_date = parsed.trade_date
            bill.side = parsed.side
            bill.bill_no = parsed.bill_no
            bill.bamt = parsed.bamt

        dates = deadline_dates(parsed.trade_date, holidays, parsed.side)
        bill.payment_deadline = dates["payment_deadline"]
        bill.edis_deadline = dates["edis_deadline"]
        bill.settlement_date = dates["settlement_date"]
        bill.bank_account_id = bill.bank_account_id or account.id
        if parsed.side == "BUY":
            bill.edis_status = "NOT_REQUIRED"
            bill.wacc_status = "NOT_REQUIRED"
        else:
            bill.edis_status = bill.edis_status or "PENDING"
            bill.wacc_status = bill.wacc_status or "PENDING"

        charges = calculate_bill_charges(
            session,
            side=parsed.side,
            trade_date=parsed.trade_date,
            investor_category=vault.investor_category,
            lines=[
                {
                    "line_no": line.line_no,
                    "symbol": line.symbol,
                    "quantity": line.quantity,
                    "price": line.price,
                }
                for line in parsed.lines
            ],
        )
        existing_txs = list(
            session.scalars(
                select(Transaction).where(Transaction.bill_id == bill.id)
            ).all()
        )
        if existing_txs:
            # A reviewed message can be corrected before it ever produced a
            # bill.  If a bill already exists, do not silently replace ledger
            # rows; direct corrections use the audited transaction endpoint.
            counters["duplicates"] += 1
            message.status = "IMPORTED"
            message.imported_at = utcnow()
            result_messages.append(message_payload(message))
            continue

        bill.gross_amount = charges.gross
        bill.charges_total = charges.total_charges
        bill.cgt_total = ZERO
        if parsed.side == "BUY":
            bill.calculated_total = money(charges.gross + charges.total_charges)
            bill.cash_amount = money(parsed.bamt) if parsed.bamt is not None else bill.calculated_total
        else:
            bill.calculated_total = money(charges.gross - charges.total_charges)
            bill.cash_amount = bill.calculated_total
        bill.reconciliation_status = charges.status

        for line, charge in zip(parsed.lines, charges.lines, strict=False):
            tx = Transaction(
                vault_id=vault.id,
                bill_id=bill.id,
                source_message_id=message.id,
                line_no=line.line_no,
                symbol=line.symbol,
                security_name=charge.security_name,
                security_type=charge.security_type,
                side=parsed.side,
                trade_date=parsed.trade_date,
                quantity=line.quantity,
                price=line.price,
                gross_amount=charge.gross,
                commission=charge.commission,
                sebon_fee=charge.sebon_fee,
                dp_charge=charge.dp_charge,
                other_charges=charge.other_charges,
                total_charges=charge.total_charges,
                net_amount=(
                    money(charge.gross + charge.total_charges)
                    if parsed.side == "BUY"
                    else money(charge.gross - charge.total_charges)
                ),
                payment_deadline=dates["payment_deadline"],
                settlement_date=dates["settlement_date"],
                status="IMPORTED",
                reconciliation_status=charges.status,
                fee_rule_version=charges.version,
                fee_snapshot_json={
                    "version": charges.version,
                    "charges": charges.snapshot,
                    "tax": None,
                },
            )
            session.add(tx)
            counters["line_items"] += 1
        message.status = "IMPORTED"
        message.imported_at = utcnow()
        message.errors_json = []
        counters["imported"] += 1
        counters["parsed"] += 1
        counters["buy_bills" if parsed.side == "BUY" else "sell_bills"] += 1
        session.flush()
        result_messages.append(message_payload(message))

    session.flush()
    recompute_vault_ledger(session, vault)
    batch.parsed_count = counters["parsed"]
    batch.imported_count = counters["imported"]
    batch.rejected_count = counters["rejected"]
    batch.review_count = counters["needs_review"]
    batch.duplicate_count = counters["duplicates"]
    batch.buy_bills = counters["buy_bills"]
    batch.sell_bills = counters["sell_bills"]
    batch.line_count = counters["line_items"]
    batch.status = "COMPLETED"
    batch.completed_at = utcnow()
    batch.summary_json = dict(counters)
    session.add(
        AuditEvent(
            vault_id=vault.id,
            entity_type="sms_import",
            entity_id=str(batch.id),
            action="IMPORT_COMMITTED",
            after_json=dict(counters),
            note="SMS batch imported; raw message text is stored only on the message rows.",
        )
    )
    session.commit()
    return {
        "import_id": batch.id,
        "summary": counters,
        "messages": result_messages,
        "batch": {
            "id": batch.id,
            "status": batch.status,
            "source_type": batch.source_type,
            "filename": batch.filename,
        },
    }
