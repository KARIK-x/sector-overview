# Known Limitations

This document is the authoritative list of what the application **cannot** do, why, and what it does
instead. If a limitation is visible in the UI, the place where it is disclosed is noted.

---

## 1. Data access

### 1.1 Official NEPSE API is unavailable

* **What:** `nepalstock.com/api/nots/*` returns HTTP 401 (`WARNING: UNAUTHORIZED ACCESS`);
  `backend.nepalstock.com` did not respond on the audit date.
* **Impact:** no official sectorwise summary, no official datewise index feed, no live quotes, no
  official corporate announcements, no authenticated financial statements.
* **Why not worked around:** bypassing authentication (token extraction, cookie replay, header
  spoofing) was out of scope and is not attempted.
* **Instead:** three documented public mirrors, with their provenance and status shown in the Data
  Quality Center.
* **Disclosed at:** Data Quality → Source register; Methodology → Provenance.

### 1.2 The data is not live

* The latest session in this build is **2026-10-16**. The header on every page shows that date, and
  the dashboard has a "Freshness & provenance" card.
* There is no streaming, websocket or intraday update. "Today" in the UI means the latest ingested
  session, never the wall clock.

### 1.3 Historical sector membership does not exist in the sources

* Only the **current** constituent list is published.
* **Impact:** a sector's historical breadth, aggregates and concentration are computed with today's
  members. Companies that moved sectors, were delisted, or listed later are misclassified in the
  past. This is survivorship and classification bias.
* **Instead:** the bias is stated wherever it applies (Dashboard, Sector Explorer breadth,
  Methodology, Limitations).
* **Not fixed because:** reconstructing membership would require dated constituent snapshots or a
  licensed corporate-actions database, neither of which is available for free.

### 1.4 Sparse sub-index history

Four sub-indices cover materially less than the NEPSE calendar:

| Sector | Completeness | Status |
| --- | --- | --- |
| Manufacturing And Processing | 80.2 % | INCOMPLETE |
| Tradings | 83.5 % | INCOMPLETE |
| Life Insurance | 93.7 % | INCOMPLETE |
| Hotels And Tourism | 94.2 % | INCOMPLETE |

* **Impact:** a "20-session" return for a sparse series spans more calendar time than 20 sessions of
  the benchmark. Cross-sector comparisons over long windows are therefore approximate.
* **Instead:** coverage, missing counts and completeness percentages are shown per series, and gaps
  are never filled.

### 1.5 Index levels are unadjusted

* The historical feed provides unadjusted index closes.
* **Impact:** base changes, reconstitutions and corporate actions are not normalised; long-horizon
  returns are level-to-level, not total-return.
* **Instead:** the methodology says so; no dividend or adjustment claim is made.

---

## 2. Fundamentals

### 2.1 Missing financial statements

* The verified feed has **profit, EPS, P/E, paid-up capital and net worth per share** only.
* **Not available:** revenue, total assets, total liabilities, equity breakdown, cash flow, share
  count, dividends, book value detail.
* **Impact:** no margins, asset turnover, leverage, book-to-market, EV/EBITDA, dividend yield or
  DuPont decomposition. The Fundamentals Lab is deliberately narrow.
* **Instead:** aggregates use only present fields and the page lists what is absent.

### 2.2 Mixed accounting periods

* Filings span different quarters and fiscal years. "Latest report per symbol" can mix a Q3 of one
  year with a Q1 of the next across companies.
* **Impact:** aggregate P/E, EPS and ROE are indicative, not a synchronised snapshot.
* **Instead:** the page and payload notes state that periods differ; the member table shows each
  filing's fiscal year.

### 2.3 Share count is a proxy

* Share count is derived as `paid_up_capital / 100` (par value NPR 100).
* **Impact:** companies with a different par value, or with preference capital, have a biased EPS
  and book equity weight.
* **Instead:** the assumption is documented in the Methodology; the app does not present a
  company-level "shares outstanding" figure.

### 2.4 Corrupted book values in the source

* Some `net_worth_per_share` values are wrong by an order of magnitude (e.g. ADBL Q4 2025-26:
  2,896.61 vs a plausible ~229).
* **Impact:** naive aggregation would inflate sector equity and depress ROE.
* **Instead:** per-company cross-check against `pe × eps`; values outside an implied P/B of
  0.10–25 are rejected, excluded from equity/ROE, displayed as `—`, counted in
  `rejected_book_values`, and disclosed in the note. The reported value is retained for audit.
* **Residual risk:** a corrupted value that happens to fall inside the plausibility band would pass.
  This is a screen, not a correction.

### 2.5 Market cap is a single snapshot

* Market cap comes from one YONEPSE snapshot (`last_updated` 2026-10-16), not a daily series.
* **Impact:** historical P/E or cap-weighting cannot be computed; the snapshot can be stale relative
  to the index close if a corporate action occurred.
* **Instead:** the snapshot date is shown; no historical valuation claim is made.

### 2.6 Unclassified instruments

* 467 securities exist, 331 are classified into a sector, 343 have a market cap.
* **Impact:** totals for "the market" are not the sum of the 13 sectors. The app reports sector
  aggregates and never claims a complete market total.

---

## 3. Analytics

### 3.1 Sector-level only

* No stock ranking, no entry/exit signals, no price targets, no candlesticks.
* **Reason:** scope. The minimal security summaries exist solely for breadth/liquidity.

### 3.2 No forecasting

* No regime detection, ML, sentiment or probabilistic forecast.
* **Reason:** 13 sector series with structural breaks and no out-of-sample validation would produce
  confident-looking noise. The research payload states this explicitly.

### 3.3 Backtest is illustrative

* Long top-3 by 20-session relative strength, equal weight, rebalanced every 5 sessions, last
  ~10 years, **no costs, slippage, taxes or liquidity constraints**.
* **Impact:** the equity curve is an upper bound and is not achievable as shown. It also uses current
  membership and unadjusted index levels.
* **Instead:** the method string is returned with the data and printed on the page; the chart is
  labelled illustrative.

### 3.4 Factor scores are relative and unstable

* Scores are cross-sectional percentile ranks across 13 sectors, with user weights.
* **Impact:** a small universe makes ranks coarse (one rank step ≈ 7.7 percentile points); changing
  one weight can reorder the table. Missing factors reduce coverage, which is shown.
* **Instead:** contributions and coverage are disclosed; missing factors are never scored as worst.

### 3.5 VaR/CVaR and drawdowns are descriptive

* Historical quantiles over 252 sessions; drawdowns over each sector's full available history.
* **Impact:** not predictive, not adjusted for volatility clustering, and not like-for-like when
  histories differ.
* **Instead:** labelled "descriptive", with the window and method stated.

### 3.6 Breadth denominators are small for some sectors

* A sector with two traded names can show a 100 % or 0 % advance share.
* **Impact:** advance share alone can mislead.
* **Instead:** the traded count, A/D ratio and net advances are shown next to it, and the page warns
  that a high share on few names is a thin signal.

---

## 4. Product and platform

### 4.1 No authentication or multi-user features

* Read-only public API; no accounts, watchlists, saved views, alerts or exports.
* **Reason:** scope and free hosting. Adding auth would add a database writer and a session store.

### 4.2 No corporate events feed

* The Events & Research page is intentionally empty and reports `UNAVAILABLE`.
* **Reason:** no verified public calendar/licence; fabricating one would be worse than absence.
* **Disclosed at:** the page itself, the source register, and this document.

### 4.3 Browser coverage

* Tested only in Chromium. Firefox and Safari were not exercised.
* CSS uses standard grid/flex and CSS variables; `color-mix()` is used in decorative gradients and
  scrollbars, with graceful degradation, but this was not verified in older browsers.

### 4.4 Accessibility gaps

* Canvas charts are not exposed to screen readers; table/text equivalents exist but were not audited
  with VoiceOver or NVDA.
* ECharts animation is not tied to `prefers-reduced-motion` (CSS transitions are).
* Focus states, skip link and ARIA labels on controls are implemented, but a formal WCAG audit has
  not been run.

### 4.5 Mobile tables

* Wide tables scroll inside their container rather than reflowing into cards. This is intentional
  (column alignment matters for numbers) but requires horizontal scrolling on phones.
* The heatmap uses a 520 px minimum width inside a scroller on small screens; the first columns are
  visible without scrolling.

### 4.6 Cold starts and free hosting

* On Render's free tier the service sleeps after ~15 minutes and the first request takes 30–60 s.
* Neon free suspends after ~5 minutes; the first query wakes it.
* SQLite on an ephemeral disk resets on redeploy — use Postgres or a volume.

### 4.7 Ingestion depends on third-party mirrors

* A mirror can change schema, move, rate-limit or disappear.
* **Instead:** raw responses are cached for audit; URLs are centralised; ingestion records a run row
  with success/failure; the Data Quality Center shows failures.
* **Residual risk:** no automatic fallback source is configured.

### 4.8 No rate limiting

* The API is public and uncached across processes (90 s in-process only).
* **Impact:** a determined client can generate database load. Free tiers include some protection at
  the edge, but the app does not implement its own limiter.

### 4.9 Tests are not a committed browser suite

* The backend has 58 automated tests; the browser pass was exploratory, with screenshots and console
  assertions recorded in the testing report.
* **Impact:** UI regressions are not caught automatically. Adding a Playwright suite is the obvious
  next step.

### 4.10 Documentation is intentionally explicit

* Docs include unverified steps (Docker build, Postgres, deployment) marked as such.
* Nothing is labelled `TESTED-PASS` without a recorded run.

---

## 5. Legal and licensing

* The `menaceXnadin` historical mirror has **no declared licence**. The repository does not ship the
  raw data or the database, but publishing a derived database may require permission.
* `binayabaral/nepal-market-data` and `shubhamnpk/yonepse` are MIT; attribution is required if their
  data is redistributed.
* The application code has **no licence file yet**. Choose one before publishing.
* Nothing here is investment advice; the disclaimer appears in the sidebar and README.
