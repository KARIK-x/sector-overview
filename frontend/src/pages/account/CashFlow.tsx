import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Landmark,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react'
import { Chart } from '../../components/Chart'
import { Card, CardHeader, EmptyState, ErrorState, InfoNote, Loading, Metric } from '../../components/ui'
import { axisStyle, baseOption, palette } from '../../lib/chart'
import { cn, dateLabel } from '../../lib/format'
import { useTheme } from '../../lib/useTheme'
import {
  accountApi,
  fmtMoney,
  moneyValue,
  type BankAccount,
  type CashflowDay,
} from '../../lib/account'
import { useAccount, todayIso } from './account-context'
import { Amount, Drawer, FIELD, Field, StatusPill } from './parts'

function addDays(iso: string, days: number): string {
  // Parse as UTC so a browser with a positive local offset cannot shift the
  // calendar date when toISOString() converts it back.
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function CashFlowChart({ days }: { days: CashflowDay[] }) {
  const { isDark } = useTheme()
  const p = palette(isDark)
  const option = {
    ...baseOption(isDark),
    grid: { left: 56, right: 18, top: 34, bottom: 30 },
    legend: { ...baseOption(isDark).legend, top: 0, left: 0 },
    tooltip: {
      ...baseOption(isDark).tooltip,
      trigger: 'axis',
      valueFormatter: (value: unknown) => fmtMoney(value as number, true),
    },
    xAxis: {
      type: 'category',
      data: days.map((day) => day.date),
      ...axisStyle(isDark),
      axisLabel: { ...axisStyle(isDark).axisLabel, formatter: (value: string) => dateLabel(value).slice(0, 6) },
    },
    yAxis: {
      type: 'value',
      ...axisStyle(isDark),
      axisLabel: { ...axisStyle(isDark).axisLabel, formatter: (value: number) => `${Math.round(value / 1000)}k` },
    },
    series: [
      {
        name: 'Actual payments',
        type: 'bar',
        stack: 'cash',
        data: days.map((day) => -moneyValue(day.actual_payments)),
        itemStyle: { color: '#b23b3b', borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 12,
      },
      {
        name: 'Projected payments',
        type: 'bar',
        stack: 'cash',
        data: days.map((day) => -moneyValue(day.projected_payments)),
        itemStyle: { color: '#d48a8a', borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 12,
      },
      {
        name: 'Actual receipts',
        type: 'bar',
        stack: 'cash',
        data: days.map((day) => moneyValue(day.actual_receipts)),
        itemStyle: { color: '#1f6f5f', borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 12,
      },
      {
        name: 'Expected receipts',
        type: 'bar',
        stack: 'cash',
        data: days.map((day) => moneyValue(day.expected_receipts)),
        itemStyle: { color: '#7ab3e8', borderRadius: [2, 2, 0, 0] },
        barMaxWidth: 12,
      },
      {
        name: 'Projected closing',
        type: 'line',
        data: days.map((day) => moneyValue(day.projected_closing_balance)),
        showSymbol: false,
        lineStyle: { width: 2, color: p.ink },
        itemStyle: { color: p.ink },
      },
      {
        name: 'Confirmed closing',
        type: 'line',
        data: days.map((day) => moneyValue(day.confirmed_closing_balance)),
        showSymbol: false,
        lineStyle: { width: 1.5, color: p.muted, type: 'dashed' },
        itemStyle: { color: p.muted },
      },
    ],
  } as EChartsOption
  return <Chart option={option} height={300} exportName="account-cash-schedule" />
}

export default function CashFlow() {
  const { token } = useAccount()
  const queryClient = useQueryClient()
  const today = todayIso()
  const [start, setStart] = useState(addDays(today, -30))
  const [end, setEnd] = useState(addDays(today, 60))
  const [asOf, setAsOf] = useState(today)
  const [accountId, setAccountId] = useState('')
  const [activityOnly, setActivityOnly] = useState(true)
  const [movementOpen, setMovementOpen] = useState(false)
  const params = useMemo(
    () => ({ start: start || undefined, end: end || undefined, as_of: asOf || undefined, bank_account_id: accountId ? Number(accountId) : undefined }),
    [start, end, asOf, accountId],
  )
  const query = useQuery({
    queryKey: ['account', 'cashflow', params],
    queryFn: () => accountApi.cashflow(token, params),
  })
  const accounts = useQuery({
    queryKey: ['account', 'bank-accounts'],
    queryFn: () => accountApi.bankAccounts(token),
  })
  const movements = useQuery({
    queryKey: ['account', 'cash-movements', accountId],
    queryFn: () => accountApi.cashMovements(token, { bank_account_id: accountId ? Number(accountId) : undefined, include_reversed: true }),
  })
  const [reverseId, setReverseId] = useState<number | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [reverseNotice, setReverseNotice] = useState<string | null>(null)
  const reverse = useMutation({
    mutationFn: (id: number) => {
      const reason = reverseReason.trim()
      if (!reason) throw new Error('Add a reason for the reversal.')
      return accountApi.reverseCashMovement(token, id, reason)
    },
    onSuccess: async (result) => {
      setReverseId(null)
      setReverseReason('')
      setReverseNotice(
        result.movements.length > 1
          ? 'Transfer reversed on both accounts. Neither leg now counts as actual cash.'
          : 'Cash movement reversed. It no longer counts as actual cash.',
      )
      await queryClient.invalidateQueries({ queryKey: ['account'] })
    },
  })

  const data = query.data
  const days = useMemo(() => {
    const rows = data?.days ?? []
    return activityOnly
      ? rows.filter((day) => day.events.length > 0 || moneyValue(day.shortfall) > 0)
      : rows
  }, [data, activityOnly])
  const totals = useMemo(() => {
    let moneyIn = 0
    let moneyOut = 0
    let net = 0
    let projectedIn = 0
    let projectedOut = 0
    let other = 0
    for (const day of days) {
      const dayOther = moneyValue(day.other_movements)
      moneyIn += moneyValue(day.actual_receipts) + Math.max(0, dayOther)
      moneyOut += moneyValue(day.actual_payments) + Math.max(0, -dayOther)
      projectedIn += moneyValue(day.expected_receipts)
      projectedOut += moneyValue(day.projected_payments)
      net += moneyValue(day.net_cash_flow)
      other += dayOther
    }
    const ending = days.length ? moneyValue(days[days.length - 1].projected_closing_balance) : 0
    return { moneyIn, moneyOut, net, projectedIn, projectedOut, ending, other }
  }, [days])
  const accountMap = new Map((accounts.data?.accounts ?? []).map((account) => [account.id, account.name]))

  if (query.isLoading) return <Card><Loading label="Building the cash schedule" rows={5} /></Card>
  if (query.error || !data) return <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>

  return (
    <div className="space-y-5">
      {!data.available ? (
        <Card>
          <EmptyState
            title="No bank account yet"
            body="Add a bank account with an opening balance before projecting T+1 payments and T+2 receipts."
            action={<button className="btn btn-active" onClick={() => setMovementOpen(true)}>Open account tools</button>}
            icon={<Landmark size={18} />}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 rounded-xl border bg-surface p-4 sm:grid-cols-4">
            <Metric label="Actual bank cash" value={fmtMoney(data.metrics.actual_bank_balance)} sub={`Confirmed as of ${dateLabel(data.as_of)}`} />
            <Metric label="Projected cash" value={fmtMoney(data.metrics.projected_available_cash)} tone={moneyValue(data.metrics.projected_available_cash) < 0 ? 'neg' : 'neutral'} sub="At the end of this window" />
            <Metric label="Potential shortfall" value={fmtMoney(data.metrics.potential_shortfall)} tone={moneyValue(data.metrics.potential_shortfall) > 0 ? 'neg' : 'pos'} sub={data.metrics.first_shortfall ? dateLabel(data.metrics.first_shortfall.date) : 'No projected gap'} />
            <Metric label="Overdue payments" value={fmtMoney(data.metrics.overdue_payments)} tone={moneyValue(data.metrics.overdue_payments) > 0 ? 'warn' : 'neutral'} sub={data.metrics.next_payment_deadline ? `Next ${dateLabel(data.metrics.next_payment_deadline)}` : 'None outstanding'} />
          </div>

          {data.metrics.first_shortfall && (
            <InfoNote tone="warn">
              <b>{fmtMoney(data.metrics.first_shortfall.amount)}</b> shortfall on {dateLabel(data.metrics.first_shortfall.date)}. Expected sale receipts are shown separately and are not assumed to arrive before this payment.
            </InfoNote>
          )}

          <Card pad={false}>
            <div className="border-b p-4">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Window start"><input type="date" className={cn(FIELD, 'w-auto')} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                <Field label="Window end"><input type="date" className={cn(FIELD, 'w-auto')} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
                <Field label="As of"><input type="date" className={cn(FIELD, 'w-auto')} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
                <Field label="Bank account">
                  <select className={cn(FIELD, 'w-auto')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">All accounts</option>
                    {(accounts.data?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </Field>
                <label className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                  <input type="checkbox" checked={activityOnly} onChange={(e) => setActivityOnly(e.target.checked)} /> Activity only
                </label>
                <button className="btn ml-auto text-[11px]" onClick={() => setMovementOpen(true)}><SlidersHorizontal size={12} /> Cash movement</button>
              </div>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-[1.3fr_1fr]">
              <div>
                <CardHeader eyebrow="Daily chronology" title="Payments before receipts on the same day" subtitle="A receipt due on the same date cannot fund a payment that was due earlier." />
                {days.length ? <CashFlowChart days={days} /> : <EmptyState compact title="No activity in this window" body="Widen the dates or turn off “activity only”." />}
              </div>
              <div className="space-y-2">
                <div className="eyebrow">Account balances</div>
                {data.accounts.map((account) => (
                  <div key={account.id} className="rounded-lg border bg-raised/35 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-medium">{account.name}</span>
                      {account.is_default && <span className="chip border-accent/30 bg-accent-soft text-accent">default</span>}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-muted">
                      <div>Confirmed <div className="num text-[11px] text-ink">{fmtMoney(account.confirmed_balance)}</div></div>
                      <div>Projected <div className="num text-[11px] text-ink">{fmtMoney(account.projected_balance)}</div></div>
                    </div>
                    <div className="mt-1 text-[9px] text-faint">Opening {fmtMoney(account.opening_balance)} · {dateLabel(account.opening_balance_date)}</div>
                  </div>
                ))}
                <div className="mt-3 eyebrow">Shortfall days</div>
                {data.shortfalls.length === 0 ? <div className="rounded-lg border border-dashed px-3 py-3 text-[11px] text-muted">No projected shortfall in the computed schedule.</div> : (
                  <div className="space-y-1.5">
                    {data.shortfalls.slice(0, 6).map((item) => (
                      <div key={item.date} className="flex items-center justify-between rounded-lg border border-[#b06a14]/25 bg-[#b06a14]/5 px-2.5 py-1.5 text-[11px]">
                        <span>{dateLabel(item.date)}</span>
                        <Amount value={item.amount} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Money in" value={fmtMoney(totals.moneyIn)} sub={`+${fmtMoney(totals.projectedIn)} expected`} tone="pos" />
            <Metric label="Money out" value={fmtMoney(totals.moneyOut)} sub={`+${fmtMoney(totals.projectedOut)} due`} tone="neg" />
            <Metric label="Net cash" value={fmtMoney(totals.net, true)} tone={totals.net >= 0 ? 'pos' : 'neg'} sub="Actual movements only" />
            <Metric label="Ending balance" value={fmtMoney(totals.ending)} sub="Projected closing" />
          </div>

          <Card pad={false}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <div className="eyebrow">Chronological ledger</div>
                <div className="text-[13px] font-semibold">Opening, flows and closing cash</div>
              </div>
              <span className="text-[10px] text-muted">{days.length} day(s)</span>
            </div>
            {days.length === 0 ? <EmptyState compact title="No days shown" body="The selected range contains no events." /> : (
              <div className="table-wrap max-h-[560px] overflow-y-auto">
                <table className="data-table">
                  <thead><tr><th>Date</th><th className="text-right">Money in</th><th className="text-right">Money out</th><th className="text-right">Transfers / adj.</th><th className="text-right">Net cash</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {days.map((day) => (
                      <tr key={day.date}>
                        <td className="num text-[11px]">{dateLabel(day.date)}</td>
                        <td className="text-right">
                          <Amount value={day.actual_receipts} />
                          {moneyValue(day.expected_receipts) > 0 && <div className="text-[9px] text-muted">+{fmtMoney(day.expected_receipts)} expected</div>}
                        </td>
                        <td className="text-right">
                          <Amount value={day.actual_payments} />
                          {moneyValue(day.projected_payments) > 0 && <div className="text-[9px] text-muted">+{fmtMoney(day.projected_payments)} due</div>}
                        </td>
                        <td className="text-right"><Amount value={day.other_movements} signed /></td>
                        <td className="text-right"><Amount value={day.net_cash_flow} signed /></td>
                        <td className="text-right"><Amount value={day.projected_closing_balance} /></td>
                        <td><StatusPill status={day.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-raised/40 font-semibold">
                      <td>Total</td>
                      <td className="text-right">{fmtMoney(totals.moneyIn)}{totals.projectedIn > 0 && <div className="text-[9px] font-normal text-muted">+{fmtMoney(totals.projectedIn)} expected</div>}</td>
                      <td className="text-right">{fmtMoney(totals.moneyOut)}{totals.projectedOut > 0 && <div className="text-[9px] font-normal text-muted">+{fmtMoney(totals.projectedOut)} due</div>}</td>
                      <td className="text-right">{fmtMoney(totals.other, true)}</td>
                      <td className="text-right">{fmtMoney(totals.net, true)}</td>
                      <td className="text-right">{fmtMoney(totals.ending)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader eyebrow="Outstanding bills" title="Commitments and expected receipts" subtitle="Bills remain outstanding until a settlement is recorded. Partial amounts are supported." />
              {data.commitments.length === 0 ? <EmptyState compact title="No bills" body="Import a broker SMS to populate commitments." /> : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Bill</th><th>Side</th><th>Symbols</th><th className="text-right">Outstanding</th><th>Due / settle</th><th>Status</th></tr></thead>
                    <tbody>
                      {data.commitments.filter((item) => moneyValue(item.outstanding) > 0).map((item) => (
                        <tr key={item.bill_id}>
                          <td><div className="font-medium">#{item.bill_no ?? item.bill_id}</div><div className="text-[10px] text-muted">{item.broker_id ?? '—'}</div></td>
                          <td><StatusPill status={item.side} label={item.side} /></td>
                          <td className="max-w-[170px] truncate">{item.symbols || '—'}</td>
                          <td className="text-right"><Amount value={item.outstanding} /></td>
                          <td className="num text-[11px]">{dateLabel(item.side === 'BUY' ? item.payment_deadline : item.settlement_date)}</td>
                          <td><StatusPill status={item.reconciliation_status} /></td>
                        </tr>
                      ))}
                      {data.commitments.every((item) => moneyValue(item.outstanding) <= 0) && <tr><td colSpan={6} className="text-center text-[11px] text-muted">All bills are settled.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader eyebrow="Actual movements" title="Deposits, withdrawals & transfers" subtitle="These are user-recorded movements, not bank feeds." />
              {movements.isLoading ? <Loading label="Loading movements" rows={3} /> : movements.error ? <ErrorState error={movements.error} /> : (movements.data?.movements ?? []).length === 0 ? (
                <EmptyState compact title="No cash movements" body="Add an opening balance or cash movement to make the bank picture explicit." />
              ) : (
                <div className="space-y-1.5">
                  {reverseNotice && <InfoNote>{reverseNotice}</InfoNote>}
                  {reverse.error && <InfoNote tone="warn">{reverse.error instanceof Error ? reverse.error.message : 'Could not reverse the movement.'}</InfoNote>}
                  {(movements.data?.movements ?? []).slice(0, 12).map((movement) => (
                    <div key={movement.id} className={cn('rounded-lg border bg-raised/30 px-2.5 py-1.5', movement.reversed_at && 'opacity-50')}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-medium">{movement.kind.replaceAll('_', ' ')} · {accountMap.get(movement.bank_account_id) ?? `#${movement.bank_account_id}`}</div>
                          <div className="text-[10px] text-muted">{dateLabel(movement.movement_date)} · {movement.note ?? 'no note'}{movement.reversed_at ? ' · reversed' : ''}</div>
                        </div>
                        <div className="text-right"><Amount value={movement.signed_amount} signed /></div>
                        {!movement.reversed_at && <button
                          className="btn h-6 px-1.5 text-[9px]"
                          aria-label={`Reverse ${movement.kind.replaceAll('_', ' ').toLowerCase()} on ${dateLabel(movement.movement_date)}`}
                          title="Reverse this movement"
                          onClick={() => {
                            setReverseId(reverseId === movement.id ? null : movement.id)
                            setReverseReason('')
                            setReverseNotice(null)
                            reverse.reset()
                          }}
                        ><RotateCcw size={9} /></button>}
                      </div>
                      {reverseId === movement.id && (
                        <div className="mt-1.5 flex gap-1.5">
                          <input className={FIELD} placeholder="Reason required" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                          <button className="btn text-[10px]" onClick={() => reverse.mutate(movement.id)} disabled={reverse.isPending || !reverseReason.trim()}>Confirm</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader eyebrow="Method" title="What the schedule assumes" subtitle="Dates are date-aware and configurable. Holidays are not silently invented." />
            <div className="grid gap-2 sm:grid-cols-2">
              {data.assumptions.map((assumption) => <InfoNote key={assumption}>{assumption}</InfoNote>)}
            </div>
            {data.notes.length > 0 && <div className="mt-3 space-y-1">{data.notes.map((note) => <div key={note} className="flex gap-2 text-[11px] text-muted"><AlertTriangle size={11} className="mt-0.5 shrink-0 text-faint" />{note}</div>)}</div>}
          </Card>
        </>
      )}

      <CashMovementDrawer
        open={movementOpen}
        onClose={() => setMovementOpen(false)}
        accounts={accounts.data?.accounts ?? []}
        onSaved={async () => {
          setMovementOpen(false)
          await queryClient.invalidateQueries({ queryKey: ['account'] })
        }}
      />
    </div>
  )
}

function CashMovementDrawer({
  open,
  onClose,
  accounts,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  accounts: BankAccount[]
  onSaved: () => Promise<void>
}) {
  const { token } = useAccount()
  const [form, setForm] = useState({ kind: 'DEPOSIT', bank_account_id: '', counter_account_id: '', amount: '', date: todayIso(), note: '' })
  const [error, setError] = useState<string | null>(null)
  const selectableAccounts = accounts.filter((account) => account.active)
  const fallbackAccount = selectableAccounts.find((account) => account.is_default) ?? selectableAccounts[0]
  const defaultBankId = String(fallbackAccount?.id ?? '')
  const bankId = form.bank_account_id || defaultBankId
  useEffect(() => {
    if (!open) return
    setForm({
      kind: 'DEPOSIT',
      bank_account_id: String(fallbackAccount?.id ?? ''),
      counter_account_id: '',
      amount: '',
      date: todayIso(),
      note: '',
    })
    setError(null)
    // The form resets when the drawer opens; account changes while it is open are handled by the fallback below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const mutation = useMutation({
    mutationFn: () => {
      if (!bankId) throw new Error('Choose a bank account.')
      if (!form.amount) throw new Error('Enter an amount.')
      const payload: Record<string, unknown> = {
        kind: form.kind,
        bank_account_id: Number(bankId),
        movement_date: form.date,
        amount: form.amount,
        note: form.note || null,
      }
      if (form.kind === 'TRANSFER_OUT' || form.kind === 'TRANSFER_IN') {
        if (!form.counter_account_id) throw new Error('Choose a counterpart account.')
        payload.counter_account_id = Number(form.counter_account_id)
      }
      return accountApi.createCashMovement(token, payload)
    },
    onSuccess: async () => {
      await onSaved()
      setForm({ kind: 'DEPOSIT', bank_account_id: String(fallbackAccount?.id ?? ''), counter_account_id: '', amount: '', date: todayIso(), note: '' })
      setError(null)
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the movement.'),
  })
  const isTransfer = form.kind === 'TRANSFER_IN' || form.kind === 'TRANSFER_OUT'

  return (
    <Drawer open={open} onClose={onClose} title="Record a cash movement" subtitle="Deposits and withdrawals change actual cash immediately. Transfers create two linked rows; reverse both sides if needed.">
      <div className="space-y-3">
        {error && <InfoNote tone="warn">{error}</InfoNote>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kind">
            <select className={FIELD} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="DEPOSIT">Deposit</option>
              <option value="WITHDRAWAL">Withdrawal</option>
              <option value="ADJUSTMENT">Adjustment (+/−)</option>
              <option value="TRANSFER_OUT">Transfer out / to another account</option>
              <option value="TRANSFER_IN">Transfer in / from another account</option>
            </select>
          </Field>
          <Field label="Amount (NPR)"><input type="number" step="0.01" className={FIELD} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" className={FIELD} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Bank account"><select className={FIELD} value={bankId} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}><option value="">Choose…</option>{selectableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>
          {isTransfer && <Field label="Counterpart account" className="col-span-2"><select className={FIELD} value={form.counter_account_id} onChange={(e) => setForm({ ...form, counter_account_id: e.target.value })}><option value="">Choose…</option>{selectableAccounts.filter((account) => String(account.id) !== bankId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field>}
          <Field label="Note" className="col-span-2"><input className={FIELD} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional reference" /></Field>
        </div>
        <InfoNote>An adjustment can be negative to correct a previously recorded balance. It is not a substitute for a reversal; use reversals for wrong rows.</InfoNote>
        <button className="btn btn-active w-full disabled:opacity-50" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : form.kind.includes('DEPOSIT') || form.kind === 'TRANSFER_IN' ? <ArrowDownToLine size={13} /> : form.kind === 'TRANSFER_OUT' ? <ArrowLeftRight size={13} /> : <ArrowUpFromLine size={13} />}
          Save movement
        </button>
      </div>
    </Drawer>
  )
}
