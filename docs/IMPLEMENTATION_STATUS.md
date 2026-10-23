# Implementation Status

**As of:** 2026-10-23 · **Build:** production bundle served by FastAPI · **Latest session in data:** 2026-10-16

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `TESTED-PASS` | Implemented **and** exercised in this build; the run is recorded in [TESTING_REPORT.md](TESTING_REPORT.md) |
| `IMPLEMENTED` | Code exists and renders, but the specific behaviour has not been independently exercised |
| `TESTED-FAIL` | Exercised and failed; the defect is described |
| `NOT-TESTED` | Not exercised in this environment (no claim either way) |
| `BLOCKED` | Cannot be done with the verified data/hosting available; the app says so instead of faking it |

`IMPLEMENTED` is deliberately weaker than `TESTED-PASS`. Nothing in this document claims a browser run
that was not performed. There are **no open `TESTED-FAIL` items** in this build.

---

## 1. Summary

| Area | Status | Note |
| --- | --- | --- |
| Data ingestion (5 stages) | `TESTED-PASS` | 41,509 index rows, 433,817 summaries, 4,840 fundamental reports |
| Calculations package | `TESTED-PASS` | 14 unit tests across returns, rotation boundaries, risk, breadth, concentration, MACD/correlation |
| API contract | `TESTED-PASS` | 25 public API tests + 48 private account tests; 19 public read-only endpoints + authenticated `/api/account/*` |
| Type-check / production build | `TESTED-PASS` | `tsc -b` clean; Vite build succeeded |
| Dashboard | `TESTED-PASS` | Rendered + interactions + screenshot; 3 chart surfaces |
| Sector Explorer | `TESTED-PASS` | Sector switching, ranges, exports, screenshot |
| Rotation Lab | `TESTED-PASS` | Lookbacks, bubble metric, filters, timeline, thresholds, exports, screenshot |
| Sector Comparison | `TESTED-PASS` | Presets, date inputs, series chips, modes, reset, exports, screenshot |
| Breadth Lab | `TESTED-PASS` | 60/120/260 windows, deep dive, export, screenshot |
| Liquidity Lab | `TESTED-PASS` | Horizon control, sector click, table, export, screenshot |
| Risk Lab | `TESTED-PASS` | Sector select, matrix, drawdown/rolling charts, exports, screenshot |
| Fundamentals Lab | `TESTED-PASS` | Member selection, next sector, CSV, chart exports, screenshot |
| Quantitative Research Lab | `TESTED-PASS` | Weight sliders, reset, transition matrix, backtest, screenshot |
| Data Quality Center | `TESTED-PASS` | Re-check action, inventory/coverage, screenshot |
| Events & Research | `BLOCKED` | Page renders and explains why no verified events feed exists |
| Methodology | `TESTED-PASS` | 12 sections, formulas, screenshot |
| Private Account Ledger | `TESTED-PASS` | Six tabs, SMS import, fee/CGT engine, cash flow, WACC holdings, key vault; 48 backend tests; 10 synthetic screenshots; **not deployed** |
| Theme / command palette / mobile drawer / 404 | `TESTED-PASS` | Firefox + Chrome; screenshots for dark, mobile and 404 |
| CSV / PNG exports | `TESTED-PASS` | Real downloads inspected: non-empty files, expected headers/PNG dimensions |
| Cross-browser | `TESTED-PASS` (Chrome 36, Firefox 76) · `BLOCKED` (WebKit) | Playwright WebKit crashes with a host `Bus error`; Safari remains unverified |
| PostgreSQL path | `TESTED-PASS` | Ingested sectors/indices/securities/fundamentals into Postgres 16; `/api/health`, `/api/sectors`, `/api/dashboard`, `/api/heatmap`, `/api/rotation`, `/api/compare`, `/api/risk`, `/api/fundamentals` returned 200 |
| Docker image | `TESTED-PASS` | Multi-stage build succeeded; container served `/api/health` and the SPA (`nsi:local`) |
| Public deployment | `NOT-TESTED` | Free-tier options researched; no account/credentials used |
| Screen-reader / WCAG audit | `NOT-TESTED` | Keyboard palette and focus styles implemented; no VoiceOver/NVDA run |
| Load / soak testing | `NOT-TESTED` | No concurrent-user benchmark run |

---

## 2. Pages and routes

| Route | Page | Status | Main evidence |
| --- | --- | --- | --- |
| `/` | Dashboard | `TESTED-PASS` | `artifacts/screenshots/01-dashboard.png` |
| `/new` | New sector pulse | `TESTED-PASS` | prior session; live route on `sector-overview-web.vercel.app` |
| `/rotation` | Rotation Lab | `TESTED-PASS` | `02-rotation-lab.png` |
| `/compare` | Sector Comparison | `TESTED-PASS` | `03-sector-comparison.png` |
| `/breadth` | Breadth Lab | `TESTED-PASS` | `04-breadth-lab.png` |
| `/liquidity` | Liquidity Lab | `TESTED-PASS` | `05-liquidity-lab.png` |
| `/risk` | Risk Lab | `TESTED-PASS` | `06-risk-lab.png` |
| `/fundamentals` | Fundamentals Lab | `TESTED-PASS` | `07-fundamentals-lab.png` |
| `/sectors` | Sector Explorer | `TESTED-PASS` | `08-sector-explorer.png` |
| `/research` | Quantitative Research Lab | `TESTED-PASS` | `09-quantitative-research.png` |
| `/data-quality` | Data Quality Center | `TESTED-PASS` | `10-data-quality.png` |
| `/events` | Events & Research | `BLOCKED` | `11-events-research.png` |
| `/methodology` | Methodology | `TESTED-PASS` | `12-methodology.png` |
| `/account/*` | Private Account Ledger (six tabs) | `TESTED-PASS` | `docs/account-screenshots/` |
| any unknown path | Not found | `TESTED-PASS` | `16-not-found.png` |

Thirteen public content pages, the six private Account tabs and a 404 route. `Sector Comparison` is
an addition beyond the eleven pages named in the original brief; it is the natural home for the
multi-series line chart that the dashboard deliberately does not carry.

---

## 3. Backend surface

**19 public endpoints**, all `GET`, all read-only, cached in-process for 90 s. The private
`/api/account/*` router adds authenticated reads and writes; it is `Cache-Control: private,
no-store` and is documented separately in [ACCOUNT_LEDGER.md](ACCOUNT_LEDGER.md).

| Endpoint | Status | Notes |
| --- | --- | --- |
| `/api/health`, `/api/meta` | `TESTED-PASS` | Smoke checks in API tests |
| `/api/sectors`, `/api/sectors/{code}` | `TESTED-PASS` | 13 sectors; unknown code → 404 |
| `/api/dashboard` | `TESTED-PASS` | Market, rotation, heatmap, breadth, liquidity, risk, leaders, freshness |
| `/api/heatmap` | `TESTED-PASS` | 1/5/10/20/60/120/252-session matrix |
| `/api/rotation` | `TESTED-PASS` | Window, thresholds, census, transitions |
| `/api/rotation/trails` | `TESTED-PASS` | Path ordered by date; tests added |
| `/api/rotation/history` | `TESTED-PASS` | 120-session relative-rank history; tests added |
| `/api/compare` | `TESTED-PASS` | Common start, aligned series, 404 for unknown code; tests added |
| `/api/breadth` | `TESTED-PASS` | Market + sector drill-down; 260-session history/index join |
| `/api/liquidity` | `TESTED-PASS` | Turnover, HHI, top names, 5/20/60 returns |
| `/api/risk` | `TESTED-PASS` | 14×14 correlation matrix, rolling 60-session correlation, rolling 20-session volatility |
| `/api/fundamentals` | `TESTED-PASS` | Aggregates, members, validation notes |
| `/api/factors` | `TESTED-PASS` | Six configurable weights, coverage, missing factors |
| `/api/research` | `TESTED-PASS` | Transition matrix, illustrative backtest |
| `/api/events` | `BLOCKED` | Returns `UNAVAILABLE` with reasons; no invented calendar |
| `/api/data-quality` | `TESTED-PASS` | Inventory, coverage, classification, runs |
| `/api/methodology` | `TESTED-PASS` | Structured formula content |
| `/api/account/*` | `TESTED-PASS` | Private bearer-key ledger: vaults, imports, transactions, cash flow, holdings, fees, settlements, reversals, audit |

---

## 4. Feature matrix

| Feature | Status | Detail |
| --- | --- | --- |
| Rotation x = absolute, y = relative | `TESTED-PASS` | Axis contract pinned in tests and on-page |
| Four quadrants + boundary rule | `TESTED-PASS` | 12 rotation unit tests; ties go to Losing/Lagging |
| Lookbacks 5/10/20/60/120, default 20 | `TESTED-PASS` | 5/10/20/60/120 controls; 60-session control exercised |
| Configurable thresholds | `TESTED-PASS` | Panel opens; range inputs present; backend accepts thresholds |
| Enriched hover | `TESTED-PASS` | Rotation tooltip verified (sector, quadrant, absolute/relative, RS, 20D, volatility, cap, turnover, breadth, HHI, status); other charts not asserted mark-by-mark |
| Trails | `TESTED-PASS` | 10/25/50 controls; trail query tested for date order |
| Bubble metric selection | `TESTED-PASS` | Equal, market cap, turnover, volatility, breadth; volatility exercised |
| Sector visibility filter | `TESTED-PASS` | Hide one sector, counts update, Show all restores |
| Zoom / reset control | `TESTED-PASS` | Wheel zoom changed the canvas; reset restored the exact pre-zoom hash. Touch pinch `NOT-TESTED` |
| Synchronized ranking table | `TESTED-PASS` | Sorted table with selected sector; CSV carries the full columns |
| Transition table/timeline | `TESTED-PASS` | Recent crossings + 120-session rank/excess timeline |
| Compare presets / range / modes | `TESTED-PASS` | 1Y/3Y/5Y/All, manual dates, rebased/return/absolute |
| Breadth windows / drill-down | `TESTED-PASS` | 60/120/260; Commercial Banks deep dive |
| Risk sector selection | `TESTED-PASS` | Commercial Banks drawdown + rolling charts |
| Fundamentals member selection | `TESTED-PASS` | Table row + Next sector both exercised |
| Data Quality re-check | `TESTED-PASS` | Action completes; no console errors |
| Command palette (`⌘K`/`Ctrl-K`) | `TESTED-PASS` | Opens, filters, Enter navigates |
| Theme toggle | `TESTED-PASS` | Light → dark; dark screenshots captured |
| Mobile drawer | `TESTED-PASS` | Opens, navigates; no horizontal overflow at 390 px |
| CSV exports | `TESTED-PASS` | Rotation, Compare, Breadth, Liquidity, Risk, Fundamentals; headers/row counts checked |
| PNG exports | `TESTED-PASS` | Chart control downloads a real PNG (magic bytes + 2172×1040 verified on compare) |
| Honest unavailable states | `TESTED-PASS` | Events, Mutual Fund fundamentals, missing data paths render `—`/`UNAVAILABLE` |

---

## 5. Data status

| Dataset | Rows | Status | Disclosure |
| --- | --- | --- | --- |
| Sector + NEPSE index observations | 41,509 | `VERIFIED` / `INCOMPLETE` per series | Coverage table in Data Quality |
| Security reference | 467 | `PROVISIONAL` snapshot | 331 classified; 343 with market cap |
| Daily summaries | 433,817 | `VERIFIED` mirror | No intraday OHLC; current membership bias |
| Memberships | 331 | `PROVISIONAL` | Current only; no history |
| Fundamental reports | 4,840 across 307 symbols | `PROVISIONAL` | Mixed periods; book-value screen |
| Corporate events | 0 | `UNAVAILABLE` / `BLOCKED` | No verified free feed; page explains |

---

## 6. Known gaps that are not bugs

* Historical membership and full financial statements are not available from the verified sources.
* The official NEPSE API returns HTTP 401 and was not bypassed.
* Free-host cold starts and ephemeral disks are deployment properties, not app defects.
* ECharts canvases are not screen-reader accessible; text tables and summaries are the fallback.
* Safari/WebKit has not been tested because Playwright's WebKit build crashes on this host.
* Account tables are created with `create_all`; there is no Alembic history yet. The Account
  feature is tested locally but has not been committed, pushed or deployed.

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for the full list and
[FUNCTIONALITY_AUDIT.md](FUNCTIONALITY_AUDIT.md) for the requirement-by-requirement trace.
