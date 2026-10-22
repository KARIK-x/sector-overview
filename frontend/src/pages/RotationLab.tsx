import type { EChartsOption } from 'echarts'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Download, Eye, RotateCcw, SlidersHorizontal, Star } from 'lucide-react'
import { api } from '../lib/api'
import type { RotationRow, TrailPoint } from '../lib/api'
import { BUBBLE_METRICS, RotationQuadrant } from '../components/RotationQuadrant'
import type { BubbleMetric } from '../components/RotationQuadrant'
import { RankTimeline } from '../components/RankTimeline'
import type { TimelineMode } from '../components/RankTimeline'
import { Chart } from '../components/Chart'
import {
  Card,
  CardHeader,
  ErrorState,
  InfoNote,
  Loading,
  Metric,
  PageHeader,
  QuadrantBadge,
  Segmented,
  StatusBadge,
} from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette, quadrantColor } from '../lib/chart'
import { cn, dateLabel, dateTick, needsYear, npr, pct, signedPct, toneClass } from '../lib/format'
import { downloadCsv } from '../lib/export'

const WINDOWS = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 60, label: '60' },
  { value: 120, label: '120' },
]

const TRAILS = [
  { value: 0, label: 'Off' },
  { value: 10, label: '10' },
  { value: 25, label: '25' },
  { value: 50, label: '50' },
]

type SortKey =
  | 'name'
  | 'absolute_strength'
  | 'relative_strength'
  | 'rs_ratio'
  | 'return_20'
  | 'momentum_change'
  | 'market_cap'
  | 'volatility'
  | 'advance_pct'

function SelectedSector({ row, trail }: { row: RotationRow; trail?: TrailPoint[] }) {
  const { isDark } = useTheme()
  const option = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 8 })
    const pts = trail ?? []
    return {
      ...baseOption(isDark),
      grid: { left: 38, right: 12, top: 18, bottom: 28 },
      legend: { ...baseOption(isDark).legend, top: -2, right: 0, itemWidth: 7, itemHeight: 7 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—'),
      },
      xAxis: {
        type: 'category',
        data: pts.map((p) => p.date),
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateTick(v, needsYear(pts.map((p) => p.date))), hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      },
      series: [
        {
          name: 'Absolute',
          type: 'line',
          data: pts.map((p) => p.absolute_strength),
          showSymbol: false,
          lineStyle: { width: 1.5, color: p.accent },
          itemStyle: { color: p.accent },
        },
        {
          name: 'Relative',
          type: 'line',
          data: pts.map((p) => p.relative_strength),
          showSymbol: false,
          lineStyle: { width: 1.5, color: isDark ? '#e8b06a' : '#b06a14', type: 'dashed' },
          itemStyle: { color: isDark ? '#e8b06a' : '#b06a14' },
        },
      ],
    } as unknown as EChartsOption
  }, [trail, isDark])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="eyebrow mb-1">Selected sector</div>
          <h3 className="display text-[26px] leading-tight">{row.name}</h3>
        </div>
        <QuadrantBadge quadrant={row.quadrant} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Metric label="Absolute" value={signedPct(row.absolute_strength)} tone={row.absolute_strength && row.absolute_strength > 0 ? 'pos' : 'neg'} />
        <Metric label="Relative" value={signedPct(row.relative_strength)} tone={row.relative_strength && row.relative_strength > 0 ? 'pos' : 'neg'} />
      </div>
      <div className="mt-3">
        <Chart option={option} height={150} exportName="rotation-selected-trail" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 border-t pt-3 text-[10px]">
        <div>
          <div className="eyebrow mb-0.5">RS ratio</div>
          <div className="num text-[12px]">{row.rs_ratio?.toFixed(4) ?? '—'}</div>
        </div>
        <div>
          <div className="eyebrow mb-0.5">20D</div>
          <div className={cn('num text-[12px]', toneClass(row.return_20))}>{signedPct(row.return_20)}</div>
        </div>
        <div>
          <div className="eyebrow mb-0.5">Momentum</div>
          <div className="text-[10px] font-medium">{row.momentum_direction ?? '—'}</div>
        </div>
        <div>
          <div className="eyebrow mb-0.5">Volatility</div>
          <div className="num text-[12px]">{pct(row.volatility)}</div>
        </div>
        <div>
          <div className="eyebrow mb-0.5">Market cap</div>
          <div className="num text-[12px]">{npr(row.market_cap)}</div>
        </div>
        <div>
          <div className="eyebrow mb-0.5">Adv. members</div>
          <div className="num text-[12px]">
            {row.advance_pct == null ? '—' : pct(row.advance_pct, 0)}
            {row.traded ? <span className="text-faint"> / {row.traded}</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted">
        <span>Turnover {npr(row.turnover)}</span>
        <span>HHI {row.hhi?.toFixed(3) ?? '—'}</span>
      </div>
      <Link to={`/sectors?code=${row.code}`} className="mt-auto inline-flex items-center gap-1 pt-3 text-[11px] text-accent hover:underline">
        Open full sector <ArrowUpRight size={12} />
      </Link>
    </div>
  )
}


function classifyQuadrant(abs: number | null, rel: number | null, absThr: number, relThr: number): string | null {
  if (abs === null || rel === null) return null
  if (abs > absThr && rel > relThr) return 'WINNING'
  if (abs <= absThr && rel > relThr) return 'ADVANCING'
  if (abs > absThr && rel <= relThr) return 'LOSING'
  return 'LAGGING'
}

function HistoricalPosition({
  code,
  history,
  absThreshold,
  relThreshold,
}: {
  code: string
  history: { dates: string[]; series: Array<{ code: string; absolute: Array<number | null>; relative: Array<number | null> }> }
  absThreshold: number
  relThreshold: number
}) {
  const series = history.series.find((s) => s.code === code)
  const maxIndex = Math.max(0, history.dates.length - 1)
  const [index, setIndex] = useState(maxIndex)
  const [playing, setPlaying] = useState(false)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    setIndex(maxIndex)
  }, [maxIndex, code])

  useEffect(() => {
    if (!playing || reducedMotion) return
    const timer = window.setInterval(() => {
      setIndex((v) => (v >= maxIndex ? maxIndex : v + 1))
    }, 700)
    return () => window.clearInterval(timer)
  }, [playing, maxIndex, reducedMotion])

  useEffect(() => {
    if (index >= maxIndex) setPlaying(false)
  }, [index, maxIndex])

  const abs = series?.absolute[index] ?? null
  const rel = series?.relative[index] ?? null
  const quadrant = classifyQuadrant(abs, rel, absThreshold, relThreshold)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={() => setPlaying((v) => !v)} disabled={reducedMotion}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn" onClick={() => setIndex((v) => Math.max(0, v - 1))}>Step back</button>
        <button className="btn" onClick={() => setIndex((v) => Math.min(maxIndex, v + 1))}>Step forward</button>
        <button className="btn" onClick={() => setIndex(maxIndex)}>Latest</button>
        <span className="num text-[10px] text-muted">{history.dates[index] ?? '—'}</span>
      </div>
      <input
        type="range"
        min={0}
        max={maxIndex}
        step={1}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
        aria-label="Historical rotation snapshot"
      />
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Absolute" value={abs == null ? '—' : signedPct(abs)} tone={abs && abs > 0 ? 'pos' : 'neg'} />
        <Metric label="Relative" value={rel == null ? '—' : signedPct(rel)} tone={rel && rel > 0 ? 'pos' : 'neg'} />
        <div>
          <div className="eyebrow mb-1.5">Quadrant</div>
          <QuadrantBadge quadrant={quadrant} />
        </div>
      </div>
      <p className="text-[10px] leading-relaxed text-muted">
        Historical values are stored observations for the selected lookback. Playback advances through
        recorded sessions only; it does not interpolate or stream live data.
        {reducedMotion ? ' Automatic playback is disabled because reduced motion is requested.' : ''}
      </p>
    </div>
  )
}

export default function RotationLab() {
  const [window, setWindow] = useState(() => {
    const raw = localStorage.getItem('nsi-pref-lookback')
    const v = raw ? Number(raw) : 20
    return [5, 10, 20, 60, 120].includes(v) ? v : 20
  })
  const [trailSessions, setTrailSessions] = useState(() => {
    const raw = localStorage.getItem('nsi-pref-trail')
    const v = raw ? Number(raw) : 10
    return [0, 10, 25, 50].includes(v) ? v : 10
  })
  const [absThr, setAbsThr] = useState(0)
  const [relThr, setRelThr] = useState(0)
  const [selected, setSelected] = useState<string | null>('BANKING')
  const [sortKey, setSortKey] = useState<SortKey>('relative_strength')
  const [asc, setAsc] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [bubbleMetric, setBubbleMetric] = useState<BubbleMetric>(() => {
    const raw = localStorage.getItem('nsi-pref-bubble')
    return (['none', 'market_cap', 'turnover', 'volatility', 'advance_pct'] as BubbleMetric[]).includes(raw as BubbleMetric)
      ? (raw as BubbleMetric)
      : 'none'
  })
  const [historyMode, setHistoryMode] = useState<TimelineMode>('rank')
  const [showSectorFilter, setShowSectorFilter] = useState(false)
  const [hiddenCodes, setHiddenCodes] = useState<string[]>([])
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('nsi-watchlist')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  })
  const [zoomKey, setZoomKey] = useState(0)

  useEffect(() => localStorage.setItem('nsi-pref-lookback', String(window)), [window])
  useEffect(() => localStorage.setItem('nsi-pref-trail', String(trailSessions)), [trailSessions])
  useEffect(() => localStorage.setItem('nsi-pref-bubble', bubbleMetric), [bubbleMetric])
  useEffect(() => localStorage.setItem('nsi-watchlist', JSON.stringify(watchlist)), [watchlist])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rotation', window, absThr, relThr],
    queryFn: ({ signal }) => api.rotation(window, absThr, relThr, signal),
  })
  const { data: trailData } = useQuery({
    queryKey: ['trails', window, trailSessions],
    queryFn: ({ signal }) => api.trails(window, trailSessions, signal),
    enabled: trailSessions > 0,
  })
  const { data: history } = useQuery({
    queryKey: ['rotation-history', window],
    queryFn: ({ signal }) => api.rotationHistory(window, 120, signal),
  })

  const rows = data?.rows ?? []
  const selectedRow = selected ? rows.find((r) => r.code === selected) : undefined
  const visibleRows = useMemo(
    () => rows.filter((r) => !hiddenCodes.includes(r.code) && (!watchlistOnly || watchlist.includes(r.code))),
    [rows, hiddenCodes, watchlist, watchlistOnly],
  )
  const historySeries = useMemo(
    () => (history?.series ?? []).filter((s) => !hiddenCodes.includes(s.code) && (!watchlistOnly || watchlist.includes(s.code))),
    [history, hiddenCodes, watchlist, watchlistOnly],
  )

  const groups = useMemo(() => {
    const g: Record<string, RotationRow[]> = { WINNING: [], ADVANCING: [], LOSING: [], LAGGING: [] }
    for (const r of visibleRows) if (r.quadrant) g[r.quadrant].push(r)
    return g
  }, [visibleRows])

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' || typeof bv === 'string') {
        return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
      }
      const an = (av as number | null) ?? -Infinity
      const bn = (bv as number | null) ?? -Infinity
      return asc ? an - bn : bn - an
    })
    return copy
  }, [rows, sortKey, asc])

  const sortBy = (k: SortKey) => {
    if (sortKey === k) setAsc((v) => !v)
    else {
      setSortKey(k)
      setAsc(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Rotation lab"
        title="Strength has two axes."
        description="A sector can rise and still lose ground, or fall and still beat the market. The quadrant map separates absolute direction from relative leadership."
        actions={
          <>
            <button className="btn" onClick={() => setShowControls((v) => !v)}>
              <SlidersHorizontal size={13} /> Thresholds
            </button>
            <button className="btn" onClick={() => setSelected(null)} title="Clear the selected sector">
              <RotateCcw size={13} /> Clear selection
            </button>
            <button
              className="btn"
              onClick={() => {
                setWindow(20)
                setTrailSessions(10)
                setAbsThr(0)
                setRelThr(0)
                setBubbleMetric('none')
                setHistoryMode('rank')
                setHiddenCodes([])
                setWatchlistOnly(false)
                setZoomKey((v) => v + 1)
              }}
            >
              <RotateCcw size={13} /> Reset
            </button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Segmented label="Lookback" options={WINDOWS} value={window} onChange={setWindow} />
          <Segmented label="Trail" options={TRAILS} value={trailSessions} onChange={setTrailSessions} size="sm" />
          <Segmented
            label="Bubble"
            options={BUBBLE_METRICS}
            value={bubbleMetric}
            onChange={setBubbleMetric}
            size="sm"
          />
          <button className="btn" onClick={() => setShowSectorFilter((v) => !v)} aria-expanded={showSectorFilter}>
            <Eye size={13} /> {visibleRows.length}/{rows.length} sectors
          </button>
          <button
            className={cn('btn', watchlistOnly && 'btn-active')}
            onClick={() => setWatchlistOnly((v) => !v)}
            aria-pressed={watchlistOnly}
          >
            <Star size={13} /> Watchlist{watchlist.length ? ` (${watchlist.length})` : ''}
          </button>
          <div className="ml-auto flex items-center gap-3 text-[10px] text-muted">
            <span className="num">{visibleRows.length} of {rows.length} shown</span>
            <StatusBadge status="VERIFIED" label={`as of ${dateLabel(data?.latest_date)}`} />
          </div>
        </div>
        {showSectorFilter && (
          <div className="mt-4 border-t pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">Sectors on the map</span>
              <div className="flex gap-2">
                <button className="text-[10px] text-accent hover:underline" onClick={() => setHiddenCodes([])}>
                  Show all
                </button>
                <button
                  className="text-[10px] text-muted hover:underline"
                  onClick={() => setHiddenCodes(rows.map((r) => r.code))}
                >
                  Hide all
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {rows.map((r) => {
                const hidden = hiddenCodes.includes(r.code)
                return (
                  <button
                    key={r.code}
                    aria-pressed={!hidden}
                    onClick={() =>
                      setHiddenCodes((prev) =>
                        prev.includes(r.code) ? prev.filter((c) => c !== r.code) : [...prev, r.code],
                      )
                    }
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[10px] transition-colors',
                      hidden ? 'border-line text-faint line-through' : 'border-accent/40 text-ink',
                    )}
                  >
                    {r.name}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted">
              Hidden sectors leave both the quadrant and the leadership timeline. Their trailing path is
              removed too; no invisible point remains in the calculation.
            </p>
          </div>
        )}
        {showControls && (
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-[11px]">
              <span className="w-28 shrink-0 text-muted">Absolute threshold</span>
              <input
                type="range"
                min={-0.1}
                max={0.1}
                step={0.005}
                value={absThr}
                onChange={(e) => setAbsThr(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="num w-12 text-right">{signedPct(absThr)}</span>
            </label>
            <label className="flex items-center gap-3 text-[11px]">
              <span className="w-28 shrink-0 text-muted">Relative threshold</span>
              <input
                type="range"
                min={-0.1}
                max={0.1}
                step={0.005}
                value={relThr}
                onChange={(e) => setRelThr(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="num w-12 text-right">{signedPct(relThr)}</span>
            </label>
            <p className="text-[10px] leading-relaxed text-muted sm:col-span-2">
              Thresholds move the quadrant boundaries away from zero. Ties at the boundary are classified as
              lagging/losing per the documented rule (advancing requires strictly positive relative strength).
            </p>
          </div>
        )}
      </Card>

      {isLoading && <Card><Loading label="Computing rotation map" rows={6} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}

      {data && !isLoading && (
        <>
          <InfoNote>
            Lookback is a number of trading sessions, not calendar days. The chart plots cumulative returns,
            not index levels: x is the sector’s own return and y is its excess return versus NEPSE. Bubble
            size is a context metric (market cap, turnover, volatility or breadth) and never moves a sector
            between quadrants.
          </InfoNote>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader
                eyebrow={`Absolute vs relative · ${window} sessions`}
                title="Rotation quadrant"
                subtitle="Top-right is winning; top-left is improving relative to a falling market; bottom-right is rising but lagging; bottom-left is lagging outright."
                actions={
                  <button className="btn" onClick={() => setZoomKey((v) => v + 1)} title="Reset chart zoom">
                    <RotateCcw size={12} /> Reset zoom
                  </button>
                }
              />
              <RotationQuadrant
                key={`rotation-${window}-${zoomKey}`}
                rows={visibleRows}
                trails={trailSessions > 0 ? trailData?.trails : undefined}
                height={520}
                selected={selected}
                watched={watchlist}
                onSelect={setSelected}
                bubbleMetric={bubbleMetric}
                exportName={`nepse-rotation-${window}s`}
              />
              <p className="mt-2 text-center text-[10px] text-muted">
                Bubble size: {BUBBLE_METRICS.find((b) => b.value === bubbleMetric)?.label.toLowerCase()}.
                Scroll or pinch over the map to zoom, drag to pan, then reset with “Reset zoom”. Tick marks remain
                fixed to the axes.
              </p>
            </Card>
            <div className="grid gap-4">
              <Card className="min-h-[260px]">
                {selectedRow ? (
                  <>
                    <div className="mb-3 flex justify-end">
                      <button
                        className="btn text-[10px]"
                        onClick={() =>
                          setWatchlist((prev) =>
                            prev.includes(selectedRow.code)
                              ? prev.filter((code) => code !== selectedRow.code)
                              : [...prev, selectedRow.code],
                          )
                        }
                      >
                        <Star size={12} /> {watchlist.includes(selectedRow.code) ? 'Pinned' : 'Pin sector'}
                      </button>
                    </div>
                    <SelectedSector row={selectedRow} trail={trailData?.trails?.[selectedRow.code]} />
                  </>
                ) : (
                  <InfoNote>Select a sector on the map or table to inspect its trajectory.</InfoNote>
                )}
              </Card>
              <Card>
                <CardHeader eyebrow="Quadrant census" title="Where the market sits" />
                <div className="grid grid-cols-2 gap-2">
                  {(['WINNING', 'ADVANCING', 'LOSING', 'LAGGING'] as const).map((q) => (
                    <div key={q} className="rounded-lg border p-2.5" style={{ borderColor: `${quadrantColor(q, false)}33` }}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: quadrantColor(q, false) }}>
                          {q}
                        </span>
                        <span className="num text-[13px]">{groups[q].length}</span>
                      </div>
                      <div className="mt-1.5 space-y-0.5">
                        {groups[q].length === 0 && <div className="text-[10px] text-faint">none</div>}
                        {groups[q].slice(0, 4).map((r) => (
                          <button key={r.code} onClick={() => setSelected(r.code)} className="block truncate text-[10px] text-muted hover:text-ink">
                            {r.name}
                          </button>
                        ))}
                        {groups[q].length > 4 && (
                          <div className="text-[9px] text-faint">+{groups[q].length - 4} more in table</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Cross-section"
              title="Sector strength table"
              subtitle="Click a column to sort. All returns are trading-session cumulative returns; size, volatility and breadth are latest-session context."
              actions={
                <div className="flex items-center gap-3">
                  <span className="num hidden text-[10px] text-muted sm:inline">{dateLabel(data.latest_date)}</span>
                  <button
                    className="btn"
                    onClick={() =>
                      downloadCsv(
                        `nepse-rotation-${window}s-${data.latest_date ?? 'latest'}`,
                        [
                          'Sector', 'Code', 'Absolute', 'Relative', 'RS ratio', '20D', '60D', '120D',
                          'Delta 20D', 'Quadrant', 'Market cap (NPR)', 'Turnover (NPR)', 'Advance share',
                          'Volatility', 'Turnover HHI', 'Observations', 'Latest date',
                        ],
                        sorted.map((r) => [
                          r.name, r.code, r.absolute_strength, r.relative_strength, r.rs_ratio,
                          r.return_20, r.return_60, r.return_120, r.momentum_change, r.quadrant,
                          r.market_cap, r.turnover, r.advance_pct, r.volatility, r.hhi,
                          r.observations, r.latest_date,
                        ]),
                      )
                    }
                  >
                    <Download size={12} /> CSV
                  </button>
                </div>
              }
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="cursor-pointer" onClick={() => sortBy('name')}>Sector</th>
                    <th className="text-right cursor-pointer" onClick={() => sortBy('absolute_strength')}>Absolute</th>
                    <th className="text-right cursor-pointer" onClick={() => sortBy('relative_strength')}>Relative</th>
                    <th className="text-right cursor-pointer" onClick={() => sortBy('rs_ratio')}>RS ratio</th>
                    <th className="text-right cursor-pointer" onClick={() => sortBy('return_20')}>20D</th>
                    <th className="text-right">60D</th>
                    <th className="text-right">120D</th>
                    <th className="text-right cursor-pointer" onClick={() => sortBy('momentum_change')}>Δ 20D</th>
                    <th className="text-right cursor-pointer" onClick={() => sortBy('volatility')}>Volatility</th>
                    <th className="text-right cursor-pointer" onClick={() => sortBy('market_cap')}>Market cap</th>
                    <th>Quadrant</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr
                      key={r.code}
                      className={cn('cursor-pointer', selected === r.code && 'bg-accent/[0.04]')}
                      onClick={() => setSelected(r.code)}
                    >
                      <td>
                        <div className="flex items-center gap-2">
                          <button
                            aria-label={watchlist.includes(r.code) ? `Unpin ${r.name}` : `Pin ${r.name}`}
                            className={cn('text-faint transition-colors hover:text-accent', watchlist.includes(r.code) && 'text-accent')}
                            onClick={(e) => {
                              e.stopPropagation()
                              setWatchlist((prev) =>
                                prev.includes(r.code) ? prev.filter((code) => code !== r.code) : [...prev, r.code],
                              )
                            }}
                          >
                            <Star size={12} fill={watchlist.includes(r.code) ? 'currentColor' : 'none'} />
                          </button>
                          <Link to={`/sectors?code=${r.code}`} className="flex items-center gap-2 hover:text-accent">
                            <span className="truncate">{r.name}</span>
                            <ArrowUpRight size={11} className="text-faint" />
                          </Link>
                        </div>
                      </td>
                      <td className={cn('num text-right', toneClass(r.absolute_strength))}>{signedPct(r.absolute_strength)}</td>
                      <td className={cn('num text-right', toneClass(r.relative_strength))}>{signedPct(r.relative_strength)}</td>
                      <td className="num text-right">{r.rs_ratio?.toFixed(4) ?? '—'}</td>
                      <td className={cn('num text-right', toneClass(r.return_20))}>{signedPct(r.return_20)}</td>
                      <td className={cn('num text-right', toneClass(r.return_60))}>{signedPct(r.return_60)}</td>
                      <td className={cn('num text-right', toneClass(r.return_120))}>{signedPct(r.return_120)}</td>
                      <td className={cn('num text-right', toneClass(r.momentum_change))}>{signedPct(r.momentum_change)}</td>
                      <td className="num text-right text-muted">{pct(r.volatility)}</td>
                      <td className="num text-right text-muted">{npr(r.market_cap)}</td>
                      <td><QuadrantBadge quadrant={r.quadrant} /></td>
                    </tr>
                  ))}
                  <tr className="bg-raised/60 font-medium">
                    <td>NEPSE (market)</td>
                    <td className="num text-right">{signedPct(data.market_return)}</td>
                    <td className="num text-right text-muted">—</td>
                    <td className="num text-right">1.0000</td>
                    <td className="num text-right">{signedPct(data.market_returns?.r20)}</td>
                    <td className="num text-right">{signedPct(data.market_returns?.r60)}</td>
                    <td className="num text-right">{signedPct(data.market_returns?.r120)}</td>
                    <td className="num text-right text-muted">—</td>
                    <td className="num text-right text-muted">—</td>
                    <td className="num text-right text-muted">—</td>
                    <td><span className="chip border-line bg-raised text-muted">Benchmark</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Historical position"
              title="Inspect a past rotation snapshot"
              subtitle="Scrub through the 120-session history for the selected sector. Playback uses stored observations only."
            />
            {selectedRow && history?.available && history.dates.length > 0 ? (
              <HistoricalPosition
                code={selectedRow.code}
                history={history}
                absThreshold={absThr}
                relThreshold={relThr}
              />
            ) : (
              <InfoNote>Select a sector with history to inspect past positions.</InfoNote>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Leadership timeline · 120 sessions"
              title={historyMode === 'rank' ? 'Who led, session by session' : 'Excess return, every sector'}
              subtitle={
                historyMode === 'rank'
                  ? 'Rank is recomputed each session from relative strength at the selected lookback. A sector with no observation is not ranked that day.'
                  : 'Each line is a sector’s return minus NEPSE over the same lookback. Zero is the leadership boundary.'
              }
              actions={
                <Segmented
                  options={[
                    { value: 'rank', label: 'Rank' },
                    { value: 'relative', label: 'Excess' },
                  ]}
                  value={historyMode}
                  onChange={setHistoryMode}
                  size="sm"
                />
              }
            />
            {history?.available && history.dates.length > 0 ? (
              <RankTimeline
                dates={history.dates}
                series={historySeries}
                selected={selected}
                mode={historyMode}
                height={380}
                onSelect={setSelected}
                exportName={`nepse-leadership-${window}s`}
              />
            ) : (
              <p className="py-10 text-center text-xs text-muted">
                {history?.reason ?? 'Leadership history is unavailable for this lookback.'}
              </p>
            )}
            <p className="mt-3 border-t pt-3 text-[10px] leading-relaxed text-muted">
              {history?.method ??
                'Rank uses only sessions where the sector has an observation; gaps are real missing data.'}{' '}
              Past rank is an observation, not a forecast.
            </p>
          </Card>

          <div className="mt-4 grid items-start gap-4 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader eyebrow="Quadrant transitions" title="Recent crossings" subtitle="When a sector changes quadrant, the reason is rarely a single session." />
              {data.transitions.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted">No quadrant transitions in the recent window.</p>
              ) : (
                <div className="max-h-[340px] space-y-1.5 overflow-y-auto">
                  {data.transitions.map((t) => (
                    <div key={`${t.date}-${t.code}`} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]">
                      <span className="num w-16 shrink-0 text-faint">{dateLabel(t.date)}</span>
                      <button className="truncate text-left hover:text-accent" onClick={() => setSelected(t.code)}>{t.name}</button>
                      <span className="ml-auto flex items-center gap-1 text-faint">
                        <span className="hidden sm:inline">{t.from}</span>
                        <ArrowRight size={10} />
                        <QuadrantBadge quadrant={t.to} />
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 border-t pt-3 text-[10px] leading-relaxed text-faint">
                A crossing is recorded only when both the previous and current quadrant are defined; a gap
                session is not treated as a transition. {data.transitions.length} crossings are shown for
                this lookback.
              </p>
            </Card>
            <Card>
              <CardHeader eyebrow="Axis contract" title="Read the map correctly" />
              <div className="space-y-3 text-[12px] leading-relaxed text-muted">
                <p><b className="text-ink">x — absolute strength.</b> Sector cumulative return over the selected lookback. Right is positive.</p>
                <p><b className="text-ink">y — relative strength.</b> Sector return minus NEPSE return over the same sessions. Up is outperformance.</p>
                <p><b className="text-ink">Trails.</b> Each faint line traces the sector’s recent path through the quadrants, ending at the current dot.</p>
                <p><b className="text-ink">Lookback matters.</b> Short windows capture tactical rotation; long windows reveal structural leadership. A 5-session read is not a 120-session conclusion.</p>
                <p><b className="text-ink">Bubble size is context, never an axis.</b> Market cap, turnover, volatility and breadth change the marker area only; they never move a sector between quadrants.</p>
              </div>
              <InfoNote>Relative strength is an excess return, not a price ratio. The RS ratio column is shown separately for ratio-based comparison.</InfoNote>
              <div className="mt-4 flex items-center justify-between border-t pt-3">
                <span className="text-[10px] text-muted">Full formulas</span>
                <Link to="/methodology" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                  Methodology <ArrowUpRight size={12} />
                </Link>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
