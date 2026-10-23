from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import Security
from .models import FeeRule

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def money(value: Decimal | int | str | None) -> Decimal:
    if value is None:
        return ZERO
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def _rate(value: Any) -> Decimal:
    return Decimal(str(value))


def _bracket_max(bracket: dict[str, Any]) -> Decimal | None:
    raw = bracket.get("max")
    return None if raw is None else Decimal(str(raw))


@dataclass
class ChargeLine:
    line_no: int
    symbol: str
    security_type: str = "EQUITY"
    security_name: str | None = None
    gross: Decimal = ZERO
    commission: Decimal = ZERO
    sebon_fee: Decimal = ZERO
    dp_charge: Decimal = ZERO
    other_charges: Decimal = ZERO

    @property
    def total_charges(self) -> Decimal:
        return money(
            self.commission + self.sebon_fee + self.dp_charge + self.other_charges
        )


@dataclass
class BillCharges:
    lines: list[ChargeLine]
    gross: Decimal = ZERO
    commission: Decimal = ZERO
    sebon_fee: Decimal = ZERO
    dp_charge: Decimal = ZERO
    other_charges: Decimal = ZERO
    status: str = "ESTIMATED"
    warnings: list[str] = field(default_factory=list)
    snapshot: list[dict[str, Any]] = field(default_factory=list)
    version: str | None = None

    @property
    def total_charges(self) -> Decimal:
        return money(
            self.commission + self.sebon_fee + self.dp_charge + self.other_charges
        )


SECURITY_TYPE_MAP = {
    "ordinary": "EQUITY",
    "promoter_share": "EQUITY",
    "mutual_fund": "MUTUAL_FUND",
    "debenture": "CORPORATE_DEBENTURE",
    "government_bond": "GOVERNMENT_BOND",
}


def security_meta(session: Session, symbol: str) -> tuple[str, str | None]:
    row = session.get(Security, symbol.upper())
    if row is None:
        return "EQUITY", None
    return SECURITY_TYPE_MAP.get((row.instrument_type or "").lower(), "EQUITY"), row.name


def _rule_for(
    session: Session,
    *,
    prefix: str,
    trade_date: date,
    security_type: str,
    investor_category: str,
    side: str,
    holding_period: str = "ANY",
) -> FeeRule | None:
    rules = session.scalars(
        select(FeeRule)
        .where(
            FeeRule.code.like(f"{prefix}%"),
            FeeRule.effective_from <= trade_date,
            or_(FeeRule.effective_to.is_(None), FeeRule.effective_to >= trade_date),
            FeeRule.transaction_type.in_((side, "BOTH")),
            FeeRule.security_type.in_((security_type, "ANY")),
            FeeRule.investor_category.in_((investor_category, "ANY")),
            FeeRule.holding_period.in_((holding_period, "ANY")),
        )
        .order_by(FeeRule.effective_from.desc(), FeeRule.id.desc())
    ).all()
    if not rules:
        return None
    # Prefer an exact security/investor holding match over an ANY fallback.
    def specificity(rule: FeeRule) -> tuple[int, int, int]:
        return (
            0 if rule.security_type == security_type else 1,
            0 if rule.investor_category == investor_category else 1,
            0 if rule.holding_period == holding_period else 1,
        )

    return sorted(rules, key=specificity)[0]


def _apply_rule(rule: FeeRule | None, amount: Decimal) -> Decimal:
    if rule is None:
        return ZERO
    if rule.calculation == "FLAT":
        value = money(rule.rate or 0)
    elif rule.calculation == "TIERED":
        brackets = sorted(
            rule.brackets or [],
            key=lambda b: Decimal(str(b.get("min", 0))),
        )
        chosen = None
        for bracket in brackets:
            upper = _bracket_max(bracket)
            if upper is None or amount <= upper:
                chosen = bracket
                break
        value = money(amount * _rate(chosen.get("rate", 0))) if chosen else ZERO
    else:
        value = money(amount * (rule.rate or 0))
    if rule.minimum is not None:
        value = max(value, money(rule.minimum))
    if rule.maximum is not None:
        value = min(value, money(rule.maximum))
    return money(value)


def _snapshot(
    rule: FeeRule | None, applied: Decimal, label: str
) -> dict[str, Any] | None:
    if rule is None:
        return None
    return {
        "label": label,
        "code": rule.code,
        "version": rule.version,
        "description": rule.description,
        "source_title": rule.source_title,
        "source_url": rule.source_url,
        "verification": rule.verification,
        "effective_from": rule.effective_from.isoformat(),
        "effective_to": rule.effective_to.isoformat() if rule.effective_to else None,
        "calculation": rule.calculation,
        "rate": str(rule.rate) if rule.rate is not None else None,
        "brackets": rule.brackets,
        "minimum": str(rule.minimum) if rule.minimum is not None else None,
        "applied": f"{applied:.2f}",
        "notes": rule.notes,
    }


def _allocate(total: Decimal, lines: list[ChargeLine]) -> list[Decimal]:
    """Allocate a bill-level amount pro-rata by gross, with cent reconciliation.

    Rounding each line independently can over-allocate a tiny bill-level amount
    (for example, six equal lines sharing NPR 0.03).  A negative "correction" on
    the last line then produces a negative charge.  Allocate whole cents from a
    floor and give the remaining cents to the largest fractional remainders, so
    every line stays non-negative and the parts always add back to ``total``.
    """
    if not lines:
        return []
    gross_total = sum((line.gross for line in lines), ZERO)
    if gross_total <= 0:
        return [ZERO for _ in lines]

    total = money(total)
    exact = [total * line.gross / gross_total for line in lines]
    allocated = [value.quantize(CENT, rounding=ROUND_DOWN) for value in exact]
    remaining_cents = int((total - sum(allocated, ZERO)) / CENT)
    if remaining_cents > 0:
        order = sorted(
            range(len(lines)),
            key=lambda index: (exact[index] - allocated[index], lines[index].gross),
            reverse=True,
        )
        for index in order[:remaining_cents]:
            allocated[index] = money(allocated[index] + CENT)
    return allocated


def calculate_bill_charges(
    session: Session,
    *,
    side: str,
    trade_date: date,
    investor_category: str,
    lines: Iterable[dict[str, Any]],
) -> BillCharges:
    """Calculate transaction charges for one broker bill.

    The commission rule is applied to the bill's aggregate gross value, then
    allocated pro-rata across scrips.  DP charge is per distinct scrip per
    settlement, not per line.  This matches the broker's bill-level BAmt
    presentation and avoids charging a multi-scrip SMS as several bills.
    """
    charge_lines: list[ChargeLine] = []
    for raw in lines:
        symbol = str(raw["symbol"]).upper()
        security_type, security_name = security_meta(session, symbol)
        quantity = Decimal(str(raw["quantity"]))
        price = Decimal(str(raw["price"]))
        gross = money(quantity * price)
        charge_lines.append(
            ChargeLine(
                line_no=int(raw.get("line_no", len(charge_lines))),
                symbol=symbol,
                security_type=security_type,
                security_name=security_name,
                gross=gross,
            )
        )
    result = BillCharges(
        lines=charge_lines,
        gross=money(sum((line.gross for line in charge_lines), ZERO)),
    )
    if not charge_lines:
        result.warnings.append("NO_SECURITY_LINES")
        result.status = "RULE_NOT_VERIFIED"
        return result

    security_types = {line.security_type for line in charge_lines}
    commission_rule = None
    sebon_rule = None
    for security_type in security_types:
        c_rule = _rule_for(
            session,
            prefix="BROKER_COMMISSION_",
            trade_date=trade_date,
            security_type=security_type,
            investor_category=investor_category,
            side=side,
        )
        s_rule = _rule_for(
            session,
            prefix="SEBON_FEE_",
            trade_date=trade_date,
            security_type=security_type,
            investor_category=investor_category,
            side=side,
        )
        if charge_lines[0].security_type == security_type:
            commission_rule, sebon_rule = c_rule, s_rule
        if c_rule is None:
            result.warnings.append(f"BROKER_COMMISSION_RULE_MISSING:{security_type}")
        if s_rule is None:
            result.warnings.append(f"SEBON_FEE_RULE_MISSING:{security_type}")

    # A mixed-security bill is uncommon in NEPSE SMS messages.  Use the first
    # security's rule for the bill-level commission and explicitly flag it.
    if len(security_types) > 1:
        result.warnings.append("MIXED_SECURITY_TYPES")

    result.commission = _apply_rule(commission_rule, result.gross)
    result.sebon_fee = _apply_rule(sebon_rule, result.gross)
    dp_rule = _rule_for(
        session,
        prefix="DP_CHARGE_",
        trade_date=trade_date,
        security_type=charge_lines[0].security_type,
        investor_category=investor_category,
        side=side,
    )
    if dp_rule is None:
        result.warnings.append("DP_CHARGE_RULE_MISSING")
        result.dp_charge = ZERO
    else:
        unique_symbols = len({line.symbol for line in charge_lines})
        result.dp_charge = money((dp_rule.rate or 0) * unique_symbols)

    commission_split = _allocate(result.commission, charge_lines)
    sebon_split = _allocate(result.sebon_fee, charge_lines)
    dp_seen: set[str] = set()
    for index, line in enumerate(charge_lines):
        line.commission = commission_split[index]
        line.sebon_fee = sebon_split[index]
        if line.symbol not in dp_seen and dp_rule is not None:
            line.dp_charge = money(dp_rule.rate or 0)
            dp_seen.add(line.symbol)

    result.snapshot = [
        s
        for s in (
            _snapshot(commission_rule, result.commission, "Broker/exchange commission"),
            _snapshot(sebon_rule, result.sebon_fee, "SEBON transaction fee"),
            _snapshot(dp_rule, result.dp_charge, "DP charge"),
        )
        if s is not None
    ]
    versions = sorted({s["version"] for s in result.snapshot if s.get("version")})
    result.version = ",".join(versions) if versions else None

    verifications = {s["verification"] for s in result.snapshot}
    if result.warnings and any("MISSING" in w for w in result.warnings):
        result.status = "RULE_NOT_VERIFIED"
    elif "UNVERIFIED" in verifications:
        result.status = "RULE_NOT_VERIFIED"
    elif "PARTIAL" in verifications or result.warnings:
        result.status = "ESTIMATED"
    else:
        result.status = "CALCULATED"
    return result


def cgt_rule(
    session: Session,
    *,
    trade_date: date,
    investor_category: str,
    holding_period: str,
) -> FeeRule | None:
    return _rule_for(
        session,
        prefix="CGT_",
        trade_date=trade_date,
        security_type="EQUITY",
        investor_category=investor_category,
        side="SELL",
        holding_period=holding_period,
    )


def cgt_rate(
    session: Session,
    *,
    trade_date: date,
    investor_category: str,
    holding_period: str,
) -> tuple[Decimal | None, FeeRule | None]:
    rule = cgt_rule(
        session,
        trade_date=trade_date,
        investor_category=investor_category,
        holding_period=holding_period,
    )
    if rule is None or rule.rate is None:
        return None, None
    return Decimal(str(rule.rate)), rule


DEFAULT_FEE_RULES: list[dict[str, Any]] = [
    {
        "code": "BROKER_COMMISSION_EQUITY",
        "version": "SEBON-2081-05-14",
        "description": "Equity brokerage commission, headline rate including NEPSE exchange and SEBON regulatory components.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "EQUITY",
        "investor_category": "ANY",
        "calculation": "TIERED",
        "brackets": [
            {"min": 0, "max": 50000, "rate": 0.0036},
            {"min": 50000, "max": 500000, "rate": 0.0033},
            {"min": 500000, "max": 2000000, "rate": 0.0031},
            {"min": 2000000, "max": 10000000, "rate": 0.0027},
            {"min": 10000000, "max": None, "rate": 0.0024},
        ],
        "minimum": Decimal("10.00"),
        "rounding": "HALF_UP",
        "source_title": "Licensed NEPSE broker rate cards (Imperial Securities, Sun Securities, Sri Hari Securities, Sanima Securities)",
        "source_url": "https://imperialsecurities.com.np/services/stock-brokerage-service-1",
        "verification": "VERIFIED",
        "notes": "The headline 0.36%-0.24% rate is the total commission: 79.4% broker commission, 20% NEPSE exchange commission and 0.6% SEBON regulatory fee. The separate 0.015% SEBON transaction fee is stored in SEBON_FEE_EQUITY and is not double-counted here. Minimum NPR 10.",
    },
    {
        "code": "BROKER_COMMISSION_MUTUAL_FUND",
        "version": "SEBON-2081-05-14-MF",
        "description": "Mutual fund / closed-end fund brokerage commission.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "MUTUAL_FUND",
        "investor_category": "ANY",
        "calculation": "TIERED",
        "brackets": [
            {"min": 0, "max": 500000, "rate": 0.0015},
            {"min": 500000, "max": 5000000, "rate": 0.0012},
            {"min": 5000000, "max": None, "rate": 0.0010},
        ],
        "minimum": Decimal("10.00"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate card (Sri Hari Securities; Imperial Securities)",
        "source_url": "https://sriharisecurities.com.np/post/pricing",
        "verification": "VERIFIED",
        "notes": "Separate SEBON transaction fee is 0.010% for mutual fund units.",
    },
    {
        "code": "BROKER_COMMISSION_CORPORATE_DEBENTURE",
        "version": "SEBON-2081-05-14-DEB",
        "description": "Corporate bond / debenture brokerage commission.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "CORPORATE_DEBENTURE",
        "investor_category": "ANY",
        "calculation": "TIERED",
        "brackets": [
            {"min": 0, "max": 500000, "rate": 0.0010},
            {"min": 500000, "max": 5000000, "rate": 0.0005},
            {"min": 5000000, "max": None, "rate": 0.0002},
        ],
        "minimum": Decimal("10.00"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate card (Imperial Securities; Sri Hari Securities)",
        "source_url": "https://imperialsecurities.com.np/services/stock-brokerage-service-1",
        "verification": "VERIFIED",
        "notes": "Separate SEBON transaction fee is 0.010% for corporate debentures.",
    },
    {
        "code": "BROKER_COMMISSION_GOVERNMENT_BOND",
        "version": "SEBON-2081-05-14-GOV",
        "description": "Government / NRB / government-guaranteed bond brokerage commission.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "GOVERNMENT_BOND",
        "investor_category": "ANY",
        "calculation": "TIERED",
        "brackets": [
            {"min": 0, "max": 500000, "rate": 0.0010},
            {"min": 500000, "max": 5000000, "rate": 0.0005},
            {"min": 5000000, "max": None, "rate": 0.0002},
        ],
        "minimum": Decimal("10.00"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate card (Imperial Securities; Sri Hari Securities)",
        "source_url": "https://imperialsecurities.com.np/services/stock-brokerage-service-1",
        "verification": "PARTIAL",
        "notes": "The broker rate cards group government-guaranteed and corporate bonds; the 0.005% SEBON fee is from the same disclosures. Confirm the exact instrument classification with the broker.",
    },
    {
        "code": "SEBON_FEE_EQUITY",
        "version": "SEBON-2081-05-14-SEBON-EQ",
        "description": "SEBON transaction fee on equity trades.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "EQUITY",
        "investor_category": "ANY",
        "calculation": "PERCENT",
        "rate": Decimal("0.00015"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate cards (Imperial Securities, Sun Securities, Sri Hari Securities)",
        "source_url": "http://ssl.com.np/trading-commission-and-fees",
        "verification": "VERIFIED",
        "notes": "0.015% of transaction value, applicable on both BUY and SELL. This is additional to the NEPSE/SEBON component embedded in the headline commission rate.",
    },
    {
        "code": "SEBON_FEE_MUTUAL_FUND",
        "version": "SEBON-2081-05-14-SEBON-MF",
        "description": "SEBON transaction fee on mutual fund units.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "MUTUAL_FUND",
        "investor_category": "ANY",
        "calculation": "PERCENT",
        "rate": Decimal("0.00010"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate card (Imperial Securities; Sri Hari Securities)",
        "source_url": "https://imperialsecurities.com.np/services/stock-brokerage-service-1",
        "verification": "VERIFIED",
        "notes": "0.010% of transaction value.",
    },
    {
        "code": "SEBON_FEE_CORPORATE_DEBENTURE",
        "version": "SEBON-2081-05-14-SEBON-DEB",
        "description": "SEBON transaction fee on corporate debentures.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "CORPORATE_DEBENTURE",
        "investor_category": "ANY",
        "calculation": "PERCENT",
        "rate": Decimal("0.00010"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate card (Imperial Securities; Sri Hari Securities)",
        "source_url": "https://imperialsecurities.com.np/services/stock-brokerage-service-1",
        "verification": "VERIFIED",
        "notes": "0.010% of transaction value for corporate debentures.",
    },
    {
        "code": "SEBON_FEE_GOVERNMENT_BOND",
        "version": "SEBON-2081-05-14-SEBON-GOV",
        "description": "SEBON transaction fee on government / other securities.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "GOVERNMENT_BOND",
        "investor_category": "ANY",
        "calculation": "PERCENT",
        "rate": Decimal("0.00005"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate card (Imperial Securities)",
        "source_url": "https://imperialsecurities.com.np/services/stock-brokerage-service-1",
        "verification": "PARTIAL",
        "notes": "0.005% of transaction value for government / other securities. Confirm classification with the broker.",
    },
    {
        "code": "DP_CHARGE_ANY",
        "version": "CDSC-DP-2081",
        "description": "DP transaction charge per distinct scrip per transfer day.",
        "effective_from": date(2024, 5, 14),
        "transaction_type": "BOTH",
        "security_type": "ANY",
        "investor_category": "ANY",
        "calculation": "FLAT",
        "rate": Decimal("25.00"),
        "rounding": "HALF_UP",
        "source_title": "Licensed broker rate cards (Imperial Securities, Sun Securities, Sri Hari Securities)",
        "source_url": "http://ssl.com.np/trading-commission-and-fees",
        "verification": "VERIFIED",
        "notes": "NPR 25 per stock/company per transfer day, collected through the broker. Your DP may vary this; verify your contract note.",
    },
    {
        "code": "CGT_INDIVIDUAL_LONG_LEGACY",
        "version": "ITA-2058-LONG",
        "description": "Resident individual capital gains tax, listed shares held more than 365 days (legacy schedule).",
        "effective_from": date(2000, 1, 1),
        "effective_to": date(2025, 7, 16),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "RESIDENT_INDIVIDUAL",
        "holding_period": "LONG",
        "calculation": "PERCENT",
        "rate": Decimal("0.05"),
        "rounding": "HALF_UP",
        "source_title": "Income Tax Act 2058; historical listed-share CGT schedule",
        "source_url": "https://www.ird.gov.np/content/13632/economic-act--2083---information-booklet-on",
        "verification": "VERIFIED",
        "notes": "Applies to gains on listed shares held more than 365 days. Losses are not carried forward by this ledger.",
    },
    {
        "code": "CGT_INDIVIDUAL_SHORT_LEGACY",
        "version": "ITA-2058-SHORT",
        "description": "Resident individual capital gains tax, listed shares held 365 days or less (legacy schedule).",
        "effective_from": date(2000, 1, 1),
        "effective_to": date(2025, 7, 16),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "RESIDENT_INDIVIDUAL",
        "holding_period": "SHORT",
        "calculation": "PERCENT",
        "rate": Decimal("0.075"),
        "rounding": "HALF_UP",
        "source_title": "Income Tax Act 2058; historical listed-share CGT schedule",
        "source_url": "https://www.ird.gov.np/content/13632/economic-act--2083---information-booklet-on",
        "verification": "VERIFIED",
        "notes": "Applies to gains on listed shares held 365 days or less. Losses are not carried forward by this ledger.",
    },
    {
        "code": "CGT_INDIVIDUAL_LONG_2082",
        "version": "ITA-2082-LONG",
        "description": "Resident individual capital gains tax, listed shares held more than 365 days, FY 2082/83.",
        "effective_from": date(2025, 7, 17),
        "effective_to": date(2026, 7, 16),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "RESIDENT_INDIVIDUAL",
        "holding_period": "LONG",
        "calculation": "PERCENT",
        "rate": Decimal("0.05"),
        "rounding": "HALF_UP",
        "source_title": "Income Tax Act 2058; FY 2082/83 listed-share CGT schedule",
        "source_url": "https://www.fiscalnepal.com/2026/07/16/26974/new-cgt-rates-on-shares-real-estate-take-effect-friday",
        "verification": "VERIFIED",
        "notes": "Held more than 365 days. Losses are not carried forward by this ledger.",
    },
    {
        "code": "CGT_INDIVIDUAL_SHORT_2082",
        "version": "ITA-2082-SHORT",
        "description": "Resident individual capital gains tax, listed shares held 365 days or less, FY 2082/83.",
        "effective_from": date(2025, 7, 17),
        "effective_to": date(2026, 7, 16),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "RESIDENT_INDIVIDUAL",
        "holding_period": "SHORT",
        "calculation": "PERCENT",
        "rate": Decimal("0.075"),
        "rounding": "HALF_UP",
        "source_title": "Income Tax Act 2058; FY 2082/83 listed-share CGT schedule",
        "source_url": "https://www.fiscalnepal.com/2026/07/16/26974/new-cgt-rates-on-shares-real-estate-take-effect-friday",
        "verification": "VERIFIED",
        "notes": "Held 365 days or less. Losses are not carried forward by this ledger.",
    },
    {
        "code": "CGT_INDIVIDUAL_LONG_2083",
        "version": "ITA-2083-LONG",
        "description": "Resident individual capital gains tax, listed shares held more than 365 days, FY 2083/84.",
        "effective_from": date(2026, 7, 17),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "RESIDENT_INDIVIDUAL",
        "holding_period": "LONG",
        "calculation": "PERCENT",
        "rate": Decimal("0.075"),
        "rounding": "HALF_UP",
        "source_title": "Finance Act 2083/84; IRD Finance Act booklet",
        "source_url": "https://www.ird.gov.np/content/13632/economic-act--2083---information-booklet-on",
        "verification": "VERIFIED",
        "notes": "Effective Shrawan 1, 2083 (17 July 2026). The September 2026 proposal to halve the rate was not enacted at implementation time.",
    },
    {
        "code": "CGT_INDIVIDUAL_SHORT_2083",
        "version": "ITA-2083-SHORT",
        "description": "Resident individual capital gains tax, listed shares held 365 days or less, FY 2083/84.",
        "effective_from": date(2026, 7, 17),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "RESIDENT_INDIVIDUAL",
        "holding_period": "SHORT",
        "calculation": "PERCENT",
        "rate": Decimal("0.10"),
        "rounding": "HALF_UP",
        "source_title": "Finance Act 2083/84; IRD Finance Act booklet",
        "source_url": "https://www.ird.gov.np/content/13632/economic-act--2083---information-booklet-on",
        "verification": "VERIFIED",
        "notes": "Effective Shrawan 1, 2083 (17 July 2026). The September 2026 proposal to halve the rate was not enacted at implementation time.",
    },
    {
        "code": "CGT_RESIDENT_ENTITY",
        "version": "ITA-ENTITY",
        "description": "Resident entity capital gains tax on listed shares.",
        "effective_from": date(2000, 1, 1),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "RESIDENT_ENTITY",
        "holding_period": "ANY",
        "calculation": "PERCENT",
        "rate": Decimal("0.10"),
        "rounding": "HALF_UP",
        "source_title": "Income Tax Act 2058; IRD listed-share schedule",
        "source_url": "https://www.ird.gov.np/content/13609/tax-rate-for-natural-persons-for-the/",
        "verification": "VERIFIED",
        "notes": "Resident entity rate is flat with respect to holding period.",
    },
    {
        "code": "CGT_NON_RESIDENT",
        "version": "ITA-NONRESIDENT",
        "description": "Non-resident capital gains tax on listed shares (not currently open for secondary-market NEPSE trading).",
        "effective_from": date(2000, 1, 1),
        "transaction_type": "SELL",
        "security_type": "EQUITY",
        "investor_category": "NON_RESIDENT",
        "holding_period": "ANY",
        "calculation": "PERCENT",
        "rate": Decimal("0.25"),
        "rounding": "HALF_UP",
        "source_title": "Income Tax Act 2058; non-resident listed-share rate",
        "source_url": "https://www.ird.gov.np/content/13609/tax-rate-for-natural-persons-for-the/",
        "verification": "PARTIAL",
        "notes": "NRN secondary-market NEPSE trading is not currently open. This rule is present for completeness and is marked partial.",
    },
]


def ensure_default_fee_rules(session: Session) -> None:
    """Insert missing official rules without overwriting an existing revision."""
    existing = set(session.scalars(select(FeeRule.code)).all())
    changed = False
    for spec in DEFAULT_FEE_RULES:
        if spec["code"] in existing:
            continue
        session.add(FeeRule(**spec))
        changed = True
    if changed:
        session.commit()
