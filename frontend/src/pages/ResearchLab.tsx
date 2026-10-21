import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, FlaskConical, RotateCcw } from 'lucide-react'
import { api } from '../lib/api'
import { Chart } from '../components/Chart'
import { Card, CardHeader, InfoNote, Loading, Metric, PageHeader, QuadrantBadge, StatusBadge } from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette, quadrantColor } from '../lib/chart'
import { cn, num, pct } from '../lib/format'

const FACTORS = [
  { key: 'momentum_20', label: '20D momentum', hint: 'Cumulative 20-session return' },
  { key: 'relative_20', label: 'Relative 20D', hint: 'Excess return vs NEPSE' },
  { key: 'momentum_accel', label: 'Momentum Δ', hint: '20D return minus prior 20D return' },
  { key: 'low_volatility', label: 'Low volatility', hint: 'Lower annualised volatility scores higher' },
  { key: 'liquidity', label: 'Liquidity', hint: 'Latest observed sector turnover' },
  { key: 'trend', label: '60D trend', hint: 'Cumulative 60-session return' },
] as const

const FACTOR_COLORS = ['#0e7c66', '#2c5d8f', '#b06a14', '#6b5b95', '#b23b3b', '#4a7a6a']

const DEFAULT_WEIGHTS: Record<string, number> = {
  momentum_20: 25,
  relative_20: 25,
  momentum_accel: 15,
  low_volatility: 10,
  liquidity: 10,
  trend: 15,
}

const QUADS = ['WINNING', 'ADVANCING', 'LOSING', 'LAGGING']

export default function ResearchLab() {
  const { isDark } = useTheme()
  const [weights, setWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS)
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['factors', weights],
    queryFn: () => api.factors(weights),
  })
  const { data: research, isLoading: loadingResearch } = useQuery({ queryKey: ['research'], queryFn: api.research })

  const rows = data?.rows ?? []
  const sorted = useMemo(() => [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), [rows])
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)

  const scoreOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    return {
      ...baseOption(isDark),
      grid: { left: 8, right: 44, top: 10, bottom: 24, containLabel: true },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as Array<{ name: string; value: number; dataIndex: number }>
          const d = arr[0]
          const r = sorted[d.dataIndex]
          return `<div><b>${d.name}</b><br/><span style="font-family:'IBM Plex Mono',monospace">Score ${num(r?.score, 1)}</span><br/><span style="font-size:10px;color:${p.muted}">Coverage ${pct(r?.coverage, 0)} · ${r?.missing_factors.length ?? 0} missing</span></div>`
        },
      },
      xAxis: { type: 'value', min: 0, max: 100, ...axis },
      yAxis: { type: 'category', data: sorted.map((r) => r.name), inverse: true, ...axis, axisLine: { show: false } },
      series: [
        {
          type: 'bar',
          data: sorted.map((r) => ({
            value: r.score,
            itemStyle: { color: quadrantColor(r.quadrant, isDark), borderRadius: [0, 4, 4, 0], opacity: 0.85 },
          })),
          barWidth: 13,
          label: { show: true, position: 'right', formatter: (q: unknown) => num((q as { value: number }).value, 1), color: p.muted, fontSize: 9 },
        },
      ],
    } as unknown as EChartsOption
  }, [sorted, isDark])

  const contributionOption = useMemo(() => {
    const axis = axisStyle(isDark, { split: true, labelSize: 8 })
    return {
      ...baseOption(isDark),
      grid: { left: 8, right: 18, top: 34, bottom: 24, containLabel: true },
      legend: { ...baseOption(isDark).legend, top: 0, itemWidth: 8, itemHeight: 8 },
      tooltip: { ...baseOption(isDark).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', min: 0, ...axis },
      yAxis: { type: 'category', data: sorted.map((r) => r.name), inverse: true, ...axis, axisLine: { show: false } },
      series: FACTORS.map((f, i) => ({
        name: f.label,
        type: 'bar' as const,
        stack: 'contribution',
        data: sorted.map((r) => r.contributions[f.key] ?? 0),
        itemStyle: { color: FACTOR_COLORS[i], borderRadius: i === FACTORS.length - 1 ? [0, 3, 3, 0] : [0, 0, 0, 0] },
        barWidth: 13,
      })),
    } as unknown as EChartsOption
  }, [sorted, isDark])

  const matrixOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: false, labelSize: 9 })
    const matrix = research?.transition_matrix ?? {}
    const data: Array<[number, number, number]> = []
    QUADS.forEach((from, y) => {
      QUADS.forEach((to, x) => {
        data.push([x, y, matrix[from]?.[to] ?? 0])
      })
    })
    const max = Math.max(1, ...data.map((d) => d[2]))
    return {
      ...baseOption(isDark),
      grid: { left: 8, right: 12, top: 30, bottom: 12, containLabel: true },
      tooltip: {
        ...baseOption(isDark).tooltip,
        formatter: (params: unknown) => {
          const v = (params as { data?: [number, number, number] }).data
          if (!v) return ''
          return `<b>${QUADS[v[1]]} → ${QUADS[v[0]]}</b><br/><span style="font-family:'IBM Plex Mono',monospace">${v[2]} transitions</span>`
        },
      },
      xAxis: { type: 'category', data: QUADS, position: 'top', ...axis, axisLine: { show: false } },
      yAxis: { type: 'category', data: QUADS, inverse: true, ...axis, axisLine: { show: false } },
      visualMap: {
        show: false,
        min: 0,
        max,
        // Sequential single-hue ramp: darker means more transitions. A
        // red-to-green diverging scale implied that persistence was "bad".
        inRange: {
          color: isDark
            ? ['#15211d', '#1f5147', '#2f8a74', '#4fd1b0']
            : ['#f3f5f2', '#bcd8cd', '#5aa792', '#0e7c66'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data: data.map(([x, y, v]) => ({
            value: [x, y, v],
            itemStyle: { borderColor: p.paper, borderWidth: 2 },
            label: {
              color: isDark
                ? v / max > 0.5
                  ? '#07100d'
                  : p.ink
                : v / max > 0.55
                  ? '#fffdf8'
                  : p.ink,
            },
          })),
          label: { show: true, formatter: (q: unknown) => String((q as { value: [number, number, number] }).value[2]), fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" },
          itemStyle: { color: isDark ? 'rgba(79,209,176,0.7)' : 'rgba(14,124,102,0.62)' },
        },
      ],
    } as unknown as EChartsOption
  }, [research, isDark])

  const backtestOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const bt = research?.backtest
    const eq = bt?.equity_curve ?? []
    const bm = bt?.benchmark_curve ?? []
    const x = Array.from({ length: eq.length }, (_, i) => i)
    return {
      ...baseOption(isDark),
      grid: { left: 46, right: 18, top: 28, bottom: 34 },
      legend: { ...baseOption(isDark).legend, top: 0, data: ['Rotation top-3', 'NEPSE benchmark'] },
      tooltip: { ...baseOption(isDark).tooltip, trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? `${((v - 1) * 100).toFixed(1)}%` : '—') },
      xAxis: { type: 'category', data: x, ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: string) => `#${v}` } },
      yAxis: { type: 'value', ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${((v - 1) * 100).toFixed(0)}%` } },
      series: [
        {
          name: 'Rotation top-3',
          type: 'line',
          data: eq,
          showSymbol: false,
          lineStyle: { width: 1.8, color: p.accent },
          itemStyle: { color: p.accent },
          areaStyle: { color: isDark ? 'rgba(79,209,176,0.08)' : 'rgba(14,124,102,0.07)' },
        },
        {
          name: 'NEPSE benchmark',
          type: 'line',
          data: bm,
          showSymbol: false,
          lineStyle: { width: 1.2, color: isDark ? '#e8b06a' : '#b06a14', type: 'dashed' },
          itemStyle: { color: isDark ? '#e8b06a' : '#b06a14' },
        },
      ],
    } as unknown as EChartsOption
  }, [research, isDark])

  return (
    <div>
      <PageHeader
        eyebrow="Quantitative research lab"
        title="Research, with the seams showing."
        description="Factor scores, quadrant transition statistics and an illustrative rotation backtest. None of this is a trading system, a forecast, or investment advice."
        actions={<StatusBadge status="PROVISIONAL" label="illustrative research" />}
      />

      <InfoNote tone="warn">
        Backtests are shown with their method and without transaction costs. They are not evidence of future returns.
        Factor weights are user-configurable and the coverage of each score is disclosed.
      </InfoNote>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            eyebrow="Factor model"
            title="Composite sector score"
            subtitle="Cross-sector percentile ranks, weighted and renormalised over available factors. Missing factors are omitted."
            actions={<span className="num text-[10px] text-muted">total weight {totalWeight}</span>}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {FACTORS.map((f) => (
              <label key={f.key} className="rounded-lg border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium">{f.label}</span>
                  <span className="num text-[10px] text-muted">{weights[f.key]}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={5}
                  value={weights[f.key]}
                  onChange={(e) => setWeights((w) => ({ ...w, [f.key]: Number(e.target.value) }))}
                  className="mt-1.5 w-full accent-[var(--accent)]"
                  aria-label={`${f.label} weight`}
                />
                <div className="mt-0.5 text-[9px] leading-snug text-faint">{f.hint}</div>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] text-muted">Weights are relative; they are renormalised over available factors.</span>
            <button className="btn" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader
            eyebrow="Ranking"
            title="Composite scores"
            subtitle={isFetching ? 'Recomputing…' : 'Percentile-weighted score (0–100)'}
          />
          {isLoading ? <Loading label="Scoring sectors" /> : <Chart option={scoreOption} height={330} />}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            eyebrow="Attribution"
            title="What drives each score"
            subtitle="Each factor's weighted contribution, in score points. A missing factor contributes nothing and is disclosed below."
          />
          <Chart option={contributionOption} height={330} />
        </Card>
        <Card>
          <CardHeader eyebrow="Score table" title="Coverage and missing inputs" subtitle="A score built from fewer factors deserves more caution." />
          <div className="table-wrap max-h-[330px] overflow-y-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sector</th>
                  <th className="text-right">Score</th>
                  <th className="text-right">Coverage</th>
                  <th>Quadrant</th>
                  <th>Missing</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.code}>
                    <td>
                      <Link to={`/sectors?code=${r.code}`} className="hover:text-accent">{r.name}</Link>
                    </td>
                    <td className="num text-right">{num(r.score, 1)}</td>
                    <td className={cn('num text-right', r.coverage < 1 ? 'warn' : '')}>{pct(r.coverage, 0)}</td>
                    <td><QuadrantBadge quadrant={r.quadrant} /></td>
                    <td className="text-[10px] text-muted">{r.missing_factors.length ? r.missing_factors.join(', ') : 'none'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader
            eyebrow="State transitions"
            title="Quadrant persistence"
            subtitle="Historical quadrant transitions across all sectors and sessions. Rows are origin, columns are destination."
          />
          {loadingResearch ? <Loading label="Loading transitions" /> : <Chart option={matrixOption} height={280} />}
          <InfoNote>Diagonal cells indicate persistence. Off-diagonal mass shows where leadership tends to migrate.</InfoNote>
        </Card>
        <Card>
          <CardHeader
            eyebrow="Illustrative backtest"
            title="Top-3 relative strength rotation"
            subtitle={research?.backtest?.method ?? 'Long top-3 sectors by 20-session relative strength, rebalanced every 5 sessions.'}
          />
          {research?.backtest?.available ? (
            <>
              <div className="mb-2 grid grid-cols-3 gap-3">
                <Metric label="Strategy" value={`${(((research.backtest.final_equity ?? 1) - 1) * 100).toFixed(1)}%`} tone={(research.backtest.final_equity ?? 1) > 1 ? 'pos' : 'neg'} sub="cumulative, no costs" />
                <Metric label="Benchmark" value={`${(((research.backtest.final_benchmark ?? 1) - 1) * 100).toFixed(1)}%`} sub="NEPSE, same windows" />
                <Metric label="Rebalances" value={research.backtest.points} sub="5-session steps" />
              </div>
              <Chart option={backtestOption} height={250} />
            </>
          ) : (
            <InfoNote tone="warn">Insufficient overlapping history to run the illustrative backtest.</InfoNote>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader eyebrow="Interpretation" title="What this lab can and cannot tell you" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 text-[11px] leading-relaxed text-muted">
            <p><b className="text-ink">It can</b> rank sectors on transparent, reproducible momentum, relative-strength and risk inputs.</p>
            <p><b className="text-ink">It can</b> show how often sectors persist in or migrate between quadrants historically.</p>
            <p><b className="text-ink">It can</b> expose whether a score is built on complete or partial factor coverage.</p>
          </div>
          <div className="space-y-2 text-[11px] leading-relaxed text-muted">
            <p><b className="text-ink">It cannot</b> predict returns, account for transaction costs, taxes or liquidity impact.</p>
            <p><b className="text-ink">It cannot</b> correct for survivorship or historical membership changes, which are unavailable.</p>
            <p><b className="text-ink">It cannot</b> validate a live event feed because no licensed event source is connected.</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><FlaskConical size={12} /> Research module · {research?.notes?.[0] ? 'limitations disclosed' : 'partial history'}</span>
          <Link to="/methodology" className="inline-flex items-center gap-1 text-accent hover:underline">
            Formulas & limits <ArrowUpRight size={11} />
          </Link>
        </div>
      </Card>
    </div>
  )
}
