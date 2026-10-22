import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Download, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { CompareSeries } from '../lib/api'
import { Chart } from '../components/Chart'
import { Card, CardHeader, ErrorState, InfoNote, Loading, Metric, PageHeader, Segmented, StatusBadge } from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette, seriesColors } from '../lib/chart'
import { cn, dateLabel, dateTick, needsYear, signedPct, toneClass } from '../lib/format'
import { downloadCsv } from '../lib/export'

type Mode = 'normalized' | 'absolute' | 'cumulative'
type Preset = '1Y' | '3Y' | '5Y' | 'ALL'

const DEFAULT_CODES = ['BANKING', 'HYDROPOWER', 'MICROFINANCE', 'NEPSE']

function isoYearsAgo(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  // Format from local parts: toISOString() would shift the calendar day for
  // users east of UTC and make a "3Y" preset start a day early.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

interface Stats {
  first: number | null
  last: number | null
  period: number | null
  maxDrawdown: number | null
  volatility: number | null
  points: number
}

function stats(points: Array<{ date: string; close: number }>): Stats {
  if (!points.length) return { first: null, last: null, period: null, maxDrawdown: null, volatility: null, points: 0 }
  const closes = points.map((p) => p.close)
  const first = closes[0]
  const last = closes[closes.length - 1]
  let peak = closes[0]
  let worst = 0
  for (const c of closes) {
    if (c > peak) peak = c
    if (peak > 0) worst = Math.min(worst, c / peak - 1)
  }
  const rets: number[] = []
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1)
  }
  const sd = stdev(rets)
  return {
    first,
    last,
    period: first > 0 ? last / first - 1 : null,
    maxDrawdown: worst,
    volatility: sd === null ? null : sd * Math.sqrt(252),
    points: points.length,
  }
}

function rebase(series: CompareSeries[], commonStart: string | null) {
  return series.map((s) => {
    const startIndex = commonStart ? s.points.findIndex((p) => p.date >= commonStart) : 0
    const base = s.points[startIndex]?.close ?? null
    const idx = Math.max(0, startIndex)
    return { ...s, base, anchorDate: s.points[idx]?.date ?? null }
  })
}

export default function Compare() {
  const { isDark } = useTheme()
  const [codes, setCodes] = useState<string[]>(DEFAULT_CODES)
  const [mode, setMode] = useState<Mode>('normalized')
  const [preset, setPreset] = useState<Preset>('3Y')
  const [start, setStart] = useState<string>(isoYearsAgo(3))
  const [end, setEnd] = useState<string>('')

  const { data: sectors } = useQuery({ queryKey: ['sectors'], queryFn: api.sectors })
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['compare', codes, start, end],
    queryFn: ({ signal }) => api.compare(codes, start || undefined, end || undefined, signal),
    enabled: codes.length > 0,
  })

  const applyPreset = (p: Preset) => {
    setPreset(p)
    if (p === 'ALL') {
      setStart('')
      setEnd('')
      return
    }
    const years = p === '1Y' ? 1 : p === '3Y' ? 3 : 5
    setStart(isoYearsAgo(years))
    setEnd('')
  }

  const series = useMemo(() => rebase(data?.series ?? [], data?.common_start ?? null), [data])
  const colors = seriesColors(isDark)
  const colorFor = (code: string, i: number) => (code === 'NEPSE' ? palette(isDark).ink : colors[i % colors.length])

  const dateUnion = useMemo(() => {
    const set = new Set<string>()
    for (const s of series) for (const p of s.points) set.add(p.date)
    return [...set].sort()
  }, [series])

  const chartOption = useMemo<EChartsOption>(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const maps = series.map((s) => new Map(s.points.map((pt) => [pt.date, pt.close])))
    return {
      ...baseOption(isDark),
      animation: false,
      grid: { left: 58, right: 30, top: 48, bottom: 44 },
      legend: {
        ...baseOption(isDark).legend,
        type: 'scroll',
        top: 0,
        left: 0,
        itemWidth: 12,
        itemHeight: 3,
        pageIconSize: 9,
        textStyle: { color: p.muted, fontSize: 10 },
      },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: p.faint, width: 1, opacity: 0.65 } },
        formatter: (params: unknown) => {
          const items = params as Array<{ axisValue: string; seriesName: string; value: number | null; color: string }>
          if (!items.length) return ''
          const head = `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${p.muted};margin-bottom:5px">${dateLabel(items[0].axisValue)}</div>`
          return (
            head +
            items
              .filter((i) => i.value !== null)
              .map(
                (i) =>
                  `<div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${i.color};white-space:nowrap">${i.seriesName}</span><b style="font-family:'IBM Plex Mono',monospace">${
                    mode === 'absolute' ? i.value?.toFixed(1) : mode === 'normalized' ? i.value?.toFixed(1) : signedPct((i.value ?? 0) / 100)
                  }</b></div>`,
              )
              .join('')
          )
        },
      },
      xAxis: {
        type: 'category',
        data: dateUnion,
        boundaryGap: false,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateTick(v, needsYear(dateUnion)), hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        scale: mode !== 'cumulative',
        ...axis,
        name:
          mode === 'absolute'
            ? 'Index level (unadjusted)'
            : mode === 'normalized'
              ? 'Index level · common start = 100'
              : 'Return from first observation',
        nameLocation: 'end',
        nameGap: 12,
        nameTextStyle: { color: p.faint, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        axisLabel: {
          ...axis.axisLabel,
          formatter: (v: number) => (mode === 'cumulative' ? `${v > 0 ? '+' : ''}${v.toFixed(0)}%` : v.toFixed(0)),
        },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' as const } },
      },
      series: series.map((s, i) => {
        const color = colorFor(s.code, i)
        const points = dateUnion.map((date) => {
          const close = maps[i].get(date)
          if (close === undefined) return null
          // Only draw from the common-start anchor, so a late-starting series
          // does not get a misleading flat prefix.
          if (s.anchorDate && date < s.anchorDate) return null
          if (!s.base) return null
          if (mode === 'absolute') return close
          const ratio = close / s.base
          return mode === 'normalized' ? ratio * 100 : (ratio - 1) * 100
        })
        return {
          name: s.name,
          type: 'line' as const,
          data: points,
          showSymbol: false,
          connectNulls: false,
          animation: false,
          lineStyle: {
            width: s.code === 'NEPSE' ? 2 : 1.5,
            color,
            type: s.code === 'NEPSE' ? ('dashed' as const) : ('solid' as const),
            opacity: 0.95,
          },
          itemStyle: { color },
          emphasis: { focus: 'series' as const, lineStyle: { width: 2.4 } },
          z: s.code === 'NEPSE' ? 6 : 3,
        }
      }),
    }
  }, [series, dateUnion, mode, isDark])

  const table = useMemo(
    () =>
      series
        .map((s) => {
          const st = stats(s.points.filter((p) => (start ? p.date >= start : true) && (end ? p.date <= end : true)))
          return { ...s, stats: st }
        })
        .sort((a, b) => (b.stats.period ?? -Infinity) - (a.stats.period ?? -Infinity)),
    [series, start, end],
  )
  const nepse = table.find((s) => s.code === 'NEPSE')
  const best = table.find((s) => s.code !== 'NEPSE')

  const toggle = (code: string) => {
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }

  const reset = () => {
    setCodes(DEFAULT_CODES)
    setMode('normalized')
    applyPreset('3Y')
    setEnd('')
  }

  return (
    <div>
      <PageHeader
        eyebrow="Sector comparison"
        title="Put the sectors on one scale."
        description="Compare any mix of sector indices against NEPSE over the same observation window. Normalisation is an alignment device, not a forecast; index levels are unadjusted."
        actions={
          <>
            <StatusBadge status="VERIFIED" label={`as of ${dateLabel(data?.end)}`} />
            <button className="btn" onClick={reset}>
              <RotateCcw size={13} /> Reset
            </button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented
            label="Scale"
            options={[
              { value: 'normalized', label: 'Rebased 100' },
              { value: 'cumulative', label: 'Return %' },
              { value: 'absolute', label: 'Index level' },
            ]}
            value={mode}
            onChange={setMode}
            size="sm"
          />
          <Segmented
            label="Range"
            options={[
              { value: '1Y', label: '1Y' },
              { value: '3Y', label: '3Y' },
              { value: '5Y', label: '5Y' },
              { value: 'ALL', label: 'All' },
            ]}
            value={preset}
            onChange={applyPreset}
            size="sm"
          />
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <label className="flex items-center gap-1.5">
              From
              <input
                type="date"
                className="rounded-md border bg-surface px-2 py-1 font-mono text-[10px] text-ink"
                value={start}
                max={end || undefined}
                onChange={(e) => {
                  setStart(e.target.value)
                  setPreset('ALL')
                }}
              />
            </label>
            <label className="flex items-center gap-1.5">
              To
              <input
                type="date"
                className="rounded-md border bg-surface px-2 py-1 font-mono text-[10px] text-ink"
                value={end}
                min={start || undefined}
                onChange={(e) => {
                  setEnd(e.target.value)
                  setPreset('ALL')
                }}
              />
            </label>
          </div>
          <span className="num ml-auto text-[10px] text-muted">{codes.length} series selected</span>
        </div>
        <div className="mt-4 border-t pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Series</span>
            <div className="flex gap-2 text-[10px]">
              <button className="text-accent hover:underline" onClick={() => setCodes(['BANKING', 'HYDROPOWER', 'MICROFINANCE', 'NEPSE'])}>
                Defaults
              </button>
              <button className="text-muted hover:underline" onClick={() => setCodes([])}>
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(sectors ?? []).map((s) => {
              const active = codes.includes(s.code)
              return (
                <button
                  key={s.code}
                  aria-pressed={active}
                  onClick={() => toggle(s.code)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] transition-colors',
                    active ? 'border-accent/50 bg-accent/[0.07] text-ink' : 'border-line text-muted hover:text-ink',
                  )}
                >
                  {s.name}
                </button>
              )
            })}
            <button
              aria-pressed={codes.includes('NEPSE')}
              onClick={() => toggle('NEPSE')}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors',
                codes.includes('NEPSE') ? 'border-accent/50 bg-accent/[0.07] text-ink' : 'border-line text-muted',
              )}
            >
              NEPSE (benchmark)
            </button>
          </div>
        </div>
      </Card>

      {isLoading && <Card><Loading label="Aligning index series" rows={5} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}
      {data && !data.available && <Card><InfoNote tone="warn">{data.reason ?? 'No observations in this range.'}</InfoNote></Card>}

      {data && data.available && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <Metric
                label="Best period return"
                value={best ? signedPct(best.stats.period) : '—'}
                tone={best && (best.stats.period ?? 0) > 0 ? 'pos' : 'neg'}
                sub={best?.name ?? '—'}
              />
            </Card>
            <Card>
              <Metric
                label="NEPSE over window"
                value={nepse ? signedPct(nepse.stats.period) : '—'}
                tone={nepse && (nepse.stats.period ?? 0) > 0 ? 'pos' : 'neg'}
                sub={`${dateLabel(data.start)} → ${dateLabel(data.end)}`}
              />
            </Card>
            <Card>
              <Metric
                label="Common start"
                value={<span className="text-[16px]">{dateLabel(data.common_start)}</span>}
                sub="All rebased series begin here"
              />
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow={`${mode === 'absolute' ? 'Unadjusted index levels' : mode === 'normalized' ? 'Rebased to 100 at the common start' : 'Cumulative return'} · ${dateUnion.length} sessions`}
              title="Sector index paths"
              subtitle={
                mode === 'absolute'
                  ? 'Raw index levels. Different base levels make vertical distance hard to compare; use rebased or return mode for relative performance.'
                  : 'Series are aligned on the common calendar. A sector with no observation is a gap, never a carried-forward value.'
              }
              actions={
                <button
                  className="btn"
                  onClick={() =>
                    downloadCsv(
                      `nepse-compare-${start || 'all'}-${end || 'latest'}`,
                      ['Series', 'Code', 'First close', 'Last close', 'Period return', 'Max drawdown', 'Volatility (252)', 'Observations'],
                      table.map((s) => [
                        s.name, s.code, s.stats.first, s.stats.last, s.stats.period,
                        s.stats.maxDrawdown, s.stats.volatility, s.stats.points,
                      ]),
                    )
                  }
                >
                  <Download size={12} /> CSV
                </button>
              }
            />
            {codes.length === 0 ? (
              <InfoNote>Select at least one series above.</InfoNote>
            ) : (
              <Chart option={chartOption} height={520} exportName={`nepse-compare-${mode}`} />
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              {mode === 'absolute'
                ? 'Index levels are unadjusted closes from the sector sub-indices and the NEPSE index.'
                : mode === 'normalized'
                  ? '100 is the first common observation; 105 means +5% from that anchor, not an official index value.'
                  : 'Values are the cumulative percentage change from each series’ first observation on or after the common start.'}
            </p>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Window statistics"
              title="Return, drawdown and volatility"
              subtitle="Computed from the index levels shown above, using each series’ own observations in the selected range."
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Series</th>
                    <th className="text-right">First</th>
                    <th className="text-right">Last</th>
                    <th className="text-right">Period return</th>
                    <th className="text-right">vs NEPSE</th>
                    <th className="text-right">Max drawdown</th>
                    <th className="text-right">Volatility</th>
                    <th className="text-right">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((s) => {
                    const excess =
                      s.code !== 'NEPSE' && nepse?.stats.period != null && s.stats.period != null
                        ? s.stats.period - nepse.stats.period
                        : null
                    return (
                      <tr key={s.code}>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: colorFor(s.code, table.indexOf(s)) }} />
                            {s.code === 'NEPSE' ? (
                              <Link to="/" className="hover:text-accent">{s.name}</Link>
                            ) : (
                              <Link to={`/sectors?code=${s.code}`} className="inline-flex items-center gap-1 hover:text-accent">
                                {s.name} <ArrowUpRight size={11} className="text-faint" />
                              </Link>
                            )}
                          </span>
                        </td>
                        <td className="num text-right text-muted">{s.stats.first?.toFixed(1) ?? '—'}</td>
                        <td className="num text-right text-muted">{s.stats.last?.toFixed(1) ?? '—'}</td>
                        <td className={cn('num text-right', toneClass(s.stats.period))}>{signedPct(s.stats.period)}</td>
                        <td className={cn('num text-right', toneClass(excess))}>{excess == null ? '—' : signedPct(excess)}</td>
                        <td className="num text-right neg">{signedPct(s.stats.maxDrawdown)}</td>
                        <td className="num text-right">{s.stats.volatility == null ? '—' : `${(s.stats.volatility * 100).toFixed(1)}%`}</td>
                        <td className="num text-right text-muted">{s.stats.points}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!nepse && <InfoNote>Add NEPSE to the selection to compute excess return.</InfoNote>}
          </Card>

          <Card className="mt-4">
            <CardHeader eyebrow="Method" title="What this view does — and does not — say" />
            <div className="grid gap-3 text-[12px] leading-relaxed text-muted sm:grid-cols-2">
              <p>
                <b className="text-ink">Alignment.</b> Dates are unioned across the selected series. Each series
                begins at the first observation on or after the common start; earlier cells are blank. Nothing is
                interpolated or carried forward.
              </p>
              <p>
                <b className="text-ink">Not total return.</b> NEPSE sector sub-indices here are price indices.
                Dividends, corporate actions and membership changes are outside this comparison.
              </p>
              <p>
                <b className="text-ink">Drawdown.</b> Peak-to-trough decline within the selected window, computed
                from the displayed closes. It is not the full-history drawdown on the Risk Lab.
              </p>
              <p>
                <b className="text-ink">Volatility.</b> Annualised standard deviation of daily returns
                (√252), using only the returns inside the window.
              </p>
            </div>
            <div className="mt-3 border-t pt-3">
              <Link to="/rotation" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                See these sectors on the rotation map <ArrowUpRight size={12} />
              </Link>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
