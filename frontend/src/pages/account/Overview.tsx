import type { EChartsOption } from 'echarts'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  Coins,
  MessageSquareText,
  ReceiptText,
  ShieldAlert,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Chart } from '../../components/Chart'
import { Card, CardHeader, EmptyState, ErrorState, InfoNote, Loading, Metric, StatusBadge } from '../../components/ui'
import { axisStyle, baseOption, palette } from '../../lib/chart'
import { cn, dateLabel } from '../../lib/format'
import { useTheme } from '../../lib/useTheme'
import {
  accountApi,
  fmtMoney,
  fmtQty,
  moneyValue,
  type AccountOverview,
  type CashflowDay,
} from '../../lib/account'
import { useAccount } from './account-context'
import { Amount, Money, StatusPill } from './parts'

function CashChart({ days }: { days: CashflowDay[] }) {
  const { isDark } = useTheme()
  const p = palette(isDark)
  const option = {
    ...baseOption(isDark),
    grid: { left: 52, right: 18, top: 34, bottom: 30 },
    legend: { ...baseOption(isDark).legend, top: 0, left: 0 },
    tooltip: {
      ...baseOption(isDark).tooltip,
      trigger: 'axis',
      valueFormatter: (value: unknown) => fmtMoney(value as number),
    },
    xAxis: {
      type: 'category',
      data: days.map((day) => day.date),
      ...axisStyle(isDark),
      axisLabel: {
        ...axisStyle(isDark).axisLabel,
        formatter: (value: string) => dateLabel(value).slice(0, 6),
      },
    },
    yAxis: {
      type: 'value',
      ...axisStyle(isDark),
      axisLabel: {
        ...axisStyle(isDark).axisLabel,
        formatter: (value: number) => `${Math.round(value / 1000)}k`,
      },
    },
    series: [
      {
        name: 'Confirmed cash',
        type: 'line',
        data: days.map((day) => moneyValue(day.confirmed_closing_balance)),
        showSymbol: false,
        lineStyle: { width: 2, color: p.accent },
        itemStyle: { color: p.accent },
      },
      {
        name: 'Projected cash',
        type: 'line',
        data: days.map((day) => moneyValue(day.projected_closing_balance)),
        showSymbol: false,
        lineStyle: { width: 2, color: p.muted, type: 'dashed' },
        itemStyle: { color: p.muted },
      },
    ],
  } as EChartsOption
  return <Chart option={option} height={260} exportName="account-cash-projection" />
}

function ChargesChart({ data }: { data: AccountOverview['charges_series'] }) {
  const { isDark } = useTheme()
  const p = palette(isDark)
  const option = {
    ...baseOption(isDark),
    grid: { left: 48, right: 14, top: 28, bottom: 28 },
    legend: { ...baseOption(isDark).legend, top: 0, left: 0 },
    tooltip: {
      ...baseOption(isDark).tooltip,
      trigger: 'axis',
      valueFormatter: (value: unknown) => fmtMoney(value as number),
    },
    xAxis: { type: 'category', data: data.map((row) => row.month), ...axisStyle(isDark) },
    yAxis: {
      type: 'value',
      ...axisStyle(isDark),
      axisLabel: {
        ...axisStyle(isDark).axisLabel,
        formatter: (value: number) => `${Math.round(value / 1000)}k`,
      },
    },
    series: [
      {
        name: 'Charges',
        type: 'bar',
        stack: 'charges',
        data: data.map((row) => moneyValue(row.charges)),
        itemStyle: { color: p.accent, borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 24,
      },
      {
        name: 'CGT',
        type: 'bar',
        stack: 'charges',
        data: data.map((row) => moneyValue(row.cgt)),
        itemStyle: { color: '#b06a14', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 24,
      },
    ],
  } as EChartsOption
  return <Chart option={option} height={220} exportName="account-charges" />
}

function EmptyLedger() {
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="eyebrow mb-2">Start with evidence</div>
          <h2 className="display text-[36px] leading-none">No trades imported yet.</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
            The ledger begins with a broker message or an exported SMS file. One bill with several
            securities stays one bill. Nothing is invented, and browser storage is never the ledger.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/account/import" className="btn btn-active text-[11px]">
              <MessageSquareText size={13} /> Import broker SMS
            </Link>
            <Link to="/account/settings" className="btn text-[11px]">
              <Wallet size={13} /> Set opening cash
            </Link>
          </div>
        </div>
        <div className="space-y-2">
          {[
            ['1', 'Paste or upload', 'Multi-stock BUY/SELL messages, .txt, .csv, or Android SMS Backup XML.'],
            ['2', 'Review every field', 'Edit or reject before commit. Duplicate messages are detected by a normalised fingerprint.'],
            ['3', 'Reconcile real charges', 'Broker BAmt is compared, not added twice. Missing tax rules stay unverified.'],
            ['4', 'Watch cash dates', 'BUY T+1, SELL EDIS/WACC T+1, and CDSC cash settlement T+2 are separate obligations.'],
          ].map(([step, title, body]) => (
            <div key={step} className="flex gap-3 rounded-lg border bg-raised/40 px-3 py-2.5">
              <span className="num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border bg-surface text-[9px] text-muted">{step}</span>
              <div>
                <div className="text-[12px] font-medium">{title}</div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-muted">{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export default function Overview() {
  const { token } = useAccount()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['account', 'overview'],
    queryFn: () => accountApi.overview(token),
    retry: false,
  })

  if (isLoading) return <Card><Loading label="Loading the private ledger" rows={5} /></Card>
  if (error || !data) return <Card><ErrorState error={error} onRetry={() => void refetch()} /></Card>

  const m = data.metrics
  const shortfall = m.first_shortfall
  const visibleDays = data.cashflow.days

  return (
    <div className="space-y-5">
      {!data.has_data && <EmptyLedger />}

      {shortfall && (
        <div className="flex flex-col gap-3 rounded-xl border border-[#b06a14]/30 bg-[#b06a14]/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[#b06a14] dark:text-[#e8b06a]" />
            <div>
              <div className="text-[13px] font-semibold">Cash shortfall projected on {dateLabel(shortfall.date)}</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                {fmtMoney(shortfall.amount)} is unfunded after payments due up to that date. Expected
                sale receipts later are not used to cover this earlier obligation.
              </p>
            </div>
          </div>
          <Link to="/account/cashflow" className="btn shrink-0 text-[11px]">Open cash flow <ArrowRight size={12} /></Link>
        </div>
      )}

      <Card>
        <CardHeader
          eyebrow="Position today"
          title="What is actually available"
          subtitle={`As of ${dateLabel(data.as_of)}. Confirmed cash excludes expected sale proceeds and all unrealised gains.`}
          actions={<StatusBadge status={m.potential_shortfall !== '0.00' ? 'INCOMPLETE' : 'VERIFIED'} label={m.potential_shortfall !== '0.00' ? 'funding gap' : 'no projected gap'} />}
        />
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Metric label="Actual bank cash" value={fmtMoney(m.actual_bank_balance)} sub="Confirmed movements only" />
          <Metric label="Projected cash" value={fmtMoney(m.projected_available_cash)} sub="After scheduled payments & receipts" tone={moneyValue(m.projected_available_cash) < 0 ? 'neg' : 'neutral'} />
          <Metric label="Committed payments" value={fmtMoney(m.committed_payments)} sub={m.next_payment_deadline ? `Next due ${dateLabel(m.next_payment_deadline)}` : 'No open BUY bill'} tone={m.committed_payments !== '0.00' ? 'warn' : 'neutral'} />
          <Metric label="Expected receipts" value={fmtMoney(m.expected_receipts)} sub="Unconfirmed SELL settlement" tone="neutral" />
          <Metric label="Potential shortfall" value={fmtMoney(m.potential_shortfall)} tone={m.potential_shortfall !== '0.00' ? 'neg' : 'pos'} sub={shortfall ? `First gap ${dateLabel(shortfall.date)}` : 'No gap in schedule'} />
          <Metric label="Realised P&L" value={fmtMoney(m.realized_pnl, true)} tone={moneyValue(m.realized_pnl) >= 0 ? 'pos' : 'neg'} sub="After fees and estimated CGT" />
          <Metric label="Unrealised P&L" value={m.unrealized_pnl ? fmtMoney(m.unrealized_pnl, true) : '—'} tone={m.unrealized_pnl && moneyValue(m.unrealized_pnl) >= 0 ? 'pos' : m.unrealized_pnl ? 'neg' : 'neutral'} sub="Not cash; marked to latest close" />
          <Metric label="Charges + CGT" value={fmtMoney(moneyValue(m.charges_paid) + moneyValue(m.cgt_paid))} sub={`${fmtMoney(m.charges_paid)} fees · ${fmtMoney(m.cgt_paid)} CGT`} />
        </div>
        {(m.unreviewed_messages > 0 || m.overdue_payments !== '0.00') && (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {m.overdue_payments !== '0.00' && (
              <InfoNote tone="warn">
                <b>{fmtMoney(m.overdue_payments)}</b> in BUY payments is past its saved deadline and has no recorded payment.
              </InfoNote>
            )}
            {m.unreviewed_messages > 0 && (
              <InfoNote tone="warn">
                <b>{m.unreviewed_messages}</b> message(s) need review and are not in the ledger. Open SMS Import.
              </InfoNote>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            eyebrow="Cash runway"
            title="Confirmed vs projected cash"
            subtitle="Solid is money already moved. Dashed includes future receipts and is not spendable until received."
            actions={<Link to="/account/cashflow" className="text-[11px] text-accent hover:underline">Detail <ArrowUpRight size={11} className="inline" /></Link>}
          />
          {visibleDays.length ? <CashChart days={visibleDays} /> : <EmptyState compact title="No cash dates yet" body="Add a bank account and import a bill to build the T+1 / T+2 schedule." />}
        </Card>

        <Card>
          <CardHeader eyebrow="Next obligations" title="Deadlines that matter" subtitle="BUY payment, SELL EDIS/WACC, and cash settlement are separate dates." />
          {data.upcoming.length === 0 ? (
            <EmptyState compact title="Nothing outstanding" body="Every imported bill has a recorded settlement, or there are no bills yet." />
          ) : (
            <div className="space-y-2">
              {data.upcoming.slice(0, 7).map((item) => (
                <div key={`${item.bill_id}-${item.type}`} className="rounded-lg border bg-raised/35 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn('chip', item.type === 'PAYMENT' ? 'border-[#b23b3b]/30 bg-[#b23b3b]/10 text-[#b23b3b] dark:text-[#f08a86]' : 'border-[#2c5d8f]/30 bg-[#2c5d8f]/10 text-[#2c5d8f] dark:text-[#7ab3e8]')}>
                          {item.type}
                        </span>
                        {item.overdue && <span className="chip border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]">overdue</span>}
                      </div>
                      <div className="mt-1 truncate text-[12px] font-medium">{item.symbols || `Bill ${item.bill_no ?? item.bill_id}`}</div>
                      <div className="mt-0.5 text-[10px] text-muted">
                        {item.broker_id ?? 'broker —'} · bill {item.bill_no ?? item.bill_id} · {item.reconciliation_status.replaceAll('_', ' ').toLowerCase()}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Amount value={item.outstanding} />
                      <div className="mt-0.5 text-[10px] text-muted">{item.due_date ? dateLabel(item.due_date) : 'date missing'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            eyebrow="Recent ledger"
            title="Last imported trades"
            actions={<Link to="/account/transactions" className="text-[11px] text-accent hover:underline">All transactions <ArrowUpRight size={11} className="inline" /></Link>}
          />
          {data.recent_transactions.length === 0 ? (
            <EmptyState compact title="No transactions" body="Import a broker SMS to begin." icon={<ReceiptText size={17} />} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Side</th><th>Symbol</th><th className="text-right">Qty</th><th className="text-right">Net</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.recent_transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="num text-[11px]">{dateLabel(tx.trade_date)}</td>
                      <td><StatusPill status={tx.side} label={tx.side} /></td>
                      <td><span className="font-medium">{tx.symbol}</span><span className="ml-1 text-[10px] text-muted">{tx.security_name ?? ''}</span></td>
                      <td className="num text-right">{fmtQty(tx.quantity)}</td>
                      <td className="text-right"><Amount value={tx.net_amount} /></td>
                      <td><StatusPill status={tx.reconciliation_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            eyebrow="Cost of trading"
            title="Charges by month"
            subtitle="Commission, SEBON, DP and CGT actually allocated to transactions."
            actions={<Link to="/account/settings" className="text-[11px] text-accent hover:underline">Rules <ArrowUpRight size={11} className="inline" /></Link>}
          />
          {data.charges_series.length ? <ChargesChart data={data.charges_series} /> : <EmptyState compact title="No charges yet" body="Charges appear after the first committed import." icon={<Coins size={17} />} />}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader
            eyebrow="Holdings"
            title="Open positions"
            actions={<Link to="/account/holdings" className="text-[11px] text-accent hover:underline">Detail <ArrowUpRight size={11} className="inline" /></Link>}
          />
          {data.holdings.rows.length === 0 ? (
            <EmptyState compact title="No open positions" body="A BUY adds a position; a SELL reduces it using WACC." icon={<TrendingUp size={17} />} />
          ) : (
            <div className="space-y-2">
              {data.holdings.rows.slice(0, 6).map((row) => (
                <div key={row.symbol} className="flex items-center justify-between gap-3 rounded-lg border bg-raised/35 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium">{row.symbol} <span className="font-normal text-muted">{row.name ?? ''}</span></div>
                    <div className="mt-0.5 text-[10px] text-muted">{fmtQty(row.quantity)} shares · avg {row.avg_cost ? fmtMoney(row.avg_cost) : '—'} · held {row.holding_days ?? '—'}d</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money value={row.unrealized_pnl} signed />
                    <div className="mt-0.5 text-[10px] text-muted">{row.market_price ? `@ ${fmtMoney(row.market_price)}` : 'no price'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader eyebrow="Assumptions & limits" title="What this page does not claim" />
          <div className="space-y-2">
            {data.notes.map((note, index) => (
              <div key={`${index}-${note.slice(0, 24)}`} className="flex gap-2 text-[11px] leading-relaxed text-muted">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-faint" />
                <span>{note}</span>
              </div>
            ))}
            {data.notes.length === 0 && <p className="text-[11px] text-muted">No additional notes.</p>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniLink to="/account/import" icon={<MessageSquareText size={13} />} label="Import SMS" />
            <MiniLink to="/account/settings" icon={<CalendarClock size={13} />} label="Holidays & rules" />
            <MiniLink to="/account/cashflow" icon={<Banknote size={13} />} label="Cash schedule" />
            <MiniLink to="/account/transactions" icon={<ReceiptText size={13} />} label="Correct a trade" />
          </div>
        </Card>
      </div>
    </div>
  )
}

function MiniLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-1.5 rounded-lg border bg-raised/30 px-2.5 py-2 text-[11px] text-muted transition-colors hover:bg-raised hover:text-ink">
      {icon} {label}
    </Link>
  )
}
