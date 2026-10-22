import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Download, Droplets, Layers3 } from 'lucide-react'
import { api } from '../lib/api'
import type { LiquidityRow, LiquiditySummary } from '../lib/api'
import { Chart } from '../components/Chart'
import { Card, CardHeader, ErrorState, InfoNote, Loading, Metric, PageHeader, StatusBadge } from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette } from '../lib/chart'
import { cn, compact, dateLabel, dateTick, needsYear, npr, num, pct, signedPct, toneClass } from '../lib/format'
import { downloadCsv } from '../lib/export'
import { Segmented } from '../components/ui'

const SECTOR_COLORS = [
  '#1f6f5f',
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
  const [horizon, setHorizon] = useState<'return_5' | 'return_20' | 'return_60'>('return_20')
  const [turnoverPeriod, setTurnoverPeriod] = useState<5 | 21 | 63 | 252>(21)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['liquidity-summary'],
    queryFn: () => api.liquidity() as Promise<LiquiditySummary>,
  })

  const rows = data?.rows ?? []
  const total = data?.total_turnover ?? 0
  const totalVolume = rows.reduce((s, r) => s + (r.volume ?? 0), 0)
  const totalSecurities = rows.reduce((s, r) => s + (r.securities ?? 0), 0)
  const hhi = rows.reduce((s, r) => s + (r.share ?? 0) ** 2, 0)
  const history = data?.history ?? []
  const names = useMemo(() => rows.map((r) => r.sector_name), [rows])

  const sortedHistory = useMemo(() => [...history].sort((a, b) => String(a.date).localeCompare(String(b.date))), [history])
  const periodTurnover = useMemo(() => {
    const recent = sortedHistory.slice(-turnoverPeriod)
    const prior = sortedHistory.slice(-turnoverPeriod * 2, -turnoverPeriod)
    const addTotals = (slice: typeof history) => {
      const totals = new Map<string, number>()
      for (const row of slice) {
        for (const [key, value] of Object.entries(row)) {
          if (key === 'date' || typeof value !== 'number') continue
          totals.set(key, (totals.get(key) ?? 0) + value)
        }
      }
      return totals
    }
    const recentTotals = addTotals(recent)
    const priorTotals = addTotals(prior)
    const sectorTotals = rows.map((r) => {
      const recentTotal = recentTotals.get(r.sector_name) ?? 0
      const priorTotal = priorTotals.get(r.sector_name) ?? 0
      return {
        sector_name: r.sector_name,
        recent: recentTotal,
        prior: priorTotal,
        change: priorTotal > 0 ? recentTotal / priorTotal - 1 : null,
      }
    }).sort((a, b) => b.recent - a.recent)
    const totalRecent = [...recentTotals.values()].reduce((s, v) => s + v, 0)
    const totalPrior = [...priorTotals.values()].reduce((s, v) => s + v, 0)
    return {
      sectorTotals,
      totalRecent,
      totalPrior,
      change: totalPrior > 0 ? totalRecent / totalPrior - 1 : null,
    }
  }, [rows, sortedHistory, turnoverPeriod])

  // Turnover is heavy-tailed by two orders of magnitude, so a log x axis is the
  // honest way to show the full cross-section in one frame.
  const scatterOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const points = rows
      .filter((r) => r.turnover != null && r.turnover > 0)
      .map((r, i) => ({
        name: r.sector_name,
        value: [r.turnover, r[horizon] ?? null],
        meta: r,
        itemStyle: {
          color: SECTOR_COLORS[i % SECTOR_COLORS.length],
          borderColor: p.surface,
          borderWidth: 1.5,
          opacity: sector && r.sector_name !== sector ? 0.5 : 0.9,
        },
        symbolSize:
          sector === r.sector_name
            ? 26
            : 10 + Math.min(20, Math.sqrt((r.market_cap ?? 0) / 1e11) * 4),
        label: {
          show: i < 4 || sector === r.sector_name,
          position: (['right', 'top', 'left', 'bottom'] as const)[i % 4],
        },
      }))
      .filter((d) => d.value[1] !== null)
    return {
      ...baseOption(isDark),
      grid: { left: 54, right: 26, top: 24, bottom: 46 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = params as { data?: { meta?: LiquidityRow; value?: number[] } }
          const r = d.data?.meta
          if (!r) return ''
          return `<div style="min-width:196px"><b>${r.sector_name}</b>
            <div style="height:1px;background:${p.line};margin:6px 0"></div>
            <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Turnover</span><b style="font-family:'IBM Plex Mono',monospace">${npr(r.turnover)}</b></div>
            <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Share</span><b style="font-family:'IBM Plex Mono',monospace">${pct(r.share)}</b></div>
            <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">20D return</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(r.return_20)}</b></div>
            <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Market cap</span><b style="font-family:'IBM Plex Mono',monospace">${npr(r.market_cap)}</b></div>
            <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Turnover HHI</span><b style="font-family:'IBM Plex Mono',monospace">${r.hhi == null ? '—' : r.hhi.toFixed(3)}</b></div>
            <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Effective N</span><b style="font-family:'IBM Plex Mono',monospace">${r.effective_n == null ? '—' : r.effective_n.toFixed(1)}</b></div>
          </div>`
        },
      },
      xAxis: {
        type: 'log',
        name: 'Turnover · NPR (log scale)',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => compact(v) },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
      },
      yAxis: {
        type: 'value',
        name: `${horizon === 'return_5' ? '5' : horizon === 'return_20' ? '20' : '60'}-session return`,
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%` },
      },
      series: [
        {
          type: 'scatter',
          data: points,
          label: {
            show: true,
            color: p.muted,
            fontSize: 8,
            formatter: (params: unknown) => (params as { name: string }).name.split(' ')[0],
            textBorderColor: p.surface,
            textBorderWidth: 2.5,
          },
          labelLayout: { hideOverlap: true },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            lineStyle: { color: p.faint, type: 'dashed', opacity: 0.55 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    } as unknown as EChartsOption
  }, [rows, horizon, sector, isDark])

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
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateTick(v, needsYear(history.map((h) => String(h.date)))), hideOverlap: true },
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
              <Chart option={historyOption} height={340} exportName="liquidity-turnover-history" />
              <InfoNote>{data.notes?.[0] ?? 'Turnover is trading value, not net investor inflow.'}</InfoNote>
            </Card>
            <Card>
              <CardHeader eyebrow="Share of turnover" title="Latest session mix" subtitle={`Total ${npr(total)}`} />
              <Chart option={shareOption} height={270} exportName="liquidity-turnover-share" />
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted">
                {rows.slice(0, 8).map((r, i) => (
                  <span key={r.sector_name} className="flex items-center gap-1.5 truncate">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                    <span className="truncate">{r.sector_name}</span>
                    <span className="num ml-auto">{pct(r.share, 0)}</span>
                  </span>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-faint">Top 8 of {rows.length} sectors; full table below.</div>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Turnover vs performance"
              title="Does traded value follow returns?"
              subtitle="Each bubble is a sector; x is latest-session turnover on a log scale and y is the selected return horizon. Bubble area scales with market capitalisation. Correlation here is descriptive — turnover is not investor inflow."
              actions={
                <Segmented
                  options={[
                    { value: 'return_5', label: '5D' },
                    { value: 'return_20', label: '20D' },
                    { value: 'return_60', label: '60D' },
                  ]}
                  value={horizon}
                  onChange={setHorizon}
                  size="sm"
                />
              }
            />
            <Chart
              option={scatterOption}
              height={400}
              exportName={`liquidity-turnover-${horizon}`}
              onEvents={{
                click: (params: unknown) => {
                  const name = (params as { name?: string }).name
                  if (name) setSector(name)
                },
              }}
            />
            <p className="mt-2 text-[10px] text-muted">
              Sectors above the dashed zero line rose over the horizon; sectors to the right traded more value on
              the latest session. Click a bubble to open its within-sector concentration detail below.
            </p>
          </Card>

          <Card className="mt-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="eyebrow mb-1">Turnover period</div>
                <p className="text-[11px] text-muted">Totals are sums of observed daily turnover. Periods are trading sessions, not calendar days.</p>
              </div>
              <Segmented
                options={[{ value: 5, label: '5D' }, { value: 21, label: '21D' }, { value: 63, label: '63D' }, { value: 252, label: '252D' }]}
                value={turnoverPeriod}
                onChange={(v) => setTurnoverPeriod(v as 5 | 21 | 63 | 252)}
                size="sm"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Period turnover" value={npr(periodTurnover.totalRecent)} sub={`${turnoverPeriod} sessions`} />
              <Metric label="Prior period" value={npr(periodTurnover.totalPrior)} sub={`${turnoverPeriod} sessions`} />
              <Metric label="Change" value={signedPct(periodTurnover.change)} tone={periodTurnover.change && periodTurnover.change > 0 ? 'pos' : 'neg'} sub="recent vs prior" />
            </div>
            <div className="mt-4 table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th className="text-right">Period turnover</th>
                    <th className="text-right">Prior period</th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {periodTurnover.sectorTotals.slice(0, 8).map((r) => (
                    <tr key={r.sector_name}>
                      <td>{r.sector_name}</td>
                      <td className="num text-right">{npr(r.recent)}</td>
                      <td className="num text-right text-muted">{npr(r.prior)}</td>
                      <td className={cn('num text-right', toneClass(r.change))}>{signedPct(r.change)}</td>
                    </tr>
                  ))}
                  <tr className="bg-raised/60 font-medium">
                    <td>Total (observed sectors)</td>
                    <td className="num text-right">{npr(periodTurnover.totalRecent)}</td>
                    <td className="num text-right text-muted">{npr(periodTurnover.totalPrior)}</td>
                    <td className={cn('num text-right', toneClass(periodTurnover.change))}>{signedPct(periodTurnover.change)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Concentration"
              title="Sector turnover table"
              subtitle="Share is computed on observed turnover, not total market capitalization. HHI is within-sector turnover concentration."
              actions={
                <button
                  className="btn"
                  onClick={() =>
                    downloadCsv(
                      `nepse-liquidity-${data.latest_date ?? 'latest'}`,
                      ['Sector', 'Turnover', 'Share', 'Volume', 'Traded names', '20D return', 'Market cap', 'HHI', 'Effective N', 'Top-1 share'],
                      [...rows]
                        .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
                        .map((r) => [
                          r.sector_name, r.turnover, r.share, r.volume, r.securities,
                          r.return_20, r.market_cap, r.hhi, r.effective_n, r.top1_share,
                        ]),
                    )
                  }
                >
                  <Download size={12} /> CSV
                </button>
              }
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
                    <th className="text-right">20D</th>
                    <th className="text-right">HHI</th>
                    <th className="text-right">Eff. N</th>
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
                      <td className={cn('num text-right', toneClass(r.return_20))}>{signedPct(r.return_20)}</td>
                      <td className="num text-right text-muted">{r.hhi == null ? '—' : r.hhi.toFixed(3)}</td>
                      <td className="num text-right text-muted">{r.effective_n == null ? '—' : r.effective_n.toFixed(1)}</td>
                      <td>
                        <div className="h-2 overflow-hidden rounded-sm bg-line/60">
                          <div className="h-full rounded-sm" style={{ width: `${(r.share ?? 0) * 100}%`, backgroundColor: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                  <tr className="bg-raised/60 font-medium">
                    <td className="num text-faint">{rows.length + 1}</td>
                    <td>Total (observed sectors)</td>
                    <td className="num text-right">{npr(total)}</td>
                    <td className="num text-right">100.0%</td>
                    <td className="num text-right text-muted">{compact(totalVolume)}</td>
                    <td className="num text-right">{totalSecurities}</td>
                    <td className="num text-right text-muted">—</td>
                    <td className="num text-right text-muted">—</td>
                    <td className="num text-right text-muted">—</td>
                    <td>
                      <div className="h-2 overflow-hidden rounded-sm bg-line/60">
                        <div className="h-full rounded-sm bg-accent" style={{ width: '100%' }} />
                      </div>
                    </td>
                  </tr>
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
