import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import type { EChartsOption } from 'echarts'
import { echarts } from '../lib/echarts'
import { useTheme } from '../lib/useTheme'
import { palette } from '../lib/chart'
import { downloadChartPng } from '../lib/export'

export function Chart({
  option,
  height = 300,
  className,
  onEvents,
  exportName,
}: {
  option: EChartsOption
  height?: number | string
  className?: string
  onEvents?: Record<string, (params: unknown) => void>
  /** When set, a PNG export control appears in the chart's top-right corner. */
  exportName?: string
}) {
  const { isDark } = useTheme()
  const ref = useRef<ReactEChartsCore>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [exported, setExported] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.getEchartsInstance().resize(), 120)
    return () => window.clearTimeout(t)
  }, [isDark, option])

  return (
    <div ref={wrap} className="chart-frame relative" role="img" aria-label={exportName ? `${exportName} chart` : 'Chart'}>
      <div className={className} style={{ height }} data-theme={isDark ? 'dark' : 'light'}>
        <ReactEChartsCore
          echarts={echarts}
          ref={ref}
          option={option}
          notMerge
          lazyUpdate
          style={{ height: '100%', width: '100%' }}
          onEvents={onEvents}
          opts={{ renderer: 'canvas' }}
        />
      </div>
      {exportName && (
        <button
          type="button"
          className="chart-export"
          title="Export chart as PNG"
          aria-label={`Export ${exportName} as PNG`}
          onClick={() => {
            const bg = palette(isDark).surface
            const ok = downloadChartPng(wrap.current, exportName, bg)
            if (ok) {
              setExported(true)
              window.setTimeout(() => setExported(false), 1200)
            }
          }}
        >
          <Download size={12} />
          <span>{exported ? 'Saved' : 'PNG'}</span>
        </button>
      )}
    </div>
  )
}
