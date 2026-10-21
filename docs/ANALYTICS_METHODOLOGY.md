# Analytics Methodology

Every number in the application is produced by a function in
`backend/app/calculations/` and is unit-tested independently of HTTP and the database. This document
states what each function computes, in what unit, and where it can mislead.

---

## 0. Conventions

| Convention | Rule |
| --- | --- |
| Time | Windows are **trading sessions**, not calendar days |
| Returns | Fractions (`0.0646` = 6.46 %), compounded between observed levels |
| Missing data | `null`. Never `0`, never forward-filled, never interpolated |
| Denominators | Only **observed** securities/sessions; the rest are reported separately |
| Percentile | Mid-rank `(less + 0.5 × equal) / n` |
| Rounding | Full precision in the API; formatting is a UI concern |

Series are built from a date-aligned frame: each sector is joined to NEPSE on the sector's own
observed dates. A sector return is therefore measured over *its* sessions, while the relative
calculation subtracts the NEPSE return over the same aligned window.

---

## 1. Returns

```
r_n = close[t] / close[t-n] − 1
```

`t-n` is the *n*-th previous **observed** session. If the final observation is missing, the result
is `null` (the app does not substitute yesterday's value). If `n` exceeds available history, the
result is `null`.

**Cumulative vs. annualised:** all displayed returns are cumulative over the window, not annualised.
YTD uses the last close before the current calendar year as the base.

---

## 2. Rotation

### 2.1 Axes

| Axis | Formula | Meaning |
| --- | --- | --- |
| **Absolute strength** (x) | `s_t / s_{t-n} − 1` | Did the sector rise or fall? |
| **Relative strength** (y) | `r_sector − r_NEPSE` | Did it beat the market? |

The relative value is an arithmetic difference of cumulative returns (percentage points), not a
ratio. This keeps the zero line meaningful: `y = 0` means "matched NEPSE".

The **RS ratio** is also reported (used in tables, not on the axes):

```
RS = (s_t / s_{t-n}) / (m_t / m_{t-n})
```

`RS > 1` = outperformance; `RS = 1.05` = 5 % ahead of the market's cumulative growth.

### 2.2 Quadrant contract (frozen)

```
WINNING   : x >  abs_threshold  and y >  rel_threshold     (top-right)
ADVANCING : x <= abs_threshold  and y >  rel_threshold     (top-left)
LOSING    : x >  abs_threshold  and y <= rel_threshold     (bottom-right)
LAGGING   : x <= abs_threshold  and y <= rel_threshold     (bottom-left)
```

Thresholds default to `0.0` and are user-configurable (displayed as percentages, converted to
fractions before the comparison). The boundary convention is deliberate: a sector exactly at zero
absolute but positive relative is **Advancing**, never Winning. Tests pin all four cases and the
boundary.

### 2.3 Lookbacks

`5, 10, 20, 60, 120` sessions; default **20**. Trails use the same window and can replay 0–120 past
sessions; each trail point is computed from the truncated history ending on that session, so a trail
is a true path of the metric, not an interpolation.

### 2.4 Momentum change

```
prior_20 = close[t-20] / close[t-40] − 1
momentum_change = r_20(t) − prior_20
```

Positive means the 20-session return improved versus the preceding 20-session return. Direction is
`IMPROVING`, `DETERIORATING` or `FLAT`. This is a change in *momentum*, not a forecast.

### 2.5 Worked example (2026-10-16, 20 sessions)

* Commercial Banks 20-session return: `6.4629 %`
* NEPSE 20-session return: `0.8326 %`
* Relative strength: `6.4629 − 0.8326 = 5.6304 %` → **Winning**
* RS ratio: `1.0558` (5.58 % ahead on a compounded basis)

The quadrant census on the same date: 4 Winning, 0 Advancing, 0 Losing, 9 Lagging.

---

## 3. Breadth

### 3.1 Advance / decline

For a given date and universe (market or sector):

```
advances  = count(pct_change > 0)
declines  = count(pct_change < 0)
unchanged = count(pct_change == 0)
traded    = advances + declines + unchanged
advance_pct = advances / traded
ad_ratio    = advances / declines        (null if declines = 0)
```

**Critical rule:** a security with no observation on that date is **not** counted as unchanged. It
is excluded from `traded` and reported as `unavailable`. This prevents suspension or missing data
from silently looking like stability.

On 2026-10-16 the market breadth was **174 advances, 91 declines, 12 unchanged** →
`advance_pct = 174 / 277 = 62.8 %`.

### 3.2 Participation and thrust

* **% above MA(n):** for each security with at least *n* observations, compare the latest close to
  its own simple moving average. The share above is reported.
* **New highs / lows:** latest close vs. the maximum/minimum of its last 252 observations.
* **Breadth thrust:** mean of the last 10 daily advance percentages.
* **Divergence:** over 20 sessions, if the index rose while advance share fell →
  `PRICE_UP_BREADTH_DOWN`; the opposite → `PRICE_DOWN_BREADTH_UP`.

### 3.3 Sector breadth

Computed from current members' daily summaries, grouped by `sector_name`. Historical membership is
not available, so a sector's past breadth uses today's constituents. This is a **survivorship and
classification bias** and is disclosed on the page.

---

## 4. Liquidity and concentration

```
turnover_share_i = turnover_i / Σ turnover
HHI = Σ share_i²
effective_N = 1 / HHI
top_k_share = Σ(top k turnover) / Σ turnover
```

HHI is in `[1/n, 1]`; `effective_N` is the number of equally sized members that would produce the
same concentration. A high HHI means a sector's traded value depends on a few names.

**Turnover is trading value, not investor inflow.** A sale and a purchase are two sides of one
transaction; the app never calls turnover "money entering the sector".

Historical transaction counts are not present in the summary source, so only turnover and volume are
shown over time.

---

## 5. Risk

Daily returns are computed only between adjacent observed sessions.

| Metric | Formula | Window |
| --- | --- | --- |
| Volatility | `std(daily returns, ddof=1) × √252` | last 252 sessions |
| Downside volatility | `sqrt(mean(min(0, r)²)) × √252` | last 252 |
| Beta | `cov(r_sector, r_NEPSE) / var(r_NEPSE)` | last 252, paired dates |
| Correlation | Pearson `r` | last 252 |
| Drawdown | `close / running_peak − 1` | full observed history |
| Max drawdown | `min(drawdown series)` | full history |
| VaR 95 % | 5th percentile of daily returns, `method="lower"` | last 252 |
| CVaR 95 % | mean of returns ≤ VaR | last 252 |

**Descriptive only.** VaR/CVaR are historical quantiles; they assume the past distribution is
representative. The app does not annualise VaR, does not model volatility clustering, and does not
claim predictive validity. Drawdowns use the full available history (which differs by sector), so
max drawdown is not a like-for-like comparison when histories differ; the table shows the metric
with that caveat in the methodology page.

**Beta uses aligned pairs only.** Dates where either series is missing are dropped, not filled.

---

## 6. Fundamentals

### 6.1 Report selection

The latest report per symbol is selected by fiscal year, then submitted date. Filings are not
synchronised: Q1–Q4 and different fiscal years coexist. Aggregates therefore mix accounting periods.
This is stated on the page and in the payload notes.

### 6.2 Aggregation

Let `M_i` be market cap, `P_i` reported profit, `C_i` paid-up capital, `E_i` EPS, `N_i` net worth per
share, and `S_i = C_i / 100` the share-count proxy (par value NPR 100).

```
aggregate_profit  = Σ P_i                      (all members with a report, losses included)
aggregate_cap     = Σ M_i
aggregate_shares  = Σ S_i
aggregate_eps     = aggregate_profit / aggregate_shares
aggregate_equity  = Σ N_i × S_i                (validated N_i only)
aggregate_roe     = aggregate_profit / aggregate_equity
aggregate_pe      = aggregate_cap / aggregate_profit        (only if aggregate_profit > 0)
aggregate_pe_ex   = Σ(cap of profitable) / Σ(profit of profitable)   (variant)
```

* **Losses are included** in the main P/E denominator. This is the economically correct aggregate
  multiple: total price paid for total earnings, including losses.
* The **ex-loss variant** excludes loss-makers and is shown so the effect of losses is visible.
* P/E is `null` only when aggregate earnings are non-positive (a negative multiple is meaningless).
* ROE uses **validated** book values; rejected values are excluded and counted.

### 6.3 Book-value validation

```
implied_price = pe × eps
pb = implied_price / net_worth_per_share
accept if 0.10 ≤ pb ≤ 25
```

If `eps`/`pe` are missing or non-positive, the value is marked `unverifiable` and included with a
`†`. Values outside the band are `implausible`: excluded from equity/ROE, displayed as `—` with a
tooltip, and counted in `rejected_book_values`.

This is a plausibility screen, not a correction. The app never rewrites the source value; it retains
`book_value_reported` for audit and shows the rejection.

### 6.4 Worked example (Commercial Banks, latest filings)

* Aggregate profit: NPR 65.67 bn
* Aggregate market cap: NPR 1,217.89 bn
* Aggregate P/E: `1217.89 / 65.67 = 18.54`
* P/E excluding the one loss-maker: `17.79`
* Aggregate ROE: `10.31 %`
* 19 members with a report, 1 loss-maker, 2 rejected book values

---

## 7. Factor scoring

Six factors, each computed per sector on the same date:

| Factor | Value | Better |
| --- | --- | --- |
| `momentum_20` | 20-session return | higher |
| `relative_20` | 20-session relative strength | higher |
| `momentum_accel` | `r_20 − prior_r_20` | higher |
| `low_volatility` | 252-session annualised volatility | **lower** |
| `liquidity` | latest sector turnover | higher |
| `trend` | 60-session return | higher |

Algorithm:

1. Percentile-rank each factor **across sectors** (mid-rank).
2. Invert the rank for "lower is better" factors.
3. Drop missing factors for that sector.
4. Renormalise the remaining weights so they sum to 1.
5. `score = Σ(rank_i × w_i) × 100`.
6. Report `coverage = available / 6` and the list of missing factors.

**Missing is not worst.** A sector with no liquidity observation is scored on the factors it has,
and the UI shows the missing factor explicitly. Default weights: 25/25/15/10/10/15 (total 100);
users can change them, and the total is displayed (weights are relative, so 125 is valid and is
renormalised).

---

## 8. Research modules

### 8.1 Quadrant transition matrix

For every sector and session, compute the 20-session quadrant. Count transitions between consecutive
sessions into a 4×4 matrix (origin → destination). Diagonal cells measure persistence; off-diagonal
cells show where leadership migrates.

Implementation is vectorised over the aligned price arrays (rolling 20-session returns), which took
the payload from 15.5 s to 0.12 s.

### 8.2 Illustrative rotation backtest

* Universe: 13 sectors.
* Signal: 20-session relative strength, computed at each rebalance date.
* Portfolio: long the top 3 sectors, equal weight.
* Rebalance: every 5 sessions.
* Period: last ~10 years (bounded by `len - 2520` sessions, minimum 260).
* Benchmark: NEPSE index over the same intervals.
* **No transaction costs, slippage, taxes or liquidity constraints.**
* Optional history: sectors without data on a rebalance date are skipped for that leg.

The result is a demonstration that the metric can be replayed — **not** a trading strategy, a
forecast or evidence of future returns. The method string is returned with the data and printed on
the page.

### 8.3 What is deliberately absent

Regime detection, probabilistic forecasting, machine learning and "AI signals" are not implemented.
With 13 sector series and a short, structurally changing history, those modules would produce
confident-looking output without out-of-sample validation. The research payload says so explicitly.

---

## 9. Data quality

### 9.1 Coverage

For each sub-index:

```
expected = count(NEPSE trading dates between the series' first and last date)
missing  = max(0, expected − observed)
completeness = 1 − missing / expected
status = UNAVAILABLE   if observed = 0
       | VERIFIED      if completeness ≥ 0.98
       | INCOMPLETE    otherwise
```

This is why `MANUFACTURE` (80.2 %), `TRADING` (83.5 %), `LIFEINS` (93.7 %) and `HOTELS` (94.2 %) are
labelled **INCOMPLETE** rather than "verified". The data is genuinely from a verified source; the
*series* is not complete.

### 9.2 Status vocabulary

| Status | Meaning |
| --- | --- |
| `VERIFIED` | Directly observed and reconciles with its source |
| `PROVISIONAL` | Reported by a secondary source; not independently reconciled |
| `INCOMPLETE` | Source is valid but coverage is materially below expectation |
| `UNAVAILABLE` | No verified public source; module refuses to fabricate |
| `STALE` | Observation exists but is older than the expected session |
| `FAILED_VALIDATION` | Failed a plausibility or arithmetic check |

### 9.3 Known biases

* Current membership applied to history (survivorship/classification bias).
* Unadjusted index levels (no total-return adjustment).
* Market cap is a single snapshot, not a time series.
* Fundamentals mix fiscal periods and use a par-value share-count proxy.
* Sparse sub-indices make "20 sessions" span different amounts of calendar time across sectors.

All of these are surfaced in the UI, not buried here.
