from __future__ import annotations

import pytest

from app.calculations.rotation import (
    classify_quadrant,
    compute_rotation,
    relative_strength_ratio,
    transition,
)


@pytest.mark.parametrize(
    "abs_ret,rel_ret,expected",
    [
        (0.05, 0.02, "WINNING"),
        (-0.05, 0.02, "ADVANCING"),
        (0.05, -0.02, "LOSING"),
        (-0.05, -0.02, "LAGGING"),
        (0.0, 0.02, "ADVANCING"),
        (0.05, 0.0, "LOSING"),
        (0.0, 0.0, "LAGGING"),
    ],
)
def test_quadrants(abs_ret, rel_ret, expected):
    assert classify_quadrant(abs_ret, rel_ret) == expected


def test_quadrant_thresholds():
    assert classify_quadrant(0.03, 0.03, 0.05, 0.05) == "LAGGING"
    assert classify_quadrant(0.06, 0.06, 0.05, 0.05) == "WINNING"


def test_quadrant_missing():
    assert classify_quadrant(None, 0.1) is None
    assert classify_quadrant(0.1, None) is None


def test_compute_rotation():
    sector = [100, 110, 121]
    market = [100, 105, 110]
    m = compute_rotation(sector, market, 2)
    assert m.absolute_strength == pytest.approx(0.21)
    assert m.relative_strength == pytest.approx(0.21 - 0.10)
    assert m.rs_ratio == pytest.approx(1.21 / 1.10)
    assert m.quadrant == "WINNING"


def test_rs_ratio_requires_window():
    assert relative_strength_ratio([1, 2], [1, 2], 5) is None


def test_transition():
    assert transition("LAGGING", "WINNING") == "LAGGING->WINNING"
    assert transition("WINNING", "WINNING") is None
    assert transition(None, "WINNING") is None
