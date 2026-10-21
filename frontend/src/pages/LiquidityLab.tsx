import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Droplets, Layers3 } from 'lucide-react'
import { api } from '../lib/api'
import type { LiquiditySummary } from '../lib/api'
import { Chart } from '../components/Chart'
import { Card, CardHeader, ErrorState, InfoNote, Loading, Metric, PageHeader, StatusBadge } from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette } from '../lib/chart'
import { compact, dateLabel, dateShort, npr, num, pct } from '../lib/format'

const SECTOR_COLORS = [
  '#0e7c66',
  '#2c5d8f',
  '#b06a14',
  '#6b5b95',
  '#b23b3b',
  '#3f7f5f',
  '#8a6d3b',
  '#4f7c9a',
  '#9a5b6b',
  '#5c7a4a',
  '#7a5c8f',
  '#a0703c',
  '#4a6d68',
]

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

function SectorLiquidityDetail({ sector }: { sector: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['liquidity', sector],
    queryFn: () => api.liquidity(sector) as Promise<LiquidityDetail>,
  })

  if (isLoading) return <Loading label="Loading turnover detail" />
  if (!data?.available) return <InfoNote tone="warn">{data?.reason ?? 'No liquidity detail for this sector.'}</InfoNote>

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="grid grid-cols-2 gap-4">
          <Metric label="Turnover" value={npr(data.turnover)} sub={dateLabel(data.latest_date)} />
          <Metric label="HHI" value={num(data.concentration?.hhi, 3)} sub="within-sector turnover" />
          <Metric label="Effective N" value={num(data.concentration?.effective_n, 1)} sub="1 / HHI" />
          <Metric label="Top 5 share" value={pct(data.concentration?.top5_share)} sub={`${data.concentration?.count ?? 0} traded names`} />
        </div>
        <InfoNote>HHI rises when a small number of names account for most turnover. It is a concentration measure, not a liquidity forecast.</InfoNote>
      </div>
      <div>
        <div className="eyebrow mb-2">Top traded names</div>
        <div className="space-y-2">
          {(data.top ?? []).map((t, i) => (
            <div key={t.symbol} className="flex items-center gap-2.5">
              <span className="num w-4 text-[10px] text-faint">{i + 1}</span>
              <span className="w-16 font-mono text-[11px]">{t.symbol}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/70">
                <div className="h-full rounded-full bg-accent/70" style={{ width: `${(t.share ?? 0) * 100}%` }} />
              </div>
              <span className="num w-10 text-right text-[10px] text-muted">{pct(t.share)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function LiquidityLab() {
  const { isDark } = useTheme()
  const [sector, setSector] = useState('')
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['liquidity-summary'],
    queryFn: () => api.liquidity() as Promise<LiquiditySummary>,
  })

  const rows = data?.rows ?? []
  const total = data?.total_turnover ?? 0
  const hhi = rows.reduce((s, r) => s + (r.share ?? 0) ** 2, 0)
  const history = data?.history ?? []
  const names = useMemo(() => rows.map((r) => r.sector_name), [rows])

  const historyOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    return {
      ...baseOption(isDark),
      grid: { left: 52, right: 16, top: 16, bottom: 40 },
      legend: { ...baseOption(isDark).legend, show: false },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: p.faint, type: 'dashed' } },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? npr(v) : '—'),
      },
      xAxis: {
        type: 'category',
        data: history.map((h) => String(h.date)),
        boundaryGap: false,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateShort(v), hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => compact(v) },
      },
      series: names.map((n, i) => ({
        name: n,
        type: 'line' as const,
        stack: 'turnover',
        data: history.map((h) => Number(h[n] ?? 0)),
        showSymbol: false,
        lineStyle: { width: 0.8, color: SECTOR_COLORS[i % SECTOR_COLORS.length] },
        itemStyle: { color: SECTOR_COLORS[i % SECTOR_COLORS.length] },
        areaStyle: { color: SECTOR_COLORS[i % SECTOR_COLORS.length], opacity: isDark ? 0.22 : 0.18 },
        emphasis: { focus: 'series' as const },
      })),
    } as unknown as EChartsOption
  }, [history, names, isDark])

  const shareOption = useMemo(() => {
    const p = palette(isDark)
    return {
      ...baseOption(isDark),
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = params as { name: string; value: number; percent: number; data?: { turnover?: number } }
          return `<div><b>${d.name}</b><br/><span style="font-family:'IBM Plex Mono',monospace">${npr(d.data?.turnover ?? null)}</span><br/><span style="font-size:10px;color:${p.muted}">${d.percent.toFixed(1)}% of observed turnover</span></div>`
        },
      },
      legend: { show: false },
      series: [
        {
          type: 'pie',
          radius: ['46%', '78%'],
          center: ['50%', '48%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: p.surface, borderWidth: 2, borderRadius: 3 },
          label: { show: false },
          emphasis: { label: { show: true, formatter: (q: unknown) => (q as { name: string }).name, fontSize: 11, color: p.ink } },
          data: rows.map((r, i) => ({
            name: r.sector_name,
            value: r.turnover ?? 0,
            turnover: r.turnover,
            itemStyle: { color: SECTOR_COLORS[i % SECTOR_COLORS.length] },
          })),
        },
      ],
    } as unknown as EChartsOption
  }, [rows, isDark])

  return (
    <div>
      <PageHeader
        eyebrow="Liquidity lab"
        title="Trading value is not conviction."
        description="Turnover shows where the market is transacting. Concentration shows whether that activity is broad or dependent on a handful of names. Neither is a measure of investor inflow."
        actions={<StatusBadge status="VERIFIED" label={`as of ${dateLabel(data?.latest_date)}`} />}
      />

      {isLoading && <Card><Loading label="Aggregating turnover" rows={5} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}
      {data && !data.available && <Card><InfoNote tone="warn">{data.reason ?? 'Liquidity summaries are not available.'}</InfoNote></Card>}

      {data && data.available && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><Metric label="Observed turnover" value={npr(total)} sub={`${rows.length} sectors · ${dateLabel(data.latest_date)}`} /></Card>
            <Card><Metric label="Sector HHI" value={num(hhi, 3)} sub={`effective N ≈ ${hhi ? (1 / hhi).toFixed(1) : '—'}`} /></Card>
            <Card><Metric label="Largest share" value={pct(rows[0]?.share)} sub={rows[0]?.sector_name ?? '—'} /></Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <Card>
              <CardHeader
                eyebrow="Turnover history"
                title="Stacked traded value"
                subtitle="Observed security turnover, summed by current sector membership"
              />
              <Chart option={historyOption} height={340} />
              <InfoNote>{data.notes?.[0] ?? 'Turnover is trading value, not net investor inflow.'}</InfoNote>
            </Card>
            <Card>
              <CardHeader eyebrow="Share of turnover" title="Latest session mix" subtitle={`Total ${npr(total)}`} />
              <Chart option={shareOption} height={270} />
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted">
                {rows.slice(0, 8).map((r, i) => (
                  <span key={r.sector_name} className="flex items-center gap-1.5 truncate">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                    <span className="truncate">{r.sector_name}</span>
                    <span className="num ml-auto">{pct(r.share, 0)}</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Concentration"
              title="Sector turnover table"
              subtitle="Share is computed on observed turnover, not total market capitalization."
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Sector</th>
                    <th className="text-right">Turnover</th>
                    <th className="text-right">Share</th>
                    <th className="text-right">Volume</th>
                    <th className="text-right">Traded names</th>
                    <th className="w-40">Share bar</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0)).map((r, i) => (
                    <tr key={r.sector_name}>
                      <td className="num text-faint">{i + 1}</td>
                      <td>
                        <button className="text-left hover:text-accent" onClick={() => setSector(r.sector_name)}>{r.sector_name}</button>
                      </td>
                      <td className="num text-right">{npr(r.turnover)}</td>
                      <td className="num text-right">{pct(r.share)}</td>
                      <td className="num text-right text-muted">{compact(r.volume)}</td>
                      <td className="num text-right">{r.securities}</td>
                      <td>
                        <div className="h-2 overflow-hidden rounded-sm bg-line/60">
                          <div className="h-full rounded-sm" style={{ width: `${(r.share ?? 0) * 100}%`, backgroundColor: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Within-sector concentration"
              title={sector || 'Choose a sector'}
              subtitle="HHI and effective N describe how evenly turnover is distributed across that sector’s traded names."
              actions={sector ? <button className="btn" onClick={() => setSector('')}>Clear</button> : <Layers3 size={15} className="text-faint" />}
            />
            {sector ? (
              <SectorLiquidityDetail sector={sector} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {rows.map((r) => (
                  <button key={r.sector_name} className="btn" onClick={() => setSector(r.sector_name)}>
                    {r.sector_name}
                  </button>
                ))}
                <Link to="/breadth" className="btn">
                  Compare breadth <ArrowUpRight size={12} />
                </Link>
              </div>
            )}
          </Card>

          <div className="mt-4 flex items-center gap-2 rounded-lg border bg-raised px-3 py-2.5 text-[11px] text-muted">
            <Droplets size={14} className="text-accent" />
            <span>
              Historical transaction counts are not present in the verified daily-summary source, so they are not displayed or estimated.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
