import { useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import { Chart } from './Chart'
import type { RotationRow, TrailPoint } from '../lib/api'
import { axisStyle, baseOption, palette, quadrantColor } from '../lib/chart'
import { useTheme } from '../lib/useTheme'
import { cn, npr, signedPct } from '../lib/format'

const QUADRANT_LABELS: Array<{ key: string; label: string; pos: 'tl' | 'tr' | 'bl' | 'br' }> = [
  { key: 'ADVANCING', label: 'Advancing', pos: 'tl' },
  { key: 'WINNING', label: 'Winning', pos: 'tr' },
  { key: 'LAGGING', label: 'Lagging', pos: 'bl' },
  { key: 'LOSING', label: 'Losing', pos: 'br' },
]

export type BubbleMetric = 'none' | 'market_cap' | 'turnover' | 'volatility' | 'advance_pct'

export const BUBBLE_METRICS: Array<{ value: BubbleMetric; label: string }> = [
  { value: 'none', label: 'Equal' },
  { value: 'market_cap', label: 'Market cap' },
  { value: 'turnover', label: 'Turnover' },
  { value: 'volatility', label: 'Volatility' },
  { value: 'advance_pct', label: 'Breadth' },
]

export function RotationQuadrant({
  rows,
  trails,
  height = 520,
  showTrails = true,
  selected,
  watched = [],
  onSelect,
  compact = false,
  bubbleMetric = 'none',
  exportName,
  animateSelected = true,
  replayToken = 0,
}: {
  rows: RotationRow[]
  trails?: Record<string, TrailPoint[]>
  height?: number
  showTrails?: boolean
  selected?: string | null
  watched?: string[]
  onSelect?: (code: string) => void
  compact?: boolean
  bubbleMetric?: BubbleMetric
  exportName?: string
  /** Replay the selected sector's trail when the selection changes. */
  animateSelected?: boolean
  /** Increment to replay the selected trail without changing the selection. */
  replayToken?: number
}) {
  const { isDark } = useTheme()
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [reveal, setReveal] = useState(0)
  const selectedTrail = selected && trails ? trails[selected] : undefined

  useEffect(() => {
    if (!animateSelected || !selected || !selectedTrail || selectedTrail.length < 2) {
      setReveal(selectedTrail?.length ?? 0)
      return
    }
    if (reducedMotion) {
      setReveal(selectedTrail.length)
      return
    }
    setReveal(1)
    const timer = window.setInterval(() => {
      setReveal((value) => {
        if (value >= selectedTrail.length) {
          window.clearInterval(timer)
          return value
        }
        return value + 1
      })
    }, 85)
    return () => window.clearInterval(timer)
  }, [animateSelected, reducedMotion, replayToken, selected, selectedTrail])

  const option = useMemo<EChartsOption>(() => {
    const p = palette(isDark)
    const pts = rows.filter((r) => r.absolute_strength !== null && r.relative_strength !== null)
    const visible = new Set(pts.map((r) => r.code))
    const allX = pts.map((r) => r.absolute_strength as number)
    const allY = pts.map((r) => r.relative_strength as number)
    if (showTrails && trails) {
      for (const trail of Object.values(trails)) {
        for (const t of trail) {
          allX.push(t.absolute_strength)
          allY.push(t.relative_strength)
        }
      }
    }
    const maxAbs = Math.max(0.03, ...allX.map((v) => Math.abs(v)), ...allY.map((v) => Math.abs(v)))
    const pad = maxAbs * 0.18
    const lim = maxAbs + pad

    const base = baseOption(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 10 })

    const trailSeries = showTrails && trails
      ? Object.entries(trails).filter(([code]) => visible.has(code)).map(([code, points]) => {
          const row = rows.find((r) => r.code === code)
          const color = quadrantColor(row?.quadrant, isDark)
          const last = points[points.length - 1]
          const isSelected = selected === code
          const trailData = points.map((t) => ({
            value: [t.absolute_strength, t.relative_strength] as [number, number],
            code,
            date: t.date,
            quadrant: t.quadrant,
          }))
          const revealCount = isSelected
            ? Math.max(1, Math.min(reveal, trailData.length))
            : trailData.length
          const marker = isSelected
            ? points[Math.max(0, Math.min(revealCount - 1, points.length - 1))]
            : last
          return {
            type: 'line' as const,
            name: `${row?.name ?? code} trail`,
            data: isSelected ? trailData.slice(0, revealCount) : trailData,
            symbol: 'none',
            silent: false,
            animation: false,
            lineStyle: {
              width: isSelected ? 2.4 : watched.includes(code) ? 1.6 : 1,
              color,
              opacity: isSelected ? 0.88 : watched.includes(code) ? 0.42 : selected ? 0.14 : 0.24,
            },
            emphasis: { disabled: true },
            tooltip: isSelected
              ? {
                  show: true,
                  formatter: (params: unknown) => {
                    const d = params as { data?: { date?: string; value?: [number, number] } }
                    const point = d.data
                    if (!point?.value) return ''
                    return `<div style="min-width:150px"><b>${row?.name ?? code}</b><div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${p.muted};margin-bottom:6px">${point.date ?? ''}</div><div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Absolute</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(point.value[0])}</b></div><div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Relative</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(point.value[1])}</b></div></div>`
                  },
                }
              : { show: false },
            z: isSelected ? 4 : 1,
            markPoint:
              marker && row
                ? {
                    symbol: 'circle',
                    symbolSize: isSelected ? 7 : 4,
                    silent: true,
                    label: { show: false },
                    itemStyle: { color, opacity: isSelected ? 0.95 : 0.5 },
                    data: [{ coord: [marker.absolute_strength, marker.relative_strength] }],
                  }
                : undefined,
          }
        })
      : []

    // A short, mechanical reading of the last few sessions. The arrow shows
    // where the sector has been heading; the dashed extension is an
    // extrapolation of that direction, not a forecast.
    const direction = (trail: TrailPoint[] | undefined) => {
      if (!trail || trail.length < 2) return null
      const tail = trail.slice(-6)
      const first = tail[0]
      const last = tail[tail.length - 1]
      const steps = tail.length - 1
      const dx = (last.absolute_strength - first.absolute_strength) / steps
      const dy = (last.relative_strength - first.relative_strength) / steps
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null
      return { dx, dy, length: Math.hypot(dx, dy), last }
    }

    const directionData = showTrails && trails
      ? pts.flatMap((r) => {
          const dir = direction(trails[r.code])
          if (!dir) return []
          const offset = Math.min(Math.max(maxAbs * 0.02, 0.0015), dir.length * 0.9)
          const px = dir.last.absolute_strength + (dir.dx / dir.length) * offset
          const py = dir.last.relative_strength + (dir.dy / dir.length) * offset
          return [
            {
              name: r.name,
              value: [px, py] as [number, number],
              meta: r,
              symbolRotate: (Math.atan2(dir.dx, dir.dy) * 180) / Math.PI,
              symbolSize: selected === r.code ? 14 : 8,
              itemStyle: {
                color: quadrantColor(r.quadrant, isDark),
                opacity: selected && selected !== r.code ? 0.38 : 0.95,
              },
            },
          ]
        })
      : []

    const directionSeries = directionData.length
      ? [
          {
            type: 'scatter' as const,
            name: 'Recent direction',
            data: directionData,
            symbol: 'arrow',
            silent: true,
            z: 6,
            tooltip: { show: false },
            label: { show: false },
            emphasis: { disabled: true },
          },
        ]
      : []

    const selectedDirection = selectedTrail ? direction(selectedTrail) : null
    const projectionSeries =
      selected &&
      selectedDirection &&
      selectedTrail &&
      selectedTrail.length >= 3 &&
      reveal >= selectedTrail.length
        ? (() => {
            const row = rows.find((r) => r.code === selected)
            const color = quadrantColor(row?.quadrant, isDark)
            const steps = 3
            const end: [number, number] = [
              selectedDirection.last.absolute_strength + selectedDirection.dx * steps,
              selectedDirection.last.relative_strength + selectedDirection.dy * steps,
            ]
            return [
              {
                type: 'line' as const,
                name: 'Recent direction (extrapolation)',
                data: [
                  {
                    value: [
                      selectedDirection.last.absolute_strength,
                      selectedDirection.last.relative_strength,
                    ],
                    symbol: 'none',
                  },
                  { value: end, symbol: 'arrow', symbolSize: 10 },
                ],
                showSymbol: true,
                silent: true,
                animation: false,
                lineStyle: { width: 1.4, type: 'dashed' as const, color, opacity: 0.85 },
                itemStyle: { color },
                z: 4,
                tooltip: { show: false },
                emphasis: { disabled: true },
              },
            ]
          })()
        : []

    // Labels fan away from the crowded origin by quadrant so neighbouring
    // sectors in different quadrants do not stack on the same spot.
    const labelAnchor: Record<string, 'top' | 'bottom' | 'left' | 'right'> = {
      WINNING: 'right',
      ADVANCING: 'top',
      LOSING: 'bottom',
      LAGGING: 'left',
    }

    // Bubble size uses a square-root scale so area — not radius — is roughly
    // proportional to the metric. Sectors with no observation keep the neutral
    // radius and are called out in the tooltip rather than silently sized at 0.
    const metricValues = bubbleMetric === 'none'
      ? []
      : pts.map((r) => r[bubbleMetric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const metricMin = metricValues.length ? Math.min(...metricValues) : 0
    const metricMax = metricValues.length ? Math.max(...metricValues) : 0
    const bubbleSize = (r: RotationRow): number => {
      const neutral = compact ? 13 : 16
      if (bubbleMetric === 'none' || metricValues.length < 2 || metricMax === metricMin) return neutral
      const raw = r[bubbleMetric]
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return neutral
      const t = Math.sqrt(Math.min(1, Math.max(0, (raw - metricMin) / (metricMax - metricMin))))
      const base = 9 + t * 27
      return compact ? base - 3 : base
    }

    const scatterData = pts.map((r) => ({
      name: r.name,
      value: [r.absolute_strength, r.relative_strength],
      itemStyle: {
        color: quadrantColor(r.quadrant, isDark),
        borderColor: selected === r.code ? p.ink : watched.includes(r.code) ? p.accent : p.surface,
        borderWidth: selected === r.code ? 2.5 : watched.includes(r.code) ? 2 : 1.5,
        opacity: selected && selected !== r.code ? 0.45 : 1,
        shadowBlur: selected === r.code ? 14 : 0,
        shadowColor: quadrantColor(r.quadrant, isDark),
      },
      symbolSize: selected === r.code ? bubbleSize(r) + 5 : bubbleSize(r),
      label: { position: labelAnchor[r.quadrant ?? ''] ?? 'top', distance: 7 },
      meta: r,
    }))

    return {
      ...base,
      grid: {
        left: compact ? 34 : 52,
        right: compact ? 14 : 26,
        top: compact ? 22 : 34,
        bottom: compact ? 34 : 48,
      },
      // The quadrant cross is drawn as light-filled mark areas with the label
      // anchored inside each true quadrant of the plot grid. Positioning the
      // labels with the mark area (rather than a free-floating graphic) keeps
      // them aligned with the axes at every container size.
      legend: { show: false },
      // Wheel/pinch zoom and drag-pan are enabled on both axes together so the
      // quadrant cross stays a cross. Remounting the chart resets the view.
      dataZoom: compact
        ? []
        : [
            {
              type: 'inside',
              xAxisIndex: 0,
              yAxisIndex: 0,
              filterMode: 'none',
              zoomOnMouseWheel: true,
              moveOnMouseMove: true,
              moveOnMouseWheel: false,
              preventDefaultMouseMove: true,
            },
          ],
      xAxis: {
        type: 'value',
        min: -lim,
        max: lim,
        name: compact ? '' : 'Absolute strength  →',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: p.muted, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: {
          ...axis.axisLabel,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
          showMaxLabel: false,
        },
      },
      yAxis: {
        type: 'value',
        min: -lim,
        max: lim,
        name: compact ? '' : 'Relative strength vs NEPSE  ↑',
        nameLocation: 'middle',
        nameGap: compact ? 26 : 38,
        nameTextStyle: { color: p.muted, fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: {
          ...axis.axisLabel,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
          showMaxLabel: false,
        },
      },
      tooltip: {
        ...base.tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = (params as { data?: { meta?: RotationRow } }).data
          const r = d?.meta
          if (!r) return ''
          return `<div style="min-width:190px">
            <div style="font-weight:600;margin-bottom:2px">${r.name}</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${p.muted};text-transform:uppercase;letter-spacing:.08em">${r.quadrant ?? '—'}</div>
            <div style="height:1px;background:${p.line};margin:7px 0"></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">Absolute</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(r.absolute_strength)}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">Relative</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(r.relative_strength)}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">RS ratio</span><b style="font-family:'IBM Plex Mono',monospace">${r.rs_ratio?.toFixed(4) ?? '—'}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">20-session</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(r.return_20)}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">Volatility (252)</span><b style="font-family:'IBM Plex Mono',monospace">${r.volatility == null ? '—' : `${(r.volatility * 100).toFixed(1)}%`}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">Market cap</span><b style="font-family:'IBM Plex Mono',monospace">${npr(r.market_cap)}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">Turnover</span><b style="font-family:'IBM Plex Mono',monospace">${npr(r.turnover)}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">Advancing members</span><b style="font-family:'IBM Plex Mono',monospace">${r.advance_pct == null ? '—' : `${(r.advance_pct * 100).toFixed(0)}%`}${r.traded ? ` of ${r.traded}` : ''}</b></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:11px"><span style="color:${p.muted}">Turnover HHI</span><b style="font-family:'IBM Plex Mono',monospace">${r.hhi == null ? '—' : r.hhi.toFixed(3)}</b></div>
            <div style="height:1px;background:${p.line};margin:7px 0"></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:10px;color:${p.muted}"><span>Latest sector obs.</span><span style="font-family:'IBM Plex Mono',monospace">${r.latest_date ?? '—'}</span></div>
            <div style="display:flex;justify-content:space-between;gap:18px;font-size:10px;color:${p.muted}"><span>History · status</span><span style="font-family:'IBM Plex Mono',monospace">${r.observations} · ${r.status}</span></div>
          </div>`
        },
      },
      series: [
        ...trailSeries,
        ...projectionSeries,
        ...directionSeries,
        {
          type: 'scatter',
          name: 'Sectors',
          data: scatterData,
          emphasis: {
            scale: 1.25,
            itemStyle: { borderWidth: 2.5 },
            label: { show: true, formatter: (param: unknown) => (param as { name: string }).name },
          },
          labelLayout: { hideOverlap: true },
          label: {
            show: !compact,
            position: 'top',
            distance: 6,
            formatter: (param: unknown) => {
              const r = (param as { data?: { meta?: RotationRow } }).data?.meta
              if (!r) return ''
              const short: Record<string, string> = {
                BANKING: 'Banks',
                DEVBANK: 'Dev Banks',
                FINANCE: 'Finance',
                HOTELS: 'Hotels',
                HYDROPOWER: 'Hydro',
                INVESTMENT: 'Investment',
                LIFEINS: 'Life Ins.',
                MANUFACTURE: 'Manufacturing',
                MICROFINANCE: 'Microfinance',
                MUTUALFUND: 'Mutual Fund',
                NONLIFE: 'Non-Life',
                OTHERS: 'Others',
                TRADING: 'Trading',
              }
              return short[r.code] ?? r.name
            },
            color: p.muted,
            fontSize: 9,
            fontFamily: "'IBM Plex Sans', sans-serif",
            // A surface-coloured halo keeps the dense central labels legible
            // where points and trails overlap, without hiding any label.
            textBorderColor: p.surface,
            textBorderWidth: 2.5,
          },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            animation: false,
            lineStyle: { color: p.faint, width: 1, type: 'solid', opacity: 0.55 },
            label: { show: false },
            data: [{ xAxis: 0 }, { yAxis: 0 }],
          },
          markArea: {
            silent: true,
            animation: false,
            label: {
              show: true,
              color: p.faint,
              fontSize: compact ? 8 : 9,
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
            },
            data: [
              [
                {
                  coord: [0, 0],
                  name: 'Winning',
                  label: { position: 'insideTopRight' },
                  itemStyle: { color: isDark ? 'rgba(79,209,176,0.055)' : 'rgba(14,124,102,0.05)' },
                },
                { coord: [lim, lim] },
              ],
              [
                {
                  coord: [-lim, 0],
                  name: 'Advancing',
                  label: { position: 'insideTopLeft' },
                  itemStyle: { color: isDark ? 'rgba(122,179,232,0.045)' : 'rgba(44,93,143,0.04)' },
                },
                { coord: [0, lim] },
              ],
              [
                {
                  coord: [0, -lim],
                  name: 'Losing',
                  label: { position: 'insideBottomRight' },
                  itemStyle: { color: isDark ? 'rgba(232,176,106,0.045)' : 'rgba(176,106,20,0.04)' },
                },
                { coord: [lim, 0] },
              ],
              [
                {
                  coord: [-lim, -lim],
                  name: 'Lagging',
                  label: { position: 'insideBottomLeft' },
                  itemStyle: { color: isDark ? 'rgba(240,138,134,0.04)' : 'rgba(178,59,59,0.035)' },
                },
                { coord: [0, 0] },
              ],
            ],
          },
          z: 5,
        },
      ],
    } as unknown as EChartsOption
  }, [rows, trails, isDark, selected, showTrails, compact, bubbleMetric, watched, reveal, selectedTrail])

  const onEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const p = params as { data?: { meta?: RotationRow; code?: string } }
        const code = p.data?.meta?.code ?? p.data?.code
        if (code && onSelect) onSelect(code)
      },
    }),
    [onSelect],
  )

  return (
    <div className="relative">
      <Chart option={option} height={height} onEvents={onEvents} exportName={exportName} reserveTools />
      {!compact && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] text-muted">
          {QUADRANT_LABELS.map((q) => (
            <span key={q.key} className="inline-flex items-center gap-1.5">
              <span
                className={cn('h-2 w-2 rounded-full')}
                style={{ backgroundColor: quadrantColor(q.key, isDark) }}
              />
              {q.label}
            </span>
          ))}
          <span className="text-faint">· x = absolute, y = relative to NEPSE</span>
        </div>
      )}
    </div>
  )
}
