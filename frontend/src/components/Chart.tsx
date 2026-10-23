import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Maximize2, Minimize2, RotateCcw } from 'lucide-react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import type { EChartsOption } from 'echarts'
import { echarts } from '../lib/echarts'
import { useTheme } from '../lib/useTheme'
import { palette } from '../lib/chart'
import { downloadChartPng } from '../lib/export'

const RANGE_OPTIONS: Array<{ value: string; label: string; months: number }> = [
  { value: 'ALL', label: 'All', months: 0 },
  { value: '5Y', label: '5Y', months: 60 },
  { value: '3Y', label: '3Y', months: 36 },
  { value: '1Y', label: '1Y', months: 12 },
  { value: '6M', label: '6M', months: 6 },
  { value: '3M', label: '3M', months: 3 },
  { value: '1M', label: '1M', months: 1 },
]

/** Shift an ISO date back by whole months, clamping to the end of short months. */
function shiftIso(iso: string, months: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const day = d.getDate()
  d.setMonth(d.getMonth() - months)
  if (d.getDate() < day) d.setDate(0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function categoryDates(option: EChartsOption): string[] | null {
  const raw = (option as { xAxis?: unknown }).xAxis
  const axis = (Array.isArray(raw) ? raw[0] : raw) as
    | { type?: string; data?: unknown[] }
    | undefined
  // A handful of points is a trail, not a period; only offer date ranges when
  // there is enough history for the presets to mean something.
  if (!axis || axis.type !== 'category' || !Array.isArray(axis.data) || axis.data.length < 30) {
    return null
  }
  const data = axis.data
  if (!data.every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))) return null
  return data as string[]
}

/**
 * Shared chart frame.
 *
 * Every chart gets the same interaction contract:
 * - wheel / pinch zoom and drag-pan on the time axis,
 * - a period selector for date-based axes, revealed on hover or keyboard focus,
 * - reset-zoom and true full-screen controls,
 * - optional PNG export.
 *
 * The controls are additive; a page can still supply its own `dataZoom` and
 * `onEvents` without losing anything.
 */
export function Chart({
  option,
  height = 300,
  className,
  onEvents,
  exportName,
  reserveTools = false,
}: {
  option: EChartsOption
  height?: number | string
  className?: string
  onEvents?: Record<string, (params: unknown) => void>
  /** When set, a PNG export control appears in the chart's top-right corner. */
  exportName?: string
  /** Reserve a slim strip above the canvas so controls never cover axis labels (e.g. heatmaps). */
  reserveTools?: boolean
}) {
  const { isDark } = useTheme()
  const ref = useRef<ReactEChartsCore>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [exported, setExported] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // Browsers that do not implement Element.requestFullscreen (notably iPhone
  // Safari) still get a full-viewport chart through this CSS fallback.
  const [fallbackFs, setFallbackFs] = useState(false)
  const isFullscreen = fullscreen || fallbackFs
  const [range, setRange] = useState('ALL')
  // Kept in a ref so the chart can restore the visible window after ECharts
  // receives a fresh option without making the effect depend on its own state.
  const rangeRef = useRef(range)

  useEffect(() => {
    rangeRef.current = range
  }, [range])

  const baseOption = option as EChartsOption & { dataZoom?: unknown; xAxis?: unknown }
  const canZoom = Boolean(baseOption.dataZoom || baseOption.xAxis)

  const zoomedOption = useMemo(() => {
    const base = option as EChartsOption & { dataZoom?: unknown; xAxis?: unknown }
    // Pie/donut charts have no axis to zoom; leave them untouched.
    if (base.dataZoom || !base.xAxis) return option
    return {
      ...option,
      dataZoom: [
        {
          type: 'inside',
          zoomOnMouseWheel: 'shift',
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          preventDefaultMouseMove: false,
        },
      ],
    } as EChartsOption
  }, [option])

  const timeDates = useMemo(() => categoryDates(option), [option])
  const span = timeDates ? `${timeDates[0]}|${timeDates[timeDates.length - 1]}` : ''

  useEffect(() => {
    const onChange = () => {
      setFullscreen(document.fullscreenElement === wrap.current)
      // The browser resizes the element after the fullscreen transition.
      window.setTimeout(() => ref.current?.getEchartsInstance().resize(), 180)
    }
    const onResize = () => ref.current?.getEchartsInstance().resize()
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => ref.current?.getEchartsInstance().resize(), 120)
    return () => window.clearTimeout(t)
  }, [isDark, option, isFullscreen])

  // Escape closes the CSS fallback and the page must not scroll behind it.
  useEffect(() => {
    if (!fallbackFs) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFallbackFs(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [fallbackFs])

  // A new date span is a new dataset: start from the full view rather than
  // leaving the previous percentage window applied to unrelated dates.
  useEffect(() => {
    rangeRef.current = 'ALL'
    setRange('ALL')
  }, [span])

  const resetZoom = () => {
    setRange('ALL')
    ref.current?.getEchartsInstance().dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 0,
      start: 0,
      end: 100,
    })
  }

  const applyRange = (value: string) => {
    setRange(value)
    const inst = ref.current?.getEchartsInstance()
    if (!inst) return
    const opt = RANGE_OPTIONS.find((r) => r.value === value)
    if (!timeDates || !opt || opt.months === 0) {
      inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 })
      return
    }
    const cutoff = shiftIso(timeDates[timeDates.length - 1], opt.months)
    let index = timeDates.findIndex((d) => d.slice(0, 10) >= cutoff)
    if (index < 0) index = 0
    const start = timeDates.length > 1 ? (index / (timeDates.length - 1)) * 100 : 0
    inst.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, start, end: 100 })
  }

  // Replacing the option (hiding a series, switching the theme, refetching)
  // gives ECharts a full-width dataZoom. Restore the user's chosen window once
  // the new option has been applied, so the selector and the canvas agree.
  useEffect(() => {
    if (rangeRef.current === 'ALL' || !timeDates) return
    const t = window.setTimeout(() => applyRange(rangeRef.current), 0)
    return () => window.clearTimeout(t)
  }, [option, timeDates, fallbackFs])

  const toggleFullscreen = () => {
    if (document.fullscreenElement === wrap.current) {
      void document.exitFullscreen()
      return
    }
    if (fallbackFs) {
      setFallbackFs(false)
      return
    }
    const el = wrap.current
    if (!el?.requestFullscreen) {
      setFallbackFs(true)
      return
    }
    void Promise.resolve(el.requestFullscreen()).catch(() => setFallbackFs(true))
  }

  const frame = (
    <div
      ref={wrap}
      className={`chart-frame${fallbackFs ? ' chart-frame-faux-fullscreen' : ' relative'}${
        reserveTools ? ' chart-frame-reserve-tools' : ''
      }`}
    >
      <div
        className={className}
        style={{ height: isFullscreen ? '100%' : height }}
        data-theme={isDark ? 'dark' : 'light'}
        role="img"
        aria-label={exportName ? `${exportName} chart` : 'Chart'}
      >
        <ReactEChartsCore
          echarts={echarts}
          ref={ref}
          option={zoomedOption}
          notMerge
          lazyUpdate
          style={{ height: '100%', width: '100%' }}
          onEvents={onEvents}
          opts={{ renderer: 'canvas' }}
        />
      </div>
      <div className="chart-tools">
        {timeDates && (
          <label className="chart-tool chart-range">
            <span className="sr-only">Visible period</span>
            <select
              value={range}
              onChange={(e) => applyRange(e.target.value)}
              aria-label="Visible period"
              title="Limit the visible date window"
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {canZoom && (
          <button
            type="button"
            className="chart-tool"
            title="Reset zoom"
            aria-label="Reset chart zoom"
            onClick={resetZoom}
          >
            <RotateCcw size={12} />
          </button>
        )}
        <button
          type="button"
          className="chart-tool"
          title={isFullscreen ? 'Exit full screen' : 'Expand full screen'}
          aria-label={isFullscreen ? 'Exit full screen' : 'Expand chart full screen'}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
        {exportName && (
          <button
            type="button"
            className="chart-tool"
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
    </div>
  )

  // The fallback covers the app, not just its card, and must sit above the
  // sidebar/header stacking contexts. Portalling to <body> does that without
  // touching the layout tree.
  return fallbackFs && typeof document !== 'undefined'
    ? createPortal(frame, document.body)
    : frame
}
