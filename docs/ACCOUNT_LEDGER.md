# Private Account Ledger

The Account section turns broker SMS messages into an auditable trading, cash and holdings
ledger. It is deliberately separate from the public market data: every row belongs to one
private vault, every request needs that vault's bearer key, and no account response is cached
by the public CDN.

The feature is implemented and tested locally. It has **not** been committed, pushed or
deployed as part of this change.

---

## 1. Product surface

| Page | What it answers |
| --- | --- |
| **Overview** | What is my cash, what is committed, what is still expected, and where is the first shortfall? |
| **Transactions** | What did I trade, what charges were calculated, what did the broker report, and what is still due? |
| **Cash Flow** | What cash actually exists, what payments and receipts are projected, and which day runs short? |
| **Holdings** | What do I own, at what WACC, what is realised/unrealised, and how long has each lot been held? |
| **SMS Import** | Paste or upload broker messages, review parsed lines, reject bad rows, and commit without duplicates. |
| **Fees & Settings** | Investor category, broker, holidays, deadline offsets, bank accounts, key rotation, fee sources and audit trail. |

The Account section lives at `/account/*` and is reachable from the **Account → Private
Ledger** group in the sidebar. The six tabs share one vault provider, one gate and one query
namespace (`['account']`).

### Browser screenshots

All screenshots use synthetic data only. They are in
[`docs/account-screenshots/`](account-screenshots/). The images were captured with Playwright
(Chromium) at 1440 × 1000 in the dark theme from the **production Vite bundle served by FastAPI**
at `http://127.0.0.1:8000`, not from the dev server.

| File | Surface |
| --- | --- |
| `account-locked.png` | Locked vault gate |
| `account-overview.png` | Overview |
| `account-transactions.png` | Transactions list |
| `account-transaction-detail.png` | Transaction drawer, charges, obligations and corrections |
| `account-cashflow.png` | Cash-flow chronology and shortfall |
| `account-holdings.png` | Holdings and concentration |
| `account-import.png` | SMS import |
| `account-import-preview.png` | Parsed preview and approval |
| `account-settings.png` | Settings and bank accounts |
| `account-settings-rules.png` | Versioned fee rules and sources |

The one-time-key screen is intentionally **not** screenshotted for publication. It displays a
live credential, even when the vault is synthetic; the key-once confirmation is covered by the
browser test log instead.

---

## 2. Architecture

```
React / Vite
  /account/*
    AccountProvider  ── bearer key, vault identity, lock/unlock/rotate
    AccountShell     ── six tabs, refresh, lock
    React Query      ── one ['account'] invalidation namespace
          │
          │  Authorization: Bearer <256-bit key>
          ▼
FastAPI /api/account/*
    auth.py          ── SHA-256 key hash lookup, vault dependency
    imports.py       ── parse → preview → commit → bill/transaction rows
    parser.py        ── SMS and file parsing, fingerprints, warnings
    fees.py          ── versioned fee/tax rules, BUY/SELL charges
    ledger.py        ── WACC, FIFO holding periods, CGT, holdings
    cashflow.py      ── actual/projected daily cash schedule
    routes.py        ── authenticated CRUD, settlements, reversals, exports
    serializers.py   ── fixed-point money as strings, audit-safe JSON
          │
          ▼
SQLAlchemy → SQLite (local) / PostgreSQL (Neon production)
```

### Design rules

1. **The server is authoritative.** The ledger lives in the database. Browser storage holds
   only the vault key; it never holds transactions, balances or holdings.
2. **The key is never stored in plaintext.** A 256-bit token is returned once. The database
   stores only its SHA-256 hash.
3. **Every query is vault-scoped.** `require_vault` resolves the key to one vault ID; every
   read and write filters by that ID. A key cannot address another vault's rows.
4. **Account responses are private.** The account router sets `Cache-Control: private,
   no-store`, overriding the public market cache middleware. Unauthenticated responses also
   carry that header.
5. **Money is fixed precision.** SQLAlchemy `Numeric`/`Decimal` is used server-side and
   rounded half-up to two decimals. API responses expose money as strings (2 dp) and
   quantities/prices as strings (4 dp), never binary floats.
6. **No invented rows.** Summary and holdings views are computed from the ledger. When data
   is missing, the result is marked `AWAITING_INFO`/`ESTIMATED` instead of guessed.

---

## 3. Database schema

`Base.metadata.create_all` creates these tables at startup. There is no Alembic history yet —
see [Limitations](#11-limitations-and-remaining-work).

| Table | Purpose | Important columns |
| --- | --- | --- |
| `account_vaults` | One private ledger | `id`, `key_hash`, `investor_category`, `cost_basis_method`, `settings_json` |
| `account_bank_accounts` | Multiple cash accounts | `name`, `opening_balance`, `opening_balance_date`, `is_default`, `active` |
| `account_cash_movements` | Deposits, withdrawals, transfers, adjustments | `movement_date`, `kind`, `amount`, `counter_account_id`, `transfer_group`, `reversed_at` |
| `account_sms_imports` | One import batch | `source_type`, counts, `status`, `completed_at` |
| `account_sms_messages` | Raw and parsed messages | `raw_text`, `fingerprint`, `parser_version`, `status`, `warnings_json` |
| `account_bills` | One broker bill per SMS | `side`, `bill_no`, `bamt`, totals, deadlines, reconciliation |
| `account_transactions` | One security line in a bill | quantity, price, charges, CGT, cost basis, realised P&L, reversal |
| `account_settlements` | Partial/full payments and receipts | `direction`, `amount`, `settlement_date`, `bank_account_id`, reversal |
| `account_price_overrides` | Manual price per symbol | `symbol`, `price`, `as_of`, `note` |
| `account_fee_rules` | Versioned, sourced fee/tax rules | `code`, `version`, effective dates, brackets, `verification` |
| `account_audit_events` | Append-only audit trail | entity, action, `before_json`, `after_json`, `note` |

Money columns are `Numeric(20, 2)`; quantity and price columns are `Numeric(20, 4)`; rates are
`Numeric(14, 8)`. Foreign keys cascade from the vault for ledger rows. Reversals do not delete
rows: they set `reversed_at` and a reason, and the audit event preserves the before state.

---

## 4. Import, parsing and duplicate protection

### Supported inputs

* Paste one or more broker SMS messages.
* `.txt` — one message per line or blank-line blocks.
* `.csv` — header-based (`raw_text`, `sender`, `received_at`) or first-cell messages.
* `.xml` — Android SMS Backup & Restore style `<sms>` records.
* `.json` — `messages` array or a raw string array.

`.xml` files containing a DTD are rejected. Raw message text is normalised (invisible characters,
line breaks, whitespace) and stored as plain text. React renders it as text, never HTML; CSV
exports neutralise spreadsheet formulas.

### Parser capabilities

* BUY and SELL messages from licensed broker IDs, including `RK316455`.
* Multiple securities in one bill, with quantity and price as decimals.
* Broker amount (`BAmt`), bill number (`BNo.`/`Bill No.`) and payment URL.
* Dates in `YYYY-MM-DD` and common Nepali formats.
* Per-message status: `PARSED`, `NEEDS_REVIEW` or `ERROR`, plus warnings such as
  `MISSING_BROKER` or an unparsed amount.
* Messages that cannot be parsed safely never enter the ledger.

### Preview → commit

`POST /api/account/imports/preview` returns the parsed messages, line items, calculated
charges, reconciliation status, warnings and duplicates. The user can edit line values,
approve or reject each message, and reopen rows that need review. Nothing is written to the
trading ledger until commit.

`POST /api/account/imports/commit`:

1. Checks each message's SHA-256 fingerprint **inside the vault**.
2. Skips an already-imported fingerprint.
3. Creates one `account_bills` row per message and one transaction row per security line.
4. Allocates bill-level commission and SEBON fee pro rata by gross value.
5. Charges the DP fee per distinct scrip.
6. Computes deadlines and reconciliation, then recomputes WACC/CGT.

The fingerprint is the SHA-256 of the normalised raw text. A genuine second trade on the same
day in the same security is **not** a duplicate when it has different SMS text or bill number.
A test covers exactly this case.

### SMS access limitations

There is no web API that can read the SMS inbox. The page therefore accepts copy/paste and
exported files; it never asks for an unnecessary permission, never sends messages, and never
uploads raw messages to a third party. On iOS, SMS export requires the user's own
export/shortcut workflow. On Android, an SMS backup XML is the practical route. The UI explains
both instead of pretending browser access exists.

---

## 5. Fees, taxes and reconciliation

Rules are data, not hardcoded arithmetic. The engine selects the most specific rule that covers
the trade date, side, security type, investor category and holding period, and stores a snapshot
of the rule (code, version, effective dates, source URL, verification) on the transaction.

### Brokerage — equity

Effective **14 May 2024**. The headline rate is the total commission; it already contains the
broker, NEPSE exchange and SEBON regulatory components. The separate SEBON transaction fee is
stored independently and is not added twice.

| Turnover (NPR) | Rate on the whole turnover | Minimum |
| --- | --- | --- |
| Up to 50,000 | 0.36% | NPR 10 |
| 50,001 – 500,000 | 0.33% | NPR 10 |
| 500,001 – 2,000,000 | 0.31% | NPR 10 |
| 2,000,001 – 10,000,000 | 0.27% | NPR 10 |
| Above 10,000,000 | 0.24% | NPR 10 |

This is a slab rate, not a progressive marginal calculation: the applicable rate is applied to
the whole transaction value.

Other verified rules: mutual fund 0.15%/0.12%/0.10%; corporate debenture
0.10%/0.05%/0.02%; government/government-guaranteed bond 0.10%/0.05%/0.02% (marked `PARTIAL`
because rate cards group instrument classes).

### SEBON and DP

* Equity SEBON fee: **0.015%** of transaction value, both sides.
* Mutual fund / corporate debenture: **0.010%**.
* Government/other: **0.005%** (marked `PARTIAL`).
* DP charge: **NPR 25 per distinct scrip per transfer day**, charged on each scrip line, not
  once per bill. Your DP may vary this; the UI says so.

### Capital gains tax

CGT is calculated only on SELL and only on a positive gain.

| Effective period | Resident individual, held > 365 days | Resident individual, held ≤ 365 days |
| --- | --- | --- |
| Before 17 Jul 2025 | 5.0% | 7.5% |
| 17 Jul 2025 – 16 Jul 2026 | 5.0% | 7.5% |
| From 17 Jul 2026 | 7.5% | 10.0% |

Resident entities use a flat 10%; non-residents 25% (marked `PARTIAL`; secondary-market NRN
trading is not currently open). The September 2026 proposal to halve CGT was **not enacted**
at implementation time and is not used.

Method:

```
BUY   net payable = gross + commission + SEBON + DP + other charges
SELL  net receivable = gross − commission − SEBON − DP − other charges − CGT
CGT   = (gross − sell charges − cost basis) × applicable rate
```

The cost basis is WACC including buy charges. `gain` is net sale proceeds minus that cost
basis. Losses produce zero CGT but are **not** carried forward in this ledger. When a sale
spans long and short holding periods, the gain is apportioned by quantity and marked
`ESTIMATED_MIXED_HOLDING`. With no open lot, the row is `AWAITING_INFO` and no CGT is invented.

### Reconciliation states

| Status | Meaning |
| --- | --- |
| `MATCHED` | Broker `BAmt` equals calculated BUY cash within NPR 0.05 |
| `DIFFERENCE` | A broker `BAmt` exists and differs by more than NPR 0.05 |
| `ESTIMATED` | No broker amount to reconcile, or a SELL bill |
| `AWAITING_INFO` | Missing cost basis / oversold quantity; no invented number |
| `RULE_NOT_VERIFIED` | The required rule is missing, unverified or only partial |
| `REVERSED` | Every line in the bill is reversed |

These are **bill-level** states. Each transaction line also stores a fee status
(`CALCULATED`, `ESTIMATED`, `RULE_NOT_VERIFIED`); the Transactions list shows the bill's
reconciliation so a broker difference is visible without opening the drawer, and the filter
accepts either bill-level or line-level values.

`BAmt` is the broker-reported amount and is used as the BUY commitment when present. The
calculated charges are never added to `BAmt` a second time. A difference is evidence to review,
not an error to hide.

### Worked estimate

From the parser/fee test fixture (synthetic):

| Item | Value |
| --- | --- |
| BUY gross | NPR 182,434.00 |
| Commission | NPR 602.03 |
| SEBON fee | NPR 27.37 |
| DP (two scrips) | NPR 50.00 |
| Total charges | NPR 679.40 |
| Calculated total | NPR 183,113.40 |
| Broker `BAmt` | NPR 183,167.22 |
| Difference | NPR 53.82 → `DIFFERENCE` |

---

## 6. Dates and cash-flow model

### Deadlines

* **BUY payment:** T+1 from trade date, in trading days.
* **SELL EDIS/WACC:** T+1, separately tracked status.
* **CDSC cash/security settlement:** T+2.
* The three dates are stored and displayed separately. A BUY payment is never presented as a
  T+2 settlement date.

The trading week is date-aware: Sunday–Thursday before **6 April 2026**, Monday–Friday from that
date. Holidays are user-configurable because NEPSE's holiday page is JavaScript-only and cannot
be scraped reliably. Deadline offsets are also configurable per vault.

### Daily schedule

The cash-flow engine starts from every bank account's declared opening balance, then walks one
calendar day at a time through:

* actual cash movements (deposits, withdrawals, transfers, adjustments),
* recorded settlements (actual payments/receipts),
* bills with no recorded settlement (projected payment/receipt on their deadline).

Each day reports opening balance, actual payments/receipts, projected payments, expected
receipts, other movements, net flow, projected closing balance, confirmed closing balance and a
shortfall status.

Rules that matter:

* **Actual and projected are separate columns.** Expected SELL proceeds are never counted as
  cash on hand.
* **A same-day receipt is not used to cover a payment.** Shortfall is computed from confirmed
  cash plus actual receipts, and from projected cash plus actual receipts — not from expected
  same-day receipts.
* **Balances cannot go below zero in the presentation.** A negative projected balance is shown
  as a shortfall; the shortfall amount and first date are surfaced.
* **Unconfirmed receipts are dependent, not guaranteed.** If a projected balance depends on
  them, the status says so.
* **Multiple banks are supported.** Transfers create paired `TRANSFER_OUT`/`TRANSFER_IN` rows
  with a shared `transfer_group`. Reversing either leg reverses both, so a half-transfer can
  never create or destroy cash.
* **Partial settlements are supported.** Payment status is `UNPAID`, `PARTIAL`, `PAID`,
  `OVERPAID`; receipt status is `UNRECEIVED`, `PARTIAL`, `RECEIVED`, `OVERPAID`.

Status labels include `SHORTFALL`, `SHORTFALL_CONFIRMED_CASH`, `OVERDUE_PAYMENT`,
`UNCONFIRMED_RECEIPT_DEPENDENCY`, `OK` and `ACTIVITY`.

---

## 7. Holdings and P&L

* **Cost basis method:** WACC. Every BUY adds gross plus charges to quantity and cost.
* Every SELL removes quantity at the current WACC. Realised P&L is accumulated as
  `net sale proceeds − CGT − cost basis`.
* FIFO lots are used **only** to split the sold quantity into `LONG` (> 365 days) and `SHORT`
  (≤ 365 days) for CGT. They do not change the WACC cost basis.
* Unrealised P&L uses the latest manual price override, otherwise the latest stored NEPSE daily
  close on or before the as-of date, and marks the price source.
* A manual price is explicit and removable. If no price exists, unrealised values remain
  `null` rather than being estimated from nothing.
* A closed position is hidden by default and can be included.

Oversold quantities, missing cost basis and mixed holding periods are marked, never silently
rounded into a confident number.

---

## 8. Corrections, reversals and audit

* Editing a transaction requires a reason. The before and after payloads are written to
  `account_audit_events`.
* A bill-level side/date change propagates to all transaction lines in that bill.
* Reversing a transaction sets `reversed_at`/reason, excludes it from the active ledger, and
  recomputes the bill and WACC.
* Reversing a settlement keeps the row on the bill for audit but excludes it from actual cash.
  A reason is required.
* Cash movements support an include-reversed list for audit; default list excludes them from
  active totals. Reversing a transfer leg reverses both legs atomically with the same reason.
* Key rotation creates a new token, invalidates the old hash immediately, and returns the new
  key once. The current UI keeps the Settings page mounted while the new key is displayed so
  the user can save it before continuing.

---

## 9. Security and privacy

| Control | Implementation |
| --- | --- |
| Key generation | `secrets.token_urlsafe(32)` — 256 bits |
| Key at rest | SHA-256 hash only |
| Key in browser | `sessionStorage` by default; `localStorage` only when the user explicitly checks “Remember this key on this device” |
| Ledger in browser | Never; server-side database only |
| Authorization | Bearer key required by every account route |
| Isolation | Every query filters `vault_id`; cross-vault reads return 401/404 |
| Caching | `Cache-Control: private, no-store` on account responses, including 401s |
| SMS content | Stored and rendered as plain text (never HTML); raw text is returned only in the transaction/message detail endpoint; XML files with a DTD are rejected |
| Logging | No full SMS text or keys are logged by the account code |
| Public exposure | Account routes are not in the public market cache; no account data appears on public pages |
| Corrections | Every edit/reversal requires a reason and writes an audit event |

The key is a bearer secret: anyone who has it can read and modify that vault. The UI states
this. There is no password reset, email recovery or account recovery service. Rotating the key
is the only way to invalidate a leaked key; losing the key without a saved copy loses access to
that vault.

Not implemented: user accounts, OAuth/passkeys, device management, multi-user sharing,
server-side encryption at rest (database encryption is a hosting concern), rate limiting
specific to the account API, and account deletion. Those are listed as remaining work.

---

## 10. API surface

All routes are under `/api/account` and require `Authorization: Bearer <key>` unless marked
public. `/vaults` is the only public endpoint.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/vaults` | Create a vault and return the key once |
| `GET` | `/me` | Vault identity, settings, counts |
| `PATCH` | `/settings` | Label, category, broker, holidays, day offsets |
| `POST` | `/rotate-key` | Rotate and return a new key once |
| `GET/POST` | `/bank-accounts` | List/create bank accounts |
| `PATCH` | `/bank-accounts/{id}` | Edit/rename/deactivate |
| `GET/POST` | `/cash-movements` | List/create movements (`?include_reversed=true` for audit) |
| `POST` | `/cash-movements/{id}/reverse` | Reverse a movement with a reason |
| `GET` | `/cashflow` | Daily actual/projected schedule and metrics |
| `POST` | `/imports/preview` | Parse and preview, no ledger writes |
| `POST` | `/imports/commit` | Commit approved messages |
| `GET` | `/imports` | Import history |
| `GET` | `/messages`, `/messages/{id}` | Message list/detail |
| `GET` | `/transactions` | Filtered list and summary |
| `GET` | `/transactions/export.csv` | CSV export with formula-injection protection |
| `GET` | `/transactions/{id}` | Transaction, bill, message, settlements, audit |
| `PATCH` | `/transactions/{id}` | Audited correction |
| `POST` | `/transactions/{id}/reverse` | Audited reversal |
| `GET/PATCH` | `/bills/{id}` | Bill detail / audited bill correction |
| `POST` | `/bills/{id}/settlements` | Record partial/full payment or receipt |
| `POST` | `/settlements/{id}/reverse` | Reverse a settlement |
| `GET` | `/holdings` | WACC holdings, lots, P&L |
| `POST/DELETE` | `/holdings/{symbol}/price` | Set/clear manual price |
| `GET` | `/fee-rules` | Versioned rules with sources and verification |
| `GET` | `/audit` | Recent audit events |
| `GET` | `/overview` | Aggregated dashboard payload |

CSV exports neutralise cells that begin with `=`, `+`, `-` or `@` so a spreadsheet cannot
execute a formula from a symbol or note.

---

## 11. Limitations and remaining work

### Known limitations

* **No native SMS inbox access.** Paste/export is intentional; browser and iOS cannot read SMS.
  Android backup XML is supported, but the user must produce it.
* **No broker or bank feed.** Balances and settlements are user-declared/recorded, not
  synchronised with a broker, CDSC or bank.
* **Holidays are user-configured.** The official NEPSE holiday page is JavaScript-only; no
  holiday list is invented. A missing holiday shifts a deadline.
* **Fee rules can vary by broker/DP.** The seeded rules cite public rate cards, but a broker or
  DP may charge a different amount. A difference against `BAmt` is surfaced, not hidden.
* **CGT is an estimate.** It uses WACC including buy charges and net sale proceeds. It does not
  carry losses forward, model other income, or replace a tax filing.
* **Mixed holding periods** are apportioned and marked `ESTIMATED_MIXED_HOLDING`.
* **One currency (NPR).** No FX conversion.
* **No migrations.** `create_all` is used. A schema change in production needs a migration
  strategy before the next deployment.
* **No account deletion endpoint.** A local demo vault must be removed directly from the
  database during development.
* **Key recovery is the user's responsibility.** There is no email/password reset.
* **No multi-user sharing or team roles.**
* **WebKit/Safari automation remains blocked on this host** (existing project limitation).

### Remaining work

1. Add Alembic migrations for the account tables before deploying.
2. Add account deletion and an explicit “forget this vault” flow.
3. Add rate limiting and login-attempt throttling for `/vaults` and key-protected routes.
4. Decide whether to keep `localStorage` key persistence at all; if kept, add a clear warning
   and a “forget key” action in the gate.
5. Add a verified holiday feed or a packaged, dated holiday list with provenance.
6. Add a native mobile companion or share-sheet import for SMS, rather than scraping.
7. Add broker/DP fee verification per broker and per DP, with a user override that is clearly
   marked as an override.
8. Model tax loss carry-forward and other income, or keep CGT explicitly labelled as an
   estimate.
9. Show an explicit transfer-pair indicator/link in the movement list (the API already exposes
   `transfer_group`; both legs are reversed together).
10. Add multi-currency support only if a real requirement appears.
11. Add accessibility review (keyboard-only vault gate, screen-reader labels for icon actions).
12. Add load/performance testing for large ledgers and long cash-flow ranges.

---

## 12. Test evidence

Account-specific tests (backend):

| File | Focus | Tests |
| --- | --- | --- |
| `backend/tests/test_account_parser.py` | SMS formats, multi-line bills, decimals, files, errors | 18 |
| `backend/tests/test_account_fees.py` | Commission slabs, SEBON, DP, CGT, reconciliation, allocation | 9 |
| `backend/tests/test_account_cashflow.py` | Actual vs projected, shortfall, partial settlement, transfers, account filter | 10 |
| `backend/tests/test_account_holdings.py` | WACC, CGT, realised/unrealised, oversold, as-of | 6 |
| `backend/tests/test_account_api.py` | Auth/isolation, import/duplicate, reconciliation filter, edits, reversals, transfer pairs, settlements, CSV, key rotation, guards | 16 |

Checks run:

```bash
backend/.venv/bin/python -m pytest backend/tests -q
cd backend  && .venv/bin/ruff check app tests
cd frontend && npx tsc -p tsconfig.app.json --noEmit
cd frontend && npm run build
```

The full backend suite is **124 tests**. The account suite includes an explicit test that two
same-day, same-security trades with different bill numbers are both imported and neither is
discarded as a duplicate.

Browser validation used synthetic data only and covered: locked gate, unlock with/without
“remember”, vault creation, key-once confirmation, key rotation (new key remains visible while
the old key returns 401), overview, transactions, audited quantity correction and revert,
partial settlement receipt and reversal, cash-movement creation and reversal, paired-transfer
reversal (both legs), holdings manual price, fee-rule table, settings save, bank-account
create/deactivate, SMS sample preview, commit, and duplicate-skip commit. A 390 × 844 viewport
check on all six tabs found no horizontal page overflow. The final production-bundle pass at both
1440 × 1000 and 390 × 844 produced **zero console errors or warnings** across all six tabs.

> All fixtures, screenshots and demo rows are synthetic. No real user SMS, brokerage statement,
> bank balance or key is included in the repository.
