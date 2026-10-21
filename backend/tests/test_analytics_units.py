from __future__ import annotations

import pytest

from app.calculations.concentration import concentration
from app.calculations.factors import score_factors
from app.calculations.fundamentals import CompanyFundamental, aggregate


def test_concentration():
    c = concentration([40, 30, 30])
    assert c.hhi == pytest.approx(0.34)
    assert c.effective_n == pytest.approx(1 / 0.34)
    assert c.top1_share == pytest.approx(0.4)
    assert c.top5_share == pytest.approx(1.0)


def test_concentration_empty():
    c = concentration([])
    assert c.hhi is None
    assert c.count == 0


def test_fundamentals_negative_earnings_keep_pe_with_disclosure():
    companies = [
        CompanyFundamental("A", 100.0, 1000.0, 200.0, 10.0, 20.0, 2000.0, "Annual", "2025", None),
        CompanyFundamental("B", -50.0, 1000.0, 150.0, -5.0, None, 1000.0, "Annual", "2025", None),
    ]
    agg = aggregate(companies, 3)
    assert agg.symbols_with_reports == 2
    assert agg.negative_earnings_symbols == 1
    assert agg.aggregate_profit == pytest.approx(50.0)
    # Total market cap / total earnings, losses included in the denominator.
    assert agg.aggregate_pe == pytest.approx(3000.0 / 50.0)
    # Positive-only variant isolates the loss-making member.
    assert agg.aggregate_pe_ex_negative == pytest.approx(2000.0 / 100.0)
    assert agg.aggregate_eps == pytest.approx(50.0 / 20.0)
    assert agg.coverage == pytest.approx(2 / 3)
    assert any("negative earnings" in n for n in agg.notes)


def test_fundamentals_positive_pe():
    companies = [
        CompanyFundamental("A", 100.0, 1000.0, 200.0, 10.0, 20.0, 2000.0, "Annual", "2025", None),
    ]
    agg = aggregate(companies, 1)
    assert agg.aggregate_pe == pytest.approx(20.0)
    assert agg.aggregate_pe_ex_negative == pytest.approx(20.0)
    assert agg.aggregate_roe == pytest.approx(100.0 / 2000.0)
    assert agg.book_value_symbols == 1
    assert agg.rejected_book_values == 0


def test_fundamentals_implausible_book_value_is_excluded():
    good = CompanyFundamental("A", 100.0, 1000.0, 200.0, 10.0, 20.0, 2000.0, "Annual", "2025", None)
    # Implied price is 14.38 * 16.11 ≈ 231.6, so a book value of 2896.6 gives a
    # price-to-book of ~0.08 — outside the plausibility band and rejected.
    corrupt = CompanyFundamental("B", 200.0, 1973.8, 2896.61, 16.11, 14.38, 5000.0, "Annual", "2025", None)
    agg = aggregate([good, corrupt], 2)
    assert agg.rejected_book_values == 1
    assert agg.book_value_symbols == 1
    # Equity is built only from the validated company: 200 * (1000/100).
    assert agg.aggregate_equity == pytest.approx(2000.0)
    assert any("implausible net worth" in n for n in agg.notes)


def test_fundamentals_unverifiable_book_value_is_included_but_flagged():
    company = CompanyFundamental("A", 100.0, 1000.0, 250.0, None, None, 2000.0, "Annual", "2025", None)
    agg = aggregate([company], 1)
    assert agg.book_value_symbols == 1
    assert agg.rejected_book_values == 0
    assert any("unverified" in n for n in agg.notes)


def test_factor_missing_is_renormalised():
    values = {"a": [1.0, 2.0, None], "b": [1.0, 3.0, 5.0]}
    scores = score_factors(values, {"a": 50, "b": 50})
    # The third sector has only factor b; its weight is renormalised to 100%.
    assert scores["2"].coverage == pytest.approx(0.5)
    assert scores["2"].missing == ["a"]
    assert "a" not in scores["2"].contributions
    assert scores["2"].contributions["b"] == pytest.approx(83.333333, rel=1e-4)
