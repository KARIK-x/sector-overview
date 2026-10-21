import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarClock, FileWarning, Lock, Newspaper } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardHeader, ErrorState, InfoNote, Loading, PageHeader, StatusBadge } from '../components/ui'

const PLANNED = [
  { title: 'Dividend declarations', detail: 'Cash and bonus dividend announcements, with ex-date and book-closure context.' },
  { title: 'AGM / SGM notices', detail: 'Meeting dates, agendas and resolutions that change sector-level capital structure.' },
  { title: 'Book closure & rights', detail: 'Rights issues, auction notices and capital changes affecting index weights.' },
  { title: 'Quarterly earnings releases', detail: 'Published filings linked to the fundamentals dataset, not scraped rumours.' },
  { title: 'Monetary & regulatory events', detail: 'NRB policy actions and SEBON rule changes with sector exposure tags.' },
  { title: 'Index methodology changes', detail: 'Constituent and weight changes published by NEPSE.' },
]

export default function EventsResearch() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['events'], queryFn: api.events })

  return (
    <div>
      <PageHeader
        eyebrow="Events & research"
        title="A calendar we refuse to invent."
        description="Sector narratives are often built on corporate events. This module will publish them only when a verified, licensed feed exists. Until then, it reports the gap explicitly."
        actions={<StatusBadge status="UNAVAILABLE" label="event feed unavailable" />}
      />

      {isLoading && <Card><Loading label="Checking event sources" rows={3} /></Card>}
      {isError && <Card><ErrorState error={error} onRetry={() => refetch()} /></Card>}

      {data && (
        <>
          <Card className="mb-4 overflow-hidden">
            <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div>
                <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl border bg-raised text-muted">
                  <Newspaper size={19} />
                </div>
                <h2 className="display text-[30px]">No verified event feed is connected.</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{data.reason}</p>
                <div className="mt-4 rounded-xl border bg-raised p-4">
                  <div className="eyebrow mb-1.5">Required source</div>
                  <p className="text-[12px] leading-relaxed">{data.required_source}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/data-quality" className="btn">Data quality center <ArrowUpRight size={12} /></Link>
                  <Link to="/methodology" className="btn">Methodology</Link>
                </div>
              </div>
              <div className="rounded-xl border bg-raised/60 p-4">
                <div className="flex items-center gap-2">
                  <Lock size={14} className="warn" />
                  <span className="eyebrow">Why not scrape it?</span>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  The official NEPSE endpoints that carry corporate disclosures require authenticated access and returned HTTP 401
                  during the source audit. That access was not bypassed. Public mirrors do not expose a complete, licensed
                  event history with reliable timestamps.
                </p>
                <div className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-muted">
                  Publishing incomplete event data would create a false sense of coverage — and would violate the project’s provenance rule.
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader
                eyebrow="Planned coverage"
                title="What will appear here"
                subtitle="Each item is scoped to sector-level relevance, not a stock-news feed."
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {PLANNED.map((p) => (
                  <div key={p.title} className="rounded-lg border p-3">
                    <div className="flex items-start gap-2">
                      <CalendarClock size={13} className="mt-0.5 shrink-0 text-accent" />
                      <div>
                        <div className="text-[12px] font-medium">{p.title}</div>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{p.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid gap-4">
              <Card>
                <CardHeader eyebrow="Source status" title="What the audit found" />
                <div className="space-y-2.5 text-[11px] leading-relaxed text-muted">
                  <p><b className="text-ink">Official NEPSE API</b> — authenticated; HTTP 401. Not bypassed. No event payload ingested.</p>
                  <p><b className="text-ink">Public mirrors</b> — index history and daily summaries are available; corporate events are not consistently published with machine-readable dates.</p>
                  <p><b className="text-ink">Licensing</b> — an event feed must carry explicit reuse permission. Unknown-licence scraping is excluded.</p>
                </div>
                <InfoNote tone="warn">
                  Absence of events on this page means absence of a verified source, not absence of events in the market.
                </InfoNote>
              </Card>
              <Card>
                <CardHeader eyebrow="Research posture" title="What this app will not do" />
                <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
                  <li>— Publish rumoured or social-media-sourced corporate actions.</li>
                  <li>— Attach dates that the source does not provide.</li>
                  <li>— Convert an event into a directional trade recommendation.</li>
                  <li>— Hide the coverage gap behind an empty but polished calendar.</li>
                </ul>
                <div className="mt-3 flex items-center gap-2 border-t pt-3 text-[10px] text-faint">
                  <FileWarning size={12} /> Status: NOT-TESTED against a live event feed (none connected)
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
