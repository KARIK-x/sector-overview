import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CircleAlert, Download, FileText } from 'lucide-react'
import { api } from '../lib/api'
import type { FundamentalRow } from '../lib/api'
import { Chart } from '../components/Chart'
import { Card, CardHeader, ErrorState, InfoNote, Loading, Metric, PageHeader, StatusBadge } from '../components/ui'
import { useTheme } from '../lib/useTheme'
import { axisStyle, baseOption, palette } from '../lib/chart'
import { cn, compact, npr, num, pct } from '../lib/format'
import { downloadCsv } from '../lib/export'

export default function FundamentalsLab() {
  const { isDark } = useTheme()
  const [code, setCode] = useState('BANKING')
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['fundamentals'],
    queryFn: api.fundamentals,
  })

  const rows = data?.rows ?? []
  const available = rows.filter((r) => r.available)
  const totalMembers = rows.reduce((s, r) => s + (r.symbols_total ?? 0), 0)
  const coveredMembers = rows.reduce((s, r) => s + (r.symbols_with_reports ?? 0), 0)
  const selected = rows.find((r) => r.code === code)

  const peOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true, labelSize: 9 })
    const sorted = [...available]
      .filter((r) => r.aggregate_pe != null)
      .sort((a, b) => (a.aggregate_pe ?? 0) - (b.aggregate_pe ?? 0))
    return {
      ...baseOption(isDark),
      grid: { left: 8, right: 52, top: 10, bottom: 24, containLabel: true },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = params as { data?: { meta?: FundamentalRow } }
          const row = d.data?.meta
          if (!row) return ''
          return `<div><b>${row.name}</b><br/><span style="font-family:'IBM Plex Mono',monospace">P/E ${num(row.aggregate_pe, 1)}</span><br/><span style="font-size:10px;color:${p.muted}">Coverage ${pct(row.coverage, 0)}</span></div>`
        },
      },
      // A log axis is necessary: the highest P/E is ~26× the lowest. A dot plot
      // is used instead of bars because a log axis has no meaningful zero and
      // zero-based bars would be a false visual anchor.
      xAxis: {
        type: 'log',
        min: 10,
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => v.toFixed(0) },
      },
      yAxis: {
        type: 'category',
        data: sorted.map((r) => r.name),
        inverse: true,
        ...axis,
        axisLine: { show: false },
        axisLabel: {
          ...axis.axisLabel,
          formatter: (v: string) =>
            v
              .replace('Manufacturing And Processing', 'Manufacturing')
              .replace('Non Life Insurance', 'Non-Life')
              .replace('Hotels And Tourism', 'Hotels'),
        },
      },
      series: [
        {
          type: 'scatter',
          data: sorted.map((r, i) => ({
            value: [r.aggregate_pe, i],
            name: r.name,
            meta: r,
            itemStyle: {
              color:
                (r.aggregate_pe ?? 0) > 30
                  ? isDark ? 'rgba(232,176,106,0.9)' : 'rgba(176,106,20,0.85)'
                  : isDark ? 'rgba(79,209,176,0.9)' : 'rgba(14,124,102,0.85)',
              borderColor: p.surface,
              borderWidth: 1.5,
            },
            symbolSize: 10,
            label: {
              show: true,
              position: 'right',
              distance: 6,
              formatter: () => num(r.aggregate_pe, 1),
              color: p.muted,
              fontSize: 9,
              fontFamily: "'IBM Plex Mono', monospace",
            },
          })),
          labelLayout: { hideOverlap: false },
        },
      ],
    } as unknown as EChartsOption
  }, [available, isDark])

  const bubbleOption = useMemo(() => {
    const p = palette(isDark)
    const axis = axisStyle(isDark, { split: true })
    const plotted = available.filter((r) => r.aggregate_pe != null && r.aggregate_roe != null)
    // Only annotate the corners of the distribution. Labels for the dense
    // middle are available on hover, and every row is in the table below.
    const labelled = new Set<string>()
    const byPe = [...plotted].sort((a, b) => (a.aggregate_pe ?? 0) - (b.aggregate_pe ?? 0))
    byPe.slice(0, 2).forEach((r) => labelled.add(r.code))
    byPe.slice(-2).forEach((r) => labelled.add(r.code))
    const byRoe = [...plotted].sort((a, b) => (a.aggregate_roe ?? 0) - (b.aggregate_roe ?? 0))
    byRoe.slice(0, 1).forEach((r) => labelled.add(r.code))
    byRoe.slice(-1).forEach((r) => labelled.add(r.code))
    return {
      ...baseOption(isDark),
      grid: { left: 52, right: 26, top: 20, bottom: 44 },
      tooltip: {
        ...baseOption(isDark).tooltip,
        trigger: 'item',
        formatter: (params: unknown) => {
          const d = params as { data?: { meta?: FundamentalRow } }
          const r = d.data?.meta
          if (!r) return ''
          return `<div style="min-width:180px"><b>${r.name}</b><div style="height:1px;background:${p.line};margin:6px 0"></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">P/E</span><b style="font-family:'IBM Plex Mono',monospace">${num(r.aggregate_pe, 1)}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">ROE</span><b style="font-family:'IBM Plex Mono',monospace">${pct(r.aggregate_roe)}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Market cap</span><b style="font-family:'IBM Plex Mono',monospace">${npr(r.aggregate_market_cap)}</b></div>
          <div style="font-size:11px;display:flex;justify-content:space-between;gap:16px"><span style="color:${p.muted}">Coverage</span><b style="font-family:'IBM Plex Mono',monospace">${pct(r.coverage, 0)}</b></div></div>`
        },
      },
      xAxis: {
        // P/E is multiplicative: a log axis stops one 480× multiple from
        // compressing every other sector into the left edge.
        type: 'log',
        name: 'Aggregate P/E (log scale)',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${v}` },
      },
      yAxis: {
        type: 'value',
        name: 'Aggregate ROE',
        nameLocation: 'middle',
        nameGap: 36,
        nameTextStyle: { color: p.muted, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace" },
        ...axis,
        axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      },
      series: [
        {
          type: 'scatter',
          data: plotted.map((r, i) => ({
              value: [r.aggregate_pe, r.aggregate_roe],
              name: r.name,
              meta: r,
              // Square-root scale keeps bubble *area* roughly proportional to
              // aggregate market cap without letting Banks swallow the panel.
              symbolSize: 9 + Math.sqrt(Math.max(0, r.aggregate_market_cap ?? 0) / 1e12) * 34,
              itemStyle: { color: isDark ? 'rgba(79,209,176,0.8)' : 'rgba(14,124,102,0.78)', borderColor: p.surface, borderWidth: 1.5 },
              // Alternate the anchor so labels fan out in four directions.
              label: {
                show: labelled.has(r.code),
                position: (['right', 'top', 'left', 'bottom'] as const)[i % 4],
              },
            })),
          label: {
            show: true,
            position: 'right',
            distance: 4,
            color: p.muted,
            fontSize: 8,
            formatter: (params: unknown) => (params as { name: string }).name.split(' ')[0],
            textBorderColor: p.surface,
            textBorderWidth: 2.5,
          },
          labelLayout: { hideOverlap: true, moveOverlap: 'shiftY' },
        },
      ],
    } as unknown as EChartsOption
  }, [available, isDark])

  return (
    <div>
      <PageHeader
        eyebrow="Fundamentals lab"
        title="Earnings, not narratives."
        description="Sector aggregates built only from fields present in verified filings. Revenue, total assets, liabilities, cash flow and dividends are not available and are not invented."
        actions={<StatusBadge status="PROVISIONAL" label="filings · provisional" />}
      />

      {isLoading && <Card><Loading label="Loading fundamentals" rows={5} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><Metric label="Report coverage" value={pct(totalMembers ? coveredMembers / totalMembers : null, 0)} sub={`${coveredMembers} of ${totalMembers} classified members`} /></Card>
            <Card><Metric label="Sectors with filings" value={`${available.length} / ${rows.length}`} sub="at least one report" /></Card>
            <Card><Metric label="Filing reports" value={compact(rows.reduce((s, r) => s + (r.companies?.length ?? 0), 0))} sub="latest report per member" /></Card>
            <Card><Metric label="P/E unavailable" value={rows.filter((r) => r.available && r.aggregate_pe == null).length} sub="non-positive aggregate earnings" tone="warn" /></Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader eyebrow="Valuation" title="Aggregate P/E by sector" subtitle="Market cap ÷ aggregate net profit, with losses in the denominator. Unavailable only when aggregate earnings are non-positive." />
              <Chart option={peOption} height={340} exportName="fundamentals-valuation" />
            </Card>
            <Card>
              <CardHeader eyebrow="Quality vs price" title="ROE against P/E" subtitle="Bubble area scales with aggregate market capitalisation. P/E uses a log axis; accounting periods differ across members." />
              <Chart option={bubbleOption} height={340} exportName="fundamentals-cap-profit" />
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Cross-section"
              title="Sector fundamentals"
              subtitle="Aggregates are sums of the latest report per member; they are not averages of company ratios."
              actions={
                <button
                  className="btn"
                  onClick={() =>
                    downloadCsv(
                      'nepse-sector-fundamentals',
                      ['sector', 'coverage', 'net_profit_npr', 'market_cap_npr', 'pe', 'pe_ex_loss', 'eps', 'roe', 'loss_makers'],
                      rows.map((r) => [
                        r.name,
                        r.coverage,
                        r.aggregate_profit,
                        r.aggregate_market_cap,
                        r.aggregate_pe,
                        r.aggregate_pe_ex_negative,
                        r.aggregate_eps,
                        r.aggregate_roe,
                        r.negative_earnings_symbols,
                      ]),
                    )
                  }
                >
                  <Download size={12} /> CSV
                </button>
              }
            />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sector</th>
                    <th className="text-right">Coverage</th>
                    <th className="text-right">Net profit</th>
                    <th className="text-right">Market cap</th>
                    <th className="text-right">P/E</th>
                    <th className="text-right">P/E ex-loss</th>
                    <th className="text-right">EPS</th>
                    <th className="text-right">ROE</th>
                    <th className="text-right">Loss-makers</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code}>
                      <td>
                        <button className="text-left hover:text-accent" onClick={() => setCode(r.code)}>{r.name}</button>
                      </td>
                      <td className="num text-right">{pct(r.coverage, 0)}</td>
                      <td className="num text-right">{npr(r.aggregate_profit)}</td>
                      <td className="num text-right text-muted">{npr(r.aggregate_market_cap)}</td>
                      <td className="num text-right">{num(r.aggregate_pe, 1)}</td>
                      <td className="num text-right text-muted">{num(r.aggregate_pe_ex_negative, 1)}</td>
                      <td className="num text-right">{num(r.aggregate_eps, 2)}</td>
                      <td className="num text-right">{pct(r.aggregate_roe)}</td>
                      <td className={cn('num text-right', (r.negative_earnings_symbols ?? 0) > 0 ? 'warn' : 'text-muted')}>{r.negative_earnings_symbols ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              eyebrow="Member detail"
              title={selected?.name ?? 'Sector'}
              subtitle={`${selected?.symbols_with_reports ?? 0} members with a report · ${selected?.negative_earnings_symbols ?? 0} loss-making ${(selected?.negative_earnings_symbols ?? 0) === 1 ? 'member' : 'members'}`}
              actions={<button className="btn" onClick={() => setCode(rows[(rows.findIndex((r) => r.code === code) + 1) % rows.length]?.code ?? 'BANKING')}>Next sector <ArrowUpRight size={12} /></button>}
            />
            {selected && selected.available ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Aggregate profit" value={npr(selected.aggregate_profit)} />
                  <Metric label="Aggregate equity" value={npr(selected.aggregate_equity)} />
                  <Metric label="P/E" value={num(selected.aggregate_pe, 1)} sub={selected.aggregate_pe == null ? 'unavailable' : 'aggregate'} />
                  <Metric label="ROE" value={pct(selected.aggregate_roe)} />
                </div>
                <div className="table-wrap max-h-[360px] overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>FY</th>
                        <th>Type</th>
                        <th className="text-right">Profit</th>
                        <th className="text-right">EPS</th>
                        <th className="text-right">P/E</th>
                        <th className="text-right">Paid-up</th>
                        <th className="text-right">Net worth/sh.</th>
                        <th className="text-right">Market cap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.companies ?? []).map((c) => (
                        <tr key={c.symbol}>
                          <td className="font-mono text-[11px]">{c.symbol}</td>
                          <td className="text-[10px] text-muted">{c.fiscal_year ?? '—'}</td>
                          <td className="text-[10px] text-muted">{c.report_type ?? '—'}</td>
                          <td className="num text-right">{compact(c.profit)}</td>
                          <td className="num text-right">{num(c.eps, 1)}</td>
                          <td className="num text-right">{num(c.pe, 1)}</td>
                          <td className="num text-right text-muted">{compact(c.paid_up_capital)}</td>
                          <td
                            className={cn('num text-right', c.book_value_status === 'implausible' && 'warn')}
                            title={
                              c.book_value_status === 'implausible'
                                ? `Reported ${num(c.book_value_reported, 1)} · rejected by the price-to-book check and excluded from equity/ROE`
                                : c.book_value_status === 'unverifiable'
                                  ? 'Included, but not cross-checkable (no positive EPS and P/E)'
                                  : undefined
                            }
                          >
                            {c.book_value_status === 'implausible' ? (
                              <span aria-label="implausible value excluded">—</span>
                            ) : (
                              <>
                                {num(c.net_worth_per_share, 1)}
                                {c.book_value_status === 'unverifiable' && <span className="text-faint">†</span>}
                              </>
                            )}
                          </td>
                          <td className="num text-right text-muted">{compact(c.market_cap)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-[10px] text-faint">
                  Scroll for all {(selected.companies ?? []).length} reported members.
                </div>
              </>
            ) : (
              <InfoNote tone="warn">No verified fundamental reports are available for this sector’s current membership.</InfoNote>
            )}
            {(selected?.notes ?? []).map((n) => (
              <InfoNote key={n}>{n}</InfoNote>
            ))}
          </Card>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoNote tone="warn">
              <b>Not available:</b> revenue, total assets, total liabilities, operating cash flow, book value per sector and dividend yield.
              These fields are absent from the verified source. They are not estimated.
            </InfoNote>
            <InfoNote>
              <FileText size={12} className="mr-1 inline" />
              Filing dates differ by company. Aggregates blend the latest available report per member, so cross-sector comparisons carry period mismatch risk.
              <Link to="/data-quality" className="ml-1 underline underline-offset-2 hover:text-ink">See coverage</Link>
            </InfoNote>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#b06a14]/25 bg-[#b06a14]/5 px-3 py-2.5 text-[11px] text-[#7a5216] dark:text-[#e8b06a]">
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
            <span>These are accounting aggregates, not valuations of future cash flows. A low P/E can reflect a low-quality earnings base or a cyclical peak.</span>
          </div>
        </>
      )}
    </div>
  )
}
