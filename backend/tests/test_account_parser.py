from __future__ import annotations

from decimal import Decimal
from html import escape

import pytest

from app.account.parser import (
    apply_known_symbols,
    parse_file,
    parse_sms,
    split_messages,
)
from app.account.schemas import PreviewRequest

BUY_MULTI = (
    "RK316455, you bought HIDCLP-500.0@213.84 JBBL-200.0@377.57 on 2026-04-15 "
    "BAmt 183167.22. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.48."
)
SELL_MULTI = (
    "RK316455,You Sold RSML 20.0@4659.00 SYPNL 60.0@1844.83 on 2026-04-15. "
    "Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.48"
)
BUY_THREE = (
    "RK316455, you bought RSML-60.0@4329.00 SAIL-50.0@1263.12 SYPNL-50.0@1775.94 "
    "on 2026-04-16 BAmt 413311.85. Please pay through your TMS with in T+1 to avoid "
    "Penalty of LATE FEE.BNo.48."
)
SELL_TWO = (
    "RK316455,You Sold API 400.0@352.45 GMFIL 450.0@480.09 on 2026-04-16. "
    "Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.48"
)


def test_buy_multi_parses_bill_level_fields():
    parsed = parse_sms(BUY_MULTI)
    assert parsed.status == "PARSED"
    assert parsed.broker_id == "RK316455"
    assert parsed.side == "BUY"
    assert parsed.trade_date.isoformat() == "2026-04-15"
    assert parsed.bill_no == "48"
    assert parsed.bamt == Decimal("183167.22")
    assert [line.symbol for line in parsed.lines] == ["HIDCLP", "JBBL"]
    assert [line.gross for line in parsed.lines] == [Decimal("106920.00"), Decimal("75514.00")]
    assert parsed.gross_total == Decimal("182434.00")


def test_sell_multi_parses_no_bamt():
    parsed = parse_sms(SELL_MULTI)
    assert parsed.status == "PARSED"
    assert parsed.side == "SELL"
    assert parsed.bamt is None
    assert parsed.bill_no == "48"
    assert [line.symbol for line in parsed.lines] == ["RSML", "SYPNL"]


def test_three_line_buy_and_decimal_quantities():
    parsed = parse_sms(BUY_THREE)
    assert parsed.status == "PARSED"
    assert len(parsed.lines) == 3
    assert parsed.gross_total == Decimal("411693.00")
    assert parsed.lines[0].quantity == Decimal("60")


def test_split_multiple_messages_and_drop_duplicate():
    text = "\n\n".join([BUY_MULTI, SELL_MULTI, BUY_THREE, SELL_TWO])
    messages = split_messages(text)
    assert len(messages) == 4
    assert split_messages(BUY_MULTI + "\n\n" + BUY_MULTI) == [BUY_MULTI]


def test_inline_two_message_split():
    messages = split_messages(BUY_MULTI + " " + SELL_MULTI)
    assert len(messages) == 2


def test_invalid_message_is_error():
    parsed = parse_sms("Hello, this is not a broker SMS.")
    assert parsed.status == "ERROR"
    assert parsed.lines == []
    assert parsed.errors


def test_missing_date_needs_review():
    parsed = parse_sms("RK316455, you bought HIDCLP-10@213.84 BNo.48")
    assert parsed.status == "NEEDS_REVIEW"
    assert parsed.trade_date is None
    assert any("date" in error.lower() for error in parsed.errors)


def test_missing_bamt_warns_but_imports():
    parsed = parse_sms("RK316455, you bought HIDCLP-10@213.84 on 2026-04-15 BNo.48")
    assert parsed.status == "PARSED"
    assert "MISSING_BAMT" in parsed.warnings


def test_payment_url_is_restricted_to_http():
    parsed = parse_sms(
        "RK316455, you bought HIDCLP-10@213.84 on 2026-04-15 BNo.48 "
        "Pay https://tms.example.com/pay/48."
    )
    assert parsed.payment_url == "https://tms.example.com/pay/48"


def test_unknown_symbols_are_warnings_not_rejections():
    parsed = apply_known_symbols(parse_sms(BUY_MULTI), {"HIDCLP"})
    assert "UNKNOWN_SYMBOL:JBBL" in parsed.warnings
    assert parsed.status == "PARSED"


def test_csv_import_with_header():
    content = (
        "address,body,date\n"
        f'RK316455,"{BUY_MULTI}",1776211200000\n'
        f'RK316455,"{SELL_MULTI}",1776211200000\n'
    )
    messages = parse_file("sms.csv", content)
    assert len(messages) == 2
    assert messages[0].raw_text == BUY_MULTI
    assert messages[0].sender == "RK316455"


def test_txt_import():
    messages = parse_file("sms.txt", BUY_MULTI + "\n\n" + SELL_MULTI)
    assert len(messages) == 2


def test_android_xml_import_and_dtd_rejection():
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<smses>
  <sms address="RK316455" date="1776211200000" body="{escape(BUY_MULTI)}"/>
  <sms address="RK316455" date="1776211200000" body="{escape(SELL_MULTI)}"/>
</smses>"""
    messages = parse_file("sms.xml", xml)
    assert len(messages) == 2
    with pytest.raises(ValueError, match="DTD"):
        parse_file(
            "sms.xml",
            '<!DOCTYPE sms [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><smses/>',
        )


def test_json_import():
    messages = parse_file(
        "sms.json",
        '{"messages":[{"sender":"RK316455","body":"' + BUY_MULTI.replace('"', '\\"') + '"}]}',
    )
    assert len(messages) == 1
    assert messages[0].sender == "RK316455"


def test_money_rounds_half_up_like_the_fee_engine():
    parsed = parse_sms(
        "RK316455, you bought HIDCLP-10.0@10.00 on 2026-04-15 BAmt 100.005. "
        "Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.51."
    )
    assert parsed.bamt == Decimal("100.01")


def test_oversized_message_is_rejected_before_commit():
    with pytest.raises(ValueError, match="longer than"):
        parse_file("huge.txt", "A" * 20_001)


def test_unsupported_file_type():
    with pytest.raises(ValueError, match="Unsupported"):
        parse_file("sms.pdf", "not a real pdf")


def test_preview_schema_requires_content():
    with pytest.raises(ValueError):
        PreviewRequest(source_type="PASTE")
