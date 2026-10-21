# Data Source Audit

**Audit date:** 2026-10-21 / 2026-10-22
**Scope:** every dataset used by NEPSE Sector Intelligence, including what was rejected and why.
No credentials were used, no authentication was bypassed, and no paywalled data was accessed.

---

## 1. Method

1. Resolve each candidate endpoint and record the HTTP status, payload size and a sample of the
   schema.
2. Check the publisher's repository metadata (licence, last push) through the GitHub API.
3. Ingest a small slice, then verify arithmetic invariants (price × shares = market cap, index
   identity, P/E × EPS ≈ implied price).
4. Record the outcome as `VERIFIED`, `PROVISIONAL`, `INCOMPLETE`, `UNAVAILABLE` or
   `FAILED_VALIDATION`.
5. Re-verify the endpoint status on the audit date; raw responses are cached under
   `backend/data/raw/` for reproducibility (git-ignored).

---

## 2. Official NEPSE endpoints — tested, refused

The Exchange's own JSON endpoints were probed from a normal client with a browser user agent.

| Endpoint | Result on 2026-10-21 |
| --- | --- |
| `https://www.nepalstock.com/api/nots/index` | **HTTP 401** — `WARNING: UNAUTHORIZED ACCESS` |
| `https://www.nepalstock.com/api/nots/market-summary/` | **HTTP 401** — same body |
| `https://www.nepalstock.com/api/nots/securityDailyTradeStat/58` | **HTTP 401** — same body |
| `https://backend.nepalstock.com/api/nots/index` | No response (connection failed, HTTP code 000) |
| `https://backend.nepalstock.com/api/nots/market-summary/` | No response (HTTP code 000) |

**Decision:** the official API is not used. No token extraction, session replay, header spoofing,
browser-cookie reuse or scraping of authenticated pages was attempted. The application therefore
cannot claim official, real-time or intraday coverage.

**Consequences**

* Sector membership, corporate events and full financial statements cannot be sourced officially.
* The newest session available is the last row of the public mirrors (2026-10-16 in this build), not
  a live quote.
* The Data Quality Center labels the ingestion source as a mirror and shows the latest session date
  on every page header.

---

## 3. Accepted sources

### 3.1 Historical NEPSE index and sector sub-indices — VERIFIED

**Provider:** `menaceXnadin/nepse-historical-market-data-csv` (GitHub, public)
**Repository metadata:** no licence file reported by GitHub; last push 2026-10-16; not archived.
**Licence note:** because no explicit licence is declared, this dataset is used locally for analysis
and **must not be redistributed** without the publisher's permission. The repository does not ship
the raw data.

| Feed | URL pattern | Rows ingested |
| --- | --- | --- |
| NEPSE benchmark | `…/data/index/unadjusted/NEPSE_unadjusted.csv` | 6,613 |
| 13 sub-indices | `…/data/subindices/unadjusted/{SYMBOL}_unadjusted.csv` | 34,896 |
| **Total** | | **41,509** |

`SYMBOL` values: `BANKING`, `DEVBANK`, `FINANCE`, `HOTELS`, `HYDROPOWER`, `INVESTMENT`,
`LIFEINSU`, `MANUFACTURE`, `MICROFINANCE`, `MUTUAL`, `NONLIFEINSU`, `OTHERS`, `TRADING`.

**Schema:** `time,symbol,open,close,high,low,volume,category`

* `time` is an ISO date.
* `volume` in this feed is **turnover in NPR**, not share count. Cross-checked against row
  magnitudes (e.g. BANKING 2026-10-16 ≈ 1.18 × 10⁹ NPR).
* `close` is an unadjusted index level. Index levels are not adjusted for base changes or
  reconstitutions; returns are therefore level-to-level, not total-return.
* Coverage begins between 2011-03-20 (BANKING, FINANCE, HOTELS, HYDROPOWER, MANUFACTURE, OTHERS)
  and 2021-02-28 (INVESTMENT); the NEPSE benchmark starts 1997-07-20. Within its own span, some
  series are sparse (`MANUFACTURE` 80.2 %, `TRADING` 83.5 %, `LIFEINS` 93.7 %, `HOTELS` 94.2 % of
  expected sessions).

**Validation performed**

* The NEPSE close on 2026-10-16 in the warehouse is **2,634.17**, identical to the raw CSV row:
  `2026-10-16,NEPSE,2626.41,2634.17,2638.42,2622.78,4880089108,index`.
* 13/13 sector series are monotonically indexed by date and free of duplicate `(index_code, date)`.
* Daily returns are bounded and computed only between adjacent observed sessions.

### 3.2 Current sector metadata, membership and market-cap snapshot — VERIFIED / PROVISIONAL

**Provider:** YONEPSE (`shubhamnpk/yonepse`, GitHub Pages). **Licence: MIT.** Last push 2026-10-21.

| Endpoint | Size | Role | Status |
| --- | --- | --- | --- |
| `/data/market/sector_indices.json` | 7.8 KB | Official sub-index codes ↔ sector names | VERIFIED |
| `/data/other/sector_codes.json` | 64 KB | Sector master, index membership | VERIFIED |
| `/data/nepse_data.json` | 148 KB | Latest snapshot: price, change, volume, turnover, market cap | VERIFIED |
| `/data/company/financials.json` | 5.8 MB | Reported quarterly/annual filings | PROVISIONAL |

**Snapshot shape (362 records):**
`symbol, name, ltp, previous_close, change, percent_change, high, low, volume, turnover, trades,
last_updated, market_cap`

**Unit finding:** `market_cap` is reported in **NPR millions** (e.g. ACLBSL `3120.72` for a company
whose 850 NPR price × 3.67 m shares ≈ 3.12 bn NPR). Ingestion multiplies by
`MARKET_CAP_SOURCE_UNIT = 1_000_000.0` so the canonical unit is plain NPR.

**Post-ingestion check:** 343 securities carry a market cap; 315 of them are classified into a
sector. Total market cap = **4,587,583,000,000 NPR (≈ 4.588 trillion)**, consistent with the sum of
the sector aggregates (≈ 4.4 trillion for classified members plus unclassified instruments).

**Membership limitation:** only the *current* sector map is published. Historical membership is not
available, so current membership is applied to past sessions. This is disclosed in the app and in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

### 3.3 Minimal security daily summaries — VERIFIED

**Provider:** `binayabaral/nepal-market-data` (GitHub). **Licence: MIT.** Last push 2026-10-19.

| Feed | URL | Result |
| --- | --- | --- |
| Symbol reference | `…/data/reference/nepse-symbols.csv` | 467 instruments |
| Per-symbol daily CSV | `…/data/nepse/{SYMBOL}.csv` | 433,817 rows across 285 symbols |

**Stored subset only:** `close`, `previous_close`, `change`, `pct_change`, `volume`, `turnover`,
`status`, `sector`. Open/high/low are **not** stored, so the app cannot draw candlesticks even
accidentally.

**Semantics**

* `traded_quantity` = shares; `traded_amount` = NPR. (In the *index* feed, `volume` means turnover —
  the two feeds use the same word differently; ingestion handles them separately.)
* Rows begin 1995-07-20 (the earliest security file) and end 2026-10-16.
* A security with no row on a date is **not** treated as unchanged. Only observed securities enter
  the advance/decline denominator; the rest are reported as unavailable.

**Coverage:** 306 ordinary instruments in the reference, 285 with daily history (the difference is
mostly recently listed or suspended instruments), 331 classified into sectors.

### 3.4 Reported fundamentals — PROVISIONAL

**Provider:** YONEPSE `financials.json` (MIT). 307 symbols, 4,840 report rows ingested.

**Per-report fields:** `type`, `quarter`, `fy`, `fy_nepali`, `pe`, `eps`, `paid_up_capital`,
`profit`, `net_worth_per_share`, `documents[]` (submitted date and relative PDF path).

**What is present:** profit, EPS, P/E, paid-up capital, net worth per share.
**What is absent:** revenue, total assets, total liabilities, cash flow, equity breakdown, share
count. Consequently this application **does not** compute margins, asset turnover, leverage,
book-to-market or any ratio requiring those fields. It says so on the Fundamentals page.

**Unit check:** `paid_up_capital` and `profit` are NPR; `eps` and `net_worth_per_share` are NPR per
share. Example ACLBSL Q3 2025-26: paid-up 367,143,409; profit 93,684,506; EPS 34.02;
P/E 29.3; net worth/share 179.21. Implied price 29.3 × 34.02 ≈ 997 NPR, which is plausible against
the snapshot price.

**Known corruption:** the source intermittently publishes a `net_worth_per_share` that is an order
of magnitude too high (e.g. ADBL Q4 2025-26: 2,896.61 versus a plausible ~229). Ingestion keeps the
reported value, but the analytics layer validates each company against its own implied price:

```
implied_price = pe × eps
pb = implied_price / net_worth_per_share
accept when 0.10 ≤ pb ≤ 25
```

Rejected values are excluded from aggregate equity/ROE, counted in `rejected_book_values`, shown as
`—` with a tooltip in the member tables, and disclosed in the payload notes. They are **not**
silently averaged or clipped.

**Par value assumption:** `paid_up_capital / 100` is used as a share-count proxy because the source
does not publish share counts. This is disclosed in the methodology.

**Report selection:** the latest report per symbol is chosen by fiscal year and submitted date.
Accounting periods differ across companies (Q1–Q4, different fiscal years), so aggregate ROE and P/E
mix periods. This is stated on the page.

---

## 4. Rejected or unavailable sources

| Candidate | Why it was not used |
| --- | --- |
| Official NEPSE API | HTTP 401; authentication not bypassed |
| `backend.nepalstock.com` | Connection failure on audit date |
| Broker/portfolio APIs | Require credentials; out of scope |
| Screener-style HTML pages | No stable terms, no schema guarantee, fragile scraping |
| Social media / news sentiment | No verified, licensed feed; would fabricate coverage |
| Corporate events / dividend calendars | No verified public feed found; module reports `UNAVAILABLE` |
| Paid market-data vendors | Not required for a free deployment; would violate the budget constraint |
| The separate "Mega Tool" application | Explicitly out of scope: no shared code, data or infrastructure |

---

## 5. Freshness and reproducibility

* Every source URL is defined in `backend/app/config.py`; nothing is hard-coded in pages.
* Raw responses are cached in `backend/data/raw/` (git-ignored) so an ingest can be audited without
  re-downloading.
* `scripts/ingest.py` is idempotent: unique constraints on `(index_code, trade_date)` and
  `(symbol, trade_date)`; the fundamentals snapshot is replaced in one transaction and deduplicated
  per `(symbol, fiscal year, quarter, report type)` (newest filing wins). The run log holds 15 rows —
  13 successes and 2 development failures that were fixed and rerun; they are visible on purpose.
* The latest session in this build is **2026-10-16** for both index and summary data. The header on
  every page shows that date; there is no "live" claim.

## 6. Licence and redistribution

| Source | Licence | Redistribution |
| --- | --- | --- |
| `menaceXnadin/nepse-historical-market-data-csv` | none declared | Do **not** redistribute the raw CSVs or a database built from them without permission |
| `binayabaral/nepal-market-data` | MIT | Attribution required |
| `shubhamnpk/yonepse` | MIT | Attribution required |

The repository's own code has no licence file yet; the owner must choose one before publishing. The
database and raw cache are git-ignored so that publishing the code does not republish the data.
