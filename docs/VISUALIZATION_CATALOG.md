# Visualization Catalog

**27 chart surfaces across nine analytical pages**, plus a small set of HTML-native visual summaries.
Every chart is an explicit Apache ECharts option built from the payload; there are no decorative gauges,
radar "scores", dual-axis tricks that hide a second scale, or synthetic trend lines. Every chart carries
a PNG export control.

**Reading conventions**

* Positive = teal, negative = brick red, neutral = grey. Quadrant colours are fixed:
  Winning `#0e7c66` / `#4fd1b0`, Advancing `#2c5d8f` / `#7ab3e8`, Losing `#b06a14` / `#e8b06a`,
  Lagging `#b23b3b` / `#f08a86` (light / dark).
* Numbers use IBM Plex Mono with tabular figures; prose uses IBM Plex Sans; page titles use
  Instrument Serif.
* Axes state units. A missing value is a gap or `null`, never zero.
* Tooltips repeat the values used to draw the mark. The enriched Rotation Lab tooltip is verified in
  the browser pass; other charts' tooltips were not asserted mark-by-mark.
* Charts resize with the container. On phones, the heatmap keeps a 520 px minimum width inside a
  horizontal scroller so cells stay legible.

---

## 1. Dashboard (`/`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 1 | **Return surface** (`SectorHeatmap`) | Heatmap, 13 × 7 | Rows = sectors sorted by 20-session return; columns = 1, 5, 10, 20, 60, 120, 252 sessions; colour = return centred on zero, scaled to the largest absolute cell | Hover shows the exact return; click a cell opens that sector. The colour scale is shared across horizons, so a 252-session cell can dominate visually — read the printed value. |
| 2 | **Rotation map · 20 sessions** (`RotationQuadrant`) | Scatter + trails | x = absolute return; y = relative return; colour = quadrant; size = equal; 24-session trails | Hover for the full rotation context; click a bubble opens the sector; drag/scroll zoom inside the canvas. The dashboard map has no threshold sliders; the lab does. |
| 3 | **Risk vs return** | Scatter | x = annualised 252-session volatility; y = 120-session return; size = max drawdown; colour = one teal family | Hover shows return, volatility, beta, max drawdown. Only outliers and the top/bottom performers are labelled; `labelLayout.hideOverlap` stops pile-ups. |

HTML-native companions: `LeadershipBoard` (top/bottom five relative bars plus latest quadrant changes),
`BreadthCard` (12 sector advance-share bars), `LiquidityCard` (top six turnover bars), `Data trust`
(freshness, coverage, provenance links).

---

## 2. Sector Explorer (`/sectors`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 4 | **Index structure** | Line + 3 moving averages | x = date; y = index level; close + MA20/50/200; range chips 1Y/3Y/5Y/All | ECharts inside dataZoom slider; PNG export. 750 sessions are carried to the client; the range control slices them. |
| 5 | **Participation inside the sector** | Stacked bars + line | Bars = advances (up) and declines (down); line = advance share on the right axis; 260 sessions | Hover repeats counts and share. A security without a row is excluded, never treated as unchanged. Current membership is applied to history. |
| 6 | **Traded value** | Area line | x = date; y = turnover NPR; area fill is decorative | Hover formats NPR. The adjacent HTML bars show the top traded names; turnover is trading value, not inflow. |

HTML-native companions: metric strip, technicals, risk, aggregate fundamentals, member table (scroll
hint), chips for all 13 sectors.

---

## 3. Rotation Lab (`/rotation`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 7 | **Absolute vs relative map** | Scatter + optional trails | x = selected-lookback absolute return; y = relative return; colour = quadrant; bubble = equal/market cap/turnover/volatility/breadth; trails = 0/10/25/50 sessions | Hover: absolute, relative, RS, 20/60/120D, cap, turnover, breadth. Click selects. Thresholds move the cross. Wheel/pinch zoom and drag-pan; Reset remounts the chart. Selected bubble is enlarged. |
| 8 | **Selected sector trail** | Dual line | x = last up-to-10 sessions; y = return; teal = absolute, amber = relative | Hover repeats both series; the same trail drives the map. Selected sector only. |
| 9 | **Leadership timeline** | Rank or excess line chart | x = 120 sessions; y = rank 1…13 (rank mode) or excess return (excess mode); one line per sector, selected in accent, others faint | Click a line or legend to select; toggling Rank/Excess switches the y contract. Rank is by **relative** (excess) strength. |

HTML-native companions: quadrant census, sortable ranking table (selected row state, CSV), transition
list with count, axis contract. Hiding a sector removes it from map, table and timeline together.

---

## 4. Sector Comparison (`/compare`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 10 | **Aligned comparison** | Multi-line | x = union of observation dates; y = unadjusted level, rebased to 100 at the common start, or cumulative return; one line per selected series | 1Y/3Y/5Y/All presets, manual From/To dates, up to 13 sectors + NEPSE, mode toggle, Reset, CSV, PNG. Lines start at the common date, so a late-listed series cannot create a false early comparison. |

HTML-native companion: window-statistics table (first/last close, period return, max drawdown,
volatility, observations).

---

## 5. Breadth Lab (`/breadth`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 11 | **Advance / decline history** | Stacked bars + line | x = selected 60/120/260 sessions; y-left = securities; bars = advances up / declines down; y-right = advance share | Hover repeats counts; the share is computed only over observed names. Badge states the selected window. |
| 12 | **Participation divergence** | Dual-axis line | x = same window; y-left = advance share (raw faint + 10-session mean bold); y-right = NEPSE indexed to 100 at the window start | Hover distinguishes the raw and smoothed share. The mean is a display smoother; the raw series remains visible. |
| 13 | **Participation by moving average** | Bars | x = MA 20/50/100/200; y = share of members above their own MA | 50 % reference line. Hover exact share; sector deep-dive panel adds member context. |

HTML-native companions: breadth thrust/divergence metrics, sector-width diverging bars, sector deep
dive (sector MA chart + Clear).

---

## 6. Liquidity Lab (`/liquidity`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 14 | **Turnover history** | Stacked area | x = 260 sessions; y = NPR turnover; one stacked area per sector | Hover shows the stack. Legend is intentionally off to avoid 12 overlapping entries; the donut legend names the top eight and the table covers all. |
| 15 | **Latest session mix** | Donut | Share of observed turnover by sector; centre total | Hover shows NPR and percent. All 12 traded sectors are in the ring; the legend beneath lists the top eight only, with a note. |
| 16 | **Turnover vs performance** | Scatter | x = turnover NPR (log); y = selected 5/20/60-session return; colour = sector; size = market cap | Hover shows turnover, share, 20D return, market cap, HHI, effective N; click selects the sector and emphasizes the table. Log x-axis because turnover spans orders of magnitude. |

HTML-native companions: concentration metrics, HHI table, top-1/top-5 share bars.

---

## 7. Risk Lab (`/risk`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 17 | **Risk vs return** | Scatter | x = annualised volatility; y = 120-session return; size = max drawdown | Hover repeats volatility, return, beta, max DD. Outlier-only labels; overlap hidden. |
| 18 | **Volatility ranking** | Horizontal bars | Sorted 252-session annualised volatility | Hover exact value. Same axis for all sectors; current-drawdown context in the table. |
| 19 | **Correlation matrix** | Heatmap, 14 × 14 | Pairwise-complete daily-return correlation over 252 sessions; 1.00 diagonal; diverging colour | Hover shows the pair and coefficient. Pairwise samples differ, so each cell is its own overlap; the note says so. All labels are rendered. |
| 20 | **Drawdown anatomy** | Area + line | x = 260 sessions; y = drawdown from running peak (≤ 0); sector selector | Hover exact drawdown. Max drawdown is over full history; the chart shows the recent window, so the printed max may be outside it. |
| 21 | **Rolling correlation & volatility** | Dual-axis line | Correlation = 60-session rolling, min 40 pairs; volatility = 20-session rolling × √252 | Hover both series. Different windows are labelled; do not read a point as a 252-session statistic. |

HTML-native companion: full risk table (volatility, max/current DD, beta, correlation, VaR, CVaR,
observations).

---

## 8. Fundamentals Lab (`/fundamentals`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 22 | **Aggregate P/E by sector** | Dot plot, log x | x = market cap ÷ aggregate profit (losses included), log scale; y = sector; dot labels exact P/E | Hover repeats sector, P/E and coverage. Dot plot instead of bars because a log axis has no meaningful zero; bars from zero would imply a false anchor. Sectors with non-positive aggregate earnings are absent (Mutual Fund), not zero. |
| 23 | **ROE against P/E** | Bubble scatter | x = aggregate P/E (log); y = aggregate ROE; bubble area = aggregate market cap; colour = sector | Hover shows P/E, ROE, market cap and coverage; only the distribution corners are labelled, so the dense middle stays readable. Bubble area is cap, not coverage. Mixed accounting periods are disclosed. |

HTML-native companions: coverage metrics, sector aggregates table (scroll hint), member filing table
(scroll hint), validation notes. CSV exports the sector cross-section.

---

## 9. Quantitative Research Lab (`/research`)

| # | Surface | Type | Encoding | Interaction / caveat |
| --- | --- | --- | --- | --- |
| 24 | **Factor score ranking** | Horizontal bars | x = weighted score 0–100; y = sector; bar colour = quadrant; label = score | Scores are cross-sectional percentile ranks, renormalised over available factors. Missing factors reduce coverage; they are never scored as worst. |
| 25 | **Factor contribution** | Stacked horizontal bars | x = contribution to score; stacks = six factors; y = sector | Hover stack; legend names factors. Weights are user-controlled above the chart. |
| 26 | **Quadrant transition matrix** | Heatmap, 4 × 4 | y = origin quadrant; x = destination; cell = count of consecutive-session transitions; 20-session state | Hover origin → destination and count. Diagonal = persistence. Sparse off-diagonal cells are counts, not probabilities. |
| 27 | **Illustrative rotation backtest** | Two lines | x = rebalance step index; y = growth of 1; teal = long top-3 by 20-session relative strength, rebalanced every 5 sessions; dashed amber = NEPSE | Hover percent growth. No costs, slippage, taxes or liquidity constraints; the method string is printed. This is a replay, not a strategy. |

HTML-native companions: six weight sliders, coverage/missing-factor table (scroll hint), method note.

---

## 10. HTML-native visuals (not counted above)

| Visual | Page | Why not ECharts |
| --- | --- | --- |
| Leadership bars + quadrant-change list | Dashboard | Five rows each; HTML gives better text wrapping, links and accessible names |
| Breadth sector bars | Dashboard | Compact ranked bars; values printed |
| Liquidity top-six bars | Dashboard | Readable labels without a 12-colour legend |
| Quadrant census | Rotation | Count cards with named examples |
| Sector-width diverging bars | Breadth | Centred at zero with printed net advances |
| Concentration bars | Liquidity | Four metrics, values more important than marks |
| Top traded names | Sector Explorer | Symbol + share; bars are supporting |
| Data-quality inventory / source register | Data Quality | Table semantics and per-row status |
| Methodology | Methodology | Text, tables, formulae |

---

## 11. Export and accessibility notes

* CSV exports are available on Rotation, Comparison, Breadth, Liquidity, Risk and Fundamentals; they
  write the same numbers shown in the table, not formatted display strings.
* PNG export resolves the ECharts canvas and paints the theme background before download, so dark-mode
  charts do not arrive on a transparent background.
* Canvas charts are not exposed to screen readers. Every chart has a metric strip, table or note
  carrying the same decision-relevant values; the app does not claim a formal WCAG audit.
* `prefers-reduced-motion` is respected for CSS transitions; ECharts animation is not globally
  disabled. This is listed as a limitation.

For the visual review, including the defects found and fixed, see
[VISUALIZATION_AUDIT.md](VISUALIZATION_AUDIT.md).
