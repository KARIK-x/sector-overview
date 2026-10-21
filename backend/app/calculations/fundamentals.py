"""Sector-level fundamental aggregation.

Only fields actually present in the verified source are aggregated. Missing or
negative inputs are excluded from the affected ratio and reported as coverage
gaps; they are never silently replaced with a best/worst value.
"""

from __future__ import annotations

from dataclasses import dataclass, field

PAR_VALUE = 100.0


def book_value_status(company: CompanyFundamental) -> tuple[float | None, str]:
    """Return ``(net_worth_per_share, status)`` for a single company.

    The verified source occasionally publishes a corrupted
    ``net_worth_per_share`` (for example a value an order of magnitude above the
    company's own implied price). Rather than aggregate an implausible book
    value, the value is cross-checked against the price implied by the same
    report (``pe × eps``) and rejected when the implied price-to-book ratio is
    outside a wide plausibility band.

    Status is one of ``ok``, ``implausible`` or ``unverifiable``.
    """
    nwps = company.net_worth_per_share
    if nwps is None or nwps <= 0:
        return None, "missing"
    eps, pe = company.eps, company.pe
    if eps and pe and eps > 0 and pe > 0:
        implied_price = pe * eps
        pb = implied_price / nwps
        if 0.10 <= pb <= 25:
            return nwps, "ok"
        return None, "implausible"
    return nwps, "unverifiable"


@dataclass
class CompanyFundamental:
    symbol: str
    profit: float | None
    paid_up_capital: float | None
    net_worth_per_share: float | None
    eps: float | None
    pe: float | None
    market_cap: float | None
    report_type: str | None
    fiscal_year: str | None
    published_date: object | None


@dataclass
class SectorFundamentals:
    symbols_total: int
    symbols_with_reports: int
    coverage: float
    aggregate_profit: float | None
    aggregate_equity: float | None
    aggregate_market_cap: float | None
    aggregate_pe: float | None
    aggregate_pe_ex_negative: float | None
    aggregate_eps: float | None
    aggregate_roe: float | None
    weighted_net_worth_per_share: float | None
    negative_earnings_symbols: int
    missing_capital_symbols: int
    book_value_symbols: int
    rejected_book_values: int
    notes: list[str] = field(default_factory=list)


def aggregate(companies: list[CompanyFundamental], symbols_total: int) -> SectorFundamentals:
    with_reports = [c for c in companies if c.profit is not None or c.eps is not None]
    profitable = [c for c in with_reports if c.profit is not None and c.profit > 0]
    negative = [c for c in with_reports if c.profit is not None and c.profit < 0]
    missing_capital = [c for c in with_reports if c.paid_up_capital in (None, 0)]

    agg_profit = sum(c.profit for c in with_reports if c.profit is not None)

    # Book value is validated per company before aggregation (see
    # ``book_value_status``). Rejected values are excluded from equity and ROE
    # rather than silently distorting the ratio.
    book_values: list[tuple[CompanyFundamental, float]] = []
    implausible = 0
    unverifiable = 0
    for c in with_reports:
        value, status = book_value_status(c)
        if status == "implausible":
            implausible += 1
            continue
        if status == "unverifiable":
            unverifiable += 1
        if value is not None and c.paid_up_capital not in (None, 0):
            book_values.append((c, value))

    agg_equity = sum(
        value * (c.paid_up_capital / PAR_VALUE) for c, value in book_values
    )
    agg_mcap = sum(c.market_cap for c in companies if c.market_cap is not None)
    shares = sum(c.paid_up_capital / PAR_VALUE for c in with_reports if c.paid_up_capital)
    agg_eps = agg_profit / shares if shares else None

    # Aggregate P/E is the market cap divided by total earnings, including
    # loss-making members (their negative profit reduces the denominator). It is
    # suppressed only when total earnings are non-positive. A second variant
    # that excludes loss-making members is also reported so the effect of losses
    # is visible rather than hidden.
    agg_pe = None
    agg_pe_ex = None
    if agg_profit > 0 and agg_mcap > 0:
        agg_pe = agg_mcap / agg_profit
    profitable_mcap = sum(
        c.market_cap for c in profitable if c.market_cap is not None
    )
    profitable_profit = sum(c.profit for c in profitable if c.profit is not None)
    if profitable_profit > 0 and profitable_mcap > 0:
        agg_pe_ex = profitable_mcap / profitable_profit

    agg_roe = agg_profit / agg_equity if agg_equity > 0 and agg_profit is not None else None

    weighted_nw = None
    if agg_equity and agg_equity > 0:
        weighted_nw = agg_equity / shares if shares else None

    notes = []
    if negative:
        notes.append(
            f"{len(negative)} symbols have negative earnings; aggregate P/E includes their losses in the denominator."
        )
    if missing_capital:
        notes.append(f"{len(missing_capital)} symbols lack paid-up capital; EPS/ROE coverage reduced.")
    if implausible:
        notes.append(
            f"{implausible} symbols published an implausible net worth per share and were excluded from equity/ROE."
        )
    if unverifiable:
        notes.append(
            f"{unverifiable} symbols could not be cross-checked (no positive EPS and P/E); their book value is included but unverified."
        )
    if agg_profit is not None and agg_profit <= 0:
        notes.append("Aggregate earnings are non-positive; aggregate P/E is unavailable.")
    if not with_reports:
        notes.append("No verified fundamental reports are available for this sector.")

    return SectorFundamentals(
        symbols_total=symbols_total,
        symbols_with_reports=len(with_reports),
        coverage=(len(with_reports) / symbols_total) if symbols_total else 0.0,
        aggregate_profit=agg_profit if with_reports else None,
        aggregate_equity=agg_equity or None,
        aggregate_market_cap=agg_mcap or None,
        aggregate_pe=agg_pe,
        aggregate_pe_ex_negative=agg_pe_ex,
        aggregate_eps=agg_eps,
        aggregate_roe=agg_roe,
        weighted_net_worth_per_share=weighted_nw,
        negative_earnings_symbols=len(negative),
        missing_capital_symbols=len(missing_capital),
        book_value_symbols=len(book_values),
        rejected_book_values=implausible,
        notes=notes,
    )
