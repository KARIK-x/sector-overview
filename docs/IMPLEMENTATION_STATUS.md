# Implementation Status

**As of:** 2026-10-22 · **Build:** production bundle served by FastAPI · **Latest session in data:** 2026-10-16

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `TESTED-PASS` | Implemented **and** exercised in this build; the run is recorded in [TESTING_REPORT.md](TESTING_REPORT.md) |
| `IMPLEMENTED` | Code exists and renders, but the specific behaviour has not been independently exercised |
| `TESTED-FAIL` | Exercised and failed; the defect is described |
| `NOT-TESTED` | Not exercised in this environment (no claim either way) |
| `BLOCKED` | Cannot be done with the verified data/hosting available; the app says so instead of faking it |

`IMPLEMENTED` is deliberately weaker than `TESTED-PASS`. Nothing in this document claims a browser run
that was not performed.

---

## 1. Summary

| Area | Status | Note |
| --- | --- | --- |
| Data ingestion (5 stages) | `TESTED-PASS` | 41,509 index rows, 433,817 summaries, 307 fundamental symbols |
| Calculations package | `TESTED-PASS` | 37 unit tests across returns, rotation, breadth, concentration, risk, fundamentals, factors |
| API (17 endpoints) | `TESTED-PASS` | 21 API tests; sanitised JSON; 90 s cache; gzip |
| 11 pages + 404 | `TESTED-PASS` | 12-route Chromium sweep, 0 console errors |
| Rotation Lab contract | `TESTED-PASS` | Unit + API + browser; lookback change verified |
| Breadth / Liquidity / Risk / Fundamentals labs | `TESTED-PASS` | Rendered with real data; numbers reconciled |
| Research Lab | `TESTED-PASS` | Scores, weights, transitions, illustrative backtest |
| Data Quality Center | `TESTED-PASS` | Completeness-aware statuses, source register, run log |
| Methodology | `TESTED-PASS` | Rendered; content mirrors `ANALYTICS_METHODOLOGY.md` |
| Command palette | `TESTED-PASS` | ⌘K, ranked search, Enter navigation |
| Theme + mobile + responsive layout | `TESTED-PASS` | Dark mode persisted; 390 px with no page overflow |
| Postgres path | `NOT-TESTED` | No server available; dialect-neutral models |
| Docker build | `NOT-TESTED` | Dockerfile written; not built here |
| Public deployment | `NOT-TESTED` | No provider account provisioned |
| Cross-browser (Firefox/Safari) | `NOT-TESTED` | Chromium only |
| Accessibility audit with AT | `NOT-TESTED` | Table equivalents exist; no screen-reader session |
| Load / concurrency test | `NOT-TESTED` | Single-user local run |
| Corporate events feed | `BLOCKED` | No verified source; page reports UNAVAILABLE |
| Historical sector membership | `BLOCKED` | Not published; current membership applied to history |
| Full financial statements | `BLOCKED` | Revenue/assets/liabilities absent from the verified feed |
| Official NEPSE API | `BLOCKED` | HTTP 401; authentication not bypassed |

**Counts:** 15 `TESTED-PASS` areas, 5 `NOT-TESTED`, 4 `BLOCKED`, 0 `TESTED-FAIL`.

---

## 2. Backend

### 2.1 Ingestion — `TESTED-PASS`

| Stage | Result in this build |
| --- | --- |
| Sectors and index metadata | 13 sectors + NEPSE |
| Index observations | 41,509 rows (34,896 sector + 6,613 NEPSE). Sector series begin between 2011-03-20 and 2021-02-28; NEPSE from 1997-07-20. All end 2026-10-16 |
| Securities and membership | 467 instruments, 331 memberships, 343 with market cap |
| Daily summaries | 433,817 rows across 285 symbols, 1995-07-20 → 2026-10-16 |
| Fundamentals | 4,840 reports across 307 symbols |

All five stages completed. The run log holds **15 rows: 13 SUCCESS and 2 FAILED** from the development
session — a `float.strip` bug in the securities stage and a fundamentals unique-constraint bug. Both
were fixed and rerun successfully; the failures were deliberately left in the log so the Data Quality
Center shows real operational history rather than an invented all-green record. The fundamentals stage
was rerun twice against the final build (4,840 rows each time, no duplicates), which verifies
replace-and-reload idempotency. Raw responses cached (8.4 MB), SQLite 128 MB.

### 2.2 Calculations — `TESTED-PASS`

`backend/app/calculations/` is independent of HTTP and the database. Every function returns `None`
for missing input rather than zero. Tests: 12 (core), 12 (rotation), 6 (breadth), 7 (analytics units).

Verified contracts:

* quadrant boundaries (`x=0`, `y=0` cases pinned);
* cumulative return by session position;
* missing ≠ unchanged in breadth;
* aggregate P/E includes losses; ex-loss variant reported separately;
* implausible book values excluded and counted; unverifiable ones included with `†`;
* factor weights renormalised over available factors, missing ≠ worst.

### 2.3 API — `TESTED-PASS`

17 endpoints, all `GET`, read-only. 21 tests cover health, meta, axis contract, sector detail, 404,
methodology, 11 endpoints' JSON validity/sanitisation, factor and research payload shapes, data
quality status, and the `clean_json` serialiser.

Runtime facts: in-process TTL 90 s; gzip on responses ≥ 1 kB (dashboard 47 kB → 10 kB); cold
dashboard 1.31 s, warm 11 ms; no `NaN`/`Infinity` on any endpoint.

---

## 3. Frontend

### 3.1 Pages

| Page | Route | Status | Rendered content |
| --- | --- | --- | --- |
| Dashboard | `/` | `TESTED-PASS` | KPI strip, rotation map, horizon heatmap, leadership board, breadth, turnover treemap, risk scatter, freshness |
| Sector Explorer | `/sectors` | `TESTED-PASS` | Sub-index history with MAs + zoom, technicals, sector breadth, traded value, member table |
| Rotation Lab | `/rotation` | `TESTED-PASS` | Quadrant + trails, lookback/threshold controls, census, table, recent crossings |
| Breadth Lab | `/breadth` | `TESTED-PASS` | Participation history, MA breadth, sector table, deep dive |
| Liquidity Lab | `/liquidity` | `TESTED-PASS` | Stacked turnover, donut, table, concentration panel |
| Risk Lab | `/risk` | `TESTED-PASS` | Risk/return bubbles, volatility ranking, risk table, drawdown anatomy |
| Fundamentals Lab | `/fundamentals` | `TESTED-PASS` | Aggregate P/E, ROE vs P/E (log x), sector table, member filings |
| Events & Research | `/events` | `TESTED-PASS` (as an empty state) | Explicit UNAVAILABLE disclosure; no fabricated rows |
| Quantitative Research Lab | `/research` | `TESTED-PASS` | Factor scores, weight sliders, attribution, persistence heatmap, backtest |
| Data Quality Center | `/data-quality` | `TESTED-PASS` | Coverage with completeness, inventory, classification, runs, source register |
| Methodology | `/methodology` | `TESTED-PASS` | Ten sections, formulas, status vocabulary, limitations |
| Not found | any unknown | `TESTED-PASS` | Designed 404 |

### 3.2 Design system and shell — `TESTED-PASS`

* Paper/ink palette with teal accent; light and dark themes (persisted, system default, applied before
  paint).
* Instrument Serif / IBM Plex Sans / IBM Plex Mono; tabular numerals.
* Sidebar (desktop) → drawer (mobile); skip link; visible focus rings; ARIA labels on icon buttons.
* Command palette (`⌘K`/`Ctrl+K`) with ranked label-first search and keyboard navigation.
* Cards reflow 4 → 2 → 1 column; tables and the mobile heatmap scroll inside their containers.
* Lazy routes with a single `Suspense` fallback; ECharts registered through `echarts/core`.

### 3.3 Interactions verified in the browser

| Behaviour | Result |
| --- | --- |
| Rotation lookback 20 → 5 | Table header and values recomputed |
| Trail replay 25 → 50 | `aria-selected` moves; chart redraws |
| Sector switch | URL `?code=HYDROPOWER`, 3 charts re-render |
| Heatmap cell click | Navigates to `/sectors?code=HYDROPOWER` |
| Factor weight change | Score 91.4 → 92.4, total weight 125 shown |
| Command palette | `risk` → Risk Lab first; Enter → `/risk` |
| Theme toggle | `html.dark`, background `rgb(11,17,16)` |
| Mobile drawer | Opens, body scroll locked |
| Mobile overflow | scroll width = client width = 380 px |

---

## 4. What is deliberately not built

| Item | Status | Reason |
| --- | --- | --- |
| Stock screener / ranking | Out of scope | Sector-only product; minimal summaries exist only for breadth |
| Candlestick / OHLC charts | Out of scope | OHLC is not stored |
| Price targets, buy/sell signals, forecasts | Out of scope | Not supported by the data or the evidence |
| Authentication, watchlists, alerts, exports | Not built | Public read-only tool; free hosting |
| ML / regime detection / sentiment | Not built | Would be unvalidated with 13 series and a short history |
| Corporate events calendar | `BLOCKED` | No verified public feed |
| Intraday / real-time | `BLOCKED` | Official API requires auth |
| Historical constituents | `BLOCKED` | Not published |
| Revenue/asset/leverage analytics | `BLOCKED` | Fields absent from the feed |

---

## 5. Reproduce this status

```bash
# backend
cd backend
.venv/bin/python -m pytest -q -p no:warnings          # 58 passed
.venv/bin/ruff check app tests                        # clean
.venv/bin/uvicorn app.main:app --port 8000

# frontend
cd ../frontend
npx tsc -b                                            # exit 0
npm run build                                         # 23 assets, dist ≈ 1.1 MB

# browser
# open http://127.0.0.1:8000 and follow docs/TESTING_REPORT.md
```

## 6. Honest next steps, in priority order

1. Add a committed Playwright suite so the browser evidence becomes repeatable.
2. Verify the Docker image build and a real Postgres deployment.
3. Run a screen-reader pass and tie ECharts animation to `prefers-reduced-motion`.
4. Add a second source for sector membership (dated snapshots) to remove the survivorship bias.
5. If a licensed fundamentals feed is obtained, add revenue/assets/leverage — and only then extend the
   Fundamentals Lab.
