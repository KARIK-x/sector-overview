# Visualization Audit

**Method:** the production build was opened in a fresh Firefox instance for each page, at a single tall
viewport set before navigation (so the image is not a stitched full-page capture). Every page was
reviewed at 1440 px and the 390 px mobile layout was checked separately. Low-resolution previews were
re-cropped at 2–3× with nearest-neighbour scaling before treating small text as a defect; this avoided
chasing OCR artifacts. Final evidence is in `artifacts/screenshots/` and indexed in
[TESTING_REPORT.md](TESTING_REPORT.md).

**Outcome:** no open visual `TESTED-FAIL`. Ten issues found during the build were fixed; the residual
items below are design trade-offs or unverified accessibility, not broken layouts.

---

## 1. Dashboard — `01-dashboard.png`

**Checked:** hierarchy from market strip → rotation map → full-width return surface → breadth/liquidity
→ risk/trust; card heights; density; tabular alignment; dark/mobile variants.

**What works:** the full-width heatmap is now the dominant visual, as intended. The rotation map and
leadership board sit at the same height. Breadth and liquidity bars share a row. The risk scatter and
data-trust card close the page. The session strip states the latest date, breadth and turnover without
requiring a chart.

**Fixed in this pass**

* The liquidity card was a treemap whose small tiles hid labels. It is now a top-six ranked HTML bar
  list with printed shares and a link to the lab.
* Risk-scatter labels piled up in the dense volatility cluster. Only outliers and extremes are labelled
  and `labelLayout.hideOverlap` is enabled. Result: readable labels, no hidden marks.
* The heatmap was moved to full width after the two-column layout compressed the 7 horizons.

**Residual:** the leadership card stretches to match the rotation map, leaving deliberate whitespace
between the bar lists and the transition list. The transitions are anchored at the bottom; this is a
composition choice, not missing content. Very dense years in the heatmap still require reading the
printed value rather than relying on colour alone.

---

## 2. Rotation Lab — `02-rotation-lab.png`

**Checked:** quadrant labels and fills, crosshair, trails, selected-sector emphasis, census, table
column fit, timeline, transitions, axis contract, threshold panel.

**What works:** the four quadrant labels are unmistakable; the map is the page. The table fits all
columns at 1440 px, including the Quadrant badge. The selected-sector card pairs a trail with the
current values. The timeline carries 120 sessions without the y-axis name colliding with the first
x-tick.

**Fixed in this pass**

* The table previously carried two extra columns (`Adv. share`, `Obs.`) that pushed the Quadrant badge
  out of view. Those fields remain in the CSV, where width is free; the on-screen table now fits.
* The rank timeline's y-axis name overlapped the first x-axis label. The name was removed; “Rank” is
  stated in the card title and the tooltip, and the axis ticks are self-explanatory.
* The transition card stretched to the height of the taller axis-contract card, leaving a large empty
  bordered area. It now sizes to its content, and a footer states the crossing rule and the count.
* Trails are drawn behind points and use low opacity; hidden sectors remove their trail as well as the
  point, so no invisible sector remains in the visual field.

**Residual:** with 13 sectors and a default zero threshold, labels cluster near the origin. The selected
sector is emphasized and the table is the precise fallback. This is preferable to jittering points,
which would falsify positions. The bubble size encodings are contextual, never axes — stated in the
axis contract.

---

## 3. Sector Comparison — `03-sector-comparison.png`

**Checked:** line separation, legend, common start, presets, date inputs, mode labels, statistics table,
export control, light/dark contrast.

**What works:** four default series remain distinguishable; the chart uses a shared x-range and starts
at the common date. The mode toggle changes the y contract and the card eyebrow changes with it, so a
rebased chart cannot be mistaken for an absolute one. The statistics table repeats the exact window.

**Fixed in this pass**

* Preset dates used UTC arithmetic; in Kathmandu a one-year preset could land a day early. The helper
  now uses local-date components.
* A late-listed series could otherwise draw a shorter line and imply an earlier common start; the
  chart and table use the computed common start.

**Residual:** the page is chart-plus-table, with no second chart. That is deliberate: comparison is one
question, and adding a second view would dilute it. Long series are capped at 2,000 points server-side;
the chart and the statistics table both use that sampled payload, and the table's observation count
says so.

---

## 4. Breadth Lab — `04-breadth-lab.png`

**Checked:** 60/120/260 windows, A/D bars, advance-share line, NEPSE indexed comparison, moving-average
bars, sector-width bars, deep-dive panel, legend.

**What works:** raw daily breadth is genuinely noisy, so the divergence chart keeps the raw advance
share faint and overlays a 10-session mean. The NEPSE index is indexed to 100 at the selected window's
start, making the two y-axes interpretable. The window badge matches the selected number of index
sessions.

**Fixed in this pass**

* The badge previously said “available history” while the chart showed 120 sessions; it now says
  `120 INDEX SESSIONS` / `60` / `260` and matches the control.
* The NEPSE overlay originally started from its absolute level, which made the right axis meaningless.
  It is now indexed to 100 at the first date in the selected window.
* The deep-dive “Clear” control and the sector header were checked after switching to Commercial Banks;
  the panel updates without a page reload.

**Residual:** with 120 or 260 sessions, the x-axis is necessarily dense. `hideOverlap` keeps tick labels
readable and the tooltip carries exact dates. The sector-width bars use a common ±max scale; a single
extreme sector can compress the others, which is why net advances are printed.

---

## 5. Liquidity Lab — `05-liquidity-lab.png`

**Checked:** stacked turnover history, share donut, top-eight legend, turnover/return scatter, horizon
toggle, concentration table, note placement.

**What works:** the stacked area shows composition over time; the donut is a single-session share
snapshot; the log-x scatter prevents Hydro Power's turnover from compressing every other sector. The
horizon toggle changes both the scatter and its export name.

**Fixed in this pass**

* The donut legend lists only the top eight sectors while the ring draws all twelve. A note under the
  legend now says “Top 8 of 12 sectors; full table below.” The ring itself is unchanged.
* The stacked history legend is off to avoid twelve overlapping entries; the donut legend and table
  carry the names. This is stated in the card.
* Turnover is repeatedly labelled trading value, not investor inflow, in the card note and methodology.

**Residual:** twelve colours are hard to distinguish in a stacked area; the chart answers “how
concentrated / how it changed”, not “which exact sector is which” at every date. The table is the
authoritative cross-section. The scatter labels only the top four by iteration order plus the selected
sector; hover covers the rest.

---

## 6. Risk Lab — `06-risk-lab.png`

**Checked:** scatter, volatility ranking, 14×14 matrix labels, diagonal, drawdown/rolling detail, table,
sector selector.

**What works:** the matrix renders every sector and NEPSE label at 1440 px, with a visible 1.00 diagonal
and a diverging scale. Drawdown and rolling charts share a sector selector, so the page reads as one
drill-down. The table gives exact VaR/CVaR and observation counts.

**Fixed in this pass**

* The correlation heatmap originally clipped edge labels. Grid margins and label rotation were adjusted
  until all 14 labels were visible.
* Risk-scatter labels were overlapping; outlier-only labelling plus `hideOverlap` fixed it.
* Rolling correlation and rolling volatility use different windows (60/40 and 20/15). The card subtitle
  states both, so the dual axis is not read as one statistic.

**Residual:** a 14×14 matrix is dense by nature; at phone width it scrolls rather than shrinking labels
below legibility. Pairwise-complete correlations use different overlaps per cell; the note says so, and
the table's observation count is not a substitute for per-cell samples.

---

## 7. Fundamentals Lab — `07-fundamentals-lab.png`

**Checked:** P/E dot plot, ROE/P-E bubble, table fit, member table, coverage metrics, CSV placement,
negative/absent values.

**What works:** the P/E distribution spans roughly 10×, so a log dot plot is the honest form; labels sit
beside dots and long sector names are shortened on the axis. The bubble chart uses market cap as area,
which is explained in the subtitle. Mutual Fund's unavailable P/E is absent, not drawn at zero. Member
book-value caveats are visible in the table and notes.

**Fixed in this pass**

* Aggregate P/E was originally a bar chart on a log axis. Bars imply a zero baseline that a log axis
  cannot have; it is now a dot plot.
* The bubble chart was changed from “profit vs cap” to ROE vs P/E with cap-scaled area, which answers a
  more useful valuation/quality question and uses the same validated fields.
* The page had no CSV export. A cross-section CSV (13 rows + header) was added; the member table gained
  a scroll hint.

**Residual:** sectors have different fiscal periods, so a dot plot compares indicative aggregates, not a
synchronised snapshot. Book values are screened, not corrected; rejected values are shown as `—` with a
count. The member table needs internal scrolling for large sectors, signposted by the hint.

---

## 8. Sector Explorer — `08-sector-explorer.png`

**Checked:** chip wrapping, header actions, range control, price/MA chart, breadth, liquidity, technicals,
risk, fundamentals, member table, footer notes.

**What works:** all 13 chips wrap without a horizontal page scroll. The price chart carries MA20/50/200
and a visible zoom slider. The sector-level breadth and liquidity panels are compact enough to sit side
by side. The fundamental aggregate and member evidence are on the same page, with the member table
clearly subordinate.

**Fixed in this pass**

* Chips overflowed the card at medium widths; wrapping was fixed.
* Multi-year charts showed only month/day; they now include the year when the window crosses a year
  boundary.
* The member table cut a row with no cue; a “Scroll for all N reported members” hint was added.

**Residual:** the member table still shows a partial row at the bottom of its scroll container. The hint
makes the affordance explicit; a paginated table would be a future improvement. The price chart's zoom
slider can be visually confused with a range selector; the range chips above it are the coarse control.

---

## 9. Quantitative Research Lab — `09-quantitative-research.png`

**Checked:** weight sliders, score ranking, attribution stack, score table, transition matrix, backtest,
interpretation notes.

**What works:** the factor model is visibly parameterised; the chart and score table change together.
The transition matrix is a compact 4×4 with counts, not fake probabilities. The backtest is labelled
illustrative and shows the benchmark.

**Fixed in this pass**

* The score table showed only nine of thirteen sectors with no cue. A “Scroll for all 13 sectors” hint
  was added.
* The Reset control was checked after moving a weight; it restores the first weight to 25.
* The backtest and factor charts use the same quadrant colour semantics as the rest of the app, avoiding
  a second, unexplained palette.

**Residual:** the score table remains an internal scroll region to keep the card aligned with the
attribution chart. The small universe makes ranks coarse (one step ≈ 7.7 percentile points), which is
stated in the interpretation card.

---

## 10. Data Quality Center — `10-data-quality.png`

**Checked:** coverage table, inventory, validation, ingestion runs, known issues, source register,
layout at 1440 and mobile.

**What works:** coverage is full width and sorted by completeness, so the four `INCOMPLETE` series are
obvious. Inventory and validation sit below in two columns. The source register names each origin and
status; ingestion runs include failures rather than hiding them.

**Fixed in this pass**

* The coverage table and the inventory/validation cards were competing for width; the table is now full
  width and the cards sit below.
* The metric “331 of 467 classified” was checked against the payload; the 70.9 % figure is correct and
  the denominator is stated.

**Residual:** the page is intentionally table-led and has no chart. That is appropriate for provenance;
the dashboard carries the visual summary.

---

## 11. Events & Research — `11-events-research.png`

**Checked:** planned-coverage cards, `UNAVAILABLE` status, source findings, research posture.

**What works:** the page does not pretend to have a calendar. It explains what would be needed, what was
probed, and why the module is blocked. The empty state is informative rather than decorative.

**Residual:** this page cannot become “complete” without a verified events feed or licence. `BLOCKED` is
the correct status.

---

## 12. Methodology — `12-methodology.png`

**Checked:** long-form readability, section headings, formula blocks, tables, status vocabulary, links.

**What works:** the page reads as a reference document, not a marketing page. Formula blocks use mono
type; each section states a caveat. The 4,000 px capture was used only to verify the full document; the
page itself scrolls normally.

**Residual:** it is long by design. Anchor navigation would help; the sidebar and command palette remain
available while scrolling.

---

## 13. Dark theme — `13-dashboard-dark.png`, `14-rotation-dark.png`

**Checked:** contrast of paper/ink inversion, quadrant colours, chart gridlines, tooltip surfaces,
selected states, export controls.

**What works:** the dark palette is a true inversion of the same semantic colours, not a second brand.
Charts re-render with the dark palette and transparent PNG exports are painted on the dark surface.

**Residual:** colour contrast was not measured against WCAG ratios. This is an accessibility gap, not a
visual break.

---

## 14. Mobile — `15-dashboard-mobile.png`

**Checked:** 390×844 dashboard, drawer, chart widths, page overflow.

**What works:** the scroll width equals the client width; there is no horizontal page overflow. The
drawer opens and navigates. Charts resize; the heatmap scrolls inside its own container.

**Residual:** wide tables scroll inside cards; this is intentional to preserve numeric column alignment.
Touch tooltips were not separately tested.

---

## 15. 404 — `16-not-found.png`

**Checked:** route, copy, navigation back.

**What works:** a real page with an explanation and a link home, not a blank screen or a raw stack trace.

---

## 16. Summary of fixes

| # | Issue | Fix | Page |
| --- | --- | --- | --- |
| 1 | Liquidity treemap labels unreadable | Ranked top-six HTML bars | Dashboard |
| 2 | Risk scatter labels collided | Outlier labels + `labelLayout.hideOverlap` | Dashboard, Risk |
| 3 | Rotation table clipped Quadrant | Removed two columns from screen; kept in CSV | Rotation |
| 4 | Rank timeline y-name overlapped ticks | Removed the axis name; title/tooltip carry it | Rotation |
| 5 | Breadth badge did not match selected window | `${sessions} index sessions` | Breadth |
| 6 | NEPSE overlay used absolute level | Indexed to 100 at window start | Breadth |
| 7 | Donut legend covered only 8 of 12 | Added “Top 8 of 12; full table below” | Liquidity |
| 8 | P/E bars on a log axis implied a zero | Dot plot on log x | Fundamentals |
| 9 | Member/score tables cut without a cue | Scroll hints with counts | Sector, Fundamentals, Research |
| 10 | Full-page Chromium captures showed stitching/text artifacts | Final evidence captured in Firefox with pre-sized viewports | All |

No screenshot was retouched, cropped into the final evidence set, or generated from a mock. The PNGs are
the rendered application.
