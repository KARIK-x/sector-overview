import { useEffect, useRef } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import type { EChartsOption } from 'echarts'
import { echarts } from '../lib/echarts'
import { useTheme } from '../lib/useTheme'

export function Chart({
  option,
  height = 300,
  className,
  onEvents,
}: {
  option: EChartsOption
  height?: number | string
  className?: string
  onEvents?: Record<string, (params: unknown) => void>
}) {
  const { isDark } = useTheme()
  const ref = useRef<ReactEChartsCore>(null)

  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.getEchartsInstance().resize(), 120)
    return () => window.clearTimeout(t)
  }, [isDark, option])

  return (
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
  )
}
