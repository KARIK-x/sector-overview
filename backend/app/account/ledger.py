from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DailySummary, Security
from .calendar import nepal_today
from .fees import ZERO, cgt_rate, money
from .models import (
    AccountVault,
    PriceOverride,
    Transaction,
    TransactionBill,
)


@dataclass
class Lot:
    acquired: date
    qty: Decimal
    unit_cost: Decimal


@dataclass
class SymbolState:
    symbol: str
    name: str | None = None
    qty: Decimal = ZERO
    cost: Decimal = ZERO
    realized: Decimal = ZERO
    charges: Decimal = ZERO
    lots: list[Lot] = field(default_factory=list)
    oversold: bool = False

    @property
    def avg_cost(self) -> Decimal | None:
        return money(self.cost / self.qty) if self.qty > 0 else None


def _as_decimal(value: Decimal | float | int | str | None) -> Decimal:
    if value is None:
        return ZERO
    return Decimal(str(value))


def _sold_periods(state: SymbolState, sold_qty: Decimal, trade_date: date) -> tuple[Decimal, Decimal]:
    """Split sold quantity into long/short portions using FIFO lot dates.

    Cost basis remains WACC; FIFO is used only to identify which shares crossed
    the 365-day holding-period boundary.  That distinction is explicit in the
    tax snapshot and is marked estimated when a sale spans both periods.
    """
    remaining = sold_qty
    long_qty = ZERO
    short_qty = ZERO
    for lot in state.lots:
        if remaining <= 0:
            break
        take = min(lot.qty, remaining)
        if (trade_date - lot.acquired).days > 365:
            long_qty += take
        else:
            short_qty += take
        remaining -= take
    return long_qty, short_qty


def _consume_lots(state: SymbolState, sold_qty: Decimal) -> None:
    remaining = sold_qty
    new_lots: list[Lot] = []
    for lot in state.lots:
        if remaining <= 0:
            new_lots.append(lot)
            continue
        if lot.qty <= remaining:
            remaining -= lot.qty
            continue
        new_lots.append(Lot(lot.acquired, lot.qty - remaining, lot.unit_cost))
        remaining = ZERO
    state.lots = new_lots


def _snapshot_with_tax(existing: dict | None, tax: dict | None) -> dict:
    snapshot = dict(existing or {})
    if "charges" not in snapshot:
        snapshot["charges"] = []
    snapshot["tax"] = tax
    return snapshot


def walk_ledger(
    session: Session,
    vault: AccountVault,
    transactions: list[Transaction],
    *,
    apply_updates: bool = True,
) -> dict[str, SymbolState]:
    states: dict[str, SymbolState] = {}
    ordered = sorted(
        transactions,
        key=lambda tx: (tx.trade_date, tx.bill_id, tx.line_no, tx.id or 0),
    )
    for tx in ordered:
        if tx.status == "REVERSED":
            continue
        symbol = tx.symbol.upper()
        state = states.setdefault(symbol, SymbolState(symbol=symbol, name=tx.security_name))
        quantity = _as_decimal(tx.quantity)
        gross = _as_decimal(tx.gross_amount)
        charges = _as_decimal(tx.total_charges)
        state.charges += charges

        if tx.side == "BUY":
            cost = gross + charges
            state.qty += quantity
            state.cost += cost
            if quantity > 0:
                state.lots.append(
                    Lot(
                        acquired=tx.trade_date,
                        qty=quantity,
                        unit_cost=money(cost / quantity),
                    )
                )
            if apply_updates:
                tx.cost_basis = None
                tx.cgt = ZERO
                tx.realized_pnl = None
                tx.net_amount = money(cost)
                tx.fee_snapshot_json = _snapshot_with_tax(tx.fee_snapshot_json, None)
            continue

        # SELL
        available = state.qty
        sold = min(quantity, available) if available > 0 else ZERO
        net_before_tax = money(gross - charges)
        tax_snapshot: dict | None = None
        status = tx.reconciliation_status
        if sold <= 0 or available <= 0:
            state.oversold = True
            cost_basis = None
            cgt = ZERO
            realized = None
            status = "AWAITING_INFO"
            tax_snapshot = {
                "status": "AWAITING_COST_BASIS",
                "message": "No open BUY lot is available for this sale.",
            }
        else:
            avg = state.cost / available
            cost_basis = money(avg * sold)
            long_qty, short_qty = _sold_periods(state, sold, tx.trade_date)
            gain = money(net_before_tax - cost_basis)
            cgt = ZERO
            tax_status = "CALCULATED"
            tax_rules: list[dict] = []
            if gain > 0 and sold > 0:
                long_rate, long_rule = cgt_rate(
                    session,
                    trade_date=tx.trade_date,
                    investor_category=vault.investor_category,
                    holding_period="LONG",
                )
                short_rate, short_rule = cgt_rate(
                    session,
                    trade_date=tx.trade_date,
                    investor_category=vault.investor_category,
                    holding_period="SHORT",
                )
                pieces = []
                if long_qty > 0:
                    if long_rate is None:
                        tax_status = "RULE_NOT_VERIFIED"
                    else:
                        pieces.append((gain * long_qty / sold, long_rate))
                        if long_rule:
                            tax_rules.append(_tax_rule_snapshot(long_rule, long_rate, long_qty))
                if short_qty > 0:
                    if short_rate is None:
                        tax_status = "RULE_NOT_VERIFIED"
                    else:
                        pieces.append((gain * short_qty / sold, short_rate))
                        if short_rule:
                            tax_rules.append(_tax_rule_snapshot(short_rule, short_rate, short_qty))
                if long_qty > 0 and short_qty > 0:
                    tax_status = "ESTIMATED_MIXED_HOLDING"
                if tax_status != "RULE_NOT_VERIFIED":
                    cgt = money(sum((piece * rate for piece, rate in pieces), ZERO))
            elif gain <= 0:
                tax_status = "NO_TAXABLE_GAIN"
            realized = money(net_before_tax - cgt - cost_basis)
            state.realized += realized
            tax_snapshot = {
                "status": tax_status,
                "long_quantity": str(long_qty),
                "short_quantity": str(short_qty),
                "gain": f"{gain:.2f}",
                "rules": tax_rules,
            }
            if tax_status == "RULE_NOT_VERIFIED":
                status = "RULE_NOT_VERIFIED"
            else:
                status = "ESTIMATED"
            state.qty -= sold
            state.cost -= cost_basis
            _consume_lots(state, sold)
            if quantity > sold:
                state.oversold = True
                status = "AWAITING_INFO"

        if apply_updates:
            tx.cost_basis = cost_basis
            tx.cgt = money(cgt)
            tx.realized_pnl = realized
            tx.net_amount = money(net_before_tax - cgt)
            tx.reconciliation_status = status
            tx.fee_snapshot_json = _snapshot_with_tax(tx.fee_snapshot_json, tax_snapshot)

    return states


def _tax_rule_snapshot(rule, rate: Decimal, quantity: Decimal) -> dict:
    return {
        "code": rule.code,
        "version": rule.version,
        "description": rule.description,
        "rate": str(rate),
        "quantity": str(quantity),
        "source_title": rule.source_title,
        "source_url": rule.source_url,
        "verification": rule.verification,
        "effective_from": rule.effective_from.isoformat(),
        "effective_to": rule.effective_to.isoformat() if rule.effective_to else None,
    }


def recompute_vault_ledger(session: Session, vault: AccountVault) -> None:
    transactions = list(
        session.scalars(
            select(Transaction)
            .where(
                Transaction.vault_id == vault.id,
                Transaction.status != "REVERSED",
            )
            .order_by(Transaction.trade_date, Transaction.bill_id, Transaction.line_no)
        ).all()
    )
    walk_ledger(session, vault, transactions, apply_updates=True)
    session.flush()
    _update_bills(session, vault)


def _update_bills(session: Session, vault: AccountVault) -> None:
    bills = session.scalars(
        select(TransactionBill).where(TransactionBill.vault_id == vault.id)
    ).all()
    for bill in bills:
        lines = list(
            session.scalars(
                select(Transaction).where(Transaction.bill_id == bill.id)
            ).all()
        )
        active = [line for line in lines if line.status != "REVERSED"]
        if not active:
            bill.gross_amount = ZERO
            bill.charges_total = ZERO
            bill.cgt_total = ZERO
            bill.calculated_total = ZERO
            bill.cash_amount = ZERO
            bill.reconciliation_status = "REVERSED"
            bill.status = "REVERSED"
            continue
        gross = money(sum((_as_decimal(line.gross_amount) for line in active), ZERO))
        charges = money(sum((_as_decimal(line.total_charges) for line in active), ZERO))
        cgt = money(sum((_as_decimal(line.cgt) for line in active), ZERO))
        if bill.side == "BUY":
            calculated = money(gross + charges)
            cash = money(bill.bamt) if bill.bamt is not None else calculated
        else:
            calculated = money(gross - charges - cgt)
            cash = calculated
        statuses = {line.reconciliation_status for line in active}
        if "RULE_NOT_VERIFIED" in statuses:
            reconciliation = "RULE_NOT_VERIFIED"
        elif "AWAITING_INFO" in statuses:
            reconciliation = "AWAITING_INFO"
        elif bill.side == "BUY" and bill.bamt is not None:
            diff = money(bill.bamt - calculated)
            reconciliation = "MATCHED" if abs(diff) <= Decimal("0.05") else "DIFFERENCE"
        else:
            reconciliation = "ESTIMATED"
        bill.gross_amount = gross
        bill.charges_total = charges
        bill.cgt_total = cgt
        bill.calculated_total = calculated
        bill.cash_amount = cash
        bill.reconciliation_status = reconciliation
        if any(line.status == "NEEDS_REVIEW" for line in active):
            bill.status = "NEEDS_REVIEW"
        else:
            bill.status = "IMPORTED"
    session.flush()


def _latest_market_price(
    session: Session, vault_id: str, symbol: str, as_of: date
) -> tuple[Decimal | None, date | None, str | None, bool]:
    override = session.scalar(
        select(PriceOverride)
        .where(
            PriceOverride.vault_id == vault_id,
            PriceOverride.symbol == symbol,
            PriceOverride.as_of <= as_of,
        )
        .order_by(PriceOverride.as_of.desc(), PriceOverride.id.desc())
    )
    if override is not None:
        return _as_decimal(override.price), override.as_of, "MANUAL", True
    row = session.scalar(
        select(DailySummary)
        .where(
            DailySummary.symbol == symbol,
            DailySummary.trade_date <= as_of,
            DailySummary.close.is_not(None),
        )
        .order_by(DailySummary.trade_date.desc())
        .limit(1)
    )
    if row is None or row.close is None:
        return None, None, None, False
    return _as_decimal(row.close), row.trade_date, "NEPSE_DAILY_SUMMARY", False


def build_holdings(
    session: Session,
    vault: AccountVault,
    *,
    as_of: date | None = None,
    include_closed: bool = False,
) -> dict:
    as_of = as_of or nepal_today()
    conditions = [
        Transaction.vault_id == vault.id,
        Transaction.status != "REVERSED",
    ]
    if as_of is not None:
        conditions.append(Transaction.trade_date <= as_of)
    transactions = list(
        session.scalars(
            select(Transaction)
            .where(*conditions)
            .order_by(Transaction.trade_date, Transaction.bill_id, Transaction.line_no)
        ).all()
    )
    states = walk_ledger(session, vault, transactions, apply_updates=False)
    rows = []
    total_cost = ZERO
    total_market = ZERO
    total_unrealized = ZERO
    total_realized = ZERO
    total_charges = ZERO
    for state in sorted(states.values(), key=lambda s: s.symbol):
        is_open = state.qty > 0
        if not is_open and not include_closed:
            total_realized += state.realized
            total_charges += state.charges
            continue
        price, price_date, price_source, manual = _latest_market_price(
            session, vault.id, state.symbol, as_of
        )
        market_value = money(state.qty * price) if price is not None and is_open else ZERO
        unrealized = money(market_value - state.cost) if price is not None and is_open else None
        earliest = min((lot.acquired for lot in state.lots), default=None)
        holding_days = (as_of - earliest).days if earliest else None
        security = session.get(Security, state.symbol)
        name = state.name or (security.name if security else None)
        status = "OPEN" if is_open else "CLOSED"
        if is_open and price is None:
            status = "NO_MARKET_PRICE"
        if state.oversold:
            status = "COST_BASIS_INCOMPLETE"
        rows.append(
            {
                "symbol": state.symbol,
                "name": name,
                "quantity": str(state.qty),
                "avg_cost": f"{state.avg_cost:.2f}" if state.avg_cost is not None else None,
                "cost_basis": f"{state.cost:.2f}",
                "market_price": f"{price:.2f}" if price is not None else None,
                "market_price_date": price_date.isoformat() if price_date else None,
                "market_price_source": price_source,
                "market_value": f"{market_value:.2f}" if price is not None else None,
                "unrealized_pnl": f"{unrealized:.2f}" if unrealized is not None else None,
                "realized_pnl": f"{state.realized:.2f}",
                "charges": f"{state.charges:.2f}",
                "holding_days": holding_days,
                "earliest_lot": earliest.isoformat() if earliest else None,
                "status": status,
            }
        )
        total_cost += state.cost
        total_market += market_value
        total_realized += state.realized
        total_charges += state.charges
        if unrealized is not None:
            total_unrealized += unrealized
    return {
        "as_of": as_of.isoformat(),
        "method": "WACC",
        "holding_period_basis": "FIFO lots used only to split long/short tax periods; cost basis is weighted average.",
        "rows": rows,
        "summary": {
            "open_positions": sum(1 for row in rows if row["status"] != "CLOSED"),
            "cost_basis": f"{total_cost:.2f}",
            "market_value": f"{total_market:.2f}" if total_market else None,
            "unrealized_pnl": f"{total_unrealized:.2f}" if total_unrealized else None,
            "realized_pnl": f"{total_realized:.2f}",
            "charges": f"{total_charges:.2f}",
        },
        "notes": [
            "WACC includes buy-side transaction charges in the cost of the position.",
            "Market prices come from the latest stored NEPSE daily summary, or a manually entered override when no reliable close is available.",
            "Unrealized gains are not cash and are not included in the cash-flow schedule.",
            "CGT losses are not carried forward by this ledger; review the tax estimate with a professional.",
        ],
    }
