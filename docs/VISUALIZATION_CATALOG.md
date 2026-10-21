# Visualization Catalog

22 chart surfaces across nine analytical pages. Every chart is drawn with Apache ECharts from an
explicit option object; there are no decorative "AI" charts, radar scores or animated gauges.

**Reading conventions**

* Positive = teal, negative = brick red, neutral = grey. Quadrant colours are fixed:
  Winning `#0e7c66` / `#4fd1b0`, Advancing `#2c5d8f` / `#7ab3e8`, Losing `#b06a14` / `#e8b06a`,
  Lagging `#b23b3b` / `#f08a86` (light / dark).
* Numbers use IBM Plex Mono with tabular figures; prose uses IBM Plex Sans; page titles use
  Instrument Serif.
* Axes are labelled with units. A missing value is a gap or `null`, never zero.
* Tooltips repeat the exact values used to draw the mark.

---

## Dashboard

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 1 | **Rotation map** (`RotationQuadrant`) | Scatter + optional trails | x = 20-session absolute return, y = relative return; colour = quadrant; size = fixed; labels = sector; faint quadrant fills and labels | Hover tooltip; click a point opens `/sectors?code=…`; trails replay 25 sessions |
| 2 | **Return surface** (`SectorHeatmap`) | Heatmap 13 × 7 | Rows = sectors, columns = 1/5/10/20/60/120/252-session cumulative return; colour intensity = magnitude, hue = sign | Hover for the exact value; click a cell opens the sector |
| 3 | **Turnover concentration** | Treemap | Area = latest turnover; label = sector and share | Hover for turnover and share |
| 4 | **Volatility vs sensitivity** | Scatter | x = annualised volatility, y = beta vs NEPSE; one point per sector | Hover tooltip with volatility, beta, correlation |
| — | Sector character bars | Inline bars | 20-session return per sector | — |
| — | Leadership / breadth / freshness cards | Text + bars | Values and provenance | Links to labs |

**Why these four:** the dashboard answers "what is happening" from four independent angles —
relative positioning, horizon profile, where trading value sits, and how much risk each sector
carries. No composite "market score" is shown, because a single number would hide those differences.

---

## Sector Explorer

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 5 | **Sub-index history** | Line + 3 MA lines + area | x = date, y = index level; MA 20/50/200; gradient fill; dashed drawdown reference | Wheel/drag zoom (`inside` + slider dataZoom), hover crosshair with all MAs |
| 6 | **Participation inside the sector** | Bars + line, dual axis | Bars = advances/declines (count, left axis); line = advance share (%, right axis) | Hover; sector switch reloads |
| 7 | **Traded value & concentration** | Area line | x = date, y = daily turnover (NPR) for current members | Hover |
| — | Technicals panel | Text metrics | RSI(14), MACD histogram, MA position, trend slope | — |
| — | Member fundamentals table | Table | Symbol, FY, profit, EPS, P/E, net worth/share; rejected book values as `—` with tooltip | Sort by clicking headers |

**Range control:** 1Y / 3Y / 5Y / All slices the history without refetching; the API returns the full
series once.

---

## Rotation Lab

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 8 | **Rotation quadrant** | Scatter + trails | x = absolute strength, y = relative strength; quadrant fills; selected point enlarged with glow | Lookback 5/10/20/60/120; threshold controls; trail replay; click to select |
| 9 | **Selected sector path** | Dual line | x = session, y = cumulative return; teal = absolute, amber dashed = relative | Appears when a sector is selected |
| — | Quadrant census | Counts | Winning / Advancing / Losing / Lagging | — |
| — | Strength table | Table | 5/20/60/120 returns, relative, RS ratio, momentum change, quadrant | Sortable columns |
| — | Recent crossings | List | From → to, date, strength at crossing | — |

The quadrant labels are anchored to the true grid corners with ECharts `markArea` labels, so they
stay aligned at every container size. Trail series are deliberately excluded from the legend.

---

## Breadth Lab

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 10 | **Participation history** | Bars + line, dual axis | Bars = advances (teal) and declines (red); line = advancing share | Hover crosshair; period selector |
| 11 | **Moving-average breadth** | Bars | Share of members above MA 20/50/100/200 (appears in the sector deep dive) | Hover |
| — | Net advances by sector | Diverging bars | Advances − declines | — |
| — | Breadth table | Table + inline bar | Adv., dec., unch., traded, advance share (bar + %), A/D, signal | Click a sector to open the deep dive |
| — | Sector deep dive | Cards + charts | Participation, MA breadth, new highs/lows, A/D, thrust | Click a sector name in the table |

**Rule made visible:** the bar widths use only observed securities. The table's "Traded" column
makes the denominator explicit, so a 100 % advance share on 2 traded names cannot be mistaken for a
broad move.

---

## Liquidity Lab

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 12 | **Stacked traded value** | Stacked bars + total line | x = date, y = turnover (NPR), stacked by sector | Hover per sector; legend toggle |
| 13 | **Latest session mix** | Donut | Share of total turnover by sector; labels and percentages | Hover |
| — | Turnover table | Table | Sector, turnover, volume, securities, share | Sortable |
| — | Within-sector concentration | Cards + table | HHI, effective N, top-1/top-5 share, top-10 names | Sector chips |

The donut is used only for a part-to-whole question with 13 parts; the legend carries the names and
values so colour is never the only channel.

---

## Risk Lab

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 14 | **Risk vs return** | Bubble scatter | x = volatility, y = 120-session return; bubble area = max drawdown; labels = outliers only (highest volatility, best/worst 120-session returns) | Hover any bubble for full name and metrics |
| 15 | **Volatility ranking** | Horizontal bars | Sorted annualised volatility, value labels at bar ends | Hover |
| 16 | **Drawdown anatomy** | Area line | x = date, y = drawdown from running peak; subtle zero line | Sector select |
| — | Risk table | Table | Volatility, beta, correlation, max/current drawdown, VaR 95, CVaR 95 | — |

**Label policy:** the 15–23 % volatility cluster would produce unreadable collisions if every bubble
were labelled. Only informative outliers are labelled, and the subtitle says so; hovering reveals any
name. This is a deliberate trade-off, not an omission.

---

## Fundamentals Lab

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 17 | **Aggregate P/E by sector** | Horizontal bars | x = aggregate P/E; sectors sorted; value labels | Hover tooltip with profit and market cap |
| 18 | **ROE against P/E** | Bubble scatter, log x-axis | x = aggregate P/E (log), y = ROE; bubble area = report coverage; labels alternate anchors | Hover for coverage and period caveats |
| — | Sector table | Table | Profit, market cap, P/E, P/E ex-loss, ROE, coverage, loss-makers, rejected book values | Click a sector for member detail |
| — | Member detail | Table | Symbol, FY, profit, EPS, P/E, net worth/share; `—` for rejected values | Tooltip explains the rejection |

**Log axis rationale:** one 484× multiple would compress every other sector against the left edge of
a linear axis. P/E is multiplicative, so a log axis is the honest way to keep all sectors readable.

---

## Quantitative Research Lab

| # | Surface | Type | Encoding | Interaction |
| --- | --- | --- | --- | --- |
| 19 | **Composite score** | Horizontal bars | Score 0–100 per sector | Weight sliders (six factors, 0–50 each) |
| 20 | **Factor attribution** | Stacked horizontal bars | Weighted contribution in score points per factor | Hover; weights update live |
| 21 | **Quadrant persistence** | Heatmap 4 × 4 | Rows = origin quadrant, columns = destination; sequential teal intensity = transition count | Hover for count |
| 22 | **Illustrative backtest** | Two lines | x = rebalance step, y = cumulative growth (1 = start); teal = top-3 rotation, grey = NEPSE | Hover; method printed below |

The persistence heatmap uses a **single-hue sequential** ramp. An earlier red→green scale implied that
persistence was "bad"; darker now simply means more transitions. Cell labels switch between ink and
paper text based on the computed cell luminance.

---

## Non-chart pages

* **Events & Research** — explicitly empty. Cards state what is missing, why, and what would be
  required. No placeholder calendar and no fake event rows.
* **Data Quality Center** — tables, coverage bars, status badges, source register, ingestion history.
  The bar is always paired with a percentage; sparse series show `INCOMPLETE`.
* **Methodology** — sticky section navigation with formulas and contracts, written as prose rather
  than an image, so it can be searched and quoted.

---

## Design system

| Token | Light | Dark |
| --- | --- | --- |
| Paper | `#f5f3ee` | `#0b1110` |
| Surface | `#fffdf8` | `#111917` |
| Ink | `#111b18` | `#e9f0ec` |
| Muted | `#5c6a64` | `#93a29b` |
| Accent | `#0e7c66` | `#4fd1b0` |
| Line | `#e0ddd4` | `#24312c` |

* **Type:** Instrument Serif for page-level statements, IBM Plex Sans for UI, IBM Plex Mono for
  numbers and codes. Numerals are tabular so columns align.
* **Rhythm:** 4 px spacing scale, 1 px hairlines, 12–16 px card radii, no drop shadows except cards
  and the command palette.
* **Theme:** `class="dark"` on `<html>`, persisted in `localStorage`, defaults to the OS preference,
  applied before paint to avoid a flash.
* **Motion:** 480 ms cubic-out for chart transitions; no looping or attention-seeking animation.
* **Density:** cards reflow from 4 columns at `xl` to 2 at `md` and 1 at mobile; tables scroll inside
  their own container.
* **Focus:** every interactive element has a visible 2 px accent focus ring; the app has a skip link.

## Accessibility and honesty

Canvas charts are **not** individually screen-reader accessible. The application therefore provides a
text or table equivalent for every analytical chart:

* rotation map → strength table with quadrant labels;
* heatmap → sector table (and the sector page);
* risk charts → risk table;
* factor charts → score table with coverage and missing inputs;
* breadth/liquidity → their tables with explicit denominators;
* research heatmap → the visible cell counts and the method note.

Colour is never the sole channel: quadrant names, signs, labels and table text repeat the meaning.
Reduced-motion preference is respected by CSS for UI transitions; chart animation is short but not
disabled automatically — a known gap, documented in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
