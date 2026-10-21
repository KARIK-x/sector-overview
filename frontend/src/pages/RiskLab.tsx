import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import type { RiskSummary } from '../lib/api'
import { Chart } from '../components/Chart'
import { Card, CardHeader, ErrorState, InfoNote, Loading, Metric, PageHeader, StatusBadge } from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette } from '../lib/chart'
import { cn, dateLabel, dateShort, num, pct, signedPct, toneClass } from '../lib/format'

interface SectorRiskDetail {
  available: boolean
  reason?: string
  volatility?: number | null
  max_drawdown?: number | null
  current_drawdown?: number | null
  beta?: number | null
  correlation?: number | null
  var_95?: number | null
  cvar_95?: number | null
  drawdown_series?: Array<{ date: string; drawdown: number }>
}

function DrawdownPanel({ code }: { code: string }) {
  const { isDark } = useTheme()
  const { data, isLoading } = useQuery({
    queryKey: ['risk', code],
    queryFn: () => api.risk(code) as Promise<SectorRiskDetail>,
  })

  const option = useMemo(() => {
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const series = data?.drawdown_series ?? []
    return {
      ...baseOption(isDark),
      grid: { left: 48, right: 16, top: 18, bottom: 34 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—'),
      },
      xAxis: {
        type: 'category',
        data: series.map((d) => d.date),
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateShort(v), hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        max: 0,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      },
      series: [
        {
          name: 'Drawdown',
          type: 'line',
          data: series.map((d) => d.drawdown),
          showSymbol: false,
          lineStyle: { width: 1.3, color: isDark ? '#f08a86' : '#b23b3b' },
          itemStyle: { color: isDark ? '#f08a86' : '#b23b3b' },
          areaStyle: { color: isDark ? 'rgba(240,138,134,0.18)' : 'rgba(178,59,59,0.12)' },
        },
      ],
    } as unknown as EChartsOption
  }, [data, isDark])

  if (isLoading) return <Loading label="Loading drawdown" />
  if (!data?.available) return <InfoNote tone="warn">{data?.reason ?? 'Insufficient history for drawdown.'}</InfoNote>

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Volatility" value={pct(data.volatility)} sub="annualised" />
        <Metric label="Beta" value={num(data.beta)} sub="vs NEPSE" />
        <Metric label="Max drawdown" value={signedPct(data.max_drawdown)} tone="neg" sub="full history" />
        <Metric label="Current drawdown" value={signedPct(data.current_drawdown)} tone={(data.current_drawdown ?? 0) < 0 ? 'neg' : 'neutral'} sub="from peak" />
      </div>
      <Chart option={option} height={240} />
    </div>
  )
}

export default function RiskLab() {
  const { isDark } = useTheme()
  const [code, setCode] = useState('BANKING')
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['risk-summary'],
    queryFn: () => api.risk() as Promise<RiskSummary>,
  })
  const { data: rotation } = useQuery({
    queryKey: ['rotation', 120, 0, 0],
    queryFn: ({ signal }) => api.rotation(120, 0, 0, signal),
  })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const retMap = useMemo(() => Object.fromEntries((rotation?.rows ?? []).map((r) => [r.code, r.return_120])), [rotation])

  const scatterOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true })
    // Label only the outliers that carry information; labelling every bubble
    // in the dense 15–23% volatility cluster produces unreadable collisions.
    const labelled = new Set<string>()
    ;[...rows]
      .sort((a, b) => (b.volatility ?? 0) - (a.volatility ?? 0))
      .slice(0, 3)
      .forEach((r) => labelled.add(r.code))
    ;[...rows]
      .filter((r) => retMap[r.code] != null)
      .sort((a, b) => (retMap[b.code] ?? 0) - (retMap[a.code] ?? 0))
      .forEach((r, i, arr) => {
        if (i < 2 || i >= arr.length - 2) labelled.add(r.code)
      })
    const points = rows
      .filter((r) => r.volatility != null)
      .map((r) => ({
        value: [r.volatility, retMap[r.code] ?? null],
        name: r.name,
        meta: r,
        itemStyle: { color: isDark ? 'rgba(79,209,176,0.82)' : 'rgba(14,124,102,0.8)', borderColor: p.surface, borderWidth: 1.5 },
        symbolSize: 10 + Math.min(18, Math.abs(r.max_drawdown ?? 0) * 55),
      }))
      .filter((d) => d.value[1] !== null)
      // Fan labels around each bubble instead of stacking them all to the right.
      .map((d, i) => ({
        ...d,
        label: {
          show: labelled.has((d.meta as { code: string }).code),
          position: (['right', 'top', 'left', 'bottom'] as const)[i % 4],
        },
      }))
    return {
      ...baseOption(isDark),
      grid: { left: 52, right: 22, top: 20, bottom: 42 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = params as { data?: { meta?: (typeof rows)[number]; value?: number[] } }
          const r = d.data?.meta
          if (!r) return ''
          return `<div style="min-width:180px"><b>${r.name}</b><div style="height:1px;background:${p.line};margin:6px 0"></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">120D return</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(d.data?.value?.[1] ?? null)}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Volatility</span><b style="font-family:'IBM Plex Mono',monospace">${pct(r.volatility)}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Beta</span><b style="font-family:'IBM Plex Mono',monospace">${num(r.beta)}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Max DD</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(r.max_drawdown)}</b></div></div>`
        },
      },
      xAxis: {
        type: 'value',
        name: 'Volatility (annualised)',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      },
      yAxis: {
        type: 'value',
        name: '120-session return',
        nameLocation: 'middle',
        nameGap: 34,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      },
      series: [
        {
          type: 'scatter',
          data: points,
          label: {
            show: true,
            position: 'right',
            distance: 4,
            color: p.muted,
            fontSize: 8,
            formatter: (params: unknown) => (params as { name: string }).name.split(' ')[0],
            // Halo plus overlap suppression keeps the cluster readable; the
            // table below and the tooltip carry the full names and values.
            textBorderColor: p.surface,
            textBorderWidth: 2.5,
          },
          labelLayout: { hideOverlap: true },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            lineStyle: { color: p.faint, type: 'dashed', opacity: 0.5 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    } as unknown as EChartsOption
  }, [rows, retMap, isDark])

  const volOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const sorted = [...rows].filter((r) => r.volatility != null).sort((a, b) => (b.volatility ?? 0) - (a.volatility ?? 0))
    return {
      ...baseOption(isDark),
      grid: { left: 8, right: 40, top: 10, bottom: 24, containLabel: true },
      tooltip: { ...baseOption(isDark).tooltip, trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? pct(v) : '—') },
      xAxis: { type: 'value', ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
      yAxis: { type: 'category', data: sorted.map((r) => r.name), inverse: true, ...axis, axisLine: { show: false } },
      series: [
        {
          type: 'bar',
          data: sorted.map((r) => ({
            value: r.volatility,
            itemStyle: {
              color: (r.volatility ?? 0) > 0.3 ? (isDark ? 'rgba(240,138,134,0.7)' : 'rgba(178,59,59,0.65)') : isDark ? 'rgba(79,209,176,0.7)' : 'rgba(14,124,102,0.65)',
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barWidth: 12,
          label: { show: true, position: 'right', formatter: (q: unknown) => pct((q as { value: number }).value), color: p.muted, fontSize: 9 },
        },
      ],
    } as unknown as EChartsOption
  }, [rows, isDark])

  const highestVol = [...rows].sort((a, b) => (b.volatility ?? 0) - (a.volatility ?? 0))[0]
  const deepest = [...rows].sort((a, b) => (a.max_drawdown ?? 0) - (b.max_drawdown ?? 0))[0]
  const lowestVol = [...rows].sort((a, b) => (a.volatility ?? 9) - (b.volatility ?? 9))[0]

  return (
    <div>
      <PageHeader
        eyebrow="Risk lab"
        title="Return is what happened. Risk is the shape of the path."
        description="Volatility, market sensitivity and drawdown are computed from index history. Historical risk is descriptive, not a forecast, and does not capture liquidity or gap risk."
        actions={<StatusBadge status="VERIFIED" label={`as of ${dateLabel(data?.latest_date)}`} />}
      />

      {isLoading && <Card><Loading label="Computing risk metrics" rows={5} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}

      {data && data.available && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><Metric label="Highest volatility" value={pct(highestVol?.volatility)} sub={highestVol?.name} tone="neg" /></Card>
            <Card><Metric label="Lowest volatility" value={pct(lowestVol?.volatility)} sub={lowestVol?.name} tone="pos" /></Card>
            <Card><Metric label="Deepest drawdown" value={signedPct(deepest?.max_drawdown)} sub={deepest?.name} tone="neg" /></Card>
            <Card><Metric label="Sectors measured" value={rows.length} sub="252-session window" /></Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                eyebrow="Risk vs return"
                title="120-session return against volatility"
                subtitle="Bubble size reflects the maximum historical drawdown. Labels mark the highest volatility and the best/worst 120-session returns; hover any bubble for its name."
              />
              <Chart option={scatterOption} height={380} />
            </Card>
            <Card>
              <CardHeader eyebrow="Volatility ranking" title="Annualised dispersion" subtitle="Daily return standard deviation × √252" />
              <Chart option={volOption} height={380} />
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Risk table"
              title="Cross-sectional risk metrics"
              subtitle="VaR and CVaR are historical daily estimates at 95% confidence using a 252-session window."
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th className="text-right">Volatility</th>
                    <th className="text-right">Beta</th>
                    <th className="text-right">Correlation</th>
                    <th className="text-right">Max DD</th>
                    <th className="text-right">Current DD</th>
                    <th className="text-right">VaR 95%</th>
                    <th className="text-right">CVaR 95%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => (a.volatility ?? 0) - (b.volatility ?? 0)).map((r) => (
                    <tr key={r.code}>
                      <td>
                        <button className="text-left hover:text-accent" onClick={() => setCode(r.code)}>{r.name}</button>
                      </td>
                      <td className="num text-right">{pct(r.volatility)}</td>
                      <td className={cn('num text-right', (r.beta ?? 0) > 1 ? 'warn' : '')}>{num(r.beta)}</td>
                      <td className="num text-right text-muted">{num(r.correlation)}</td>
                      <td className="num text-right neg">{signedPct(r.max_drawdown)}</td>
                      <td className={cn('num text-right', toneClass(r.current_drawdown))}>{signedPct(r.current_drawdown)}</td>
                      <td className="num text-right">{signedPct(r.var_95)}</td>
                      <td className="num text-right">{signedPct(r.cvar_95)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Drawdown anatomy"
              title="How the path behaved"
              subtitle="Peak-to-trough decline from the running maximum close"
              actions={
                <select
                  aria-label="Drawdown sector"
                  className="btn pr-2 text-[11px]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                >
                  {rows.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              }
            />
            <DrawdownPanel code={code} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[10px] text-muted">
              <span className="inline-flex items-center gap-1"><ShieldCheck size={11} /> Historical descriptive risk only</span>
              <Link to={`/sectors?code=${code}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                Open sector <ArrowUpRight size={11} />
              </Link>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
