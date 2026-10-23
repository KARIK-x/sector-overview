from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone
from typing import Any

NEPAL_TZ = timezone(timedelta(hours=5, minutes=45))


def nepal_today() -> date:
    return datetime.now(NEPAL_TZ).date()


def nepal_now() -> datetime:
    return datetime.now(NEPAL_TZ).replace(tzinfo=None)


# NEPSE changed from a Sunday-Thursday trading week to Monday-Friday on
# 6 April 2026.  Hard-coding either week for every historical trade would
# silently produce wrong T+1/T+2 deadlines, so the calendar is date-aware.
TRADING_WEEK_CHANGE = date(2026, 4, 6)


def _closed_weekdays(day: date) -> set[int]:
    # Python: Monday=0 ... Sunday=6.
    if day < TRADING_WEEK_CHANGE:
        return {4, 5}  # Friday, Saturday
    return {5, 6}  # Saturday, Sunday


def is_weekend(day: date) -> bool:
    return day.weekday() in _closed_weekdays(day)


def holiday_set(values: Iterable[str] | None) -> set[date]:
    out: set[date] = set()
    for raw in values or []:
        try:
            out.add(date.fromisoformat(str(raw)[:10]))
        except (TypeError, ValueError):
            continue
    return out


def settings_holidays(settings: dict[str, Any] | None) -> set[date]:
    return holiday_set((settings or {}).get("holiday_dates") or [])


def is_trading_day(day: date, holidays: Iterable[date] | None = None) -> bool:
    if is_weekend(day):
        return False
    return day not in set(holidays or [])


def next_trading_day(
    day: date, holidays: Iterable[date] | None = None, *, include_self: bool = False
) -> date:
    current = day if include_self else day + timedelta(days=1)
    for _ in range(370):
        if is_trading_day(current, holidays):
            return current
        current += timedelta(days=1)
    raise ValueError("Could not find a trading day within one year")


def add_trading_days(
    day: date, days: int, holidays: Iterable[date] | None = None
) -> date:
    if days < 0:
        raise ValueError("Trading-day offset must be non-negative")
    current = day
    remaining = days
    while remaining:
        current += timedelta(days=1)
        if is_trading_day(current, holidays):
            remaining -= 1
    return current


def trading_days_between(
    start: date, end: date, holidays: Iterable[date] | None = None
) -> int:
    """Count trading days in the inclusive interval [start, end]."""
    if end < start:
        return 0
    total = 0
    current = start
    holiday_dates = set(holidays or [])
    while current <= end:
        if is_trading_day(current, holiday_dates):
            total += 1
        current += timedelta(days=1)
    return total


def deadline_dates(
    trade_date: date,
    settings: dict[str, Any] | None,
    side: str,
) -> dict[str, date | None]:
    """Return the operational and cash dates for a bill.

    Defaults encode the documented rules in force at implementation time:
    BUY payment is due T+1 from the broker SMS; SELL EDIS/WACC is due T+1;
    CDSC cash/security settlement is T+2.  A vault can override the
    business-day offsets without changing historical rows.
    """
    settings = settings or {}
    holidays = settings_holidays(settings)
    buy_deadline_days = int(settings.get("buy_payment_business_days", 1))
    edis_days = int(settings.get("edis_business_days", 1))
    settlement_days = int(settings.get("sell_settlement_business_days", 2))

    settlement = add_trading_days(trade_date, settlement_days, holidays)
    if side == "BUY":
        return {
            "payment_deadline": add_trading_days(trade_date, buy_deadline_days, holidays),
            "edis_deadline": None,
            "settlement_date": settlement,
        }
    return {
        "payment_deadline": None,
        "edis_deadline": add_trading_days(trade_date, edis_days, holidays),
        "settlement_date": settlement,
    }
