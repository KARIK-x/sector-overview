import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CheckCircle2, Database, FileWarning, RefreshCw, Server, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardHeader, ErrorState, InfoNote, Loading, Metric, PageHeader, StatusBadge } from '../components/ui'
import { cn, compact, dateLabel, num, pct } from '../lib/format'

const SOURCES = [
  {
    name: 'NEPSE historical index CSVs',
    role: 'Index-level history for NEPSE and 13 sector sub-indices',
    url: 'github.com/menaceXnadin/nepse-historical-market-data-csv',
    status: 'VERIFIED',
    note: 'Public raw CSV mirror. Unadjusted closes. Turnover is the index CSV volume column.',
  },
  {
    name: 'YONEPSE market metadata',
    role: 'Sector index metadata, membership and current market-cap snapshot',
    url: 'shubhamnpk.github.io/yonepse',
    status: 'VERIFIED',
    note: 'Static JSON, no authentication. Current snapshot only; not historical membership.',
  },
  {
    name: 'Nepal market daily summaries',
    role: 'Minimal security daily close, change, volume and turnover',
    url: 'github.com/binayabaral/nepal-market-data',
    status: 'VERIFIED',
    note: 'MIT-licensed public dataset. No intraday OHLC stored in this application.',
  },
  {
    name: 'YONEPSE company financials',
    role: 'EPS, P/E, paid-up capital, profit and net worth per share',
    url: 'shubhamnpk.github.io/yonepse/data/company/financials.json',
    status: 'PROVISIONAL',
    note: 'Reported fields only. Revenue, assets, liabilities and cash flow are absent.',
  },
  {
    name: 'Official NEPSE authenticated API',
    role: 'Would provide official sectorwise summaries and disclosures',
    url: 'nepalstock.com',
    status: 'UNAVAILABLE',
    note: 'Returned HTTP 401. Authentication was not bypassed. No official payload is used.',
  },
]

export default function DataQuality() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['data-quality'], queryFn: api.dataQuality })

  return (
    <div>
      <PageHeader
        eyebrow="Data quality center"
        title="Trust is a dataset property."
        description="Coverage, freshness, ingestion outcomes and known gaps. This page is deliberately unflattering: it is the audit trail for every number in the application."
        actions={
          <button className="btn" onClick={() => refetch()}>
            <RefreshCw size={13} /> Re-check
          </button>
        }
      />

      {isLoading && <Card><Loading label="Auditing datasets" rows={6} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <Metric
                label="Index series"
                value={data.index_coverage.length}
                sub={`${compact(data.index_coverage.reduce((s, r) => s + r.observations, 0))} verified observations`}
              />
            </Card>
            <Card>
              <Metric
                label="Daily summaries"
                value={compact(data.daily_summaries.rows)}
                sub={`${dateLabel(data.daily_summaries.first_date)} → ${dateLabel(data.daily_summaries.last_date)}`}
              />
            </Card>
            <Card>
              <Metric
                label="Security classification"
                value={pct(data.securities.classification_coverage, 1)}
                sub={`${data.securities.classified} of ${data.securities.total} reference securities`}
              />
            </Card>
            <Card>
              <Metric
                label="Fundamental reports"
                value={compact(data.fundamentals.reports)}
                sub={`${data.fundamentals.symbols} symbols`}
                tone="warn"
              />
            </Card>
          </div>

          <div className="mt-4 grid gap-4">
            <Card>
              <CardHeader
                eyebrow="Index coverage"
                title="Sessions delivered vs expected"
                subtitle="Expected sessions use the NEPSE trading calendar within each series’ own first/last date."
                actions={<StatusBadge status="VERIFIED" label="verified closes" />}
              />
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sector</th>
                      <th className="text-right">Obs.</th>
                      <th className="text-right">Expected</th>
                      <th className="text-right">Missing</th>
                      <th>First</th>
                      <th>Last</th>
                      <th className="w-32">Completeness</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.index_coverage.map((r) => {
                      const completeness = r.completeness ?? (r.expected_sessions ? 1 - r.missing_sessions / r.expected_sessions : 0)
                      return (
                        <tr key={r.code}>
                          <td>{r.name}</td>
                          <td className="num text-right">{compact(r.observations)}</td>
                          <td className="num text-right text-muted">{compact(r.expected_sessions)}</td>
                          <td className={cn('num text-right', r.missing_sessions > 0 ? 'warn' : 'text-muted')}>{r.missing_sessions}</td>
                          <td className="num text-[10px] text-muted">{r.first_date ?? '—'}</td>
                          <td className="num text-[10px] text-muted">{r.last_date ?? '—'}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line/70">
                                <div className="h-full rounded-full bg-accent/70" style={{ width: `${completeness * 100}%` }} />
                              </div>
                              <span className={cn('num w-9 shrink-0 text-right text-[10px]', completeness >= 0.98 ? 'text-muted' : 'warn')}>
                                {(completeness * 100).toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td><StatusBadge status={r.status} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <InfoNote>
                Missing sessions are counted against NEPSE trading dates. Sparse sub-indices are labelled INCOMPLETE rather than
                verified, and long-window returns for those series span more calendar time than their nominal session count. Gaps are
                shown, never filled.
              </InfoNote>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader eyebrow="Dataset inventory" title="What is stored" />
                <div className="space-y-2 text-[11px]">
                  {[
                    ['Index observations', compact(data.index_coverage.reduce((s, r) => s + r.observations, 0))],
                    ['Security daily summaries', compact(data.daily_summaries.rows)],
                    ['Reference securities', compact(data.securities.total)],
                    ['Ordinary equities', compact(data.securities.ordinary)],
                    ['Fundamental reports', compact(data.fundamentals.reports)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between border-b border-line/60 py-1.5 last:border-0">
                      <span className="text-muted">{k}</span>
                      <span className="num font-medium">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 rounded-lg border bg-raised p-2.5 text-[10px] leading-relaxed text-muted">
                  Intraday OHLC candles are <b className="text-ink">not stored</b>. Security summaries keep close, change, volume,
                  turnover, status and sector only.
                </div>
              </Card>

              <Card>
                <CardHeader eyebrow="Validation" title="Controls in place" />
                <ul className="space-y-2 text-[11px] leading-relaxed text-muted">
                  <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 pos" /> Unique <span className="font-mono">(index_code, trade_date)</span> and <span className="font-mono">(symbol, trade_date)</span> constraints prevent duplicates.</li>
                  <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 pos" /> Missing observations are never converted to zero or “unchanged”.</li>
                  <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 pos" /> Book value per share is cross-checked against the price implied by the same filing; implausible values are excluded from equity and ROE.</li>
                  <li className="flex gap-2"><CheckCircle2 size={13} className="mt-0.5 shrink-0 pos" /> Raw source responses are cached for audit and excluded from version control.</li>
                </ul>
              </Card>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader eyebrow="Ingestion runs" title="Latest pipeline activity" subtitle="Every ingest writes an explicit run record." />
              {data.ingestion_runs.length === 0 ? (
                <p className="py-4 text-xs text-muted">No ingestion runs recorded.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.ingestion_runs.map((r, i) => (
                    <div key={`${r.source}-${i}`} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px]">
                      <Server size={12} className="text-faint" />
                      <span className="font-mono text-[10px]">{r.source}</span>
                      <StatusBadge status={r.status} />
                      <span className="num ml-auto text-[10px] text-muted">{compact(r.rows)} rows</span>
                      <span className="num hidden text-[10px] text-faint sm:inline">{r.finished_at?.slice(0, 16).replace('T', ' ') ?? '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader eyebrow="Known issues" title="Open data gaps" subtitle="Disclosed, not hidden." />
              <div className="space-y-2">
                {[
                  ['Historical sector membership', 'Current official membership is applied to all history. No historical constituent file was available.'],
                  ['Transaction counts', 'The verified daily-summary feed does not include trade counts; turnover and volume are used instead.'],
                  ['Full fundamentals', 'Revenue, assets, liabilities, cash flow and dividends are not present in the source.'],
                  ['Corporate events', 'No licensed event feed is connected; the events module reports UNAVAILABLE.'],
                  ['Official NEPSE endpoints', 'Authenticated access returned HTTP 401 and was not bypassed.'],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-lg border p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                      <FileWarning size={12} className="warn" /> {title}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{body}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card className="mt-4">
            <InfoNote>
              The application analyses the 13 NEPSE sector sub-indices that have verified index history.
              NEPSE’s daily sector summary also reports preference shares, corporate debentures and promoter
              shares; those are turnover categories, not sector sub-indices, and are excluded from rotation
              and relative-strength calculations because no sub-index history is available.
            </InfoNote>
          </Card>

          <Card className="mt-4">
            <CardHeader eyebrow="Provenance" title="Source register" subtitle="Every dataset has a named origin, role and status." />
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCES.map((s) => (
                    <tr key={s.name}>
                      <td>
                        <div className="text-[12px] font-medium">{s.name}</div>
                        <div className="break-all font-mono text-[9px] text-faint">{s.url}</div>
                      </td>
                      <td className="max-w-[200px] whitespace-normal text-[10px] text-muted">{s.role}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td className="max-w-[240px] whitespace-normal text-[10px] leading-relaxed text-muted">{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoNote>
              <b>Reproducibility:</b> ingestion is idempotent. Re-running the pipeline will not duplicate observations because of
              database uniqueness constraints.
            </InfoNote>
            <InfoNote tone="warn">
              <b>Freshness:</b> the latest index close is {dateLabel(data.index_coverage[0]?.last_date)}. This application does not
              claim intraday or real-time coverage.
            </InfoNote>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1"><Database size={11} /> {num(data.securities.classified)} classified names</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><ShieldCheck size={11} /> No fabricated fills</span>
            <span>·</span>
            <Link to="/methodology" className="link inline-flex items-center gap-1">Methodology <ArrowUpRight size={10} /></Link>
          </div>
        </>
      )}
    </div>
  )
}
