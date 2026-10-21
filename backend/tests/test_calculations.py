from __future__ import annotations

from datetime import date

import pytest

from app.calculations import (
    annualized_volatility,
    beta,
    correlation,
    cumulative_return,
    current_drawdown,
    cvar_historical,
    daily_returns,
    drawdown_series,
    hhi,
    moving_average,
    rsi,
    top_n_share,
    var_historical,
    ytd_return,
)


def test_cumulative_return_exact():
    values = [100.0, 110.0, 121.0]
    assert cumulative_return(values, 2) == pytest.approx(0.21)
    assert cumulative_return(values, 1) == pytest.approx(0.1)
    assert cumulative_return(values, 3) is None


def test_cumulative_return_zero_base_is_none():
    assert cumulative_return([0.0, 10.0], 1) is None


def test_cumulative_return_missing_tail_is_none():
    assert cumulative_return([100.0, 110.0, None], 1) is None


def test_daily_returns():
    out = daily_returns([100, 110, 99, None])
    assert out[0] is None
    assert out[1] == pytest.approx(0.10)
    assert out[2] == pytest.approx(-0.10)
    assert out[3] is None


def test_ytd_uses_prior_year_close():
    dates = [date(2025, 12, 30), date(2025, 12, 31), date(2026, 1, 2)]
    values = [100.0, 200.0, 220.0]
    assert ytd_return(dates, values) == pytest.approx(0.10)


def test_drawdown_and_recovery():
    values = [100, 120, 90, 130, 65]
    dd = drawdown_series(values)
    assert dd[1] == pytest.approx(0.0)
    assert dd[2] == pytest.approx(90 / 120 - 1)
    assert dd[4] == pytest.approx(65 / 130 - 1)
    assert current_drawdown(values) == pytest.approx(65 / 130 - 1)


def test_volatility_and_beta():
    rets = [0.01, -0.01, 0.02, -0.02, 0.01]
    vol = annualized_volatility(rets)
    assert vol is not None and vol > 0
    market = [0.005, -0.005, 0.01, -0.01, 0.005]
    assert beta(rets, market) == pytest.approx(2.0, rel=1e-6)
    assert correlation(rets, market) == pytest.approx(1.0, rel=1e-6)


def test_beta_insufficient():
    assert beta([0.1], [0.1]) is None


def test_moving_average():
    out = moving_average([1, 2, 3, 4], 2)
    assert out == [None, 1.5, 2.5, 3.5]


def test_rsi_all_up_is_100():
    values = list(range(1, 20))
    out = rsi(values, 14)
    assert out[-1] == pytest.approx(100.0)


def test_hhi_and_top_share():
    assert hhi([50, 50]) == pytest.approx(0.5)
    assert top_n_share([50, 30, 20], 1) == pytest.approx(0.5)
    assert hhi([0, 0]) is None


def test_var_cvar():
    rets = [(-0.05 if i < 5 else 0.01) for i in range(100)]
    assert var_historical(rets, 0.95) <= -0.04
    assert cvar_historical(rets, 0.95) <= var_historical(rets, 0.95)
