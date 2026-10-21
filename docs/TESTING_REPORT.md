# Testing Report

**Date:** 2026-10-22
**Build tested:** the production bundle served by FastAPI at `http://127.0.0.1:8000` (not the Vite dev
server), backed by the ingested SQLite warehouse (latest session 2026-10-16).
**Environment:** macOS 14.3.1 (Darwin arm64), Python 3.12.3, Node 24.20.0, npm 11.19.0, Chromium
driven by Playwright.

Statuses use the project vocabulary: `TESTED-PASS`, `TESTED-FAIL`, `NOT-TESTED`, `BLOCKED`.

---

## 1. Automated backend tests — TESTED-PASS

```
cd backend && .venv/bin/python -m pytest -q -p no:warnings
58 passed in 1.21s
cd backend && .venv/bin/ruff check app tests
All checks passed
```

| File | Tests | What is pinned |
| --- | --- | --- |
| `test_calculations.py` | 12 | Cumulative return positions, zero/missing bases, daily returns, YTD base, drawdown/recovery, volatility, beta, MA, RSI, HHI, top-share, VaR/CVaR |
| `test_rotation.py` | 12 | All four quadrants, **all boundary cases** (`x=0`, `y=0`), custom thresholds, missing values, RS ratio window guard, transitions |
| `test_breadth.py` | 6 | Denominator rules, missing ≠ unchanged, zero-decline A/D, all-unavailable, % above MA, new highs/lows |
| `test_analytics_units.py` | 7 | Concentration, P/E with losses, implausible book value excluded, unverifiable book value included, factor renormalisation |
| `test_api.py` | 21 | Health, meta, axis contract, sector detail, 404, methodology, **11 endpoints return valid sanitised JSON**, factor payload shape, research payload shape, completeness status, serialiser scrubs `NaN`/`Infinity` |

Key assertions worth naming:

* `test_quadrants[0.0-0.02-ADVANCING]` — zero absolute with positive relative is **Advancing**.
* `test_quadrants[0.05-0.0-LOSING]` — positive absolute with zero relative is **Losing**.
* `test_missing_is_not_unchanged` — absence is excluded from the denominator.
* `test_endpoints_return_sanitised_json[*]` — asserts the literal strings `NaN` and `Infinity` never
  appear in the response body and that every response parses.
* `test_data_quality_status_reflects_completeness` — coverage and status agree.

### Post-fix verification

A stale-results bug in the command palette (searching "risk" surfaced Dashboard first because its
description mentions risk) was fixed by ranking label matches above description matches. The fix was
re-verified in the browser: typing `risk` lists **Risk Lab** first and Enter navigates to `/risk`.

Mobile regression found during this pass: after adding a minimum-width heatmap scroller, the page
itself overflowed horizontally (390 px viewport, 570 px scroll width). Root cause: CSS grid items
default to `min-width: auto`. Fixed by `min-w-0` on the card primitive. Re-test: scroll width 380 px =
client width 380 px, and the heatmap scrolls internally (520 px content in a 314 px viewport).

---

## 2. Frontend static checks — TESTED-PASS

```
cd frontend && npx tsc -b          # exit 0
cd frontend && npm run build       # exit 0, 23 assets, dist ≈ 1.1 MB
```

Production chunks:

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `echarts` (vendor, lazily used by chart pages) | 708.46 kB | 235.66 kB |
| `react` (vendor) | 163.69 kB | 53.30 kB |
| `index` (app shell) | 54.90 kB | 17.38 kB |
| `Dashboard` (lazy) | 22.16 kB | 6.66 kB |
| `SectorExplorer` (lazy) | 16.94 kB | 5.56 kB |
| `Methodology` (lazy) | 14.84 kB | 5.67 kB |
| CSS | 28.11 kB | 6.37 kB |

ECharts was switched from the full package to explicit `echarts/core` registration: 1,052 kB →
708 kB raw (348 → 236 kB gzip), a 32 % reduction, with no missing-component errors at runtime.

---

## 3. Browser pass — TESTED-PASS

Twelve routes were loaded in a real Chromium session at 1440 × 900, with a 2–4 s settle and console
capture.

| Route | Page | Console errors | Rendered |
| --- | --- | --- | --- |
| `/` | Dashboard | 0 | KPI cards, 4 charts, leadership, breadth, turnover treemap, risk scatter, freshness |
| `/sectors` | Sector Explorer | 0 | 3 charts, technical panel, breadth, liquidity, member table |
| `/rotation` | Rotation Lab | 0 | Quadrant (canvas), trail sparkline, census, table, crossings |
| `/breadth` | Breadth Lab | 0 | Participation chart, net advances, sector table; sector name opens the MA-breadth deep dive |
| `/liquidity` | Liquidity Lab | 0 | Stacked turnover, donut, table, concentration panel |
| `/risk` | Risk Lab | 0 | Bubble, volatility ranking, risk table, drawdown |
| `/fundamentals` | Fundamentals Lab | 0 | P/E bars, ROE/P/E bubbles, sector table, members |
| `/events` | Events & Research | 0 | Explicit UNAVAILABLE state |
| `/research` | Quantitative Research Lab | 0 | Score bars, attribution, persistence heatmap, backtest |
| `/data-quality` | Data Quality Center | 0 | Coverage table, inventory, controls, runs, register |
| `/methodology` | Methodology | 0 | Ten sections, formulas, status vocabulary |
| `/nope` | Not found | 0 | Designed 404 with navigation back |

**Total console errors across the sweep: 0.** No unhandled promise rejections, no ECharts
"series/component not found" errors, no React key warnings.

### Interaction evidence

| Interaction | Method | Observed result |
| --- | --- | --- |
| Rotation lookback 20 → 5 | Click `[role=tab][aria-label="Lookback"]` first tab | Header changed `ABSOLUTE VS RELATIVE · 20 SESSIONS` → `· 5 SESSIONS`; table recomputed (Commercial Banks `+3.8 %` absolute, `+2.1 %` relative) |
| Trail replay 25 → 50 | `Trail` tablist | `aria-selected` moves; chart redraws |
| Command palette open | `⌘K` | Dialog `[aria-label="Command palette"]` opens, input autofocuses |
| Command palette search | Type `risk` | Results: **Risk Lab**, Dashboard, Sector Explorer (label match ranked first) |
| Command palette navigate | `Enter` | URL `/risk`, H1 "Return is what happened. Risk is the shape of the path." |
| Theme toggle | Click `[aria-label="Switch to dark theme"]` | `html` class `dark`, body background `rgb(11, 17, 16)`, charts recolour |
| Sector switch | Click "Hydro Power" chip | URL `/sectors?code=HYDROPOWER`, 3 canvases re-render |
| Factor weights | Focus `input[aria-label="20D momentum weight"]`, 8 × ArrowRight | Value 25 → 50, `total weight 125`, table reloads, Commercial Banks score 91.4 → 92.4 |
| Mobile drawer | 390 × 844, click `[aria-label="Open menu"]` | Primary nav visible, body scroll locked |
| Mobile overflow | 390 × 844 | `scrollWidth = clientWidth = 380`; heatmap scroller 520 px inside 314 px |
| Sector heatmap cell click | Click a cell on the dashboard heatmap | URL `/sectors?code=HYDROPOWER`, H1 "One sector, every lens.", 3 charts render |
| Breadth deep dive | Click a sector name in the breadth table | Chart count 1 → 2; "Members above their own moving average" appears (MA 20/50/100/200) |

### Screenshots (real captures, not mockups)

| File | Content |
| --- | --- |
| `01-dashboard.png` | Full dashboard, light theme, 1440 px |
| `02-sector-explorer.png` | Commercial Banks detail |
| `03-rotation-lab.png` | Quadrant + table at 20 sessions |
| `04-breadth-lab.png` | Participation, MA breadth, sector table |
| `05-liquidity-lab.png` | Stacked turnover, donut, concentration |
| `06-risk-lab.png` | Risk/return bubbles, ranking, drawdown |
| `07-fundamentals-lab.png` | P/E bars, log-axis ROE/P/E, member table |
| `08-events-research.png` | UNAVAILABLE disclosure |
| `09-research-lab.png` | Factor bars, attribution, persistence, backtest |
| `10-data-quality.png` | Coverage with INCOMPLETE rows, source register |
| `11-methodology.png` | Full methodology |
| `12-not-found.png` | 404 |
| `13-dark-rotation.png` | Dark theme, rotation trails |
| `14-command-palette.png` | Palette open |
| `15-command-palette-search.png` | Filtered to "risk" |
| `16-mobile-dashboard.png` | 390 px dashboard |
| `17-sector-explorer-hydro.png` | Sector switched to Hydro Power |
| `18-research-weights.png` | Weights changed, scores recomputed |
| `19-mobile-drawer.png` | Mobile navigation drawer |
| `20-rotation-trail-50.png` | Trail replayed from 25 to 50 sessions |
| `21-heatmap-cell-click.png` | Sector page reached by clicking a dashboard heatmap cell |
| `22-breadth-deep-dive.png` | Breadth deep dive opened from a sector name |

---

## 4. Performance — TESTED-PASS

Measured with `curl` against the running server, cold cache (server just started) and warm cache
(in-process TTL still valid).

| Endpoint | Cold | Warm | Raw | Gzip |
| --- | --- | --- | --- | --- |
| `/api/dashboard` | 1.312 s | 0.011 s | 47 kB | 10 kB |
| `/api/rotation` | 0.124 s | 0.001 s | 6 kB | 1 kB |
| `/api/heatmap` | 0.076 s | 0.001 s | 3 kB | 1 kB |
| `/api/breadth` | 0.342 s | 0.004 s | 27 kB | 4 kB |
| `/api/liquidity` | 0.292 s | 0.008 s | 95 kB | 24 kB |
| `/api/risk` | 0.127 s | 0.001 s | 3 kB | 1 kB |
| `/api/fundamentals` | 0.590 s | 0.007 s | 81 kB | 13 kB |
| `/api/factors` | 0.518 s | 0.002 s | 11 kB | 2 kB |
| `/api/research` | 0.150 s | 0.002 s | 18 kB | 9 kB |
| `/api/data-quality` | 0.188 s | 0.001 s | 8 kB | 2 kB |
| `/api/sectors` | 0.002 s | 0.001 s | 2 kB | < 1 kB |

Optimisations proven by the numbers:

* Vectorised transition/backtest replay: `/api/research` 15.48 s → 0.12–0.15 s.
* Dashboard no longer ships the 260-session liquidity history: 141 kB → 47 kB raw.
* GZip middleware: dashboard 47 kB → 10 kB, liquidity 95 kB → 24 kB on the wire.
* In-process 90 s TTL: warm payloads 1–11 ms.

### Ingestion idempotency — TESTED-PASS

The fundamentals stage was run twice against the final build. Each run wrote 4,840 rows, the table
count stayed at 4,840 and no duplicate `(symbol, fiscal year, quarter, report type)` keys appeared.
The stage now replaces the snapshot in one transaction, so an amended filing (same key, newer
document) is refreshed instead of being skipped. The run log intentionally retains two failures from
the development session (a `float.strip` bug and a unique-constraint bug); both were fixed and rerun,
and the Data Quality Center shows the real history.

---

## 5. Not tested / blocked

| Area | Status | Reason |
| --- | --- | --- |
| Firefox, Safari, iOS Safari | `NOT-TESTED` | Only Chromium was available in this environment |
| Screen-reader walkthrough (VoiceOver/NVDA) | `NOT-TESTED` | No assistive-technology session was run; text/table equivalents exist but were not audited with AT |
| Load/concurrency testing | `NOT-TESTED` | Single-user local run only; no k6/Locust run |
| Postgres behaviour | `NOT-TESTED` | No PostgreSQL server available; SQLAlchemy models are dialect-neutral and `psycopg` is declared, but the deployed path was not exercised |
| Docker image build | `NOT-TESTED` | Dockerfile written and reviewed; no `docker build` run in this environment |
| Free-host deployment | `NOT-TESTED` | No provider account provisioned; see DEPLOYMENT.md |
| Corporate events | `BLOCKED` | No verified public feed; the page reports `UNAVAILABLE` |
| Historical sector membership | `BLOCKED` | Not published by any available source |
| Revenue/assets/leverage fundamentals | `BLOCKED` | Absent from the verified filings feed |
| Official NEPSE endpoints | `BLOCKED` | HTTP 401; authentication not bypassed |
| Reduced-motion chart animation | `NOT-TESTED` | CSS motion is respected; ECharts animation is not tied to the media query |

---

## 6. Method notes and honest limitations

* The browser pass is **exploratory**, not a scripted regression suite. There is no committed
  Playwright test file yet; the evidence is the captured console output, DOM assertions and
  screenshots above.
* The screenshots are of the **production bundle** served by the API, which is why routing, static
  assets and SPA fallback are exercised together.
* Cold timings include pandas frame construction and are single-run; they are indicative, not a
  benchmark.
* No claim is made that the app is accessible, cross-browser or load-tested beyond what is listed.
  Every unimplemented check is marked `NOT-TESTED`, not assumed.
