# Data Dictionary

Canonical units are **plain NPR** for money, **NPR per share** for per-share values, **fractions**
(not percentages) for every return and ratio in the database and API. The UI formats fractions as
percentages.

---

## 1. Warehouse tables

SQLite by default (`backend/data/sector_intelligence.db`), PostgreSQL-compatible through
`DATABASE_URL`. Schema is created by `app.db.init_db()`.

### `sectors`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | |
| `code` | text, unique | App code: `BANKING`, `DEVBANK`, `FINANCE`, `HOTELS`, `HYDROPOWER`, `INVESTMENT`, `LIFEINS`, `MANUFACTURE`, `MICROFINANCE`, `MUTUALFUND`, `NONLIFE`, `OTHERS`, `TRADING` |
| `name` | text, unique | Display name, e.g. `Commercial Banks` |
| `index_code` | text | YONEPSE index code, e.g. `BANKSUBIND` |
| `index_name` | text | e.g. `Banking SubIndex` |
| `description` | text | Source description |
| `active` | boolean | |
| `source` | text | `yonepse` |
| `updated_at` | datetime | |

### `index_observations`

| Column | Type | Unit / notes |
| --- | --- | --- |
| `index_code` | text | `NEPSE` or one of the 13 mirror symbols (`BANKING`, `LIFEINSU`, …) |
| `sector_id` | FK → `sectors.id`, nullable | `NULL` for the benchmark |
| `trade_date` | date | ISO date |
| `open`, `high`, `low` | float, nullable | Index levels; not used by any current chart |
| `close` | float | Index level, required |
| `turnover` | float, nullable | **NPR** (mapped from the source column named `volume`) |
| `source` | text | e.g. `menaceXnadin` |
| `source_url` | text | Exact raw URL used |
| `retrieved_at` | datetime | |
| `status` | text | `VERIFIED` by default |

**Constraints:** `UNIQUE(index_code, trade_date)`; index on `(index_code, trade_date)`.
**Rows in this build:** 41,509 (6,613 NEPSE + 34,896 sector).

### `securities`

| Column | Type | Unit / notes |
| --- | --- | --- |
| `symbol` | text PK | NEPSE symbol |
| `name` | text | Company name |
| `instrument_type` | text | `ordinary`, `preference`, `mutual_fund`, `debenture`, … |
| `sector_name` | text, nullable | Display name, normalised through `SECTOR_NAME_ALIASES` |
| `status` | text | `listed`, `suspended`, `delisted`, … |
| `source_category` | text | Raw category from the reference feed |
| `market_cap` | float, nullable | **NPR** (source reports NPR millions × 1,000,000) |
| `market_cap_as_of` | date, nullable | Snapshot date |
| `source` | text | `binayabaral+nepse` |
| `updated_at` | datetime | |

**Rows:** 467 (306 ordinary, 285 ordinary + listed, 331 classified, 343 with market cap).

### `daily_summaries`

Deliberately minimal: **no intraday OHLC is stored**.

| Column | Type | Unit / notes |
| --- | --- | --- |
| `symbol` | text | |
| `trade_date` | date | |
| `close` | float, nullable | NPR |
| `prev_close` | float, nullable | NPR |
| `change` | float, nullable | NPR |
| `pct_change` | float, nullable | Fraction (`0.0123` = 1.23 %) |
| `volume` | float, nullable | Shares |
| `turnover` | float, nullable | NPR |
| `status` | text, nullable | Trading status if supplied |
| `sector_name` | text, nullable | Denormalised current sector for fast grouping |
| `source` | text | `binayabaral` |
| `retrieved_at` | datetime | |

**Constraints:** `UNIQUE(symbol, trade_date)`; indexes on `(sector_name, trade_date)` and
`(trade_date)`.
**Rows:** 433,817 across 285 symbols, 1995-07-20 → 2026-10-16.

### `memberships`

| Column | Type | Notes |
| --- | --- | --- |
| `symbol` | text | |
| `sector_name` | text | |
| `effective_from` | date, nullable | `NULL` when unknown |
| `effective_to` | date, nullable | `NULL` = current |
| `source` | text | `yonepse` |

**Rows:** 331. Only the current membership is known; see limitations.

### `fundamental_reports`

| Column | Type | Unit / notes |
| --- | --- | --- |
| `symbol` | text | |
| `report_type` | text | `Quarterly Report`, `Annual Report`, … |
| `quarter` | text, nullable | `First Quarter` … `Fourth Quarter` |
| `fiscal_year` | text, nullable | e.g. `2025-2026` |
| `period_end` | date, nullable | |
| `published_date` | date, nullable | Document submitted date |
| `pe` | float, nullable | Multiple, as reported |
| `eps` | float, nullable | NPR per share |
| `paid_up_capital` | float, nullable | NPR |
| `profit` | float, nullable | NPR (period profit, as reported) |
| `net_worth_per_share` | float, nullable | NPR per share, **validated before aggregation** |
| `source` | text | `yonepse` |
| `status` | text | `PROVISIONAL` |

**Constraints:** `UNIQUE(symbol, fiscal_year, quarter, report_type)`.
**Rows:** 4,840 across 307 symbols.

### `ingestion_runs`

Operational log: `source`, `started_at`, `finished_at`, `status` (`RUNNING`, `OK`, `FAILED`),
`rows_written`, `message`. Shown in the Data Quality Center, failed runs included.

### `data_issues`

`dataset`, `severity`, `code`, `message`, `detail`, `detected_at`, `resolved`. Reserved for
structured issue tracking; the current build records issues in payload notes and ingestion messages.

---

## 2. Derived fields used by the API

| Field | Definition | Unit |
| --- | --- | --- |
| `return_1/5/10/20/60/120/252` | `close[-1] / close[-1-n] - 1` by session position | fraction |
| `absolute_strength` | Cumulative sector return over the selected lookback | fraction |
| `relative_strength` | Sector return − NEPSE return over the same lookback | fraction (percentage points) |
| `rs_ratio` | `(sector[-1]/sector[-1-n]) / (nepse[-1]/nepse[-1-n])` | ratio around 1.0 |
| `quadrant` | `WINNING`, `ADVANCING`, `LOSING`, `LAGGING` (or `null`) | enum |
| `momentum_change` | `return_20_now − return_20_20_sessions_ago` | fraction |
| `volatility` | Standard deviation of daily returns over 252 sessions × √252 | annualised fraction |
| `beta` | `cov(sector, NEPSE) / var(NEPSE)` over 252 sessions | dimensionless |
| `correlation` | Pearson correlation of daily returns, 252 sessions | −1 … 1 |
| `max_drawdown` | Minimum of `close / running_peak − 1` over full observed history | fraction |
| `current_drawdown` | Latest value of the same series | fraction |
| `var_95` | 5th percentile of daily returns, `method="lower"` | fraction |
| `cvar_95` | Mean of returns at or below `var_95` | fraction |
| `advance_pct` | Advances ÷ (advances + declines + unchanged) | fraction |
| `ad_ratio` | Advances ÷ declines (`null` when there are no declines) | ratio |
| `turnover` | Sum of observed security `turnover` | NPR |
| `share` | Sector turnover ÷ total turnover | fraction |
| `hhi` | Σ (member share)² | 0 … 1 |
| `effective_n` | `1 / hhi` | count |
| `top1_share`, `top5_share` | Turnover share of the largest 1 / 5 members | fraction |
| `aggregate_pe` | Σ market cap ÷ Σ profit (losses included) | multiple |
| `aggregate_pe_ex_negative` | Profitable members' cap ÷ their profit | multiple |
| `aggregate_roe` | Σ profit ÷ Σ validated equity | fraction |
| `aggregate_eps` | Σ profit ÷ Σ shares (`paid_up_capital / 100`) | NPR/share |
| `coverage` | Available factor values ÷ total factors | fraction |

---

## 3. API surface

All endpoints are `GET`, return JSON, never mutate state, and are cached in-process for 90 seconds.
Non-finite numbers are serialised as `null`.

| Endpoint | Query parameters | Returns |
| --- | --- | --- |
| `/api/health` | — | `{status, service}` |
| `/api/meta` | — | Version, quadrant list, horizons, status vocabulary |
| `/api/sectors` | — | Sector list with index code, latest level, returns, quadrant |
| `/api/sectors/{code}` | — | Full sector detail: history, returns, breadth, fundamentals, membership |
| `/api/dashboard` | — | Market overview, 20-session rotation, transitions, heatmap, liquidity cross-section, breadth, risk, leaders/laggards, freshness |
| `/api/heatmap` | — | 7 horizons × 13 sectors return matrix |
| `/api/rotation` | `window` (5/10/20/60/120, default 20), `abs_threshold`, `rel_threshold` | Axis metadata, rows, quadrant census, crossings |
| `/api/rotation/trails` | `window`, `sessions` (0–120), thresholds | Per-sector trail coordinates |
| `/api/breadth` | `sector` (optional) | Market breadth summary or sector breadth detail |
| `/api/liquidity` | `sector` (optional) | Market liquidity summary or sector liquidity detail |
| `/api/risk` | `sector` (optional) | Cross-sectional risk table or sector drawdown detail |
| `/api/fundamentals` | — | Per-sector aggregates, member reports, notes |
| `/api/factors` | `weight_*` for six factors | Scores, contributions, coverage, missing factors |
| `/api/research` | — | Transition matrix, backtest curves, notes |
| `/api/events` | — | `UNAVAILABLE` with reasons |
| `/api/data-quality` | — | Dataset inventory, index coverage, classification, source register, ingestion runs |
| `/api/methodology` | — | Structured methodology content |

### Response envelope conventions

* `available: false` + `reason` when a module cannot be computed.
* `latest_date`, `first_date`, `last_date` are ISO strings (`YYYY-MM-DD`) or `null`.
* `notes: string[]` carries disclosure that the UI renders verbatim.
* Sparse data is `null`, never `0`, and never forward-filled.

---

## 4. Sector code mapping

| App code | Display name | Historical mirror symbol | YONEPSE index code |
| --- | --- | --- | --- |
| `BANKING` | Commercial Banks | `BANKING` | `BANKSUBIND` |
| `DEVBANK` | Development Banks | `DEVBANK` | `DEVBANKIND` |
| `FINANCE` | Finance | `FINANCE` | `FININD` |
| `HOTELS` | Hotels And Tourism | `HOTELS` | `HOTELIND` |
| `HYDROPOWER` | Hydro Power | `HYDROPOWER` | `HYDPOWIND` |
| `INVESTMENT` | Investment | `INVESTMENT` | `INVIDX` |
| `LIFEINS` | Life Insurance | `LIFEINSU` | `LIFINSIND` |
| `MANUFACTURE` | Manufacturing And Processing | `MANUFACTURE` | `MANPROCIND` |
| `MICROFINANCE` | Microfinance | `MICROFINANCE` | `MICRFININD` |
| `MUTUALFUND` | Mutual Fund | `MUTUAL` | `MUTUALIND` |
| `NONLIFE` | Non Life Insurance | `NONLIFEINSU` | `NONLIFIND` |
| `OTHERS` | Others | `OTHERS` | `OTHERSIND` |
| `TRADING` | Tradings | `TRADING` | `TRDIND` |

The three naming systems differ on purpose; the mapping is explicit in
`backend/app/ingestion/sources.py` and is the only place where they are translated.
