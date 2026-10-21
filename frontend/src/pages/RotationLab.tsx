import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { api } from '../lib/api'
import type { RotationRow, TrailPoint } from '../lib/api'
import { RotationQuadrant } from '../components/RotationQuadrant'
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
import { cn, dateLabel, dateShort, signedPct, toneClass } from '../lib/format'

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

type SortKey = 'name' | 'absolute_strength' | 'relative_strength' | 'rs_ratio' | 'return_20' | 'momentum_change'

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
        axisLabel: { ...axis.axisLabel, formatter: (v: string) => dateShort(v), hideOverlap: true },
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
        <Chart option={option} height={150} />
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
      </div>
      <Link to={`/sectors?code=${row.code}`} className="mt-auto inline-flex items-center gap-1 pt-3 text-[11px] text-accent hover:underline">
        Open full sector <ArrowUpRight size={12} />
      </Link>
    </div>
  )
}

export default function RotationLab() {
  const [window, setWindow] = useState(20)
  const [trailSessions, setTrailSessions] = useState(25)
  const [absThr, setAbsThr] = useState(0)
  const [relThr, setRelThr] = useState(0)
  const [selected, setSelected] = useState<string | null>('BANKING')
  const [sortKey, setSortKey] = useState<SortKey>('relative_strength')
  const [asc, setAsc] = useState(false)
  const [showControls, setShowControls] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rotation', window, absThr, relThr],
    queryFn: ({ signal }) => api.rotation(window, absThr, relThr, signal),
  })
  const { data: trailData } = useQuery({
    queryKey: ['trails', window, trailSessions],
    queryFn: ({ signal }) => api.trails(window, trailSessions, signal),
    enabled: trailSessions > 0,
  })

  const rows = data?.rows ?? []
  const selectedRow = rows.find((r) => r.code === selected) ?? rows[0]

  const groups = useMemo(() => {
    const g: Record<string, RotationRow[]> = { WINNING: [], ADVANCING: [], LOSING: [], LAGGING: [] }
    for (const r of rows) if (r.quadrant) g[r.quadrant].push(r)
    return g
  }, [rows])

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
            <button
              className="btn"
              onClick={() => {
                setWindow(20)
                setTrailSessions(25)
                setAbsThr(0)
                setRelThr(0)
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
          <div className="ml-auto flex items-center gap-3 text-[10px] text-muted">
            <span className="num">{rows.length} sectors</span>
            <StatusBadge status="VERIFIED" label={`as of ${dateLabel(data?.latest_date)}`} />
          </div>
        </div>
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
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader
                eyebrow={`Absolute vs relative · ${window} sessions`}
                title="Rotation quadrant"
                subtitle="Top-right is winning; top-left is improving relative to a falling market; bottom-right is rising but lagging; bottom-left is lagging outright."
              />
              <RotationQuadrant
                rows={rows}
                trails={trailSessions > 0 ? trailData?.trails : undefined}
                height={520}
                selected={selected}
                onSelect={setSelected}
              />
            </Card>
            <div className="grid gap-4">
              <Card className="min-h-[260px]">
                {selectedRow ? (
                  <SelectedSector row={selectedRow} trail={trailData?.trails?.[selectedRow.code]} />
                ) : (
                  <InfoNote>Select a sector on the map.</InfoNote>
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
              subtitle="Click a column to sort. All returns are trading-session cumulative returns."
              actions={<span className="num text-[10px] text-muted">{dateLabel(data.latest_date)}</span>}
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
                    <th>Quadrant</th>
                    <th className="text-right">Obs.</th>
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
                        <Link to={`/sectors?code=${r.code}`} className="flex items-center gap-2 hover:text-accent">
                          <span className="truncate">{r.name}</span>
                          <ArrowUpRight size={11} className="text-faint" />
                        </Link>
                      </td>
                      <td className={cn('num text-right', toneClass(r.absolute_strength))}>{signedPct(r.absolute_strength)}</td>
                      <td className={cn('num text-right', toneClass(r.relative_strength))}>{signedPct(r.relative_strength)}</td>
                      <td className="num text-right">{r.rs_ratio?.toFixed(4) ?? '—'}</td>
                      <td className={cn('num text-right', toneClass(r.return_20))}>{signedPct(r.return_20)}</td>
                      <td className={cn('num text-right', toneClass(r.return_60))}>{signedPct(r.return_60)}</td>
                      <td className={cn('num text-right', toneClass(r.return_120))}>{signedPct(r.return_120)}</td>
                      <td className={cn('num text-right', toneClass(r.momentum_change))}>{signedPct(r.momentum_change)}</td>
                      <td><QuadrantBadge quadrant={r.quadrant} /></td>
                      <td className="num text-right text-muted">{r.observations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
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
            </Card>
            <Card>
              <CardHeader eyebrow="Axis contract" title="Read the map correctly" />
              <div className="space-y-3 text-[12px] leading-relaxed text-muted">
                <p><b className="text-ink">x — absolute strength.</b> Sector cumulative return over the selected lookback. Right is positive.</p>
                <p><b className="text-ink">y — relative strength.</b> Sector return minus NEPSE return over the same sessions. Up is outperformance.</p>
                <p><b className="text-ink">Trails.</b> Each faint line traces the sector’s recent path through the quadrants, ending at the current dot.</p>
                <p><b className="text-ink">Lookback matters.</b> Short windows capture tactical rotation; long windows reveal structural leadership. A 5-session read is not a 120-session conclusion.</p>
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
