import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, ArrowUpRight, Info } from 'lucide-react'
import { api } from '../lib/api'
import type { SectorDetail } from '../lib/api'
import { Chart } from '../components/Chart'
import {
  Card,
  CardHeader,
  ErrorState,
  InfoNote,
  KeyValue,
  Loading,
  Metric,
  PageHeader,
  Segmented,
  StatusBadge,
} from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette } from '../lib/chart'
import { cn, compact, dateLabel, dateShort, npr, num, pct, signedPct, toneClass } from '../lib/format'

interface BreadthDetail {
  available: boolean
  reason?: string
  eligible?: number
  observed?: number
  unavailable?: number
  counts?: {
    advances: number
    declines: number
    unchanged: number
    traded: number
    advance_pct: number | null
    decline_pct: number | null
    ad_ratio: number | null
  }
  above_ma_pct?: Record<string, number | null>
  new_highs?: number
  new_lows?: number
  new_highs_lows_denominator?: number
  history?: Array<{ date: string; advances: number; declines: number; unchanged: number; advance_pct: number | null }>
  notes?: string[]
}

interface LiquidityDetail {
  available: boolean
  reason?: string
  latest_date?: string
  turnover?: number | null
  volume?: number | null
  concentration?: {
    hhi: number | null
    effective_n: number | null
    top1_share: number | null
    top5_share: number | null
    total: number | null
    count: number
  }
  top?: Array<{ symbol: string; turnover: number | null; share: number | null }>
  history?: Array<{ date: string; turnover: number | null; volume: number | null }>
  notes?: string[]
}

const RANGE_OPTIONS = [
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
  { value: '5Y', label: '5Y' },
  { value: 'ALL', label: 'All' },
]

function rangeSlice(history: NonNullable<SectorDetail['history']>, range: string) {
  if (range === 'ALL') return history
  const sessions = range === '1Y' ? 252 : range === '3Y' ? 756 : 1260
  return history.slice(-sessions)
}

function IndexChart({ detail, range }: { detail: SectorDetail; range: string }) {
  const { isDark } = useTheme()
  const history = rangeSlice(detail.history ?? [], range)
  const option = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    return {
      ...baseOption(isDark),
      grid: { left: 52, right: 22, top: 30, bottom: 54 },
      legend: { ...baseOption(isDark).legend, top: 0, right: 0, data: ['Close', 'MA 20', 'MA 50', 'MA 200'] },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: p.faint, type: 'dashed' } },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : '—'),
      },
      xAxis: {
        type: 'category',
        data: history.map((h) => h.date),
        boundaryGap: false,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateShort(v), hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        scale: true,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => v.toFixed(0) },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
        {
          type: 'slider',
          height: 18,
          bottom: 6,
          borderColor: p.line,
          backgroundColor: 'transparent',
          fillerColor: isDark ? 'rgba(79,209,176,0.08)' : 'rgba(14,124,102,0.08)',
          handleStyle: { color: p.accent },
          textStyle: { color: p.muted, fontSize: 9 },
          dataBackground: { lineStyle: { color: p.faint, opacity: 0.4 }, areaStyle: { color: p.faint, opacity: 0.08 } },
        },
      ],
      series: [
        {
          name: 'Close',
          type: 'line',
          data: history.map((h) => h.close),
          showSymbol: false,
          lineStyle: { width: 1.8, color: p.accent },
          itemStyle: { color: p.accent },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: isDark ? 'rgba(79,209,176,0.16)' : 'rgba(14,124,102,0.14)' },
                { offset: 1, color: 'rgba(14,124,102,0)' },
              ],
            },
          },
          emphasis: { focus: 'series' },
        },
        {
          name: 'MA 20',
          type: 'line',
          data: history.map((h) => h.ma20),
          showSymbol: false,
          lineStyle: { width: 1, color: isDark ? '#e8b06a' : '#b06a14', opacity: 0.85 },
          itemStyle: { color: isDark ? '#e8b06a' : '#b06a14' },
        },
        {
          name: 'MA 50',
          type: 'line',
          data: history.map((h) => h.ma50),
          showSymbol: false,
          lineStyle: { width: 1, color: isDark ? '#7ab3e8' : '#2c5d8f', opacity: 0.8 },
          itemStyle: { color: isDark ? '#7ab3e8' : '#2c5d8f' },
        },
        {
          name: 'MA 200',
          type: 'line',
          data: history.map((h) => h.ma200),
          showSymbol: false,
          lineStyle: { width: 1, color: isDark ? '#f08a86' : '#b23b3b', opacity: 0.65, type: 'dashed' },
          itemStyle: { color: isDark ? '#f08a86' : '#b23b3b' },
        },
      ],
    } as unknown as EChartsOption
  }, [history, isDark])

  return <Chart option={option} height={380} />
}

function BreadthPanel({ breadth }: { breadth: BreadthDetail }) {
  const { isDark } = useTheme()
  const option = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const history = breadth.history ?? []
    return {
      ...baseOption(isDark),
      grid: { left: 42, right: 42, top: 26, bottom: 36 },
      legend: { ...baseOption(isDark).legend, top: 0, data: ['Advances', 'Declines', 'Advance %'] },
      tooltip: { ...baseOption(isDark).tooltip, trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: history.map((h) => h.date),
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateShort(v), hideOverlap: true },
      },
      yAxis: [
        { type: 'value', ...axis, name: 'count', nameTextStyle: { color: p.muted, fontSize: 9 } },
        {
          type: 'value',
          min: 0,
          max: 1,
          ...axis,
          splitLine: { show: false },
          axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
          name: 'advance %',
          nameTextStyle: { color: p.muted, fontSize: 9 },
        },
      ],
      series: [
        {
          name: 'Advances',
          type: 'bar',
          stack: 'ad',
          data: history.map((h) => h.advances),
          itemStyle: { color: isDark ? 'rgba(79,209,176,0.75)' : 'rgba(14,124,102,0.72)' },
        },
        {
          name: 'Declines',
          type: 'bar',
          stack: 'ad',
          data: history.map((h) => -h.declines),
          itemStyle: { color: isDark ? 'rgba(240,138,134,0.7)' : 'rgba(178,59,59,0.65)' },
        },
        {
          name: 'Advance %',
          type: 'line',
          yAxisIndex: 1,
          data: history.map((h) => h.advance_pct),
          showSymbol: false,
          lineStyle: { width: 1.4, color: isDark ? '#e8b06a' : '#b06a14' },
          itemStyle: { color: isDark ? '#e8b06a' : '#b06a14' },
        },
      ],
    } as unknown as EChartsOption
  }, [breadth, isDark])

  if (!breadth.available) {
    return <InfoNote tone="warn">{breadth.reason ?? 'Breadth is unavailable for this sector.'}</InfoNote>
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Advancing"
          value={breadth.counts?.advances ?? '—'}
          tone="pos"
          sub={`${pct(breadth.counts?.advance_pct)} of observed`}
        />
        <Metric
          label="Declining"
          value={breadth.counts?.declines ?? '—'}
          tone="neg"
          sub={`${pct(breadth.counts?.decline_pct)} of observed`}
        />
        <Metric
          label="Above MA 200"
          value={pct(breadth.above_ma_pct?.['200'])}
          sub={`${breadth.observed ?? '—'} observed · ${breadth.unavailable ?? 0} unavailable`}
        />
        <Metric
          label="New highs / lows"
          value={`${breadth.new_highs ?? '—'} / ${breadth.new_lows ?? '—'}`}
          sub="252-session extremes"
        />
      </div>
      <Chart option={option} height={250} />
      {breadth.notes && (
        <div className="mt-2">
          {breadth.notes.map((n) => (
            <InfoNote key={n}>{n}</InfoNote>
          ))}
        </div>
      )}
    </div>
  )
}

function LiquidityPanel({ liquidity }: { liquidity: LiquidityDetail }) {
  const { isDark } = useTheme()
  const history = liquidity.history ?? []
  const option = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    return {
      ...baseOption(isDark),
      grid: { left: 54, right: 18, top: 22, bottom: 34 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? npr(v) : '—'),
      },
      xAxis: {
        type: 'category',
        data: history.map((h) => h.date),
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateShort(v), hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => compact(v) },
      },
      series: [
        {
          name: 'Turnover',
          type: 'line',
          data: history.map((h) => h.turnover),
          showSymbol: false,
          lineStyle: { width: 1.6, color: p.accent },
          itemStyle: { color: p.accent },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: isDark ? 'rgba(79,209,176,0.18)' : 'rgba(14,124,102,0.16)' },
                { offset: 1, color: 'rgba(14,124,102,0)' },
              ],
            },
          },
        },
      ],
    } as unknown as EChartsOption
  }, [history, isDark])

  if (!liquidity.available) {
    return <InfoNote tone="warn">{liquidity.reason ?? 'Liquidity is unavailable for this sector.'}</InfoNote>
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      <div>
        <Chart option={option} height={240} />
        <div className="mt-1 grid grid-cols-3 gap-3">
          <Metric label="Turnover" value={npr(liquidity.turnover)} sub={dateLabel(liquidity.latest_date)} />
          <Metric label="HHI" value={num(liquidity.concentration?.hhi, 3)} sub="turnover concentration" />
          <Metric label="Top 5 share" value={pct(liquidity.concentration?.top5_share)} sub={`${liquidity.concentration?.count ?? 0} traded names`} />
        </div>
      </div>
      <div>
        <div className="eyebrow mb-2">Top traded names</div>
        <div className="space-y-2">
          {(liquidity.top ?? []).map((t, i) => (
            <div key={t.symbol} className="flex items-center gap-2.5">
              <span className="num w-4 text-[10px] text-faint">{i + 1}</span>
              <span className="w-16 font-mono text-[11px]">{t.symbol}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${(t.share ?? 0) * 100}%` }} />
              </div>
              <span className="num w-10 text-right text-[10px] text-muted">{pct(t.share)}</span>
            </div>
          ))}
        </div>
        <InfoNote>Turnover is trading value, not net investor inflow.</InfoNote>
      </div>
    </div>
  )
}

export default function SectorExplorer() {
  const [params, setParams] = useSearchParams()
  const code = (params.get('code') ?? 'BANKING').toUpperCase()
  const [range, setRange] = useState('3Y')
  const { data: sectors } = useQuery({ queryKey: ['sectors'], queryFn: api.sectors })
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sector', code],
    queryFn: () => api.sector(code),
  })

  const list = sectors ?? []
  const idx = list.findIndex((s) => s.code === code)
  const prev = idx > 0 ? list[idx - 1] : list[list.length - 1]
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : list[0]

  const setSector = (c: string) => setParams({ code: c })

  return (
    <div>
      <PageHeader
        eyebrow="Sector explorer"
        title="One sector, every lens."
        description="Price structure, participation, liquidity, risk and reported fundamentals — held together without pretending the gaps do not exist."
        actions={
          <>
            <button className="btn" onClick={() => prev && setSector(prev.code)} title="Previous sector">
              <ArrowLeft size={13} /> {prev?.code ?? '—'}
            </button>
            <button className="btn" onClick={() => next && setSector(next.code)} title="Next sector">
              {next?.code ?? '—'} <ArrowRight size={13} />
            </button>
          </>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {list.map((s) => (
          <button
            key={s.code}
            onClick={() => setSector(s.code)}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-colors',
              s.code === code ? 'border-ink bg-ink text-paper' : 'bg-surface text-muted hover:text-ink',
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      {isLoading && <Card><Loading label={`Loading ${code}`} rows={5} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}
      {data && !data.available && <Card><InfoNote tone="warn">No verified index history is available for {data.name}.</InfoNote></Card>}

      {data && data.available && (
        <>
          <Card className="mb-4">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="eyebrow">{data.index_symbol} · sector sub-index</span>
                  <StatusBadge status="VERIFIED" label="verified close" />
                </div>
                <h2 className="display text-[38px]">{data.name}</h2>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="num text-2xl font-medium">{num(data.latest_close)}</span>
                  <span className={cn('num text-sm', toneClass(data.returns?.r1))}>
                    {signedPct(data.returns?.r1)} <span className="font-sans text-[11px] text-muted">1D</span>
                  </span>
                  <span className="text-[11px] text-muted">as of {dateLabel(data.latest_date)}</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-6">
                {[
                  ['5D', data.returns?.r5],
                  ['20D', data.returns?.r20],
                  ['60D', data.returns?.r60],
                  ['120D', data.returns?.r120],
                  ['252D', data.returns?.r252],
                ].map(([label, v]) => (
                  <div key={String(label)}>
                    <div className="eyebrow mb-1">{label}</div>
                    <div className={cn('num text-sm', toneClass(v as number | null))}>{signedPct(v as number | null)}</div>
                  </div>
                ))}
                <div>
                  <div className="eyebrow mb-1">Observations</div>
                  <div className="num text-sm">{compact(data.observations)}</div>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader
                eyebrow="Index structure"
                title={`${data.name} sub-index`}
                subtitle="Verified close with 20/50/200-session moving averages"
                actions={<Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} size="sm" />}
              />
              <IndexChart detail={data} range={range} />
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader eyebrow="Technicals" title="Trend & momentum" />
                <div className="grid grid-cols-2 gap-4">
                  <Metric label="RSI (14)" value={num(data.technicals?.rsi14, 1)} sub={rsiLabel(data.technicals?.rsi14 ?? null)} />
                  <Metric label="MACD hist" value={num(data.technicals?.macd_hist, 3)} sub="12 / 26 / 9 EMA" />
                  <Metric label="Trend slope 60" value={num((data.technicals?.trend_slope_60 ?? 0) * 100, 3)} sub="% of level per session" />
                  <Metric
                    label="Current drawdown"
                    value={signedPct(data.technicals?.drawdown)}
                    tone={(data.technicals?.drawdown ?? 0) < 0 ? 'neg' : 'neutral'}
                    sub="from running peak"
                  />
                </div>
                <div className="mt-4 border-t pt-3">
                  <div className="eyebrow mb-2">Moving-average stack</div>
                  <div className="space-y-1.5 text-[11px]">
                    {[['MA 20', data.technicals?.ma20], ['MA 50', data.technicals?.ma50], ['MA 200', data.technicals?.ma200]].map(([label, v]) => (
                      <div key={String(label)} className="flex items-center justify-between">
                        <span className="text-muted">{label}</span>
                        <span className="num">{num(v as number | null)}</span>
                        <span className={cn('num text-[10px]', (data.latest_close ?? 0) >= (v as number) ? 'pos' : 'neg')}>
                          {(data.latest_close ?? 0) >= (v as number) ? 'above' : 'below'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
              <Card>
                <CardHeader eyebrow="Risk" title="Return dispersion" />
                <div className="grid grid-cols-2 gap-4">
                  <Metric label="Volatility" value={pct((data.risk?.volatility as number) ?? null)} sub="annualised, 252D" />
                  <Metric label="Beta" value={num((data.risk?.beta as number) ?? null)} sub="vs NEPSE" />
                  <Metric label="Max drawdown" value={signedPct((data.risk?.max_drawdown as number) ?? null)} tone="neg" sub="full history" />
                  <Metric label="VaR 95%" value={signedPct((data.risk?.var_95 as number) ?? null)} sub="daily historical" />
                </div>
                <Link to="/risk" className="mt-4 inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                  Compare all sectors <ArrowUpRight size={12} />
                </Link>
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4">
            <Card>
              <CardHeader
                eyebrow="Breadth"
                title={`Participation inside ${data.name}`}
                subtitle="Observed members only; missing names are reported as unavailable, not unchanged"
              />
              <BreadthPanel breadth={(data.breadth ?? { available: false }) as unknown as BreadthDetail} />
            </Card>
            <Card>
              <CardHeader
                eyebrow="Liquidity"
                title="Traded value & concentration"
                subtitle="Daily turnover across the current sector membership"
              />
              <LiquidityPanel liquidity={(data.liquidity ?? { available: false }) as unknown as LiquidityDetail} />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.3fr]">
            <Card>
              <CardHeader eyebrow="Fundamentals" title="Reported aggregates" subtitle="Latest filing per member; P/E needs positive aggregate earnings and book values are validated" />
              {data.fundamentals?.available ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Metric label="Coverage" value={pct(data.fundamentals.coverage, 0)} sub={`${data.fundamentals.symbols_with_reports ?? 0} of ${data.fundamentals.symbols_total ?? 0} members`} />
                    <Metric label="Aggregate P/E" value={num(data.fundamentals.aggregate_pe, 1)} sub="market cap / net profit" />
                    <Metric label="Aggregate EPS" value={num(data.fundamentals.aggregate_eps, 2)} sub="profit / shares (par NPR 100)" />
                    <Metric label="Aggregate ROE" value={pct(data.fundamentals.aggregate_roe)} sub="profit / equity" />
                  </div>
                  <div className="mt-4">
                    <KeyValue label="Aggregate net profit">{npr(data.fundamentals.aggregate_profit)}</KeyValue>
                    <KeyValue label="Aggregate market cap">{npr(data.fundamentals.aggregate_market_cap)}</KeyValue>
                    <KeyValue label="Negative-earnings members">{data.fundamentals.negative_earnings_symbols ?? 0}</KeyValue>
                    <KeyValue label="Missing paid-up capital">{data.fundamentals.missing_capital_symbols ?? 0}</KeyValue>
                  </div>
                  {(data.fundamentals.notes ?? []).map((n) => <InfoNote key={n}>{n}</InfoNote>)}
                </>
              ) : (
                <InfoNote tone="warn">No verified fundamental report overlaps this sector’s current membership.</InfoNote>
              )}
            </Card>

            <Card>
              <CardHeader
                eyebrow="Member fundamentals"
                title="Latest reported snapshot"
                subtitle="P/E is the reported company value; sector aggregates are computed separately"
              />
              <div className="table-wrap max-h-[340px] overflow-y-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>FY</th>
                      <th className="text-right">Profit</th>
                      <th className="text-right">EPS</th>
                      <th className="text-right">P/E</th>
                      <th className="text-right">Net worth/sh.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.fundamentals?.companies ?? []).map((c) => (
                      <tr key={c.symbol}>
                        <td className="font-mono text-[11px]">{c.symbol}</td>
                        <td className="text-[10px] text-muted">{c.fiscal_year ?? '—'}</td>
                        <td className="num text-right">{compact(c.profit)}</td>
                        <td className="num text-right">{num(c.eps, 1)}</td>
                        <td className="num text-right">{num(c.pe, 1)}</td>
                        <td
                          className={cn('num text-right', c.book_value_status === 'implausible' && 'warn')}
                          title={
                            c.book_value_status === 'implausible'
                              ? `Reported ${num(c.book_value_reported, 1)} · rejected by the price-to-book check and excluded from equity/ROE`
                              : c.book_value_status === 'unverifiable'
                                ? 'Included, but not cross-checkable (no positive EPS and P/E)'
                                : undefined
                          }
                        >
                          {c.book_value_status === 'implausible' ? (
                            <span aria-label="implausible value excluded">—</span>
                          ) : (
                            <>
                              {num(c.net_worth_per_share, 1)}
                              {c.book_value_status === 'unverifiable' && <span className="text-faint">†</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1"><Info size={11} /> {data.data_quality?.status as string}</span>
            <span>·</span>
            <span>First observation {dateLabel(data.data_quality?.first_date as string)}</span>
            <span>·</span>
            <span>Last {dateLabel(data.data_quality?.last_date as string)}</span>
            <span>·</span>
            <Link to="/methodology" className="link">Method & limits</Link>
          </div>
        </>
      )}
    </div>
  )
}

function rsiLabel(v: number | null) {
  if (v === null) return 'insufficient history'
  if (v >= 70) return 'overbought zone'
  if (v <= 30) return 'oversold zone'
  return 'neutral zone'
}
