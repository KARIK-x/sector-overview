const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const SESSION_KEY = 'nepse.account.key'
const LOCAL_KEY = 'nepse.account.key.remember'
const PENDING_CREATION_KEY = 'nepse.account.pending-creation'

export interface PendingCreation {
  token: string
  label: string
}

export class AccountApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'AccountApiError'
  }
}

export function readAccountToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(LOCAL_KEY)
  } catch {
    return null
  }
}

export function storeAccountToken(token: string, remember: boolean): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(LOCAL_KEY)
    if (remember) localStorage.setItem(LOCAL_KEY, token)
    else sessionStorage.setItem(SESSION_KEY, token)
  } catch {
    /* Private browsing may block storage; the in-memory session still works. */
  }
}

export function clearAccountToken(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(LOCAL_KEY)
  } catch {
    /* ignore */
  }
}

export function storePendingCreation(creation: PendingCreation): void {
  try {
    sessionStorage.setItem(PENDING_CREATION_KEY, JSON.stringify(creation))
  } catch {
    /* The key screen still works for this page load. */
  }
}

export function readPendingCreation(): PendingCreation | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CREATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingCreation>
    if (typeof parsed.token !== 'string' || typeof parsed.label !== 'string') return null
    return { token: parsed.token, label: parsed.label }
  } catch {
    return null
  }
}

export function clearPendingCreation(): void {
  try {
    sessionStorage.removeItem(PENDING_CREATION_KEY)
  } catch {
    /* ignore */
  }
}

function qs(params?: Record<string, string | number | boolean | undefined | null>): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

function describeDetail(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const location = Array.isArray(record.loc)
          ? record.loc.filter((part) => part !== 'body').join('.')
          : ''
        const message = typeof record.msg === 'string' ? record.msg : 'Invalid value'
        return location ? `${location}: ${message}` : message
      }
      return String(item)
    })
    return parts.length ? parts.join('; ') : null
  }
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>
    if (typeof record.msg === 'string') return record.msg
    return JSON.stringify(detail)
  }
  return null
}

async function request<T>(
  token: string,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
    body?: unknown
    params?: Record<string, string | number | boolean | undefined | null>
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const response = await fetch(`${BASE}/api/account${path}${qs(options.params)}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: 'no-store',
  })
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`
    try {
      const data = (await response.json()) as { detail?: unknown }
      detail = describeDetail(data.detail) ?? detail
    } catch {
      /* keep status text */
    }
    throw new AccountApiError(detail, response.status)
  }
  return (await response.json()) as T
}

export interface AccountSettings {
  holiday_dates: string[]
  buy_payment_business_days: number
  edis_business_days: number
  sell_settlement_business_days: number
}

export interface AccountVault {
  id: string
  label: string
  investor_category: 'RESIDENT_INDIVIDUAL' | 'RESIDENT_ENTITY' | 'NON_RESIDENT'
  cost_basis_method: string
  default_broker: string | null
  created_at: string | null
  last_seen_at: string | null
  settings: AccountSettings
}

export interface BankAccount {
  id: number
  name: string
  currency: string
  opening_balance: string
  opening_balance_date: string
  is_default: boolean
  active: boolean
  created_at: string | null
  updated_at: string | null
}

export interface AccountMe {
  vault: AccountVault
  bank_accounts: BankAccount[]
  counts: { transactions: number; messages: number }
  has_data: boolean
}

export interface AccountCreateResponse {
  token: string
  vault: AccountVault
  bank_accounts: BankAccount[]
  notice: string
}

export interface AccountTransaction {
  id: number
  vault_id: string
  bill_id: number
  source_message_id: number
  line_no: number
  symbol: string
  security_name: string | null
  security_type: string
  side: 'BUY' | 'SELL'
  trade_date: string
  quantity: string
  price: string
  gross_amount: string
  commission: string
  sebon_fee: string
  dp_charge: string
  other_charges: string
  total_charges: string
  cgt: string
  cost_basis: string | null
  realized_pnl: string | null
  net_amount: string
  payment_deadline: string | null
  settlement_date: string | null
  status: string
  reconciliation_status: string
  fee_rule_version: string
  fee_snapshot: Record<string, unknown>
  notes: string | null
  reversed_at: string | null
  reversal_reason: string | null
  created_at: string | null
  updated_at: string | null
  bill_no: string | null
  broker_id: string | null
  bamt: string | null
  bill_cash_amount: string | null
  bill_reconciliation_status: string | null
  bill_status: string | null
  edis_status: string | null
  wacc_status: string | null
  paid_amount: string
  received_amount: string
  outstanding?: string
  message_status?: string
  message_warnings?: string[]
  message_errors?: string[]
  raw_text?: string
}

export interface TransactionBill {
  id: number
  sms_message_id: number | null
  bank_account_id: number | null
  broker_id: string | null
  trade_date: string
  side: 'BUY' | 'SELL'
  bill_no: string | null
  bamt: string | null
  gross_amount: string
  charges_total: string
  cgt_total: string
  calculated_total: string
  cash_amount: string
  reconciliation_status: string
  payment_deadline: string | null
  edis_deadline: string | null
  settlement_date: string | null
  edis_status: string
  wacc_status: string
  status: string
  notes: string | null
  paid_amount: string
  received_amount: string
  outstanding: string
  payment_status: string
  created_at: string | null
  updated_at: string | null
  transactions: AccountTransaction[]
}

export interface SmsMessageRow {
  id: number
  import_id: number | null
  source_type: string
  filename: string | null
  sender: string | null
  received_at: string | null
  fingerprint: string
  parser_version: string
  confidence: number
  status: string
  warnings: string[]
  errors: string[]
  broker_id: string | null
  trade_date: string | null
  side: string | null
  bill_no: string | null
  bamt: string | null
  payment_url: string | null
  line_count: number
  created_at: string | null
  imported_at: string | null
  duplicate_of: number | null
  raw_text?: string
  normalized_text?: string
  bill?: TransactionBill
}

export interface Settlement {
  id: number
  bill_id: number
  transaction_id: number | null
  direction: 'PAYMENT' | 'RECEIPT'
  amount: string
  settlement_date: string
  bank_account_id: number | null
  reference: string | null
  note: string | null
  reversed_at: string | null
  reversal_reason: string | null
  created_at: string | null
}

export interface CashMovement {
  id: number
  bank_account_id: number
  movement_date: string
  kind: string
  amount: string
  signed_amount: string
  note: string | null
  counter_account_id: number | null
  transfer_group: string | null
  reversed_at: string | null
  reversal_reason: string | null
  created_at: string | null
}

export interface CashEvent {
  kind: string
  amount: string
  actual: boolean
  label: string
  bill_id: number | null
  bill_no: string | null
  side: string | null
  description: string | null
}

export interface CashflowDay {
  date: string
  opening_balance: string
  confirmed_opening_balance: string
  actual_payments: string
  projected_payments: string
  actual_receipts: string
  expected_receipts: string
  other_movements: string
  net_cash_flow: string
  actual_net_cash_flow: string
  projected_closing_balance: string
  confirmed_closing_balance: string
  unconfirmed_opening_balance: string
  shortfall: string
  confirmed_shortfall: string
  status: string
  events: CashEvent[]
}

export interface Commitment {
  bill_id: number
  bill_no: string | null
  side: 'BUY' | 'SELL'
  trade_date: string
  symbols: string
  broker_id: string | null
  cash_amount: string
  settled: string
  outstanding: string
  payment_deadline: string | null
  settlement_date: string | null
  status: string
  reconciliation_status: string
}

export interface CashflowMetrics {
  actual_bank_balance: string
  projected_available_cash: string
  committed_payments: string
  expected_receipts: string
  unconfirmed_receipts: string
  potential_shortfall: string
  max_shortfall: string
  first_shortfall: { date: string; amount: string; confirmed_amount: string; status: string } | null
  next_payment_deadline: string | null
  next_receipt_date: string | null
  overdue_payments: string
  confirmed_balance: string
}

export interface CashflowPayload {
  available: boolean
  as_of: string
  start: string | null
  end: string | null
  accounts: Array<BankAccount & { confirmed_balance: string; projected_balance: string }>
  days: CashflowDay[]
  shortfalls: Array<{ date: string; amount: string; confirmed_amount: string; status: string }>
  commitments: Commitment[]
  metrics: CashflowMetrics
  assumptions: string[]
  notes: string[]
  has_data: boolean
}

export interface HoldingRow {
  symbol: string
  name: string | null
  quantity: string
  avg_cost: string | null
  cost_basis: string
  market_price: string | null
  market_price_date: string | null
  market_price_source: string | null
  market_value: string | null
  unrealized_pnl: string | null
  realized_pnl: string
  charges: string
  holding_days: number | null
  earliest_lot: string | null
  status: string
}

export interface HoldingsPayload {
  as_of: string
  method: string
  holding_period_basis: string
  rows: HoldingRow[]
  summary: {
    open_positions: number
    cost_basis: string
    market_value: string | null
    unrealized_pnl: string | null
    realized_pnl: string
    charges: string
  }
  notes: string[]
}

export interface FeeRule {
  id: number
  code: string
  version: string
  description: string
  effective_from: string
  effective_to: string | null
  transaction_type: string
  security_type: string
  investor_category: string
  holding_period: string
  calculation: string
  rate: string | null
  brackets: Array<{ min?: number; max?: number | null; rate: number; label?: string }>
  minimum: string | null
  maximum: string | null
  rounding: string
  source_title: string
  source_url: string
  verification: string
  notes: string | null
}

export interface AuditEvent {
  id: number
  entity_type: string
  entity_id: string | null
  action: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  note: string | null
  created_at: string | null
}

export interface TransactionDetail {
  transaction: AccountTransaction
  bill: TransactionBill
  message: SmsMessageRow | null
  settlements: Settlement[]
  audit: AuditEvent[]
}

export interface AccountOverview {
  available: boolean
  as_of: string
  vault: AccountVault
  bank_accounts: BankAccount[]
  has_data: boolean
  metrics: {
    actual_bank_balance: string
    projected_available_cash: string
    committed_payments: string
    expected_receipts: string
    unconfirmed_receipts: string
    potential_shortfall: string
    max_shortfall: string
    first_shortfall: { date: string; amount: string; confirmed_amount: string; status: string } | null
    overdue_payments: string
    next_payment_deadline: string | null
    next_receipt_date: string | null
    realized_pnl: string
    unrealized_pnl: string | null
    holdings_cost: string
    holdings_value: string | null
    charges_paid: string
    cgt_paid: string
    transaction_count: number
    open_bills: number
    open_holdings: number
    import_count: number
    unreviewed_messages: number
  }
  cashflow: {
    days: CashflowDay[]
    shortfalls: Array<{ date: string; amount: string; confirmed_amount: string; status: string }>
    metrics: CashflowMetrics
    commitments: Commitment[]
    assumptions: string[]
  }
  holdings: HoldingsPayload
  upcoming: Array<Commitment & { type: 'PAYMENT' | 'RECEIPT'; due_date: string | null; overdue: boolean }>
  recent_transactions: AccountTransaction[]
  charges_series: Array<{ month: string; charges: string; cgt: string; gross: string; count: number }>
  message_health: Record<string, number>
  notes: string[]
}

export interface ParserLine {
  line_no: number
  symbol: string
  quantity: string
  price: string
  gross: string
  raw: string
}

export interface PreviewMessage {
  raw_text: string
  normalized_text: string
  fingerprint: string
  broker_id: string | null
  trade_date: string | null
  side: 'BUY' | 'SELL' | null
  lines: ParserLine[]
  gross_total: string
  bamt: string | null
  bill_no: string | null
  payment_url: string | null
  confidence: number
  status: string
  warnings: string[]
  errors: string[]
  parser_version: string
  line_count: number
  sender: string | null
  received_at: string | null
  duplicate_of: number | null
  previous_message_id: number | null
  previous_status: string | null
}

export interface ImportPreview {
  batch: { source_type: string; filename: string | null; message_count: number }
  messages: PreviewMessage[]
  summary: {
    total: number
    parsed: number
    needs_review: number
    errors: number
    duplicates: number
    buy: number
    sell: number
    unknown_symbols: string[]
  }
}

export interface ImportCommitResult {
  import_id: number
  summary: Record<string, number>
  messages: SmsMessageRow[]
  batch: { id: number; status: string; source_type: string; filename: string | null }
}

export interface ImportHistoryRow {
  id: number
  source_type: string
  filename: string | null
  status: string
  message_count: number
  parsed_count: number
  imported_count: number
  rejected_count: number
  review_count: number
  duplicate_count: number
  buy_bills: number
  sell_bills: number
  line_count: number
  created_at: string | null
  completed_at: string | null
}

export interface TransactionListPayload {
  rows: AccountTransaction[]
  total: number
  page: number
  page_size: number
  summary: {
    count: number
    buy_count: number
    sell_count: number
    buy_value: string
    sell_value: string
    charges_total: string
    cgt_total: string
    realized_pnl: string
  }
  filter_options: { symbols: string[]; statuses: string[]; reconciliations: string[]; sides: string[] }
}

export interface FeeRulesPayload {
  as_of: string | null
  rules: FeeRule[]
  sources: Array<{ title: string; url: string }>
  note: string
}

export interface ImportLineOverride {
  line_no: number
  symbol: string
  quantity: string
  price: string
}

export interface MessageOverride {
  broker_id?: string | null
  trade_date?: string | null
  side?: 'BUY' | 'SELL' | null
  bill_no?: string | null
  bamt?: string | null
  payment_url?: string | null
  lines?: ImportLineOverride[]
}

export const accountApi = {
  createVault: async (payload: {
    label: string
    investor_category: string
    opening_balance: string
    opening_balance_date: string
    default_broker?: string
    bank_account_name: string
  }): Promise<AccountCreateResponse> => {
    const response = await fetch(`${BASE}/api/account/vaults`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const data = (await response.json()) as { detail?: unknown }
        if (typeof data.detail === 'string') detail = data.detail
      } catch {
        /* keep */
      }
      throw new AccountApiError(detail, response.status)
    }
    return (await response.json()) as AccountCreateResponse
  },
  me: (token: string) => request<AccountMe>(token, '/me'),
  overview: (token: string, as_of?: string) =>
    request<AccountOverview>(token, '/overview', { params: { as_of } }),
  updateSettings: (token: string, payload: Record<string, unknown>) =>
    request<{ vault: AccountVault; notice: string }>(token, '/settings', { method: 'PATCH', body: payload }),
  rotateKey: (token: string) =>
    request<{ token: string; notice: string }>(token, '/rotate-key', { method: 'POST' }),
  bankAccounts: (token: string) =>
    request<{ accounts: BankAccount[] }>(token, '/bank-accounts'),
  createBankAccount: (token: string, payload: Record<string, unknown>) =>
    request<{ account: BankAccount }>(token, '/bank-accounts', { method: 'POST', body: payload }),
  updateBankAccount: (token: string, id: number, payload: Record<string, unknown>) =>
    request<{ account: BankAccount }>(token, `/bank-accounts/${id}`, { method: 'PATCH', body: payload }),
  cashflow: (
    token: string,
    params: { start?: string; end?: string; as_of?: string; bank_account_id?: number | null },
  ) => request<CashflowPayload>(token, '/cashflow', { params }),
  cashMovements: (
    token: string,
    params?: { from?: string; to?: string; bank_account_id?: number | null; include_reversed?: boolean },
  ) => request<{ movements: CashMovement[] }>(token, '/cash-movements', { params }),
  createCashMovement: (token: string, payload: Record<string, unknown>) =>
    request<{ movements: CashMovement[] }>(token, '/cash-movements', { method: 'POST', body: payload }),
  reverseCashMovement: (token: string, id: number, reason: string) =>
    request<{ movement: CashMovement; movements: CashMovement[] }>(token, `/cash-movements/${id}/reverse`, {
      method: 'POST',
      body: { reason },
    }),
  previewImport: (
    token: string,
    payload: { source_type: string; filename?: string | null; content?: string; messages?: Array<{ raw_text: string; sender?: string | null; received_at?: string | null }> },
  ) => request<ImportPreview>(token, '/imports/preview', { method: 'POST', body: payload }),
  commitImport: (token: string, payload: Record<string, unknown>) =>
    request<ImportCommitResult>(token, '/imports/commit', { method: 'POST', body: payload }),
  imports: (token: string) => request<{ imports: ImportHistoryRow[] }>(token, '/imports'),
  messages: (token: string, status?: string) =>
    request<{ messages: SmsMessageRow[] }>(token, '/messages', { params: { status } }),
  message: (token: string, id: number) =>
    request<{ message: SmsMessageRow }>(token, `/messages/${id}`),
  transactions: (
    token: string,
    params: {
      from?: string
      to?: string
      side?: string
      symbol?: string
      status?: string
      reconciliation?: string
      q?: string
      sort?: string
      order?: string
      page?: number
      page_size?: number
    },
  ) => request<TransactionListPayload>(token, '/transactions', { params }),
  transaction: (token: string, id: number) =>
    request<TransactionDetail>(token, `/transactions/${id}`),
  updateTransaction: (token: string, id: number, payload: Record<string, unknown>) =>
    request<TransactionDetail>(token, `/transactions/${id}`, { method: 'PATCH', body: payload }),
  reverseTransaction: (token: string, id: number, reason: string) =>
    request<TransactionDetail>(token, `/transactions/${id}/reverse`, {
      method: 'POST',
      body: { reason },
    }),
  bill: (token: string, id: number) =>
    request<{ bill: TransactionBill; settlements: Settlement[] }>(token, `/bills/${id}`),
  updateBill: (token: string, id: number, payload: Record<string, unknown>) =>
    request<{ bill: TransactionBill; settlements: Settlement[] }>(token, `/bills/${id}`, {
      method: 'PATCH',
      body: payload,
    }),
  createSettlement: (token: string, billId: number, payload: Record<string, unknown>) =>
    request<{ settlement: Settlement; bill: TransactionBill }>(token, `/bills/${billId}/settlements`, {
      method: 'POST',
      body: payload,
    }),
  reverseSettlement: (token: string, id: number, reason: string) =>
    request<{ settlement: Settlement }>(token, `/settlements/${id}/reverse`, {
      method: 'POST',
      body: { reason },
    }),
  holdings: (token: string, params?: { as_of?: string; include_closed?: boolean }) =>
    request<HoldingsPayload>(token, '/holdings', { params }),
  setPrice: (token: string, symbol: string, payload: Record<string, unknown>) =>
    request<{ symbol: string; price: string; as_of: string; note: string | null }>(
      token,
      `/holdings/${symbol}/price`,
      { method: 'POST', body: payload },
    ),
  clearPrice: (token: string, symbol: string) =>
    request<{ deleted: boolean }>(token, `/holdings/${symbol}/price`, { method: 'DELETE' }),
  feeRules: (token: string, as_of?: string) =>
    request<FeeRulesPayload>(token, '/fee-rules', { params: { as_of } }),
  audit: (token: string, limit = 100) =>
    request<{ events: AuditEvent[] }>(token, '/audit', { params: { limit } }),
  exportTransactions: async (
    token: string,
    params: Record<string, string | number | undefined | null>,
  ): Promise<Blob> => {
    const response = await fetch(`${BASE}/api/account/transactions/export.csv${qs(params)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const data = (await response.json()) as { detail?: unknown }
        if (typeof data.detail === 'string') detail = data.detail
      } catch {
        /* keep */
      }
      throw new AccountApiError(detail, response.status)
    }
    return await response.blob()
  },
}

export function moneyValue(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function fmtMoney(value: string | number | null | undefined, sign = false): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `${sign && parsed > 0 ? '+' : ''}NPR ${parsed.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function fmtQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return parsed.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

export function statusTone(status: string): string {
  const s = status.toUpperCase()
  if (s.includes('SHORTFALL') || s.includes('OVERDUE') || s === 'AWAITING_INFO' || s === 'RULE_NOT_VERIFIED') {
    return 'border-[#b23b3b]/30 bg-[#b23b3b]/10 text-[#b23b3b] dark:text-[#f08a86]'
  }
  if (s.includes('ESTIMATED') || s.includes('PARTIAL') || s.includes('DEPENDS') || s.includes('REVIEW') || s === 'DIFFERENCE') {
    return 'border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]'
  }
  if (s.includes('PAID') || s.includes('RECEIVED') || s === 'OK' || s === 'CALCULATED' || s === 'MATCHED' || s === 'IMPORTED') {
    return 'border-[#1f6f5f]/30 bg-[#1f6f5f]/10 text-[#1f6f5f] dark:text-[#6fbfa8]'
  }
  if (s.includes('UNPAID') || s.includes('UNRECEIVED') || s === 'REVERSED') {
    return 'border-line bg-raised text-muted'
  }
  return 'border-line bg-raised text-muted'
}

export function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
