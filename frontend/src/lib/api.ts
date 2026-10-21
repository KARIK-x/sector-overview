const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

function qs(params?: Record<string, string | number | boolean | undefined | null>) {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v))
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export async function getJson<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${BASE}/api${path}${qs(params)}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* keep status text */
    }
    throw new ApiError(detail, res.status)
  }
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export type Quadrant = 'WINNING' | 'ADVANCING' | 'LOSING' | 'LAGGING'

export interface SectorMeta {
  code: string
  name: string
  index_code: string | null
  index_name: string | null
  description: string | null
  active: boolean
  subindex_symbol: string
}

export interface RotationRow {
  code: string
  name: string
  absolute_strength: number | null
  relative_strength: number | null
  rs_ratio: number | null
  quadrant: Quadrant | null
  return_5: number | null
  return_20: number | null
  return_60: number | null
  return_120: number | null
  momentum_change: number | null
  momentum_direction: 'IMPROVING' | 'DETERIORATING' | 'FLAT' | null
  latest_date: string | null
  observations: number
  status: string
}

export interface RotationPayload {
  window: number
  absolute_threshold: number
  relative_threshold: number
  latest_date: string | null
  rows: RotationRow[]
  transitions: TransitionEvent[]
  axes: { x: string; y: string }
  quadrants: Record<string, Quadrant>
}

export interface TransitionEvent {
  date: string | null
  code: string
  name: string
  from: Quadrant
  to: Quadrant
  absolute_strength: number | null
  relative_strength: number | null
}

export interface TrailPoint {
  date: string
  absolute_strength: number
  relative_strength: number
  rs_ratio: number | null
  quadrant: Quadrant | null
}

export interface TrailsPayload {
  window: number
  sessions: number
  latest_date: string | null
  trails: Record<string, TrailPoint[]>
}

export interface HeatmapRow {
  code: string
  name: string
  latest_date: string | null
  [key: `r${number}`]: number | null | string
}

export interface HeatmapPayload {
  horizons: number[]
  rows: HeatmapRow[]
  latest_date: string | null
}

export interface MarketOverview {
  available: boolean
  latest_date?: string
  nepse_close?: number
  nepse_change?: number | null
  nepse_pct?: number | null
  return_20?: number | null
  return_60?: number | null
  return_252?: number | null
}

export interface BreadthRow {
  sector_name: string
  advances: number
  declines: number
  unchanged: number
  traded: number
  advance_pct: number | null
  decline_pct: number | null
  net_advances: number
  ad_ratio: number | null
}

export interface BreadthHistoryPoint {
  date: string
  advances: number
  declines: number
  unchanged: number
  advance_pct: number | null
}

export interface BreadthSummary {
  available: boolean
  reason?: string
  latest_date?: string
  rows?: BreadthRow[]
  history?: BreadthHistoryPoint[]
  method?: string
}

export interface LiquidityRow {
  sector_name: string
  turnover: number | null
  volume: number | null
  securities: number
  share: number | null
}

export interface LiquiditySummary {
  available: boolean
  reason?: string
  latest_date?: string
  total_turnover?: number
  rows?: LiquidityRow[]
  history?: Array<Record<string, number | string | null>>
  notes?: string[]
}

export interface RiskRow {
  code: string
  name: string
  volatility: number | null
  max_drawdown: number | null
  current_drawdown: number | null
  beta: number | null
  correlation: number | null
  var_95: number | null
  cvar_95: number | null
  observations: number
}

export interface RiskSummary {
  available: boolean
  reason?: string
  latest_date?: string
  rows?: RiskRow[]
}

export interface FundamentalRow {
  code: string
  name: string
  available: boolean
  coverage?: number
  symbols_total?: number
  symbols_with_reports?: number
  aggregate_profit?: number | null
  aggregate_equity?: number | null
  aggregate_market_cap?: number | null
  aggregate_pe?: number | null
  aggregate_pe_ex_negative?: number | null
  aggregate_eps?: number | null
  aggregate_roe?: number | null
  weighted_net_worth_per_share?: number | null
  negative_earnings_symbols?: number
  missing_capital_symbols?: number
  book_value_symbols?: number
  rejected_book_values?: number
  notes?: string[]
  companies?: CompanyFundamental[]
}

export interface CompanyFundamental {
  symbol: string
  profit: number | null
  eps: number | null
  pe: number | null
  paid_up_capital: number | null
  net_worth_per_share: number | null
  book_value_reported?: number | null
  book_value_status?: 'ok' | 'implausible' | 'unverifiable' | 'missing'
  market_cap: number | null
  fiscal_year: string | null
  report_type: string | null
}

export interface FactorRow extends RotationRow {
  score: number | null
  contributions: Record<string, number>
  weights_used: Record<string, number>
  coverage: number
  missing_factors: string[]
}

export interface FactorsPayload {
  weights: Record<string, number>
  higher_is_better: Record<string, boolean>
  rows: FactorRow[]
  method: string
}

export interface DataQualityPayload {
  index_coverage: Array<{
    code: string
    name: string
    observations: number
    first_date: string | null
    last_date: string | null
    expected_sessions: number
    missing_sessions: number
    completeness?: number
    status: string
  }>
  securities: {
    total: number
    ordinary: number
    classified: number
    classification_coverage: number
  }
  daily_summaries: { rows: number; first_date: string | null; last_date: string | null }
  fundamentals: { reports: number; symbols: number }
  ingestion_runs: Array<{
    source: string
    started_at: string | null
    finished_at: string | null
    status: string
    rows: number
    message: string | null
  }>
  issues: Array<{
    dataset: string
    severity: string
    code: string
    message: string
    detected_at: string | null
  }>
  notes: string[]
}

export interface SectorDetail {
  code: string
  name: string
  available: boolean
  index_symbol?: string
  latest_date?: string
  latest_close?: number
  returns?: Record<string, number | null>
  technicals?: Record<string, number | null>
  risk?: Record<string, unknown> & { available?: boolean }
  breadth?: Record<string, unknown> & { available?: boolean }
  liquidity?: Record<string, unknown> & { available?: boolean }
  fundamentals?: FundamentalRow
  history?: Array<{ date: string; close: number; ma20: number | null; ma50: number | null; ma200: number | null }>
  observations?: number
  data_quality?: Record<string, string | number>
}

export interface DashboardPayload {
  market: MarketOverview
  rotation: { window: number; rows: RotationRow[]; transitions: TransitionEvent[] }
  heatmap: HeatmapPayload
  liquidity: LiquiditySummary
  breadth: BreadthSummary
  risk: RiskSummary
  leaders: RotationRow[]
  laggards: RotationRow[]
  data_freshness: {
    index_latest: string | null
    summary_latest: string | null
    breadth_latest: string | null
  }
}

export interface ResearchPayload {
  available: boolean
  transition_matrix?: Record<string, Record<string, number>>
  backtest?: {
    available: boolean
    points: number
    equity_curve: number[]
    benchmark_curve: number[]
    final_equity: number | null
    final_benchmark: number | null
    method: string
  }
  notes?: string[]
}

export interface MethodologyPayload {
  [key: string]: string | string[]
}

export interface EventsPayload {
  available: boolean
  reason: string
  required_source: string
  items: Array<Record<string, unknown>>
}

export const api = {
  meta: () => getJson<{ name: string; version: string; quadrants: Quadrant[]; horizons: number[] }>('/meta'),
  sectors: () => getJson<SectorMeta[]>('/sectors'),
  dashboard: () => getJson<DashboardPayload>('/dashboard'),
  rotation: (window: number, abs: number, rel: number, signal?: AbortSignal) =>
    getJson<RotationPayload>('/rotation', { window, abs_threshold: abs, rel_threshold: rel }, signal),
  trails: (window: number, sessions: number, signal?: AbortSignal) =>
    getJson<TrailsPayload>('/rotation/trails', { window, sessions }, signal),
  heatmap: () => getJson<HeatmapPayload>('/heatmap'),
  sector: (code: string) => getJson<SectorDetail>(`/sectors/${code}`),
  breadth: (sector?: string) => getJson<BreadthSummary | Record<string, unknown>>('/breadth', { sector }),
  liquidity: (sector?: string) => getJson<LiquiditySummary | Record<string, unknown>>('/liquidity', { sector }),
  risk: (sector?: string) => getJson<RiskSummary | Record<string, unknown>>('/risk', { sector }),
  fundamentals: () => getJson<{ available: boolean; rows: FundamentalRow[]; notes: string[] }>('/fundamentals'),
  factors: (weights: Record<string, number>) =>
    getJson<FactorsPayload>('/factors', {
      weight_momentum_20: weights.momentum_20,
      weight_relative_20: weights.relative_20,
      weight_momentum_accel: weights.momentum_accel,
      weight_low_volatility: weights.low_volatility,
      weight_liquidity: weights.liquidity,
      weight_trend: weights.trend,
    }),
  research: () => getJson<ResearchPayload>('/research'),
  events: () => getJson<EventsPayload>('/events'),
  dataQuality: () => getJson<DataQualityPayload>('/data-quality'),
  methodology: () => getJson<MethodologyPayload>('/methodology'),
}
