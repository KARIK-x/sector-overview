import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { Chart } from './Chart'
import type { RotationRow, TrailPoint } from '../lib/api'
import { axisStyle, baseOption, palette, quadrantColor } from '../lib/chart'
import { useTheme } from '../lib/useTheme'
import { cn, signedPct } from '../lib/format'

const QUADRANT_LABELS: Array<{ key: string; label: string; pos: 'tl' | 'tr' | 'bl' | 'br' }> = [
  { key: 'ADVANCING', label: 'Advancing', pos: 'tl' },
  { key: 'WINNING', label: 'Winning', pos: 'tr' },
  { key: 'LAGGING', label: 'Lagging', pos: 'bl' },
  { key: 'LOSING', label: 'Losing', pos: 'br' },
]

export function RotationQuadrant({
  rows,
  trails,
  height = 520,
  showTrails = true,
  selected,
  onSelect,
  compact = false,
}: {
  rows: RotationRow[]
  trails?: Record<string, TrailPoint[]>
  height?: number
  showTrails?: boolean
  selected?: string | null
  onSelect?: (code: string) => void
  compact?: boolean
}) {
  const { isDark } = useTheme()

  const option = useMemo<EChartsOption>(() => {
    const p = palette(isDark)
    const pts = rows.filter((r) => r.absolute_strength !== null && r.relative_strength !== null)
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
      ? Object.entries(trails).map(([code, points]) => {
          const row = rows.find((r) => r.code === code)
          const color = quadrantColor(row?.quadrant, isDark)
          const last = points[points.length - 1]
          return {
            type: 'line' as const,
            name: `${row?.name ?? code} trail`,
            data: points.map((t) => [t.absolute_strength, t.relative_strength]),
            symbol: 'none',
            silent: true,
            animation: false,
            lineStyle: { width: 1.25, color, opacity: 0.42 },
            emphasis: { disabled: true },
            tooltip: { show: false },
            z: 1,
            markPoint:
              last && row
                ? {
                    symbol: 'circle',
                    symbolSize: 4,
                    silent: true,
                    label: { show: false },
                    itemStyle: { color, opacity: 0.5 },
                    data: [{ coord: [last.absolute_strength, last.relative_strength] }],
                  }
                : undefined,
          }
        })
      : []

    // Labels fan away from the crowded origin by quadrant so neighbouring
    // sectors in different quadrants do not stack on the same spot.
    const labelAnchor: Record<string, 'top' | 'bottom' | 'left' | 'right'> = {
      WINNING: 'right',
      ADVANCING: 'top',
      LOSING: 'bottom',
      LAGGING: 'left',
    }

    const scatterData = pts.map((r) => ({
      name: r.name,
      value: [r.absolute_strength, r.relative_strength],
      itemStyle: {
        color: quadrantColor(r.quadrant, isDark),
        borderColor: p.surface,
        borderWidth: selected === r.code ? 2.5 : 1.5,
        opacity: selected && selected !== r.code ? 0.45 : 1,
        shadowBlur: selected === r.code ? 14 : 0,
        shadowColor: quadrantColor(r.quadrant, isDark),
      },
      symbolSize: compact ? 13 : selected === r.code ? 21 : 16,
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
        name: compact ? '' : 'Relative strength vs NEPSE  →',
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
          </div>`
        },
      },
      series: [
        ...trailSeries,
        {
          type: 'scatter',
          name: 'Sectors',
          data: scatterData,
          emphasis: {
            scale: 1.25,
            itemStyle: { borderWidth: 2.5 },
            label: { show: true, formatter: (param: unknown) => (param as { name: string }).name },
          },
          label: {
            show: !compact,
            position: 'top',
            distance: 6,
            formatter: (param: unknown) => {
              const r = (param as { data?: { meta?: RotationRow } }).data?.meta
              return r ? r.name.replace('Manufacturing And Processing', 'Manufacturing').replace('Non Life Insurance', 'Non-Life') : ''
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
  }, [rows, trails, isDark, selected, showTrails, compact])

  const onEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const p = params as { data?: { meta?: RotationRow } }
        if (p.data?.meta && onSelect) onSelect(p.data.meta.code)
      },
    }),
    [onSelect],
  )

  return (
    <div className="relative">
      <Chart option={option} height={height} onEvents={onEvents} />
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
