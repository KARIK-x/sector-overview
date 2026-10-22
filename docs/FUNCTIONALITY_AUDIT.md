# Functionality Audit

**Purpose:** trace every requirement in the brief to what is actually in the build, with an honest
status and an evidence pointer. This is deliberately a requirements audit, not a marketing summary.

**Build:** production bundle served by FastAPI, latest data session 2026-10-16. **Audit date:**
2026-10-22.

Status vocabulary: `TESTED-PASS` · `IMPLEMENTED` · `TESTED-FAIL` · `NOT-TESTED` · `BLOCKED`.

---

## 1. Independence and scope

| Requirement | Status | Evidence / note |
| --- | --- | --- |
| Fully independent of the prior Mega Tool | `TESTED-PASS` | No imports, env vars, database, candles or infrastructure from it. The repository is self-contained. |
| No stock-picking screens | `TESTED-PASS` | Navigation has no stock screener/ranking. Sector Explorer names members only as breadth/liquidity/fundamental evidence. |
| No candlesticks | `TESTED-PASS` | No OHLC series is stored or drawn. The only price chart is a close + moving-average line. |
| No OHLC warehouse | `TESTED-PASS` | `daily_summaries` stores close, change, volume and turnover only; intraday OHLC is absent. |
| Sector-only analytics | `TESTED-PASS` | All analytical units are the 13 NEPSE sub-indices plus NEPSE. |
| Constituent data only for breadth, liquidity, cap, concentration | `TESTED-PASS` | Member rows power counts, turnover/HHI, cap aggregates and filings; no member price-picking view. |
| Continue the existing app | `TESTED-PASS` | The existing pages, theme, API and data were extended; nothing was replaced with a template. |

---

## 2. Required pages

| Page | Status | Notes |
| --- | --- | --- |
| Dashboard | `TESTED-PASS` | Market strip, rotation map, heatmap, leadership, breadth, liquidity, risk, data trust |
| Sector Explorer | `TESTED-PASS` | One sector: history, technicals, risk, breadth, liquidity, fundamentals, memberships |
| Rotation Lab | `TESTED-PASS` | Two-axis map, quadrants, lookbacks, thresholds, trails, bubbles, filter, zoom/reset, timeline, table, transitions |
| Breadth Lab | `TESTED-PASS` | A/D history, advance share vs NEPSE, MA participation, sector width, deep dive |
| Liquidity Lab | `TESTED-PASS` | Stacked turnover, share donut, turnover/return scatter, concentration table, within-sector HHI |
| Risk Lab | `TESTED-PASS` | Risk/return, volatility ranking, 14×14 correlation, drawdown/rolling detail |
| Fundamentals Lab | `TESTED-PASS` | P/E dot plot, ROE bubble, aggregates, member filings, coverage/validation |
| Events & Research | `BLOCKED` | Renders planned coverage and `UNAVAILABLE`; no verified free events feed was found |
| Quantitative Research Lab | `TESTED-PASS` | Factor model, ranking, attribution, transition matrix, illustrative backtest |
| Data Quality Center | `TESTED-PASS` | Coverage, inventory, validation, source register, ingestion runs, known gaps |
| Methodology | `TESTED-PASS` | 12 sections: formulae, windows, assumptions, status vocabulary |
| **Sector Comparison** (additional) | `TESTED-PASS` | Multi-sector/NEPSE line chart with presets and three modes |
| 404 | `TESTED-PASS` | A real route, not a blank screen |

---

## 3. Rotation Lab contract (mandatory)

| Requirement | Status | Evidence / note |
| --- | --- | --- |
| x = absolute strength | `TESTED-PASS` | Axis label and formula; 20-session bank example +6.4629 % |
| y = relative strength | `TESTED-PASS` | `sector return − NEPSE return`; bank example +5.6304 % |
| Top-right = Winning | `TESTED-PASS` | Quadrant fill/label; unit tests |
| Top-left = Advancing | `TESTED-PASS` | `x ≤ 0`, `y > 0`; unit tests |
| Bottom-right = Losing | `TESTED-PASS` | `x > 0`, `y ≤ 0`; unit tests |
| Bottom-left = Lagging | `TESTED-PASS` | `x ≤ 0`, `y ≤ 0`; unit tests |
| Lookbacks 5/10/20/60/120 | `TESTED-PASS` | Five controls; 60 was exercised |
| Default lookback 20 | `TESTED-PASS` | Initial payload window 20; Reset restores 20 |
| Configurable thresholds | `TESTED-PASS` | Two range sliders (-10 %…+10 %), API parameters |
| Enriched hover | `TESTED-PASS` | Life Insurance tooltip verified with absolute, relative, RS, 20D, volatility, cap, turnover, advancing members, HHI and status; other charts were not asserted mark-by-mark |
| Trails | `TESTED-PASS` | Off/10/25/50; 25 exercised; backend trail dates ordered |
| Bubble metrics | `TESTED-PASS` | Equal, market cap, turnover, volatility, breadth; volatility exercised |
| Sector selection | `TESTED-PASS` | Table row selects Hydro Power; selected panel shows trail + link |
| Zoom / reset | `TESTED-PASS` | Wheel zoom changed the canvas; reset restored the exact pre-zoom hash. Touch pinch is `NOT-TESTED` (no device) |
| Export | `TESTED-PASS` | CSV (14 rows, full columns) + PNG (171 KB) |
| Synchronized ranking table | `TESTED-PASS` | Sorted table, quadrant badges, selected-row state |
| Transition table/timeline | `TESTED-PASS` | Recent crossings + 120-session rank/excess timeline; Rank and Excess exercised |

**Quadrant boundary rule:** at the default zero thresholds, a sector with `x = 0` and `y > 0` is
Advancing, not Winning; `y = 0` is Losing/Lagging. This is pinned by unit tests, not inferred from a
screenshot.

---

## 4. Data integrity and provenance

| Requirement | Status | Evidence / note |
| --- | --- | --- |
| Real data only | `TESTED-PASS` | Ingested 41,509 index rows, 433,817 summaries, 467 securities, 4,840 filings |
| No fabricated events | `TESTED-PASS` | `/api/events` is `UNAVAILABLE`; page explains |
| No invented fundamentals | `TESTED-PASS` | Only profit/EPS/P/E/capital/net worth; revenue/assets/liabilities are labelled absent |
| Visible provenance | `TESTED-PASS` | Source register, per-dataset status, retrieval notes |
| Missing ≠ zero | `TESTED-PASS` | `null` gaps; API tests check JSON finiteness; breadth excludes missing names |
| Market cap unit | `TESTED-PASS` | Canonical NPR; YONEPSE million source multiplied by 1,000,000 |
| Book-value validation | `TESTED-PASS` | Implied P/B 0.10–25; rejected values excluded and counted |
| Historical membership bias disclosed | `TESTED-PASS` | Page notes + methodology + limitations |
| Sparse sub-indices disclosed | `TESTED-PASS` | Completeness table: Manufacturing 80.2 %, Tradings 83.5 %, Life 93.7 %, Hotels 94.2 % |
| Latest date consistent | `TESTED-PASS` | 2026-10-16 across dashboard, tables and exports |

---

## 5. Interactions and exports

| Requirement | Status | Notes |
| --- | --- | --- |
| Real Playwright run | `TESTED-PASS` | Firefox 76 checks, Chrome 36 checks (112 total), against the production build |
| Screenshots under `artifacts/screenshots/` | `TESTED-PASS` | 16 real images; no mockups |
| 12–15 preferred | `TESTED-PASS` (with note) | 16 images: 12 pages + 2 dark + 1 mobile + 1 404 |
| CSV downloads | `TESTED-PASS` | Rotation, Compare, Breadth, Liquidity, Risk, Fundamentals |
| PNG downloads | `TESTED-PASS` | Every chart offers PNG; compare PNG verified 2172×1040 |
| Theme | `TESTED-PASS` | Light/dark; two dark screenshots |
| Command palette | `TESTED-PASS` | `Meta+K`, filter, Enter |
| Mobile | `TESTED-PASS` | Drawer + no horizontal overflow at 390 px |
| Data Quality re-check | `TESTED-PASS` | Action completes without errors |
| 404 | `TESTED-PASS` | Real not-found page |

---

## 6. Required documentation

| Document | Status | Notes |
| --- | --- | --- |
| `README.md` | `TESTED-PASS` | Updated with 12 pages, evidence, tests, data counts |
| `PROJECT_PLAN.md` | `TESTED-PASS` | Milestones updated to current build |
| `DATA_SOURCE_AUDIT.md` | `TESTED-PASS` | Sources, licences, refusals, invariants |
| `DATA_DICTIONARY.md` | `TESTED-PASS` | Tables, units, derived fields, API |
| `ANALYTICS_METHODOLOGY.md` | `TESTED-PASS` | Formulae and caveats |
| `VISUALIZATION_CATALOG.md` | `TESTED-PASS` | 27 chart surfaces + HTML visuals |
| `TESTING_REPORT.md` | `TESTED-PASS` | Commands, counts, downloads, screenshot index |
| `DEPLOYMENT.md` | `TESTED-PASS` | Free-tier options, DB strategy, no paid requirement |
| `KNOWN_LIMITATIONS.md` | `TESTED-PASS` | Data, analytics, product, legal limits |
| `IMPLEMENTATION_STATUS.md` | `TESTED-PASS` | Page/endpoint/feature matrix |
| `VISUALIZATION_AUDIT.md` | `TESTED-PASS` | Page-by-page visual review and fixes |
| `FUNCTIONALITY_AUDIT.md` | this file | Requirement trace |

---

## 7. Free hosting and cost

| Requirement | Status | Notes |
| --- | --- | --- |
| Research free hosting | `TESTED-PASS` | Render / Hugging Face / Oracle / Neon options documented |
| No paid infrastructure used | `TESTED-PASS` | Local run only; no account, card or paid service |
| Honest deployment status | `NOT-TESTED` | Not publicly deployed; Docker build/smoke and the Postgres path are `TESTED-PASS` |

---

## 8. UI/UX quality review

| Area | Status | Notes |
| --- | --- | --- |
| Visual hierarchy | `TESTED-PASS` | Editorial serif titles, mono numerals, restrained palette |
| Responsive layout | `TESTED-PASS` | Mobile screenshot; 390 px scroll width equals client width |
| Dense-table usability | `TESTED-PASS` | Scroll hints added to Research, Sector Explorer and Fundamentals member tables |
| Chart legibility | `TESTED-PASS` | Full-width heatmap, log P/E dot plot, outlier-only risk labels, label overlap hiding |
| Empty/unavailable states | `TESTED-PASS` | Events, Mutual Fund fundamentals, sparse data |
| Consistency | `TESTED-PASS` | Shared Card/Chart/status primitives; quadrant colours fixed |
| Accessibility | `NOT-TESTED` | Canvas charts have text/table neighbours and now carry an `aria-label`; reduced motion is respected; no formal WCAG or screen-reader audit |
| Cross-browser | `TESTED-PASS` (Chrome/Firefox) · `BLOCKED` (WebKit) | WebKit crashes on this host |

**Deliberate omissions:** no glassmorphism/blur effects, no decorative gauges, no fake AI scores, no
skeleton-only pages, no stock tips. The interface stays quiet so the evidence is the loudest thing on
the page.

---

## 9. Residual issues and their disposition

| Issue | Disposition |
| --- | --- |
| Tooltip content is not automated for every mark | The enriched rotation tooltip is verified; other charts’ tooltips are `IMPLEMENTED` and not asserted mark-by-mark. |
| Touch pinch zoom is not asserted | Wheel zoom and exact reset are verified; pinch requires a touch device and is `NOT-TESTED`. |
| Some member/factor tables need internal scrolling | Hints added; a paginated table would be a future change, not a defect. |
| Quadrant labels cluster near zero | Selected sector is emphasized; table and tooltip are the fallback. |
| WebKit/Safari unverified | Recorded as `BLOCKED` with the launch error. |
| No public URL | Recorded as `NOT-TESTED`; deployment guide is complete. |
| No licence file | Recorded in `KNOWN_LIMITATIONS`; choose before redistribution. |

---

## 10. Bottom line

Every required page exists, the mandatory Rotation Lab contract is implemented and unit-tested, the
data is real and the gaps are labelled, and the production build was exercised in two browsers with
real downloads and screenshots. The honest exceptions are WebKit/Safari, public deployment, screen-reader testing, and per-mark hover
automation — all marked as such rather than promoted to `TESTED-PASS`. Docker build/container smoke and
the Postgres path are now `TESTED-PASS`.
