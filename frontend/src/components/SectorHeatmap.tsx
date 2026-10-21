import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { Chart } from './Chart'
import type { HeatmapPayload } from '../lib/api'
import { axisStyle, baseOption, heatColor, palette } from '../lib/chart'
import { useTheme } from '../lib/useTheme'
import { signedPct } from '../lib/format'

export function SectorHeatmap({
  data,
  height = 460,
  onSelect,
}: {
  data: HeatmapPayload
  height?: number
  onSelect?: (code: string) => void
}) {
  const { isDark } = useTheme()
  const rows = useMemo(
    () => [...data.rows].sort((a, b) => (Number(b.r20) || -99) - (Number(a.r20) || -99)),
    [data.rows],
  )

  const option = useMemo<EChartsOption>(() => {
    const p = palette(isDark)
    const base = baseOption(isDark)
    const axis = axisStyle(isDark, { split: false, labelSize: 10 })
    const horizons = data.horizons
    const maxAbs = Math.max(
      0.02,
      ...rows.flatMap((r) => horizons.map((h) => Math.abs(Number(r[`r${h}`]) || 0))),
    )
    const cells: Array<{
      value: [number, number, number | null]
      itemStyle: { color: string; borderColor: string; borderWidth: number }
      label: { color: string }
    }> = []
    rows.forEach((row, y) => {
      horizons.forEach((h, x) => {
        const v = row[`r${h}`] as number | null
        cells.push({
          value: [x, y, v],
          itemStyle: {
            color: heatColor(v, maxAbs, isDark),
            borderColor: p.paper,
            borderWidth: 2,
          },
          label: {
            color: Math.abs(Number(v) || 0) > maxAbs * 0.45 ? (isDark ? '#07100d' : '#fffdf8') : p.ink,
          },
        })
      })
    })

    return {
      ...base,
      grid: { left: 8, right: 18, top: 24, bottom: 30, containLabel: true },
      tooltip: {
        ...base.tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = (params as { data?: { value?: [number, number, number] } }).data
          if (!d?.value) return ''
          const [x, y, v] = d.value
          const row = rows[y]
          const horizon = horizons[x]
          return `<div style="min-width:170px">
            <div style="font-weight:600">${row?.name ?? ''}</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${p.muted};margin-top:2px">${horizon}-SESSION RETURN</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:15px;margin-top:5px">${signedPct(v, 2)}</div>
            <div style="font-size:10px;color:${p.muted};margin-top:4px">Click to open sector</div>
          </div>`
        },
      },
      xAxis: {
        type: 'category',
        data: horizons.map((h) => (h === 1 ? '1D' : `${h}D`)),
        position: 'top',
        ...axis,
        axisLine: { show: false },
        axisLabel: { ...axis.axisLabel, color: p.muted, fontSize: 9 },
      },
      yAxis: {
        type: 'category',
        data: rows.map((r) => r.name),
        inverse: true,
        ...axis,
        axisLine: { show: false },
        axisLabel: {
          ...axis.axisLabel,
          color: p.ink,
          fontSize: 10,
          fontFamily: "'IBM Plex Sans', sans-serif",
          width: 150,
          overflow: 'truncate',
        },
      },
      visualMap: { show: false, min: -maxAbs, max: maxAbs },
      series: [
        {
          type: 'heatmap',
          data: cells,
          label: {
            show: true,
            fontSize: 9,
            fontFamily: "'IBM Plex Mono', monospace",
            formatter: (params: unknown) => {
              const v = (params as { data?: { value?: [number, number, number] } }).data?.value?.[2]
              if (v === null || v === undefined) return '—'
              return `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}`
            },
          },
          emphasis: {
            itemStyle: { borderColor: p.ink, borderWidth: 1.5 },
          },
          itemStyle: { borderRadius: 3 },
        },
      ],
    } as unknown as EChartsOption
  }, [rows, data.horizons, isDark])

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        <Chart
          option={option}
          height={height}
          onEvents={{
            click: (params: unknown) => {
              const d = (params as { data?: { value?: [number, number, number] } }).data
              if (!d?.value || !onSelect) return
              const row = rows[d.value[1]]
              if (row) onSelect(row.code)
            },
          }}
        />
      </div>
    </div>
  )
}
