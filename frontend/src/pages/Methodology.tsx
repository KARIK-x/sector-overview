import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpen, CheckCircle2, Sigma } from 'lucide-react'
import { api } from '../lib/api'
import { Card, Loading, PageHeader, StatusBadge } from '../components/ui'

const SECTIONS = [
  ['scope', 'Scope & non-goals'],
  ['rotation', 'Rotation axes'],
  ['returns', 'Returns'],
  ['breadth', 'Breadth'],
  ['liquidity', 'Liquidity & concentration'],
  ['risk', 'Risk'],
  ['fundamentals', 'Fundamentals'],
  ['research', 'Factors & backtest'],
  ['provenance', 'Provenance & limitations'],
  ['statuses', 'Status vocabulary'],
]

function Formula({ children, note }: { children: string; note?: string }) {
  return (
    <div className="my-2 rounded-lg border bg-raised px-3 py-2.5">
      <code className="block overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-ink">{children}</code>
      {note && <p className="mt-1.5 text-[10px] leading-relaxed text-muted">{note}</p>}
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t pt-6 first:border-t-0 first:pt-0">
      <h2 className="display mb-3 text-[26px]">{title}</h2>
      <div className="space-y-2.5 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </section>
  )
}

const QUADRANT_ROWS = [
  ['WINNING', 'x > 0', 'y > 0', 'Positive absolute return and outperforming NEPSE'],
  ['ADVANCING', 'x ≤ 0', 'y > 0', 'Outperforming NEPSE while still negative in absolute terms'],
  ['LOSING', 'x > 0', 'y ≤ 0', 'Positive absolute return but lagging NEPSE'],
  ['LAGGING', 'x ≤ 0', 'y ≤ 0', 'Negative absolute return and underperforming NEPSE'],
]

export default function Methodology() {
  const { data, isLoading } = useQuery({ queryKey: ['methodology'], queryFn: api.methodology })

  return (
    <div>
      <PageHeader
        eyebrow="Methodology"
        title="Every number has a definition."
        description="Formulas, denominators, axis contracts and limitations. If a metric is not defined here, it is not used in the product."
        actions={<StatusBadge status="VERIFIED" label="documented" />}
      />

      {isLoading && <Card><Loading label="Loading methodology" rows={3} /></Card>}

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-xl border bg-surface p-3">
            <div className="eyebrow mb-2 px-1">Contents</div>
            <nav className="space-y-0.5">
              {SECTIONS.map(([id, label]) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="block rounded-md px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="mt-3 border-t pt-3 text-[9px] leading-relaxed text-faint">
              Version 0.1.0 · independent research project
            </div>
          </div>
        </aside>

        <Card className="space-y-8">
          <Section id="scope" title="Scope & non-goals">
            <p>
              <b className="text-ink">NEPSE Sector Intelligence</b> is a sector-level analytical application. It is not a stock
              trading terminal, does not rank individual securities for purchase, does not provide intraday candles, and does not
              ingest or reconstruct a full OHLC warehouse.
            </p>
            <p>
              Security-level daily summaries are stored only to compute sector breadth, participation, turnover, concentration and
              fundamental aggregates. The stored fields are close, previous close, change, percent change, volume, turnover, status
              and current sector membership.
            </p>
            <div className="rounded-lg border bg-raised p-3 text-[11px]">
              <div className="mb-1 font-medium text-ink">Hard exclusions</div>
              <ul className="grid gap-1 sm:grid-cols-2">
                <li>— Stock-picking pages or buy/sell signals</li>
                <li>— Individual candlestick charting</li>
                <li>— Intraday tick or order-book data</li>
                <li>— Fabricated fills for missing sessions</li>
              </ul>
            </div>
          </Section>

          <Section id="rotation" title="Rotation axes">
            <p>
              The Rotation Lab uses two explicit axes. The x-axis is <b className="text-ink">absolute strength</b>: the sector’s
              cumulative return over the selected lookback. The y-axis is <b className="text-ink">relative strength</b>: the same
              sector return minus NEPSE’s return over the identical sessions.
            </p>
            <Formula note="r_s is the sector sub-index cumulative return; r_m is NEPSE. Windows are trading sessions, not calendar days.">
              {`x = r_s = close_s[t] / close_s[t − w] − 1
y = r_s − r_m
RS ratio = (close_s[t] / close_s[t − w]) / (close_m[t] / close_m[t − w])`}
            </Formula>
            <div className="overflow-x-auto rounded-lg border">
              <table className="data-table">
                <thead>
                  <tr><th>Quadrant</th><th>x</th><th>y</th><th>Interpretation</th></tr>
                </thead>
                <tbody>
                  {QUADRANT_ROWS.map(([q, x, y, d]) => (
                    <tr key={q}>
                      <td className="font-mono text-[10px]">{q}</td>
                      <td className="num">{x}</td>
                      <td className="num">{y}</td>
                      <td className="whitespace-normal text-[10px] text-muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Boundaries are strict on the positive side and inclusive on the negative side. A sector exactly at zero relative
              strength is <i>not</i> classified as advancing. Configurable thresholds shift the origin; the default is zero.
            </p>
            <p>
              Trails are computed by replaying the same formula at each historical session and plotting the resulting
              (x, y) points. They are a path, not a forecast.
            </p>
          </Section>

          <Section id="returns" title="Returns">
            <p>All returns are cumulative close-to-close returns measured in trading-session positions.</p>
            <Formula note="No interpolation across missing sessions. If the required start or end observation is missing, the return is unavailable.">
              {`R(w) = close[t] / close[t − w] − 1
Daily return r[t] = close[t] / close[t−1] − 1`}
            </Formula>
            <p>
              Displayed horizons are 1, 5, 10, 20, 60, 120 and 252 sessions. The rotation lookback is user-selectable at 5, 10, 20,
              60 or 120 sessions, with 20 as the default.
            </p>
          </Section>

          <Section id="breadth" title="Breadth">
            <p>
              Breadth is computed from observed security daily summaries for the current sector membership. A security without a
              row on a session is <b className="text-ink">unavailable</b>; it is never treated as unchanged.
            </p>
            <Formula note="Denominators are observed securities only. Unavailable securities are reported separately.">
              {`advance_share = advances / (advances + declines + unchanged)
A/D ratio      = advances / declines        (undefined if declines = 0)
net advances   = advances − declines`}
            </Formula>
            <p>
              Moving-average breadth is the share of members whose latest close is above their own simple moving average
              (20/50/100/200 sessions). New highs and lows compare the latest close with the member’s own 252-session range.
            </p>
            <p className="rounded-lg border border-[#b06a14]/25 bg-[#b06a14]/5 px-3 py-2 text-[11px] text-[#7a5216] dark:text-[#e8b06a]">
              Historical sector membership is not published by the selected sources. Current membership is applied to history, which
              introduces look-ahead membership bias for older breadth observations.
            </p>
          </Section>

          <Section id="liquidity" title="Liquidity & concentration">
            <p>
              Turnover is the sum of observed traded amounts (NPR) for the sector. It is trading value, not net investor inflow.
              Volume is shares traded. Historical transaction counts are unavailable in the verified daily-summary source.
            </p>
            <Formula note="HHI is computed on turnover shares. Effective N is the reciprocal of HHI.">
              {`share_i = turnover_i / Σ turnover
HHI = Σ share_i²
effective N = 1 / HHI
top-N share = Σ(top N turnover) / Σ turnover`}
            </Formula>
            <p>
              HHI is bounded below by 1/N and above by 1. A higher HHI means turnover is concentrated in fewer names. It is not a
              forecast of future liquidity.
            </p>
          </Section>

          <Section id="risk" title="Risk">
            <p>Risk metrics use daily sector sub-index returns over a 252-session window unless stated otherwise.</p>
            <Formula>
              {`volatility = stdev(r) × √252
beta = cov(r_s, r_m) / var(r_m)
drawdown[t] = close[t] / max(close[0..t]) − 1
VaR 95% = 5th percentile of daily returns (historical)
CVaR 95% = mean of returns at or below the 5th percentile`}
            </Formula>
            <p>
              Beta measures sensitivity to NEPSE moves. A beta above 1 implies amplified sensitivity; below 1 implies dampened
              sensitivity. Correlation is reported separately because beta alone does not describe fit.
            </p>
            <p>
              Historical risk is descriptive. It does not capture gap risk, liquidity risk, regime change, or the possibility that
              the future distribution differs from the past.
            </p>
          </Section>

          <Section id="fundamentals" title="Fundamentals">
            <p>
              Only fields present in the verified financials feed are used: EPS, P/E, paid-up capital, net profit and net worth per
              share. Revenue, total assets, liabilities, operating cash flow and dividends are not available and are not estimated.
            </p>
            <Formula note="Par value is assumed NPR 100 for share-count conversion. This assumption is disclosed because the source reports paid-up capital, not share count. Book value per share is validated against the price implied by the same report (P/E × EPS) and rejected when the implied price-to-book ratio falls outside a wide 0.10–25 band.">
              {`shares_i ≈ paid_up_capital_i / 100
aggregate EPS = Σ profit / Σ shares
aggregate P/E = Σ market cap / Σ profit        (unavailable if Σ profit ≤ 0)
aggregate P/E ex-loss = Σ mcap(profitable) / Σ profit(profitable)
aggregate equity_i = net_worth_per_share_i × shares_i   (validated values only)
aggregate ROE = Σ profit / Σ equity`}
            </Formula>
            <p>
              The headline aggregate P/E includes loss-makers in the denominator, which is the honest reading of a
              capitalisation-weighted multiple. A positive-only variant is shown alongside it so the drag from losses is visible.
              Company-level P/E values are shown as reported; sector aggregates are computed from sums, never by averaging company
              ratios. Aggregates blend the latest available report per member, so fiscal periods can differ.
            </p>
            <p className="rounded-lg border border-[#b06a14]/25 bg-[#b06a14]/5 px-3 py-2 text-[11px] text-[#7a5216] dark:text-[#e8b06a]">
              The vendor source occasionally publishes corrupted net-worth-per-share values. Those are detected by the
              price-to-book cross-check, excluded from equity and ROE, and counted in the coverage notes rather than being averaged in.
            </p>
          </Section>

          <Section id="research" title="Factors & backtest">
            <p>
              Factor scores are cross-sector percentile ranks. Higher-is-better factors are ranked directly; low-volatility is
              inverted. Weights are user-defined and renormalised over the factors available for each sector.
            </p>
            <Formula note="Missing factors are omitted and disclosed. They never receive the worst score.">
              {`score_s = 100 × Σ_f ( weight_f / Σ_available weight ) × percentile_f(s)
coverage_s = available factors / total factors`}
            </Formula>
            <p>
              The illustrative backtest longs the top three sectors by 20-session relative strength, equal-weighted, rebalanced every
              five sessions. It models no transaction costs, taxes, slippage or capacity limits, and it uses current membership for
              history. It is a demonstration of the data pipeline, not a validated strategy.
            </p>
          </Section>

          <Section id="provenance" title="Provenance & limitations">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['Index history', 'Public raw CSV mirror. Unadjusted closes. Turnover from the index CSV volume column.'],
                ['Sector metadata', 'YONEPSE static JSON. Current snapshot, no historical membership.'],
                ['Security summaries', 'MIT-licensed public dataset. Minimal fields; no intraday OHLC stored.'],
                ['Fundamentals', 'YONEPSE financials JSON. Reported fields only; provisional status.'],
                ['Official NEPSE API', 'Authenticated; HTTP 401 during audit. Not bypassed.'],
                ['Events', 'No licensed feed. Module reports UNAVAILABLE rather than inventing a calendar.'],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border p-2.5">
                  <div className="text-[11px] font-medium text-ink">{k}</div>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{v}</p>
                </div>
              ))}
            </div>
            {data?.limitations && Array.isArray(data.limitations) && (
              <ul className="mt-2 space-y-1 text-[11px]">
                {data.limitations.map((l) => <li key={l}>— {l}</li>)}
              </ul>
            )}
            <p className="text-[11px]">
              This application is independent of any existing trading tool. It does not import another product’s frontend,
              backend, database, candle history, analytics engine, environment variables or infrastructure.
            </p>
          </Section>

          <Section id="statuses" title="Status vocabulary">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ['VERIFIED', 'Observed in a documented source and validated for the stated purpose.'],
                ['PROVISIONAL', 'Reported by the source but subject to filing revisions or incomplete coverage.'],
                ['INCOMPLETE', 'Some required observations are missing; the metric is shown with disclosure.'],
                ['PARTIAL_HISTORY', 'The series exists but is shorter than the full analytical window.'],
                ['UNAVAILABLE', 'No verified source; the metric is not computed or displayed as a number.'],
                ['STALE', 'The data is older than the expected refresh cadence.'],
                ['FAILED_VALIDATION', 'A validation rule failed; the affected value should not be trusted.'],
              ].map(([s, d]) => (
                <div key={s} className="flex items-start gap-2 rounded-lg border p-2.5">
                  <StatusBadge status={s} />
                  <span className="text-[10px] leading-relaxed text-muted">{d}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px]">
              <Link to="/data-quality" className="inline-flex items-center gap-1 text-accent hover:underline">
                Live coverage audit <ArrowUpRight size={11} />
              </Link>
              <span className="inline-flex items-center gap-1 text-muted"><Sigma size={11} /> Formulas are implemented and unit-tested</span>
              <span className="inline-flex items-center gap-1 text-muted"><CheckCircle2 size={11} /> No fabricated data</span>
            </div>
          </Section>

          <div className="flex items-center gap-2 border-t pt-4 text-[10px] text-faint">
            <BookOpen size={12} /> NEPSE Sector Intelligence · methodology v0.1.0 · not investment advice
          </div>
        </Card>
      </div>
    </div>
  )
}
