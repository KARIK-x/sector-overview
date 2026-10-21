# Project Plan — NEPSE Sector Intelligence

## 1. Problem

Nepal Stock Exchange commentary is dominated by index-level headlines ("NEPSE up 12 points") and
stock tips. The sector layer — where capital actually rotates — is usually presented as a single
ranked table with no axis contract, no participation evidence, no liquidity context and no disclosure
of data gaps.

This project builds a **sector-only intelligence surface** that is:

* **visualisation-first** — the charts are the product, not decoration on top of tables;
* **quantitative** — every view is backed by a documented formula, not a score invented in the UI;
* **provenanced** — every dataset has a named origin, a verification status and a visible gap list;
* **honest about absence** — modules that cannot be computed from verified public data say so.

## 2. Scope

### In scope

| Area | Detail |
| --- | --- |
| Sector index history | 13 NEPSE equity sub-indices + the NEPSE benchmark, daily closes |
| Rotation | Absolute strength × relative strength, 5/10/20/60/120-session lookbacks |
| Breadth | Advance/decline, advance share, MA participation, new highs/lows, thrust, divergence |
| Liquidity | Turnover, volume, sector share, internal concentration (HHI, effective N, top-1/top-5) |
| Risk | Volatility, beta, correlation, drawdown anatomy, historical VaR/CVaR |
| Fundamentals | Aggregate profit, market cap, P/E (incl. and excl. losses), EPS, ROE, book value |
| Research | Factor scoring with user weights, quadrant transition matrix, illustrative rotation backtest |
| Trust | Data-quality centre, source register, methodology, explicit UNAVAILABLE states |

### Explicit non-goals

* No individual-stock trading terminal or order workflow.
* No stock-picking score, "buy" list, target price or forecast.
* No candlestick charting, OHLC warehouse or intraday data.
* No portfolio accounting, P&L, broker integration or authentication.
* No reuse of the separate "Mega Tool" application: no shared frontend, backend, database, candle
  history, analytics engine, environment variables or infrastructure.

Minimal per-company daily summaries (close, previous close, change, percent change, volume, turnover,
status, sector) are stored **only** to compute sector breadth, liquidity, concentration and
capitalisation. No open/high/low series is retained.

## 3. Priorities (in order)

1. **Correctness** — formulas unit-tested; axis and quadrant contracts frozen by tests.
2. **Analytical depth** — more than one lens per question; no single-score answers.
3. **Visualisation quality** — purposeful encodings, readable dense charts, consistent design language.
4. **Provenance** — sources, freshness, coverage and rejection reasons are part of the product.
5. **Performance** — vectorised research pipeline, request-level caching, compressed JSON.
6. **Reliability** — deterministic payloads, no non-finite JSON, graceful empty states.
7. **Maintainability** — calculations separated from services, typed API client, one source of truth.
8. **Responsive design** — usable at 390 px, no page-level horizontal overflow.
9. **Efficient resources** — one process, SQLite by default, no paid infrastructure required.

## 4. Constraints and how they shaped the design

| Constraint | Consequence |
| --- | --- |
| Official NEPSE API requires authentication (HTTP 401) | Use three documented public mirrors; disclose mirror provenance; never bypass auth |
| Historical sector membership is not published | Apply current membership to history and label every breadth/aggregate view accordingly |
| Fundamentals lack revenue, assets and liabilities | Aggregate only fields present (profit, EPS, P/E, paid-up capital, net worth/share); no margin or leverage ratios |
| Some sub-index mirrors are sparse | Show completeness per series; mark < 98 % coverage `INCOMPLETE`; long-window returns span more calendar time |
| Source occasionally publishes corrupted book values | Per-company price-to-book plausibility check; reject and disclose rather than average |
| No corporate-events feed | Events module reports `UNAVAILABLE`; no fabricated calendar |
| Free hosting only | Single container / single process, SQLite or free Postgres, in-process cache, no message broker |

## 5. Architecture decisions

| Decision | Rationale |
| --- | --- |
| **FastAPI + SQLAlchemy 2 + pandas/numpy/scipy** | Vectorised analytics, typed request layer, one language for ingestion and serving |
| **SQLite default, PostgreSQL via `DATABASE_URL`** | Zero-cost local development; free managed Postgres for deployment |
| **Read-only API, separate ingestion CLI** | A request can never mutate the warehouse; ingestion is auditable and rerunnable |
| **Calculations package isolated from services** | Formulas are unit-tested without HTTP or database fixtures |
| **Single-service production build** | FastAPI serves the built SPA; one free web service is enough |
| **React 18 + Vite + Tailwind + ECharts** | Small typed SPA, explicit chart options, canvas rendering for dense data |
| **React Query + route-level code splitting** | Cache API reads across navigation; keep first paint small |
| **Explicit ECharts core registration** | 708 kB vs 1.05 MB for the full bundle (236 kB vs 348 kB gzip) |
| **In-process TTL cache (90 s)** | Warm payloads in 1–11 ms without Redis |
| **`SafeJSONResponse` + `clean_json`** | `NaN`/`Infinity` are structurally impossible in responses |
| **Documented status vocabulary** | `VERIFIED`, `PROVISIONAL`, `INCOMPLETE`, `UNAVAILABLE`, `STALE`, `FAILED_VALIDATION` |

## 6. Milestones

| # | Milestone | Status |
| --- | --- | --- |
| M0 | Environment, repo, data-source verification, official-API audit | Done |
| M1 | Warehouse schema + idempotent ingestion (13 sectors, 41,509 index rows, 433,817 summaries) | Done |
| M2 | Calculations package + 58 automated tests | Done |
| M3 | Read-only API (17 endpoints) + cache + JSON sanitiser | Done |
| M4 | Eleven pages, design system, charts, command palette, theme | Done |
| M5 | Independent verification in a real browser (12 routes, interactions, mobile) | Done |
| M6 | Documentation, screenshots, Dockerfile, deployment guide | This document set |
| M7 | Public deployment on a free tier | **Not deployed** — instructions provided, no account provisioned |

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Source mirror changes or disappears | Medium | High | Raw responses cached; source URLs centralised in `config.py`; audit documents fallbacks |
| Sparse sub-index history distorts long-window comparisons | High | Medium | Completeness table, `INCOMPLETE` status, methodology note, session-position returns |
| Current-membership bias in historical breadth | Certain | Medium | Disclosed on every affected view and in limitations |
| Stale market-cap snapshot | Medium | Medium | Snapshot date shown; no claim of real-time valuation |
| Corrupt fundamental values | Medium | High | Per-field validation, rejection counters, `—` in the UI, notes in payload |
| Free host spins down | High | Low | Cold-start expectation documented; warm cache only after first request |
| SQLite on ephemeral disk | High (some hosts) | High | Postgres path documented; volume required for SQLite |
| Overfitting the illustrative backtest | Medium | Medium | No costs modelled, short method string, "illustrative only" label, no forecast claim |

## 8. Definition of done

A surface is done only when:

1. Its payload is produced by a tested calculation (or explicitly reports `UNAVAILABLE`).
2. It renders with real ingested data, not placeholders.
3. Empty, partial and error states are designed.
4. It is documented in the methodology and visualisation catalog.
5. It is exercised in a browser and the result is recorded in the testing report.
6. It does not overclaim: statuses distinguish *implemented* from *verified*.
