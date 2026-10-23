import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Download, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { CompareSeries } from '../lib/api'
import { Chart } from '../components/Chart'
import {
  Card,
  CardHeader,
  ErrorState,
  InfoNote,
  Loading,
  Metric,
  PageHeader,
  Segmented,
  StatusBadge,
} from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette, seriesColors } from '../lib/chart'
import { cn, dateLabel, dateTick, needsYear, signedPct, toneClass } from '../lib/format'
import { downloadCsv } from '../lib/export'

const RANGE_OPTIONS = [
  { value: '1M', label: '1M', months: 1 },
  { value: '3M', label: '3M', months: 3 },
  { value: '6M', label: '6M', months: 6 },
  { value: '1Y', label: '1Y', months: 12 },
  { value: '3Y', label: '3Y', months: 36 },
  { value: '5Y', label: '5Y', months: 60 },
  { value: 'ALL', label: 'All', months: 0 },
]

function shiftIso(months: number): string {
  const d = new Date()
  const day = d.getDate()
  d.setMonth(d.getMonth() - months)
  if (d.getDate() < day) d.setDate(0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface SeriesStats {
  period: number | null
  first: number | null
  last: number | null
  points: number
}

function stats(points: Array<{ date: string; close: number }>): SeriesStats {
  if (!points.length) return { period: null, first: null, last: null, points: 0 }
  const first = points[0].close
  const last = points[points.length - 1].close
  return {
    period: first > 0 ? last / first - 1 : null,
    first,
    last,
    points: points.length,
  }
}

export default function NewPulse() {
  const { isDark } = useTheme()
  const [preset, setPreset] = useState('3Y')
  const [start, setStart] = useState(shiftIso(36))
  const [end, setEnd] = useState('')
  const [hidden, setHidden] = useState<string[]>([])

  const { data: sectors } = useQuery({ queryKey: ['sectors'], queryFn: api.sectors })
  const codes = useMemo(() => [...(sectors ?? []).map((s) => s.code), 'NEPSE'], [sectors])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['new-pulse', codes.join(','), start, end],
    queryFn: ({ signal }) => api.compare(codes, start || undefined, end || undefined, signal),
    enabled: codes.length > 1,
  })

  const applyPreset = (value: string) => {
    setPreset(value)
    setEnd('')
    const option = RANGE_OPTIONS.find((r) => r.value === value)
    setStart(!option || option.months === 0 ? '' : shiftIso(option.months))
  }

  const allSeries = data?.series ?? []
  const visibleSeries = useMemo(
    () => allSeries.filter((s) => !hidden.includes(s.code)),
    [allSeries, hidden],
  )

  const dateUnion = useMemo(() => {
    const set = new Set<string>()
    for (const s of visibleSeries) for (const p of s.points) set.add(p.date)
    return [...set].sort()
  }, [visibleSeries])

  const colorFor = (code: string): string => {
    if (code === 'NEPSE') return palette(isDark).ink
    const colors = seriesColors(isDark)
    const order = (sectors ?? []).map((s) => s.code)
    const index = order.indexOf(code)
    return colors[(index < 0 ? 0 : index) % colors.length]
  }

  const chartOption = useMemo<EChartsOption>(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const maps = new Map(visibleSeries.map((s) => [s.code, new Map(s.points.map((pt) => [pt.date, pt.close]))]))
    const anchors = new Map(
      visibleSeries.map((s) => [s.code, s.points.length ? { date: s.points[0].date, close: s.points[0].close } : null]),
    )

    return {
      ...baseOption(isDark),
      animation: false,
      grid: { left: 58, right: 84, top: 58, bottom: 42 },
      legend: {
        ...baseOption(isDark).legend,
        type: 'scroll',
        top: 0,
        left: 0,
        itemWidth: 13,
        itemHeight: 3,
        pageIconSize: 9,
        pageTextStyle: { color: p.muted, fontSize: 9 },
        textStyle: { color: p.muted, fontSize: 10 },
      },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'line', lineStyle: { color: p.faint, width: 1, opacity: 0.65 } },
        formatter: (params: unknown) => {
          const items = (
            params as Array<{ axisValue: string; seriesName: string; value: number | null; color: string }>
          )
            .filter((i): i is { axisValue: string; seriesName: string; value: number; color: string } =>
              typeof i.value === 'number' && Number.isFinite(i.value),
            )
            .sort((a, b) => b.value - a.value)
          if (!items.length) return ''
          const head = `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${p.muted};margin-bottom:6px">${dateLabel(items[0].axisValue)}</div>`
          return (
            head +
            items
              .map(
                (i) =>
                  `<div style="display:flex;justify-content:space-between;gap:18px;font-size:11px;line-height:1.6"><span style="color:${i.color};white-space:nowrap">${i.seriesName}</span><b style="font-family:'IBM Plex Mono',monospace">${i.value > 0 ? '+' : ''}${i.value.toFixed(2)}%</b></div>`,
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
        axisLabel: {
          ...axis.axisLabel,
          formatter: (v: string) => dateTick(v, needsYear(dateUnion)),
          hideOverlap: true,
          interval: Math.max(0, Math.ceil(dateUnion.length / 10) - 1),
        },
      },
      yAxis: {
        type: 'value',
        scale: false,
        ...axis,
        name: 'Change from own start',
        nameLocation: 'end',
        nameGap: 14,
        nameTextStyle: {
          color: p.faint,
          fontSize: 9,
          fontFamily: "'IBM Plex Mono', monospace",
          align: 'left',
        },
        axisLabel: {
          ...axis.axisLabel,
          formatter: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
        },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' as const } },
      },
      series: visibleSeries.map((s, i) => {
        const color = colorFor(s.code)
        const anchor = anchors.get(s.code)
        const isBenchmark = s.code === 'NEPSE'
        return {
          name: s.code === 'NEPSE' ? 'NEPSE' : s.name,
          type: 'line' as const,
          data: dateUnion.map((date) => {
            if (!anchor || date < anchor.date) return null
            const close = maps.get(s.code)?.get(date)
            if (close === undefined || anchor.close <= 0) return null
            return (close / anchor.close - 1) * 100
          }),
          showSymbol: false,
          connectNulls: false,
          animation: false,
          symbol: 'circle',
          symbolSize: isBenchmark ? 5 : 4,
          lineStyle: {
            width: isBenchmark ? 2.4 : 1.45,
            color,
            type: isBenchmark ? ('dashed' as const) : ('solid' as const),
            opacity: isBenchmark ? 1 : 0.9,
          },
          itemStyle: { color },
          emphasis: { focus: 'series' as const, lineStyle: { width: isBenchmark ? 3 : 2.4 } },
          // Keep the benchmark above every sector line, regardless of how
          // many sectors are visible or in what order they were returned.
          z: isBenchmark ? 100 : 4 + i,
          markLine:
            i === 0
              ? {
                  silent: true,
                  symbol: ['none', 'none'],
                  animation: false,
                  lineStyle: { color: p.faint, width: 1, opacity: 0.45 },
                  label: { show: false },
                  data: [{ yAxis: 0 }],
                }
              : undefined,
        }
      }),
    } as EChartsOption
  }, [visibleSeries, dateUnion, isDark, sectors])

  const table = useMemo(
    () =>
      visibleSeries
        .map((s: CompareSeries) => ({ ...s, stats: stats(s.points) }))
        .sort((a, b) => (b.stats.period ?? -Infinity) - (a.stats.period ?? -Infinity)),
    [visibleSeries],
  )
  // The benchmark stays available even when its line is toggled off, so the
  // "vs NEPSE" column never silently turns into a column of dashes.
  const benchmark = useMemo(() => {
    const series = allSeries.find((s) => s.code === 'NEPSE')
    return series ? stats(series.points) : null
  }, [allSeries])
  const best = table.find((s) => s.code !== 'NEPSE')
  const worst = [...table].reverse().find((s) => s.code !== 'NEPSE')
  const spread =
    best?.stats.period != null && worst?.stats.period != null
      ? best.stats.period - worst.stats.period
      : null

  const toggle = (code: string) => {
    setHidden((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
  }

  const reset = () => {
    setHidden([])
    setPreset('3Y')
    setStart(shiftIso(36))
    setEnd('')
  }

  return (
    <div>
      <PageHeader
        eyebrow="New · sector pulse"
        title="Every sector, one percentage scale."
        description="Each line is rebased to its own first observation, so every sector starts at 0% and the chart reads as percentage change. NEPSE is the dashed benchmark."
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
            label="Range"
            options={RANGE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
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
                  setPreset('CUSTOM')
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
                  setPreset('CUSTOM')
                }}
              />
            </label>
          </div>
          <div className="ml-auto flex items-center gap-3 text-[10px] text-muted">
            <span className="num">{visibleSeries.length} of {allSeries.length} series</span>
            <button className="text-accent hover:underline" onClick={() => setHidden([])}>
              Show all
            </button>
            <button className="text-muted hover:underline" onClick={() => setHidden(allSeries.map((s) => s.code))}>
              Clear
            </button>
          </div>
        </div>
        <div className="mt-4 border-t pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Sectors on the chart</span>
            <span className="text-[10px] text-muted">Click to show or hide a line</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(sectors ?? []).map((s) => {
              const active = !hidden.includes(s.code)
              return (
                <button
                  key={s.code}
                  aria-pressed={active}
                  onClick={() => toggle(s.code)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] transition-colors',
                    active ? 'border-accent/50 bg-accent/[0.07] text-ink' : 'border-line text-faint line-through',
                  )}
                >
                  {s.name}
                </button>
              )
            })}
            <button
              aria-pressed={!hidden.includes('NEPSE')}
              onClick={() => toggle('NEPSE')}
              className={cn(
                'rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors',
                !hidden.includes('NEPSE') ? 'border-accent/50 bg-accent/[0.07] text-ink' : 'border-line text-faint',
              )}
            >
              NEPSE
            </button>
          </div>
        </div>
      </Card>

      {isLoading && <Card><Loading label="Aligning every sector and NEPSE" rows={5} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}
      {data && !data.available && <Card><InfoNote tone="warn">{data.reason ?? 'No observations in this range.'}</InfoNote></Card>}

      {data && data.available && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <Metric
                label="NEPSE over window"
                value={signedPct(benchmark?.period)}
                tone={benchmark && (benchmark.period ?? 0) > 0 ? 'pos' : 'neg'}
                sub={`${dateLabel(data.start)} → ${dateLabel(data.end)}`}
              />
            </Card>
            <Card>
              <Metric
                label="Strongest sector"
                value={best ? signedPct(best.stats.period) : '—'}
                tone={best && (best.stats.period ?? 0) > 0 ? 'pos' : 'neg'}
                sub={best?.name ?? '—'}
              />
            </Card>
            <Card>
              <Metric
                label="Weakest sector"
                value={worst ? signedPct(worst.stats.period) : '—'}
                tone={worst && (worst.stats.period ?? 0) > 0 ? 'pos' : 'neg'}
                sub={worst?.name ?? '—'}
              />
            </Card>
            <Card>
              <Metric
                label="Sector spread"
                value={signedPct(spread)}
                tone={spread == null ? 'neutral' : spread > 0 ? 'pos' : 'neg'}
                sub="Strongest minus weakest, same window"
              />
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow={`Percentage change relative to each series’ own start · ${dateUnion.length} sessions`}
              title="Sector and NEPSE paths"
              subtitle="All series begin at 0%. The y-axis is the change from each line’s first observation in the selected window, not the index level. Gaps are missing sessions and are never carried forward."
              actions={
                <button
                  className="btn"
                  onClick={() =>
                    downloadCsv(
                      `nepse-sector-pulse-${start || 'all'}-${end || 'latest'}`,
                      ['Series', 'Code', 'First close', 'Last close', 'Change since start', 'vs NEPSE', 'Observations'],
                      table.map((s) => [
                        s.name,
                        s.code,
                        s.stats.first,
                        s.stats.last,
                        s.stats.period == null ? null : (s.stats.period * 100).toFixed(2),
                        s.code !== 'NEPSE' && benchmark?.period != null && s.stats.period != null
                          ? ((s.stats.period - benchmark.period) * 100).toFixed(2)
                          : null,
                        s.stats.points,
                      ]),
                    )
                  }
                >
                  <Download size={12} /> CSV
                </button>
              }
            />
            {visibleSeries.length === 0 ? (
              <InfoNote>Select at least one sector or NEPSE above.</InfoNote>
            ) : (
              <Chart option={chartOption} height={600} exportName="nepse-sector-pulse" />
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              Scroll or pinch to zoom, drag to pan, use the period selector inside the chart, or expand it
              full screen. Click a legend entry to hide or show that line. NEPSE is dashed and drawn on top.
            </p>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Window statistics"
              title="Who moved the most, relative to their own start"
              subtitle="Computed from the unadjusted price-index closes shown above. Not total return and not a forecast."
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Series</th>
                    <th className="text-right">Change since start</th>
                    <th className="text-right">vs NEPSE</th>
                    <th className="text-right">First</th>
                    <th className="text-right">Last</th>
                    <th className="text-right">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((s, i) => {
                    const excess =
                      s.code !== 'NEPSE' && benchmark?.period != null && s.stats.period != null
                        ? s.stats.period - benchmark.period
                        : null
                    return (
                      <tr key={s.code}>
                        <td className="num text-muted">{i + 1}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: colorFor(s.code) }} />
                            {s.code === 'NEPSE' ? (
                              <span className="font-mono text-[11px]">NEPSE (benchmark)</span>
                            ) : (
                              <Link to={`/sectors?code=${s.code}`} className="inline-flex items-center gap-1 hover:text-accent">
                                {s.name} <ArrowUpRight size={11} className="text-faint" />
                              </Link>
                            )}
                          </span>
                        </td>
                        <td className={cn('num text-right', toneClass(s.stats.period))}>{signedPct(s.stats.period)}</td>
                        <td className={cn('num text-right', toneClass(excess))}>{excess == null ? '—' : signedPct(excess)}</td>
                        <td className="num text-right text-muted">{s.stats.first?.toFixed(1) ?? '—'}</td>
                        <td className="num text-right text-muted">{s.stats.last?.toFixed(1) ?? '—'}</td>
                        <td className="num text-right text-muted">{s.stats.points}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader eyebrow="Method" title="What the percentage scale does — and does not — say" />
            <div className="grid gap-3 text-[12px] leading-relaxed text-muted sm:grid-cols-2">
              <p>
                <b className="text-ink">Own-start rebasing.</b> Each line is divided by its first close in the
                selected window, so every series starts at 0%. This removes the arbitrary difference between
                index levels; it does not remove the difference in volatility.
              </p>
              <p>
                <b className="text-ink">No look-ahead.</b> The base is the first observation at or after the
                chosen start date. Later points are never used to set the anchor.
              </p>
              <p>
                <b className="text-ink">Price indices only.</b> Dividends, corporate actions and index
                membership changes are not included. A sector’s path is not a tradable total-return series.
              </p>
              <p>
                <b className="text-ink">Gaps stay gaps.</b> If a sector has no observation on a session, its
                line breaks. Nothing is interpolated or carried forward. Very long windows are evenly
                sampled to roughly 2,000 points for rendering speed; the first and last observations are
                always kept.
              </p>
            </div>
            <div className="mt-3 border-t pt-3">
              <Link to="/rotation" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                See direction and rotation on the quadrant map <ArrowUpRight size={12} />
              </Link>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
