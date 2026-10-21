import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Waves } from 'lucide-react'
import { api } from '../lib/api'
import type { BreadthSummary } from '../lib/api'
import { Chart } from '../components/Chart'
import {
  Card,
  CardHeader,
  ErrorState,
  InfoNote,
  Loading,
  Metric,
  PageHeader,
  StatusBadge,
} from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette } from '../lib/chart'
import { cn, dateLabel, dateShort, pct, toneClass } from '../lib/format'

interface SectorBreadth {
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

function ADHistory({ history }: { history: NonNullable<BreadthSummary['history']> }) {
  const { isDark } = useTheme()
  const option = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    return {
      ...baseOption(isDark),
      grid: { left: 44, right: 48, top: 28, bottom: 38 },
      legend: { ...baseOption(isDark).legend, top: 0, data: ['Advances', 'Declines', 'Advance share'] },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' } },
      },
      xAxis: {
        type: 'category',
        data: history.map((h) => h.date),
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateShort(v), hideOverlap: true },
      },
      yAxis: [
        {
          type: 'value',
          ...axis,
          name: 'securities',
          nameTextStyle: { color: p.muted, fontSize: 9 },
        },
        {
          type: 'value',
          min: 0,
          max: 1,
          ...axis,
          splitLine: { show: false },
          axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
          name: 'share',
          nameTextStyle: { color: p.muted, fontSize: 9 },
        },
      ],
      series: [
        {
          name: 'Advances',
          type: 'bar',
          stack: 'ad',
          data: history.map((h) => h.advances),
          itemStyle: { color: isDark ? 'rgba(79,209,176,0.72)' : 'rgba(14,124,102,0.7)' },
        },
        {
          name: 'Declines',
          type: 'bar',
          stack: 'ad',
          data: history.map((h) => -h.declines),
          itemStyle: { color: isDark ? 'rgba(240,138,134,0.68)' : 'rgba(178,59,59,0.62)' },
        },
        {
          name: 'Advance share',
          type: 'line',
          yAxisIndex: 1,
          data: history.map((h) => h.advance_pct),
          showSymbol: false,
          lineStyle: { width: 1.5, color: isDark ? '#e8b06a' : '#b06a14' },
          itemStyle: { color: isDark ? '#e8b06a' : '#b06a14' },
        },
      ],
    } as unknown as EChartsOption
  }, [history, isDark])
  return <Chart option={option} height={330} />
}

function SectorDetailBreadth({ sector }: { sector: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['breadth', sector],
    queryFn: () => api.breadth(sector) as Promise<SectorBreadth>,
  })
  const { isDark } = useTheme()

  const maOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const keys = ['20', '50', '100', '200']
    const vals = keys.map((k) => data?.above_ma_pct?.[k] ?? null)
    return {
      ...baseOption(isDark),
      grid: { left: 46, right: 20, top: 16, bottom: 30 },
      tooltip: { ...baseOption(isDark).tooltip, trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—') },
      xAxis: { type: 'category', data: keys.map((k) => `MA ${k}`), ...axis },
      yAxis: { type: 'value', min: 0, max: 1, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      series: [
        {
          type: 'bar',
          data: vals.map((v) => ({
            value: v,
            itemStyle: {
              color: (v ?? 0) >= 0.5 ? (isDark ? 'rgba(79,209,176,0.75)' : 'rgba(14,124,102,0.72)') : (isDark ? 'rgba(240,138,134,0.6)' : 'rgba(178,59,59,0.55)'),
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barWidth: 34,
          label: { show: true, position: 'top', formatter: (p2: unknown) => pct((p2 as { value: number }).value), color: p.muted, fontSize: 9 },
        },
      ],
    } as unknown as EChartsOption
  }, [data, isDark])

  if (isLoading) return <Loading label="Loading sector breadth" />
  if (!data?.available) return <InfoNote tone="warn">{data?.reason ?? 'No breadth data for this sector.'}</InfoNote>

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Advancing" value={data.counts?.advances ?? '—'} tone="pos" sub={pct(data.counts?.advance_pct)} />
        <Metric label="Declining" value={data.counts?.declines ?? '—'} tone="neg" sub={pct(data.counts?.decline_pct)} />
        <Metric label="Observed" value={data.observed ?? '—'} sub={`of ${data.eligible ?? '—'} eligible`} />
        <Metric label="Unavailable" value={data.unavailable ?? '—'} sub="no observation" />
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="eyebrow mb-1">Members above their own moving average</div>
          <Chart option={maOption} height={180} />
        </div>
        <div className="grid grid-cols-2 gap-3 self-center">
          <Metric label="New highs" value={data.new_highs ?? '—'} tone="pos" sub="252-session" />
          <Metric label="New lows" value={data.new_lows ?? '—'} tone="neg" sub="252-session" />
          <Metric label="A/D ratio" value={data.counts?.ad_ratio?.toFixed(2) ?? '—'} sub="advances / declines" />
          <Metric label="Net advances" value={data.counts?.advances != null && data.counts?.declines != null ? data.counts.advances - data.counts.declines : '—'} sub="advances − declines" />
        </div>
      </div>
      {(data.notes ?? []).map((n) => <InfoNote key={n}>{n}</InfoNote>)}
    </div>
  )
}

export default function BreadthLab() {
  const [sector, setSector] = useState<string>('')
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['breadth-summary'],
    queryFn: () => api.breadth() as Promise<BreadthSummary>,
  })

  const rows = data?.rows ?? []
  const totals = rows.reduce(
    (acc, r) => {
      acc.adv += r.advances
      acc.dec += r.declines
      acc.unch += r.unchanged
      acc.traded += r.traded
      return acc
    },
    { adv: 0, dec: 0, unch: 0, traded: 0 },
  )
  const adRatio = totals.dec ? totals.adv / totals.dec : null
  const history = data?.history ?? []
  const thrust = useMemo(() => {
    const last = history.slice(-10).map((h) => h.advance_pct).filter((v): v is number => v !== null)
    return last.length ? last.reduce((a, b) => a + b, 0) / last.length : null
  }, [history])

  const maxNet = Math.max(1, ...rows.map((r) => Math.abs(r.net_advances)))

  return (
    <div>
      <PageHeader
        eyebrow="Breadth lab"
        title="Is the move broad, or narrow?"
        description="Index direction is one number. Breadth asks how many securities are actually participating — and whether the participation is improving or deteriorating underneath the index."
        actions={<StatusBadge status="VERIFIED" label={`as of ${dateLabel(data?.latest_date)}`} />}
      />

      {isLoading && <Card><Loading label="Aggregating breadth" rows={5} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}

      {data && !data.available && (
        <Card><InfoNote tone="warn">{data.reason ?? 'Breadth summaries are not available.'}</InfoNote></Card>
      )}

      {data && data.available && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><Metric label="Advancing" value={totals.adv} tone="pos" sub={`${pct(totals.traded ? totals.adv / totals.traded : null)} of observed`} /></Card>
            <Card><Metric label="Declining" value={totals.dec} tone="neg" sub={`${pct(totals.traded ? totals.dec / totals.traded : null)} of observed`} /></Card>
            <Card><Metric label="A/D ratio" value={adRatio ? `${adRatio.toFixed(2)}×` : '—'} tone={adRatio && adRatio > 1 ? 'pos' : 'neg'} sub={`${totals.adv - totals.dec} net advances`} /></Card>
            <Card><Metric label="10-session thrust" value={pct(thrust)} sub="mean advance share" /></Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader
                eyebrow="Advance / decline"
                title="Participation history"
                subtitle="Bars are observed securities; the line is the advancing share. Missing securities are excluded from both."
              />
              <ADHistory history={history} />
            </Card>
            <Card>
              <CardHeader eyebrow="Sector width" title="Net advances by sector" subtitle="Advances minus declines on the latest session" />
              <div className="space-y-2.5">
                {[...rows]
                  .sort((a, b) => b.net_advances - a.net_advances)
                  .map((r) => {
                    const w = (Math.abs(r.net_advances) / maxNet) * 50
                    return (
                      <div key={r.sector_name} className="flex items-center gap-2">
                        <span className="w-[104px] shrink-0 truncate text-[11px] text-muted">{r.sector_name}</span>
                        <div className="relative h-2.5 flex-1 rounded-sm bg-line/60">
                          <div className="absolute left-1/2 top-0 h-full w-px bg-faint/50" />
                          <div
                            className="absolute top-0 h-full rounded-sm"
                            style={{
                              width: `${w}%`,
                              left: r.net_advances >= 0 ? '50%' : `${50 - w}%`,
                              backgroundColor:
                                r.net_advances >= 0
                                  ? isDarkColor()
                                    ? 'rgba(79,209,176,0.8)'
                                    : 'rgba(14,124,102,0.78)'
                                  : isDarkColor()
                                    ? 'rgba(240,138,134,0.75)'
                                    : 'rgba(178,59,59,0.7)',
                            }}
                          />
                        </div>
                        <span className={cn('num w-8 text-right text-[10px]', toneClass(r.net_advances))}>{r.net_advances}</span>
                      </div>
                    )
                  })}
              </div>
              {data.method && <InfoNote>{data.method}</InfoNote>}
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Cross-section"
              title="Breadth by sector"
              subtitle="A high advance share with few traded names is a thinner signal than a broad advance."
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th className="text-right">Adv.</th>
                    <th className="text-right">Dec.</th>
                    <th className="text-right">Unch.</th>
                    <th className="text-right">Traded</th>
                    <th className="w-40">Advance share</th>
                    <th className="text-right">A/D</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => (b.advance_pct ?? 0) - (a.advance_pct ?? 0)).map((r) => (
                    <tr key={r.sector_name}>
                      <td>
                        <button className="text-left hover:text-accent" onClick={() => setSector(r.sector_name)}>
                          {r.sector_name}
                        </button>
                      </td>
                      <td className="num text-right pos">{r.advances}</td>
                      <td className="num text-right neg">{r.declines}</td>
                      <td className="num text-right text-muted">{r.unchanged}</td>
                      <td className="num text-right">{r.traded}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-sm bg-line/60"
                            title={`${((r.advance_pct ?? 0) * 100).toFixed(1)}% advancing, ${((r.decline_pct ?? 0) * 100).toFixed(1)}% declining`}
                          >
                            <div className="h-full bg-[#0e7c66] dark:bg-[#4fd1b0]" style={{ width: `${(r.advance_pct ?? 0) * 100}%` }} />
                            <div className="h-full bg-[#b23b3b] dark:bg-[#f08a86]" style={{ width: `${(r.decline_pct ?? 0) * 100}%` }} />
                          </div>
                          <span className="num w-9 shrink-0 text-right text-[10px] text-muted">
                            {r.advance_pct == null ? '—' : `${(r.advance_pct * 100).toFixed(0)}%`}
                          </span>
                        </div>
                      </td>
                      <td className="num text-right">{r.ad_ratio?.toFixed(2) ?? '—'}</td>
                      <td className="text-[10px] text-muted">
                        {(r.advance_pct ?? 0) >= 0.65 ? 'Broad advance' : (r.advance_pct ?? 0) <= 0.35 ? 'Broad decline' : 'Mixed'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Sector deep dive"
              title={sector || 'Choose a sector'}
              subtitle="Moving-average breadth uses each member’s own close history, not the sector index."
              actions={
                sector ? (
                  <button className="btn" onClick={() => setSector('')}>Clear</button>
                ) : (
                  <Waves size={15} className="text-faint" />
                )
              }
            />
            {sector ? (
              <SectorDetailBreadth sector={sector} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {rows.map((r) => (
                  <button key={r.sector_name} className="btn" onClick={() => setSector(r.sector_name)}>
                    {r.sector_name}
                  </button>
                ))}
                <Link to="/sectors" className="btn">
                  Open sector explorer <ArrowUpRight size={12} />
                </Link>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

// The chart palette is read from CSS at render time in the chart components;
// this helper keeps the inline bar colors aligned with the active theme.
function isDarkColor() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}
