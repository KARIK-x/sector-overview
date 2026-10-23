import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Download, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import type { CorrelationMatrix, RiskSummary } from '../lib/api'
import { Chart } from '../components/Chart'
import { Card, CardHeader, ErrorState, InfoNote, Loading, Metric, PageHeader, Segmented, StatusBadge } from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, heatColor, palette } from '../lib/chart'
import { cn, dateLabel, dateTick, needsYear, num, pct, signedPct, toneClass } from '../lib/format'
import { downloadCsv } from '../lib/export'

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
  rolling?: Array<{ date: string; correlation: number | null; volatility: number | null }>
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
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateTick(v, needsYear((data?.drawdown_series ?? []).map((d) => d.date))), hideOverlap: true },
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

  const rollingOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const series = data?.rolling ?? []
    return {
      ...baseOption(isDark),
      grid: { left: 46, right: 50, top: 24, bottom: 32 },
      legend: { ...baseOption(isDark).legend, top: -2, right: 0, itemWidth: 7, itemHeight: 7 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        formatter: (params: unknown) => {
          const items = params as Array<{ axisValue: string; seriesName: string; value: number | null; color: string }>
          if (!items.length) return ''
          const head = `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${p.muted};margin-bottom:5px">${dateLabel(items[0].axisValue)}</div>`
          return (
            head +
            items
              .map(
                (i) =>
                  `<div style="display:flex;justify-content:space-between;gap:16px;font-size:11px"><span style="color:${p.muted}">${i.seriesName}</span><b style="font-family:'IBM Plex Mono',monospace">${
                    i.value == null ? '—' : i.seriesName.includes('Correlation') ? i.value.toFixed(3) : `${(i.value * 100).toFixed(1)}%`
                  }</b></div>`,
              )
              .join('')
          )
        },
      },
      xAxis: {
        type: 'category',
        data: series.map((d) => d.date),
        boundaryGap: false,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateTick(v, needsYear(series.map((d) => d.date))), hideOverlap: true },
      },
      yAxis: [
        {
          type: 'value',
          min: -1,
          max: 1,
          ...axis,
          name: 'ρ',
          nameGap: 8,
          nameTextStyle: { color: p.faint, fontSize: 9 },
          axisLabel: { ...axis.axisLabel, formatter: (v: number) => v.toFixed(1) },
        },
        {
          type: 'value',
          min: 0,
          ...axis,
          splitLine: { show: false },
          name: 'Vol',
          nameGap: 8,
          nameTextStyle: { color: p.faint, fontSize: 9 },
          axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
        },
      ],
      series: [
        {
          name: 'Correlation (60D)',
          type: 'line',
          data: series.map((d) => d.correlation),
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.4, color: p.accent },
          itemStyle: { color: p.accent },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            lineStyle: { color: p.faint, type: 'dashed', opacity: 0.5 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: 'Volatility (20D)',
          type: 'line',
          yAxisIndex: 1,
          data: series.map((d) => d.volatility),
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.1, color: isDark ? '#e8b06a' : '#b06a14', opacity: 0.75 },
          itemStyle: { color: isDark ? '#e8b06a' : '#b06a14' },
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
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="eyebrow">Drawdown from running peak</span>
        <span className="text-[10px] text-muted">full available history</span>
      </div>
      <Chart option={option} height={230} exportName={`risk-drawdown-${code}`} />
      <div className="mb-2 mt-4 flex items-baseline justify-between gap-2">
        <span className="eyebrow">Rolling market sensitivity</span>
        <span className="text-[10px] text-muted">60-session ρ · 20-session realised vol</span>
      </div>
      <Chart option={rollingOption} height={210} exportName={`risk-rolling-${code}`} />
    </div>
  )
}

export default function RiskLab() {
  const { isDark } = useTheme()
  const [code, setCode] = useState('BANKING')
  const [volHorizon, setVolHorizon] = useState<'5' | '21' | '63' | '252'>('252')
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['risk-summary'],
    queryFn: () => api.risk() as Promise<RiskSummary>,
  })
  const { data: rotation } = useQuery({
    queryKey: ['rotation', 120, 0, 0],
    queryFn: ({ signal }) => api.rotation(120, 0, 0, signal),
  })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const volKey = volHorizon === '252' ? 'volatility' : `volatility_${volHorizon}`
  const rowVol = (r: (typeof rows)[number]) => (r as unknown as Record<string, number | null | undefined>)[volKey] ?? null
  const marketVol = data?.market ? (data.market as unknown as Record<string, number | null | undefined>)[volKey] ?? data.market.volatility : null
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

  const matrixOption = useMemo(() => {
    const matrix: CorrelationMatrix | null | undefined = data?.correlation_matrix
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: false, labelSize: 9 })
    const labels = matrix?.labels ?? []
    const values = matrix?.values ?? []
    const short = (name: string) =>
      name
        .replace('Commercial Banks', 'Banks')
        .replace('Development Banks', 'Dev Banks')
        .replace('Hotels And Tourism', 'Hotels')
        .replace('Life Insurance', 'Life Ins.')
        .replace('Manufacturing And Processing', 'Manufacturing')
        .replace('Non Life Insurance', 'Non-Life')
        .replace('Microfinance', 'Microfinance')
        .replace('Mutual Fund', 'Mutual')
        .replace('Investment', 'Investment')
        .replace('Hydro Power', 'Hydro')
        .replace('Finance', 'Finance')
        .replace('Trading', 'Trading')
        .replace('Others', 'Others')
        .replace('NEPSE', 'NEPSE')
    const points = values.flatMap((row, y) =>
      row.map((v, x) => ({
        value: [x, y, v],
        itemStyle: { color: heatColor(v, 1, isDark, 0.55) },
      })),
    )
    return {
      ...baseOption(isDark),
      animation: false,
      grid: { left: 92, right: 16, top: 10, bottom: 78 },
      // ECharts refuses to paint a heatmap without a visualMap even when every
      // cell carries its own itemStyle colour. Keep it hidden; the visible
      // colour key sits below the chart.
      visualMap: {
        show: false,
        min: -1,
        max: 1,
        inRange: {
          color: [heatColor(-1, 1, isDark, 0.55), heatColor(0, 1, isDark, 0.55), heatColor(1, 1, isDark, 0.55)],
        },
      },
      tooltip: {
        ...baseOption(isDark).tooltip,
        formatter: (params: unknown) => {
          const d = (params as { value?: [number, number, number | null] }).value
          if (!d) return ''
          const [x, y, v] = d
          return `<div style="font-size:11px"><b>${labels[y] ?? ''}</b> × <b>${labels[x] ?? ''}</b><div style="font-family:'IBM Plex Mono',monospace;margin-top:3px">ρ = ${v == null ? '—' : v.toFixed(3)}</div></div>`
        },
      },
      xAxis: {
        type: 'category',
        data: labels.map(short),
        ...axis,
        axisLabel: { ...axis.axisLabel, rotate: 38, fontSize: 8, margin: 10 },
        splitArea: { show: false },
      },
      yAxis: {
        type: 'category',
        data: labels.map(short),
        inverse: true,
        ...axis,
        axisLabel: { ...axis.axisLabel, fontSize: 8 },
        splitArea: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          data: points,
          label: {
            show: true,
            fontSize: 8.5,
            fontFamily: "'IBM Plex Mono', monospace",
            formatter: (params: unknown) => {
              const v = (params as { value: [number, number, number | null] }).value[2]
              return v == null ? '' : v.toFixed(2)
            },
            color: p.ink,
          },
          itemStyle: { borderColor: p.surface, borderWidth: 1 },
          emphasis: { itemStyle: { borderColor: p.ink, borderWidth: 1.5 } },
        },
      ],
    } as unknown as EChartsOption
  }, [data, isDark])

  const highestVol = [...rows].sort((a, b) => (rowVol(b) ?? 0) - (rowVol(a) ?? 0))[0]
  const deepest = [...rows].sort((a, b) => (a.max_drawdown ?? 0) - (b.max_drawdown ?? 0))[0]
  const lowestVol = [...rows].sort((a, b) => (rowVol(a) ?? 9) - (rowVol(b) ?? 9))[0]

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
            <Card><Metric label="Highest volatility" value={pct(rowVol(highestVol))} sub={highestVol?.name} tone="neg" /></Card>
            <Card><Metric label="Lowest volatility" value={pct(rowVol(lowestVol))} sub={lowestVol?.name} tone="pos" /></Card>
            <Card><Metric label="Deepest drawdown" value={signedPct(deepest?.max_drawdown)} sub={deepest?.name} tone="neg" /></Card>
            <Card><Metric label="Sectors measured" value={rows.length} sub={`${volHorizon}-session volatility`} /></Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                eyebrow="Risk vs return"
                title="120-session return against volatility"
                subtitle="Bubble size reflects the maximum historical drawdown. Labels mark the highest volatility and the best/worst 120-session returns; hover any bubble for its name."
              />
              <Chart option={scatterOption} height={380} exportName="risk-return-scatter" />
            </Card>
            <Card>
              <CardHeader eyebrow="Volatility ranking" title="Annualised dispersion" subtitle="Daily return standard deviation × √252" />
              <Chart option={volOption} height={380} exportName="risk-volatility-ranking" />
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Correlation matrix · 252 sessions"
              title="Which sectors move together"
              subtitle="Pairwise-complete daily return correlation. Sectors with fewer shared observations are computed on their overlap, so each cell states its own sample rather than an imputed one."
              actions={
                <span className="hidden text-[10px] text-muted sm:inline">
                  {data.correlation_matrix?.labels.length ?? 0} series
                </span>
              }
            />
            {data.correlation_matrix ? (
              <>
                <Chart option={matrixOption} height={560} exportName="risk-correlation-matrix" reserveTools />
                <div className="mt-1 flex items-center justify-center gap-2 text-[10px] text-muted">
                  <span className="num">−1</span>
                  <span
                    className="h-2 w-40 rounded-full"
                    style={{
                      background: isDark
                        ? 'linear-gradient(90deg,#8e3a3a,#3a2a28,#111917,#173b33,#2f9c82)'
                        : 'linear-gradient(90deg,#9f3a3a,#e8c4bd,#fffdf8,#b7ddd3,#1f6f5f)',
                    }}
                  />
                  <span className="num">+1</span>
                  <span className="ml-2 text-faint">red = moves against · teal = moves with</span>
                </div>
              </>
            ) : (
              <InfoNote>At least two sector series with 30 shared sessions are required for a correlation matrix.</InfoNote>
            )}
          </Card>

          <Card className="mt-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="eyebrow mb-1">Volatility horizon</div>
                <p className="text-[11px] text-muted">Annualised volatility is computed from daily returns over the selected horizon.</p>
              </div>
              <Segmented
                options={[{ value: '5', label: '5D' }, { value: '21', label: '21D' }, { value: '63', label: '63D' }, { value: '252', label: '252D' }]}
                value={volHorizon}
                onChange={(v) => setVolHorizon(v as '5' | '21' | '63' | '252')}
                size="sm"
              />
            </div>
            <CardHeader
              eyebrow="Risk table"
              title="Cross-sectional risk metrics"
              subtitle="VaR and CVaR are historical daily estimates at 95% confidence using a 252-session window."
              actions={
                <button
                  className="btn"
                  onClick={() =>
                    downloadCsv(
                      'nepse-risk-metrics',
                      ['Sector', 'Volatility', 'Beta', 'Correlation', 'Max drawdown', 'Current drawdown', 'VaR 95', 'CVaR 95', 'Observations'],
                      [...rows]
                        .sort((a, b) => (a.volatility ?? 0) - (b.volatility ?? 0))
                        .map((r) => [
                          r.name, rowVol(r), r.beta, r.correlation, r.max_drawdown,
                          r.current_drawdown, r.var_95, r.cvar_95, r.observations,
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
                  {[...rows].sort((a, b) => (rowVol(a) ?? 0) - (rowVol(b) ?? 0)).map((r) => (
                    <tr key={r.code}>
                      <td>
                        <button className="text-left hover:text-accent" onClick={() => setCode(r.code)}>{r.name}</button>
                      </td>
                      <td className="num text-right">{pct(rowVol(r))}</td>
                      <td className={cn('num text-right', (r.beta ?? 0) > 1 ? 'warn' : '')}>{num(r.beta)}</td>
                      <td className="num text-right text-muted">{num(r.correlation)}</td>
                      <td className="num text-right neg">{signedPct(r.max_drawdown)}</td>
                      <td className={cn('num text-right', toneClass(r.current_drawdown))}>{signedPct(r.current_drawdown)}</td>
                      <td className="num text-right">{signedPct(r.var_95)}</td>
                      <td className="num text-right">{signedPct(r.cvar_95)}</td>
                    </tr>
                  ))}
                  {data?.market && (
                    <tr className="bg-raised/60 font-medium">
                      <td>{data.market.name}</td>
                      <td className="num text-right">{pct(marketVol)}</td>
                      <td className="num text-right">1.00</td>
                      <td className="num text-right text-muted">1.00</td>
                      <td className="num text-right neg">{signedPct(data.market.max_drawdown)}</td>
                      <td className={cn('num text-right', toneClass(data.market.current_drawdown))}>{signedPct(data.market.current_drawdown)}</td>
                      <td className="num text-right">{signedPct(data.market.var_95)}</td>
                      <td className="num text-right">{signedPct(data.market.cvar_95)}</td>
                    </tr>
                  )}
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
