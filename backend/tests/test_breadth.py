from __future__ import annotations

import pytest

from app.calculations.breadth import breadth_counts, new_highs_lows, pct_above_moving_average


def test_breadth_counts_and_denominators():
    b = breadth_counts([0.01, -0.02, 0.0, None, -0.01])
    assert b.advances == 1
    assert b.declines == 2
    assert b.unchanged == 1
    assert b.traded == 4
    assert b.advance_pct == pytest.approx(0.25)
    assert b.ad_ratio == pytest.approx(0.5)


def test_zero_declines_ad_ratio_is_none():
    b = breadth_counts([0.01, 0.02])
    assert b.ad_ratio is None
    assert b.advance_pct == pytest.approx(1.0)


def test_all_unavailable_is_none():
    b = breadth_counts([], eligible=10, unavailable=10)
    assert b.traded == 0
    assert b.advance_pct is None
    assert b.eligible == 10


def test_missing_is_not_unchanged():
    b = breadth_counts([None, None, 0.0], eligible=3, unavailable=2)
    assert b.unchanged == 1
    assert b.advances == 0


def test_pct_above_ma():
    series = [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1], [1, 1, 1, 1, 1]]
    assert pct_above_moving_average(series, 3) == pytest.approx(1 / 3)


def test_new_highs_lows():
    series = [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]]
    highs, lows, total = new_highs_lows(series, 5)
    assert (highs, lows, total) == (1, 1, 2)
