# Testing Report

**Date:** 2026-10-22
**Build tested:** the production bundle served by FastAPI at `http://127.0.0.1:8000` (not the Vite dev
server), backed by the ingested SQLite warehouse (latest session 2026-10-16).
**Environment:** macOS 14.3.1 (Darwin arm64), Python 3.12.3, Node 24.20.0, npm 11.19.0.
**Browsers:** Firefox 1555 (Playwright) and Google Chrome (installed channel) on macOS.

Statuses use the project vocabulary: `TESTED-PASS`, `TESTED-FAIL`, `NOT-TESTED`, `BLOCKED`.

---

## 1. Result summary

| Layer | Checks | Result |
| --- | --- | --- |
| Backend unit + API tests | **64 passed** | `TESTED-PASS` |
| Ruff lint (backend) | clean | `TESTED-PASS` |
| TypeScript (`tsc -b`) | clean | `TESTED-PASS` |
| Production build (Vite) | succeeded | `TESTED-PASS` |
| Firefox primary interaction pass | **55 / 55** | `TESTED-PASS` |
| Firefox supplemental audit | **15 / 15** | `TESTED-PASS` |
| Firefox extras (tooltip, zoom, breadth/liquidity CSV) | **6 / 6** | `TESTED-PASS` |
| Chrome smoke / interaction pass | **36 / 36** | `TESTED-PASS` |
| **Total browser checks** | **112** | `TESTED-PASS` |
| Screenshot evidence | 16 final images | `TESTED-PASS` (captured) |
| WebKit / Safari | launch failure | `BLOCKED` |

No open `TESTED-FAIL` item remains. Two early Firefox assertions and four Chrome route-title
assertions failed because the harness expected the wrong label or a chart on a page that intentionally
has none; the app was correct and the assertions were corrected before the recorded pass. They are
listed in §7 so the history is not hidden.

---

## 2. Automated backend suite

```text
cd backend && .venv/bin/python -m pytest -p no:warnings
................................................................         [100%]
64 passed in 1.28s

cd backend && .venv/bin/ruff check app tests
All checks passed!
```

| File | Tests | What is pinned |
| --- | --- | --- |
| `tests/test_calculations.py` | 14 | Returns, daily returns, drawdown/recovery, volatility, beta, MA, RSI, MACD warm-up masking, correlation length guard, HHI, top-share, VaR/CVaR |
| `tests/test_rotation.py` | 12 | All four quadrants, boundary cases at `x=0`/`y=0`, custom thresholds, missing values, RS-ratio guard, transitions |
| `tests/test_breadth.py` | 6 | Advance/decline denominators, missing observations excluded, unchanged handling, A/D ratio, sector breadth |
| `tests/test_api.py` | 25 | 19-route contract, JSON finiteness, cache clearing, 404s, envelopes, compare alignment/common start, rotation history shape, trail ordering |
| `tests/test_analytics_units.py` | 7 | Shared analytics/calculation invariants used by the payload builders |

The API suite uses a temporary SQLite database seeded with 300 real-shaped sessions for `BANKING` and
`NEPSE`. It deliberately exercises the single-sector case as well as the live 13-sector database.

### New coverage added in this pass

* `test_compare_aligns_series` — both series start at the computed common date, are date-sorted, and
  end on the same session.
* `test_compare_unknown_series_404`.
* `test_rotation_history_shape` — 60 dates, each rank/relative/absolute array aligns, ranks are not
  all null.
* `test_rotation_trails_are_ordered` — trail length bounded, dates sorted, coordinates present.
* `test_calculations.test_correlation_rejects_mismatched_lengths` and the MACD warm-up test.

---

## 3. Firefox interaction pass

Scripts (committed for reproducibility):

```text
scripts/verification/firefox-primary.cjs      55 checks
scripts/verification/firefox-supplemental.cjs 15 checks
scripts/verification/firefox-extras.cjs        6 checks
```

Run against the production build:

```bash
NODE_PATH=/path/to/node_modules node scripts/verification/firefox-primary.cjs
NODE_PATH=/path/to/node_modules node scripts/verification/firefox-supplemental.cjs
NODE_PATH=/path/to/node_modules node scripts/verification/firefox-extras.cjs
```

### 3.1 Primary pass — 55 / 55

| Page / area | Checks exercised |
| --- | --- |
| Sector Comparison | Heading; 1Y preset updates From date; 5Y selected; Return % mode; chip toggles a series off; Reset restores 3Y + chip; CSV; PNG; zero console errors |
| Rotation Lab | Heading; 60-session lookback updates eyebrow; volatility bubble; filter opens; hide Commercial Banks (12/13); Show all (13/13); timeline Excess mode; threshold panel; Reset restores 20 + Rank; CSV; PNG; zero console errors |
| Breadth Lab | 260-window badge; 60-window badge; PNG; zero console errors |
| Risk Lab | Sector select changes to `BANKING`; CSV; PNG; zero console errors |
| Fundamentals Lab | Next sector changes the member panel; CSV; PNG; zero console errors |
| Sector Explorer | Finance chip switches panel; 1Y range selected; PNG; zero console errors |
| Research Lab | Weight slider changes output; reset restores the first weight to 25; zero console errors |
| Data Quality / Events / Methodology / 404 | Each renders an `h1`; zero console errors |
| Command palette | `Meta+K` opens; typing `rotation` + Enter navigates to `/rotation` |
| Theme | Toggle adds `dark` to `<html>` |
| Mobile 390 px | Drawer opens; Rotation link navigates; zero console errors |

### 3.2 Supplemental pass — 15 / 15

| Check | Evidence |
| --- | --- |
| Rotation table selects Hydro Power | Selected-sector panel and "Open full sector" appear |
| Trail 25 keeps both charts | Chart count ≥ 2 |
| Zoom reset control | Caption remains, chart survives |
| Rotation CSV structure | 14 lines, header begins `Sector,Code,Absolute,…` |
| Breadth deep dive | Commercial Banks shows "Members above their own moving average" + Clear |
| Fundamentals table selects Finance | Member detail updates |
| Fundamentals CSV structure | 14 lines, header `sector,coverage,net_profit_npr,…` |
| Data Quality re-check | Action completes, page stays rendered |
| Compare CSV structure | 5 lines (4 series + header), header begins `Series,Code,First close,…` |
| Compare PNG | Magic bytes `89504e47…`; 2172×1040; 484,907 bytes |
| All five pages | Zero console/page errors |

### 3.3 Extras — 6 / 6

| Check | Evidence |
| --- | --- |
| Enriched rotation tooltip | Hovering Life Insurance shows sector name, `WINNING`, absolute/relative, RS ratio, 20-session return, volatility, market cap, turnover, advancing members, HHI and latest-observation status |
| Wheel zoom | Scrolling over the map changes the rendered canvas hash |
| Reset zoom | The `Reset zoom` control restores the **exact** pre-zoom canvas hash (`c737a2d0…`) |
| Breadth CSV | `nepse-breadth-2026-10-16.csv`, 13 lines; header begins `Sector,Advances,Declines,…` |
| Liquidity CSV | `nepse-liquidity-2026-10-16.csv`, 13 lines; header begins `Sector,Turnover,Share,…` |
| Error channels | Zero console/page errors across the rotation, breadth and liquidity runs |

The zoom check is byte-level, not a visual impression: the canvas screenshot MD5 before zoom and after
reset are identical. The tooltip check targets text that exists **only** in the tooltip (“Advancing
members”, “Turnover HHI”), so it cannot be satisfied by the table.

### 3.4 Downloads inspected

| File | Observed |
| --- | --- |
| `nepse-compare-2023-10-22-latest.csv` | 503 B, 5 rows, series summary header |
| `nepse-compare-normalized.png` | 484,906 B, 2172×1040 |
| `nepse-rotation-20s-2026-10-16.csv` | 3,645 B, 14 rows, full table columns |
| `nepse-rotation-20s.png` | 171,320 B |
| `nepse-risk-metrics.csv` | 2,180 B |
| `risk-return-scatter.png` | 109,528 B |
| `breadth-advance-decline.png` | 271,626 B |
| Fundamentals CSV | 14 rows, aggregate header verified |
| `nepse-breadth-2026-10-16.csv` | 13 lines (12 sectors + header), advance/decline/traded columns |
| `nepse-liquidity-2026-10-16.csv` | 13 lines (12 sectors + header), turnover/share/HHI columns |

Rows are raw values (fractions for returns, NPR for money); the filename carries the selected window
and latest date where relevant. Exports are generated entirely in the browser; no server round-trip.

---

## 4. Chrome cross-browser pass

Script: `scripts/verification/chrome-smoke.cjs`

```text
PASS chrome / renders … /methodology renders   (12 routes)
PASS chrome * no console errors                (12 routes)
PASS chrome rotation lookback + CSV + PNG
PASS chrome compare preset + CSV
PASS chrome sector switch
PASS chrome mobile no horizontal overflow
PASS chrome mobile drawer navigates
PASS chrome mobile no errors
PASS chrome command palette
PASS chrome dark theme
PASS chrome layout no errors

CHROME SUMMARY { pass: 36, fail: 0 }
```

The Chrome run uses the installed Chrome channel, not bundled Chromium. Chart canvases, downloads,
presets, the sector switch, the mobile drawer and the command palette all worked. There were **zero
console or page errors** on all 12 routes.

### WebKit

```text
npx playwright install webkit   # downloaded
node … webkit smoke
browserType.launch: Target page, context or browser has been closed
… Bus error: 10
```

Playwright's WebKit build crashes before the first page on this macOS host. No Safari/WebKit claim is
made. This is recorded as `BLOCKED`, not as an app failure.

---

## 5. Screenshot evidence

Sixteen final PNGs, all captured from the running production build in a **fresh Chrome instance per
page** (Playwright `channel: 'chrome'`). The viewport height was set to the measured content height **before** navigation, so each
image is a single viewport rather than a stitched full-page capture. This avoids the Chromium
full-page stitching artifacts observed during the build. Text in low-resolution previews was
re-checked with 2–3× nearest-neighbour crops before any layout conclusion was drawn.

| File | Viewport | What it shows |
| --- | --- | --- |
| `01-dashboard.png` | 1440×2711 | Full dashboard: lead, rotation, heatmap, breadth, liquidity, risk, trust |
| `02-rotation-lab.png` | 1440×2988 | Map, table, selected sector, timeline, crossings, axis contract |
| `03-sector-comparison.png` | 1440×1905 | Rebased multi-series chart and statistics |
| `04-breadth-lab.png` | 1440×2248 | 120-session breadth, divergence, sector width, deep dive |
| `05-liquidity-lab.png` | 1440×2419 | Stacked turnover, share donut, scatter, concentration |
| `06-risk-lab.png` | 1440×3153 | Risk/return, volatility, 14×14 correlation, table, drawdown |
| `07-fundamentals-lab.png` | 1440×2440 | P/E dot plot, ROE bubble, aggregates, member table |
| `08-sector-explorer.png` | 1440×2901 | Price structure, participation, liquidity, risk, filings |
| `09-quantitative-research.png` | 1440×2066 | Factor model, ranking, attribution, transitions, backtest |
| `10-data-quality.png` | 1440×2718 | Coverage, inventory, validation, runs, source register |
| `11-events-research.png` | 1440×1211 | Planned coverage and `UNAVAILABLE` source status |
| `12-methodology.png` | 1440×3999 | Full method reference |
| `13-dashboard-dark.png` | 1440×900 | Dark theme, top of dashboard |
| `14-rotation-dark.png` | 1440×900 | Dark theme, rotation map and controls |
| `15-dashboard-mobile.png` | 390×844 | Mobile layout; scroll width equals client width |
| `16-not-found.png` | 1440×900 | 404 route |

The screenshot directory contains only these 16 files; exploratory/test captures were removed.

---

## 6. What was not tested

| Area | Status | Why |
| --- | --- | --- |
| Safari / WebKit | `BLOCKED` | Playwright WebKit `Bus error` before launch on this host |
| PostgreSQL | `TESTED-PASS` | Postgres 16 container; ingestion and 8 endpoint smoke checks passed |
| Docker build / image run | `TESTED-PASS` | Multi-stage image built; container served `/api/health` and `/` on port 8000 |
| Public deployment / cold starts | `NOT-TESTED` | No account or credentials used |
| VoiceOver / NVDA / formal WCAG | `NOT-TESTED` | No assistive-technology audit run |
| Load / concurrency | `NOT-TESTED` | No benchmark |
| Hover tooltip on every mark | `IMPLEMENTED` | The enriched rotation tooltip was verified; other charts' tooltips were not asserted mark-by-mark |
| Wheel/pinch zoom | `TESTED-PASS` (wheel) · `NOT-TESTED` (touch pinch) | Wheel zoom changed the canvas and reset restored it byte-for-byte; no touch device was available |

---

## 7. Harness corrections (not app defects)

These early failures are recorded so the final green run is not mistaken for a run that was always
green.

| Early failure | Cause | Resolution |
| --- | --- | --- |
| Breadth badge assertion expected `120 index sessions` | CSS uppercases the status badge; `innerText` returns `120 INDEX SESSIONS` | Assertion made case-insensitive; UI was correct |
| Rotation thresholds asserted number inputs | Thresholds are range sliders | Query corrected to `input[type=range]` |
| Fundamentals waited for "Latest reported snapshot" | That label belongs to Sector Explorer; Fundamentals uses a member-detail card | Wait on the page `h1` and the member panel |
| Sector Explorer expected the breadth title immediately | The sector query had not resolved within 1 s | Wait for the new panel text; UI was correct |
| Chrome expected `/turnover/i`, `/Price structure/i`, `/method/i` | Actual page titles are "Trading value is not conviction.", "One sector, every lens.", "Every number has a definition." | Assertions corrected |
| Chrome expected a chart on Data Quality | That page is intentionally table/status-led | Chart assertion exempted |
| Extras script read `.chart-frame` without scoping | Rotation has three chart frames | Scoped the text assertion to the rotation-map frame; app was correct |

---

## 8. Reproduce

```bash
# backend
cd backend
.venv/bin/python -m pytest -p no:warnings
.venv/bin/ruff check app tests

# frontend
cd ../frontend
npx tsc -b
npm run build

# serve the built app
cd ../backend
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# browser checks (requires Playwright; see scripts/verification/README.md)
cd ..
node scripts/verification/firefox-primary.cjs
node scripts/verification/firefox-supplemental.cjs
node scripts/verification/chrome-smoke.cjs
```

---

## 9. Final release audit (2026-10-22)

**Commit under audit (code):** `869a9e335afe278540c6813366d8410256bfc2f0`
**Final audit/documentation commit:** `77e1d3c06b019598b61bb41cb65e29a6c44a8ec9`

### 9.1 Commands and results

| Command | Result |
| --- | --- |
| `cd backend && .venv/bin/python -m pytest -p no:warnings` | `64 passed in 1.44s` |
| `cd backend && .venv/bin/ruff check app tests` | `All checks passed!` |
| `cd frontend && npx tsc -b` | clean |
| `cd frontend && npm run build` | succeeded, `✓ built in 3.27s` |
| `node scripts/verification/firefox-primary.cjs` | `55 / 55` pass |
| `node scripts/verification/firefox-supplemental.cjs` | `15 / 15` pass |
| `node scripts/verification/firefox-extras.cjs` | `6 / 6` pass |
| `node scripts/verification/chrome-smoke.cjs` | `36 / 36` pass |
| `docker build -t nsi:local .` + container smoke | image built; container served `/api/health` and `/` on port 8000 |
| Postgres 16 smoke (`DATABASE_URL=postgresql+psycopg://...`) | ingestion + 8 endpoint checks passed |
| Final page navigation (Chrome) | 13 routes rendered, including `/no-such-page`; zero console/page errors |

### 9.2 Screenshots

Final gallery: `artifacts/screenshots/` (16 PNGs), captured in a fresh Chrome instance per page with the
viewport height set before navigation. Dimensions and method are in
[`artifacts/screenshots/README.md`](../artifacts/screenshots/README.md). All captures showed a successfully
rendered page and zero console errors.

### 9.3 Rotation verification

The API was checked for all five lookbacks (`5, 10, 20, 60, 120`) across all 13 sectors:

- `absolute_strength` = sector return over the selected lookback
- `relative_strength` = sector return − NEPSE return over the same lookback
- Quadrant boundaries: `WINNING (x>0,y>0)`, `ADVANCING (x≤0,y>0)`, `LOSING (x>0,y≤0)`,
  `LAGGING (x≤0,y≤0)`
- Result: **0 mismatches** out of 65 sector/window combinations. The boundary rule is also pinned by
  12 unit tests in `tests/test_rotation.py`.
- Hover tooltip was verified on the rotation map (Life Insurance) and includes absolute, relative, RS
  ratio, 20-session return, volatility, market cap, turnover, advancing members, HHI and status.
- Wheel zoom changed the rendered canvas; the `Reset zoom` control restored the exact pre-zoom hash.

### 9.4 Data provenance audit

| Data | Type | Status |
| --- | --- | --- |
| 13 sector sub-indices + NEPSE closes | Historical mirror (1997–2026) | `VERIFIED` / `INCOMPLETE` per series |
| Security reference and daily summaries | Historical mirror | `VERIFIED` |
| Membership and market-cap snapshot | Static snapshot (2026-10-16) | `PROVISIONAL` |
| Fundamental reports | Mixed-period filings | `PROVISIONAL` |
| Corporate events | None | `UNAVAILABLE` / `BLOCKED` |
| Backtest equity curve | Illustrative replay | `ILLUSTRATIVE` |

Missing observations are `null`, never zero. Historical membership is current-only and is disclosed as a
survivorship/classification bias. No data is presented as live NEPSE data.

### 9.5 Controls exercised

Lookback chips, threshold sliders, bubble metric, sector visibility filter, zoom/reset, trail length,
timeline mode, comparison presets/date inputs/modes/chips, breadth windows and deep dive, risk sector
selection, fundamentals member selection and next-sector, data-quality re-check, command palette, theme
toggle, mobile drawer, CSV and PNG exports.

### 9.6 Sector focus

Navigation and routes were checked for stock-picking pages, candlestick charts, or OHLC warehouses. None
exist. Member data is used only for breadth, liquidity, capitalisation and concentration.

### 9.7 Remaining risks

- Safari/WebKit remains untested (`BLOCKED`: Playwright WebKit crashes on this host).
- Public deployment and load testing remain `NOT-TESTED`.
- Screen-reader/WCAG audit remains `NOT-TESTED`.
- Touch pinch zoom remains `NOT-TESTED`.
- Tooltips on charts other than the rotation map are implemented but not asserted mark-by-mark.
