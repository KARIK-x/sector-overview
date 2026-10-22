import type { EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { Chart } from './Chart'
import type { RotationHistorySeries } from '../lib/api'
import { axisStyle, baseOption, palette, seriesColors } from '../lib/chart'
import { useTheme } from '../lib/useTheme'
import { cn, dateLabel, dateTick, needsYear, signedPct } from '../lib/format'

export type TimelineMode = 'rank' | 'relative'

/**
 * Leadership timeline. In rank mode the y axis is inverted so the strongest
 * sector sits at the top; gaps mean the sector had no observation that session
 * and are drawn as breaks, never interpolated.
 */
export function RankTimeline({
  dates,
  series,
  selected,
  mode = 'rank',
  height = 360,
  onSelect,
  exportName,
}: {
  dates: string[]
  series: RotationHistorySeries[]
  selected?: string | null
  mode?: TimelineMode
  height?: number
  onSelect?: (code: string) => void
  exportName?: string
}) {
  const { isDark } = useTheme()
  const option = useMemo<EChartsOption>(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const colors = seriesColors(isDark)
    const maxRank = Math.max(
      2,
      ...series.flatMap((s) => s.rank.filter((v): v is number => typeof v === 'number')),
    )
    const base = baseOption(isDark)
    return {
      ...base,
      animation: false,
      grid: { left: 58, right: 74, top: 16, bottom: 34 },
      legend: { show: false },
      tooltip: {
        ...base.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: p.faint, width: 1, opacity: 0.6 } },
        extraCssText:
          'border-radius:10px; box-shadow:0 10px 30px -12px rgba(0,0,0,0.28); max-height:300px; overflow:auto;',
        formatter: (params: unknown) => {
          const items = (
            params as Array<{ axisValue: string; seriesName: string; value: number | null; color: string }>
          )
            .filter((i): i is { axisValue: string; seriesName: string; value: number; color: string } =>
              typeof i.value === 'number' && Number.isFinite(i.value),
            )
            .sort((a, b) => (mode === 'rank' ? a.value - b.value : b.value - a.value))
          if (!items.length) return ''
          const head = `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${p.muted};margin-bottom:6px">${dateLabel(items[0].axisValue)}</div>`
          const rows = items
            .map(
              (i, index) => `<div style="display:flex;gap:10px;align-items:center;font-size:11px;line-height:1.65">
                <span style="width:14px;color:${p.faint};font-family:'IBM Plex Mono',monospace">${mode === 'rank' ? index + 1 : ''}</span>
                <span style="width:6px;height:6px;border-radius:2px;background:${i.color}"></span>
                <span style="flex:1;white-space:nowrap">${i.seriesName}</span>
                <b style="font-family:'IBM Plex Mono',monospace">${
                  mode === 'rank'
                    ? `#${i.value}`
                    : signedPct(i.value)
                }</b>
              </div>`,
            )
            .join('')
          return head + rows
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        ...axis,
        axisLabel: {
          ...axis.axisLabel,
          formatter: (v: string) => dateTick(v, needsYear(dates)),
          hideOverlap: true,
          showMaxLabel: false,
          // With 120 sessions ECharts' auto interval still emits too many
          // ticks once the labels include a month name. Pin roughly ten.
          interval: Math.max(0, Math.ceil(dates.length / 8) - 1),
        },
      },
      yAxis:
        mode === 'rank'
          ? {
              type: 'value',
              inverse: true,
              min: 1,
              max: maxRank,
              interval: 1,
              ...axis,
              axisLabel: { ...axis.axisLabel, formatter: (v: number) => `#${v}` },
              splitLine: { lineStyle: { color: p.grid, type: 'dashed' as const } },
            }
          : {
              type: 'value',
              ...axis,
              axisLabel: {
                ...axis.axisLabel,
                formatter: (v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`,
              },
              splitLine: { lineStyle: { color: p.grid, type: 'dashed' as const } },
            },
      series: series.map((s, i) => {
        const isSelected = s.code === selected
        const color = isSelected ? p.accent : colors[i % colors.length]
        return {
          name: s.name,
          type: 'line' as const,
          data: mode === 'rank' ? s.rank : s.relative,
          connectNulls: false,
          showSymbol: false,
          smooth: false,
          animation: false,
          lineStyle: isSelected
            ? { width: 2.6, color, opacity: 1 }
            : { width: 1.15, color, opacity: selected ? 0.24 : 0.5 },
          itemStyle: { color },
          emphasis: { focus: 'series' as const, lineStyle: { width: 2.4, opacity: 1 } },
          endLabel: isSelected
            ? {
                show: true,
                formatter: s.name.replace('Manufacturing And Processing', 'Manufacturing').replace('Non Life Insurance', 'Non-Life'),
                color,
                fontSize: 9,
                fontFamily: "'IBM Plex Sans', sans-serif",
                distance: 4,
              }
            : { show: false },
          z: isSelected ? 12 : 2,
          meta: { code: s.code },
        }
      }),
    } as unknown as EChartsOption
  }, [dates, series, selected, mode, isDark])

  const onEvents = useMemo(
    () => ({
      click: (params: unknown) => {
        const meta = (params as { data?: { meta?: { code: string } } }).data?.meta
        if (meta?.code && onSelect) onSelect(meta.code)
      },
    }),
    [onSelect],
  )

  return (
    <div>
      <Chart option={option} height={height} onEvents={onEvents} exportName={exportName} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
        <span>
          {mode === 'rank'
            ? 'Grey lines are every sector’s rank; click a line to isolate it. Breaks are sessions without an observation.'
            : 'Excess return is sector return minus NEPSE over the same lookback, computed on each sector’s own dates.'}
        </span>
        {selected && (
          <span className={cn('inline-flex items-center gap-1.5 font-mono uppercase tracking-wider')}>
            <span className="h-2 w-2 rounded-full bg-accent" />
            isolated
          </span>
        )}
      </div>
    </div>
  )
}
