# Quantitative Audit

Audit date: 2026-10-22. Baseline commit: `bba1e19`.

## Method

Calculations were reviewed against their definitions, source alignment, missing-data handling, and the
existing unit/API tests. Independently derived expected values were used where noted.

## Findings

| Area | Status | Evidence |
| --- | --- | --- |
| Rotation absolute return | PASS | `_ret(series, h)` uses `series.iloc[-1-h]` to `series.iloc[-1]`; unit/API checks confirm 20-session bank return 6.4629%. |
| Rotation relative return | PASS | Relative return is sector return minus NEPSE return over the same aligned `pair` frame. |
| Quadrant classification | PASS | 7 boundary cases in `test_quadrants`; 65 sector/window combinations matched independently calculated quadrants. |
| Zero boundaries | PASS | `x=0` is not WINNING; `y=0` is not WINNING; ties are LAGGING/LOSING. |
| Missing benchmark/index | PASS | `_pair` drops dates where either series is missing; no relative result is fabricated. |
| `_ret` invalid base | PASS | Zero base returns `None`; insufficient history returns `None`. |
| `relative_strength_ratio` | FAIL (fixed) | The previous implementation independently filtered missing values, which could misalign sector and market series. It now zips observations and keeps only paired observations. |
| Momentum change | PASS | Current 20-session return minus the 20-session return ending 20 sessions earlier; guarded by 40 observations. |
| Volatility | PASS | Sample standard deviation over daily returns, annualised by sqrt(252). |
| Beta/correlation | PASS | Aligned pairs only; minimum 3 pairs; zero variance returns `None`. |
| Correlation matrix | PASS | Pairwise-complete returns over 252 sessions, minimum 30 pairs. |
| Drawdown | PASS | Running peak and current drawdown; missing observations do not reset the peak. |
| Breadth denominator | PASS | Missing observations are excluded from `traded`; they are not counted as unchanged. |
| Liquidity share | PASS | Sector turnover divided by observed total turnover. |
| Concentration (HHI) | PASS | Squared shares of observed member turnover. |
| Aggregate P/E | PASS | Market cap divided by aggregate profit, including losses. |
| Book-value validation | PASS | Implied P/B 0.10–25; rejected values excluded and counted. |
| Market-cap snapshot | PASS with limitation | Static 2026-10-16 snapshot; historical weights are not available. |

## Independent hand checks

- Commercial Banks, 20 sessions: sector 6.4629%, NEPSE 0.8326%, relative 5.6304%, WINNING.
- Case 1: sector +4%, market +7% => relative -3 pp => LOSING.
- Case 2: sector -2%, market -8% => relative +6 pp => ADVANCING.
- Case 3: sector +5%, market +2% => relative +3 pp => WINNING.
- Case 4: sector -6%, market -3% => relative -3 pp => LAGGING.

## Remaining risks

- Historical membership is current-only.
- Market capitalisation is a snapshot.
- Fundamentals have mixed periods.
- Events are unavailable.
