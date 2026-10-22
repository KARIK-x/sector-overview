import type { EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Activity,
  CircleDot,
  Droplets,
  Gauge,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Waves,
} from 'lucide-react'
import { api } from '../lib/api'
import type { DashboardPayload, RotationRow } from '../lib/api'
import { Card, CardHeader, ErrorState, InfoNote, Metric, PageHeader, QuadrantBadge, StatusBadge } from '../components/ui'
import { RotationQuadrant } from '../components/RotationQuadrant'
import { SectorHeatmap } from '../components/SectorHeatmap'
import { Chart } from '../components/Chart'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette, quadrantColor } from '../lib/chart'
import { cn, compact, dateLabel, npr, pct, signedPct, toneClass } from '../lib/format'

function SessionBrief({ data }: { data: DashboardPayload }) {
  const m = data.market
  const breadth = data.breadth.rows ?? []
  const totalAdv = breadth.reduce((s, r) => s + r.advances, 0)
  const totalDec = breadth.reduce((s, r) => s + r.declines, 0)
  const leader = data.leaders[0]
  const laggard = data.laggards[0]
  const adRatio = totalDec ? totalAdv / totalDec : null

  return (
    <Card>
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">NEPSE · session close</span>
            <StatusBadge status="VERIFIED" label="verified" />
          </div>
          <div className="mt-2 flex items-end gap-3">
            <div className="num text-[44px] font-medium leading-none tracking-[-0.03em] sm:text-[54px]">
              {m.nepse_close?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '—'}
            </div>
            <div className={cn('mb-1 flex items-center gap-1 text-sm font-medium', toneClass(m.nepse_change))}>
              {m.nepse_change != null && m.nepse_change >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              <span className="num">{m.nepse_change != null ? `${m.nepse_change > 0 ? '+' : ''}${m.nepse_change.toFixed(2)}` : '—'}</span>
              <span className="num text-xs">({signedPct(m.nepse_pct)})</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
            <span>20D <b className={cn('num', toneClass(m.return_20))}>{signedPct(m.return_20)}</b></span>
            <span>60D <b className={cn('num', toneClass(m.return_60))}>{signedPct(m.return_60)}</b></span>
            <span>252D <b className={cn('num', toneClass(m.return_252))}>{signedPct(m.return_252)}</b></span>
          </div>
          <div className="mt-3 font-mono text-[10px] uppercase tracking-wider text-faint">
            As of {dateLabel(m.latest_date)} · close only
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <Metric
            label="Advance / decline"
            value={adRatio ? `${adRatio.toFixed(2)}×` : '—'}
            tone={adRatio == null ? 'neutral' : adRatio > 1 ? 'pos' : 'neg'}
            sub={`${totalAdv} advancing · ${totalDec} declining`}
          />
          <Metric
            label="Turnover"
            value={<span className="whitespace-nowrap text-[18px]">{npr(data.liquidity.total_turnover)}</span>}
            sub={`${data.liquidity.rows?.length ?? 0} sectors observed`}
          />
          <Metric
            label="Leading sector"
            value={<span className="text-[17px]">{leader?.name ?? '—'}</span>}
            tone="pos"
            sub={leader ? `${signedPct(leader.relative_strength)} vs NEPSE · 20D` : 'No data'}
          />
          <Metric
            label="Weakest sector"
            value={<span className="text-[17px]">{laggard?.name ?? '—'}</span>}
            tone="neg"
            sub={laggard ? `${signedPct(laggard.relative_strength)} vs NEPSE · 20D` : 'No data'}
          />
        </div>

        <div className="rounded-xl border bg-raised/60 p-4">
          <div className="flex items-center justify-between">
            <span className="eyebrow">Session character</span>
            <Activity size={14} className="text-accent" />
          </div>
          <div className="mt-3 space-y-2.5 text-[12px]">
            {(data.breadth.rows ?? []).slice(0, 4).map((r) => (
              <div key={r.sector_name} className="flex items-center gap-3">
                <span className="w-[108px] shrink-0 truncate text-muted">{r.sector_name}</span>
                <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-[#1f6f5f] dark:bg-[#6fbfa8]"
                    style={{ width: `${(r.advance_pct ?? 0) * 100}%` }}
                  />
                  <div
                    className="h-full bg-[#b23b3b] dark:bg-[#f08a86]"
                    style={{ width: `${(r.decline_pct ?? 0) * 100}%` }}
                  />
                </div>
                <span className="num w-10 text-right text-[11px]">{pct(r.advance_pct, 0)}</span>
              </div>
            ))}
          </div>
          <Link
            to="/breadth"
            className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
          >
            Open breadth lab <ArrowUpRight size={12} />
          </Link>
        </div>
      </div>
    </Card>
  )
}

function LeadershipBoard({ rows, transitions }: { rows: RotationRow[]; transitions: DashboardPayload['rotation']['transitions'] }) {
  const sorted = useMemo(
    () => [...rows].filter((r) => r.relative_strength != null).sort((a, b) => (b.relative_strength ?? 0) - (a.relative_strength ?? 0)),
    [rows],
  )
  const top = sorted.slice(0, 4)
  const bottom = sorted.slice(-4).reverse()
  const max = Math.max(0.01, ...sorted.map((r) => Math.abs(r.relative_strength ?? 0)))

  const Bar = ({ row }: { row: RotationRow }) => {
    const v = row.relative_strength ?? 0
    return (
      <div className="group flex items-center gap-3 py-1.5">
        <Link to={`/sectors?code=${row.code}`} className="w-[112px] shrink-0 truncate text-[12px] hover:text-accent">
          {row.name}
        </Link>
        <div className="relative h-2 flex-1 rounded-full bg-line/70">
          <div className="absolute left-1/2 top-0 h-full w-px bg-faint/40" />
          <div
            className="absolute top-0 h-full rounded-full transition-all"
            style={{
              width: `${(Math.abs(v) / max) * 50}%`,
              left: v >= 0 ? '50%' : `${50 - (Math.abs(v) / max) * 50}%`,
              backgroundColor: quadrantColor(row.quadrant, false),
              opacity: 0.85,
            }}
          />
        </div>
        <span className={cn('num w-12 text-right text-[11px]', toneClass(v))}>{signedPct(v)}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <CardHeader
        eyebrow="Relative leadership"
        title="Who is pulling away"
        subtitle="20-session excess return versus NEPSE"
        actions={<Link to="/rotation" className="btn text-[11px]">Lab <ArrowRight size={12} /></Link>}
      />
      <div className="grid flex-1 gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div>
          <div className="eyebrow mb-1 text-[#1f6f5f] dark:text-[#6fbfa8]">Outperformers</div>
          {top.map((r) => <Bar key={r.code} row={r} />)}
        </div>
        <div>
          <div className="eyebrow mb-1 text-[#b23b3b] dark:text-[#f08a86]">Underperformers</div>
          {bottom.map((r) => <Bar key={r.code} row={r} />)}
        </div>
      </div>
      <div className="mt-4 border-t pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Latest quadrant changes</span>
          <CircleDot size={12} className="text-faint" />
        </div>
        {transitions.length === 0 ? (
          <p className="text-[11px] text-muted">No quadrant transitions in the last two sessions.</p>
        ) : (
          <div className="space-y-1.5">
            {transitions.slice(0, 3).map((t) => (
              <div key={`${t.date}-${t.code}`} className="flex items-center gap-2 text-[11px]">
                <span className="num text-faint">{dateLabel(t.date).slice(0, 6)}</span>
                <Link to={`/sectors?code=${t.code}`} className="truncate hover:text-accent">{t.name}</Link>
                <span className="ml-auto flex items-center gap-1 text-faint">
                  <span className="hidden sm:inline">{t.from}</span>
                  <ArrowRight size={10} />
                  <QuadrantBadge quadrant={t.to} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BreadthCard({ data }: { data: DashboardPayload }) {
  const rows = [...(data.breadth.rows ?? [])].sort((a, b) => (b.advance_pct ?? 0) - (a.advance_pct ?? 0))
  return (
    <Card>
      <CardHeader
        eyebrow="Breadth"
        title="Participation across sectors"
        subtitle="Share of observed securities advancing on the latest session"
        actions={<Link to="/breadth" className="text-[11px] text-accent hover:underline">Detail</Link>}
      />
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.sector_name} className="flex items-center gap-2.5">
            <span className="w-[105px] shrink-0 truncate text-[11px] text-muted">{r.sector_name}</span>
            <div className="relative flex h-3.5 flex-1 overflow-hidden rounded-sm bg-line/50">
              <div className="h-full bg-[#1f6f5f] dark:bg-[#6fbfa8]" style={{ width: `${(r.advance_pct ?? 0) * 100}%` }} />
              <div
                className="h-full bg-[#b23b3b] dark:bg-[#f08a86]"
                style={{ width: `${(r.decline_pct ?? 0) * 100}%`, marginLeft: 'auto' }}
              />
            </div>
            <span className="num w-9 text-right text-[10px]">{r.traded}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between border-t pt-2 text-[10px] text-muted">
        <span><span className="inline-block h-2 w-2 rounded-sm bg-[#1f6f5f] dark:bg-[#6fbfa8]" /> advancing</span>
        <span><span className="inline-block h-2 w-2 rounded-sm bg-[#b23b3b] dark:bg-[#f08a86]" /> declining</span>
        <span className="num">n = {rows.reduce((s, r) => s + r.traded, 0)}</span>
      </div>
    </Card>
  )
}

function LiquidityCard({ data }: { data: DashboardPayload }) {
  const rows = [...(data.liquidity.rows ?? [])].sort((a, b) => (b.share ?? 0) - (a.share ?? 0)).slice(0, 6)
  const max = Math.max(...rows.map((r) => r.share ?? 0), 0.0001)
  return (
    <Card>
      <CardHeader
        eyebrow="Liquidity"
        title="Where turnover is concentrated"
        subtitle={`${npr(data.liquidity.total_turnover)} observed on ${dateLabel(data.liquidity.latest_date)}`}
        actions={<Link to="/liquidity" className="text-[11px] text-accent hover:underline">Detail</Link>}
      />
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.sector_name}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[11px]">{r.sector_name}</span>
              <span className="num text-[10px] text-muted">{pct(r.share, 1)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-sm" style={{ background: 'color-mix(in srgb, var(--line) 55%, transparent)' }}>
              <div
                className="h-full rounded-sm bg-[#1f6f5f] dark:bg-[#6fbfa8]"
                style={{ width: `${Math.max(2, ((r.share ?? 0) / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t pt-2 text-[10px] text-muted">
        Top {rows.length} of {data.liquidity.rows?.length ?? 0} sectors · traded value, not net investor inflow.
      </div>
    </Card>
  )
}

function RiskCard({ data }: { data: DashboardPayload }) {
  const { isDark } = useTheme()
  const rows = data.risk.rows ?? []
  const option = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true })
    return {
      ...baseOption(isDark),
      grid: { left: 46, right: 18, top: 20, bottom: 40 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = params as { data?: { meta?: (typeof rows)[number] } }
          const r = d.data?.meta
          if (!r) return ''
          return `<div style="min-width:170px"><b>${r.name}</b><div style="height:1px;background:${p.line};margin:6px 0"></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Volatility</span><b style="font-family:'IBM Plex Mono',monospace">${pct(r.volatility)}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Beta</span><b style="font-family:'IBM Plex Mono',monospace">${r.beta?.toFixed(2) ?? '—'}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Max DD</span><b style="font-family:'IBM Plex Mono',monospace">${signedPct(r.max_drawdown)}</b></div></div>`
        },
      },
      xAxis: {
        type: 'value',
        name: 'Volatility (ann.)',
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      },
      yAxis: {
        type: 'value',
        name: 'Beta',
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => v.toFixed(1) },
      },
      series: [
        {
          type: 'scatter',
          data: rows
            .filter((r) => r.volatility != null && r.beta != null)
            .map((r) => ({
              value: [r.volatility, r.beta],
              name: r.name,
              meta: r,
              itemStyle: {
                color: isDark ? 'rgba(79,209,176,0.85)' : 'rgba(14,124,102,0.82)',
                borderColor: p.surface,
                borderWidth: 1.5,
              },
              symbolSize: 12,
            })),
          label: {
            show: true,
            position: 'right',
            distance: 4,
            color: p.muted,
            fontSize: 8,
            formatter: (params: unknown) => (params as { name: string }).name.split(' ')[0],
          },
          labelLayout: { hideOverlap: true },
        },
      ],
    } as unknown as EChartsOption
  }, [rows, isDark])

  return (
    <Card>
      <CardHeader
        eyebrow="Risk"
        title="Volatility versus market sensitivity"
        subtitle="252-session window · beta measured against NEPSE"
        actions={<Link to="/risk" className="text-[11px] text-accent hover:underline">Detail</Link>}
      />
      <Chart option={option} height={278} exportName="dashboard-risk-scatter" />
      <InfoNote>Beta above 1 implies amplified sensitivity to NEPSE moves. Past volatility is not a forecast.</InfoNote>
    </Card>
  )
}

function ContributionCard({ data }: { data: DashboardPayload }) {
  const { isDark } = useTheme()
  const rows = (data.rotation.rows ?? [])
    .filter((r) => r.market_cap != null && r.return_20 != null)
    .map((r) => ({ ...r, contribution: (r.market_cap ?? 0) * (r.return_20 ?? 0) }))
  const totalCap = rows.reduce((s, r) => s + (r.market_cap ?? 0), 0)
  const weighted = rows
    .map((r) => ({ ...r, weight: totalCap ? (r.market_cap ?? 0) / totalCap : 0, contrib: totalCap ? ((r.market_cap ?? 0) / totalCap) * (r.return_20 ?? 0) : 0 }))
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
  const max = Math.max(0.0001, ...weighted.map((r) => Math.abs(r.contrib)))
  return (
    <Card>
      <CardHeader
        eyebrow="Market structure"
        title="Cap-weighted contribution to the 20-session move"
        subtitle="Sector market-cap snapshot × 20-session return. Snapshot weights, not a historical series."
        actions={<Link to="/liquidity" className="text-[11px] text-accent hover:underline">Liquidity</Link>}
      />
      <div className="space-y-2">
        {weighted.map((r) => {
          const v = r.contrib
          return (
            <div key={r.code} className="flex items-center gap-3">
              <Link to={`/sectors?code=${r.code}`} className="w-[112px] shrink-0 truncate text-[11px] hover:text-accent">
                {r.name}
              </Link>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-line/60">
                <div className="absolute left-1/2 top-0 h-full w-px bg-faint/40" />
                <div
                  className="absolute top-0 h-full rounded-full"
                  style={{
                    width: `${(Math.abs(v) / max) * 50}%`,
                    left: v >= 0 ? '50%' : `${50 - (Math.abs(v) / max) * 50}%`,
                    backgroundColor: v >= 0 ? (isDark ? '#6fbfa8' : '#1f6f5f') : (isDark ? '#f08a86' : '#b23b3b'),
                    opacity: 0.85,
                  }}
                />
              </div>
              <span className={cn('num w-14 text-right text-[10px]', toneClass(v))}>{signedPct(v)}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 border-t pt-2 text-[10px] text-muted">
        Based on the {dateLabel(data.market.latest_date)} market-cap snapshot and 20-session returns. Excludes
        unclassified instruments; not a historical concentration series.
      </div>
    </Card>
  )
}

function PeriodWinnersCard({ data }: { data: DashboardPayload }) {
  const periods = (data.period_winners ?? []).map((p) => ({
    label: `${p.window} sessions`,
    leader: p.leader,
    leaderReturn: p.leader_return,
    laggard: p.laggard,
    laggardReturn: p.laggard_return,
    marketReturn: p.market_return,
  }))
  return (
    <Card>
      <CardHeader
        eyebrow="Market horizons"
        title="Who is winning over each period"
        subtitle="Leader and laggard by absolute sector return. Returns are trading-session cumulative returns, not calendar-day returns."
        actions={<Link to="/rotation" className="text-[11px] text-accent hover:underline">Rotation lab</Link>}
      />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Leader</th>
              <th className="text-right">Leader return</th>
              <th>Laggard</th>
              <th className="text-right">Laggard return</th>
              <th className="text-right">NEPSE</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.label}>
                <td className="text-[11px]">{p.label}</td>
                <td>{p.leader ?? '—'}</td>
                <td className={cn('num text-right', toneClass(p.leaderReturn))}>{signedPct(p.leaderReturn)}</td>
                <td>{p.laggard ?? '—'}</td>
                <td className={cn('num text-right', toneClass(p.laggardReturn))}>{signedPct(p.laggardReturn)}</td>
                <td className={cn('num text-right', toneClass(p.marketReturn))}>{signedPct(p.marketReturn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px] text-muted">
        NEPSE is shown as the market benchmark. Sector percentages are not summed into a total market return.
      </p>
    </Card>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboard,
  })

  if (isLoading) {
    return (
      <div className="shell">
        <div className="mb-6 h-16 w-2/3 skeleton" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-64 skeleton lg:col-span-2" />
          <div className="h-64 skeleton" />
        </div>
        <div className="mt-4 h-96 skeleton" />
      </div>
    )
  }
  if (isError || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  return (
    <div>
      <PageHeader
        eyebrow="Sector intelligence · Nepal"
        title="The market, by sector."
        description="An independent read of sector rotation, participation, liquidity and risk. Built from verified index history and public daily summaries — no stock-level trading terminal."
        actions={
          <>
            <div className="hidden text-right sm:block">
              <div className="eyebrow">Latest session</div>
              <div className="num mt-1 text-[13px]">{dateLabel(data.market.latest_date)}</div>
            </div>
            <button className="btn" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh data">
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        }
      />

      <SessionBrief data={data} />

      <div className="mt-4">
        <PeriodWinnersCard data={data} />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            eyebrow="Rotation map · 20 sessions"
            title="Absolute vs relative strength"
            subtitle="x = sector return, y = excess return over NEPSE. The top-right quadrant is leadership."
            actions={<Link to="/rotation" className="btn text-[11px]"><LineIcon /> Open lab</Link>}
          />
          <RotationQuadrant
            rows={data.rotation.rows}
            trails={data?.trails?.trails}
            height={500}
            exportName="dashboard-rotation-map"
            onSelect={(code) => navigate(`/sectors?code=${code}`)}
          />
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            eyebrow="Return surface"
            title="Sector performance across horizons"
            subtitle="Cumulative index return by trading-session lookback. Click a cell to open the sector."
            actions={<Link to="/sectors" className="text-[11px] text-accent hover:underline">Explore</Link>}
          />
          <SectorHeatmap data={data.heatmap} height={440} onSelect={(code) => { if (code !== 'NEPSE') navigate(`/sectors?code=${code}`) }} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <LeadershipBoard rows={data.rotation.rows} transitions={data.rotation.transitions} />
        </Card>
        <ContributionCard data={data} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <BreadthCard data={data} />
        <LiquidityCard data={data} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <RiskCard data={data} />
        <Card>
          <CardHeader
            eyebrow="Data trust"
            title="Freshness & provenance"
            subtitle="What this dashboard actually knows, and when it knew it."
            actions={<Link to="/data-quality" className="text-[11px] text-accent hover:underline">Quality center</Link>}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-raised p-3">
              <div className="eyebrow mb-1">Index history</div>
              <div className="num text-[13px]">{dateLabel(data.data_freshness.index_latest)}</div>
              <div className="mt-1 text-[10px] text-muted">13 sector sub-indices + NEPSE</div>
            </div>
            <div className="rounded-xl border bg-raised p-3">
              <div className="eyebrow mb-1">Daily summaries</div>
              <div className="num text-[13px]">{dateLabel(data.data_freshness.summary_latest)}</div>
              <div className="mt-1 text-[10px] text-muted">Close, change, volume, turnover</div>
            </div>
            <div className="rounded-xl border bg-raised p-3">
              <div className="eyebrow mb-1">Breadth</div>
              <div className="num text-[13px]">{dateLabel(data.data_freshness.breadth_latest)}</div>
              <div className="mt-1 text-[10px] text-muted">Observed members only</div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5">
              <Droplets size={14} className="mt-0.5 text-accent" />
              <div>
                <div className="text-[11px] font-medium">Liquidity is traded value</div>
                <p className="text-[10px] leading-relaxed text-muted">Turnover is not net capital inflow; no investor-flow inference is made.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5">
              <ShieldAlert size={14} className="mt-0.5 warn" />
              <div>
                <div className="text-[11px] font-medium">Membership caveat</div>
                <p className="text-[10px] leading-relaxed text-muted">Current sector membership is applied to history because historical membership is not published.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5">
              <Waves size={14} className="mt-0.5 text-accent" />
              <div>
                <div className="text-[11px] font-medium">Missing ≠ unchanged</div>
                <p className="text-[10px] leading-relaxed text-muted">Securities without an observation are excluded from breadth denominators and reported as unavailable.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2.5">
              <Gauge size={14} className="mt-0.5 text-accent" />
              <div>
                <div className="text-[11px] font-medium">No fabricated fills</div>
                <p className="text-[10px] leading-relaxed text-muted">Gaps are shown as gaps. Aggregate P/E is unavailable when total earnings are non-positive, and implausible book values are excluded.</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> {compact(data.market.nepse_close)} index level</span>
            <Link to="/methodology" className="link">Read the methodology</Link>
          </div>
        </Card>
      </div>
    </div>
  )
}

function LineIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1.5 9.5L4 6l2 1.5L10.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
