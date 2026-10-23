import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { Card, CardHeader, EmptyState, ErrorState, InfoNote, Loading } from '../../components/ui'
import { cn, dateLabel } from '../../lib/format'
import {
  accountApi,
  downloadBlob,
  fmtMoney,
  fmtQty,
  moneyValue,
  type BankAccount,
  type Settlement,
  type TransactionDetail,
} from '../../lib/account'
import { useAccount, todayIso } from './account-context'
import { Amount, Drawer, FIELD, Field, StatusPill } from './parts'

type Filters = {
  q: string
  side: string
  symbol: string
  status: string
  reconciliation: string
  from: string
  to: string
  sort: string
  order: string
  page: number
  page_size: number
}

function paramsOf(filters: Filters) {
  return {
    q: filters.q || undefined,
    side: filters.side || undefined,
    symbol: filters.symbol || undefined,
    status: filters.status || undefined,
    reconciliation: filters.reconciliation || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    sort: filters.sort,
    order: filters.order,
    page: filters.page,
    page_size: filters.page_size,
  }
}

function draftOf(detail: TransactionDetail): Record<string, string> {
  const tx = detail.transaction
  return {
    symbol: tx.symbol,
    side: tx.side,
    trade_date: tx.trade_date,
    quantity: tx.quantity.replace(/0+$/, '').replace(/\.$/, ''),
    price: tx.price.replace(/0+$/, '').replace(/\.$/, ''),
    bill_no: tx.bill_no ?? '',
    bamt: tx.bamt ?? '',
    notes: tx.notes ?? '',
    payment_deadline: tx.payment_deadline ?? '',
    settlement_date: tx.settlement_date ?? '',
    edis_status: tx.edis_status ?? '',
    wacc_status: tx.wacc_status ?? '',
  }
}

export default function Transactions() {
  const { token } = useAccount()
  const [filters, setFilters] = useState<Filters>({
    q: '',
    side: '',
    symbol: '',
    status: '',
    reconciliation: '',
    from: '',
    to: '',
    sort: 'trade_date',
    order: 'desc',
    page: 1,
    page_size: 50,
  })
  const [selected, setSelected] = useState<number | null>(null)
  const [requestReverse, setRequestReverse] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const deferredQ = useDeferredValue(filters.q)
  const params = useMemo(() => paramsOf({ ...filters, q: deferredQ }), [filters, deferredQ])
  const query = useQuery({
    queryKey: ['account', 'transactions', params],
    queryFn: () => accountApi.transactions(token, params),
    placeholderData: (previous) => previous,
  })
  const accounts = useQuery({
    queryKey: ['account', 'bank-accounts'],
    queryFn: () => accountApi.bankAccounts(token),
  })

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }))
  const data = query.data
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  const options = data?.filter_options

  const exportCsv = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const blob = await accountApi.exportTransactions(token, params)
      downloadBlob(blob, `nepse-transactions-${todayIso()}.csv`)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 rounded-xl border bg-surface p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Summary label="Trades" value={String(data?.summary.count ?? '—')} sub={`${data?.summary.buy_count ?? 0} buys · ${data?.summary.sell_count ?? 0} sells`} />
        <Summary label="Buy value" value={fmtMoney(data?.summary.buy_value)} />
        <Summary label="Sell value" value={fmtMoney(data?.summary.sell_value)} />
        <Summary label="Charges" value={fmtMoney(data?.summary.charges_total)} />
        <Summary label="CGT" value={fmtMoney(data?.summary.cgt_total)} />
        <Summary label="Realised P&L" value={fmtMoney(data?.summary.realized_pnl, true)} tone={moneyValue(data?.summary.realized_pnl) >= 0 ? 'pos' : 'neg'} />
      </div>

      <Card pad={false}>
        <div className="border-b p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={filters.q}
                  onChange={(event) => update({ q: event.target.value })}
                  placeholder="Search symbol, security, bill or broker…"
                  className={cn(FIELD, 'pl-8')}
                  aria-label="Search transactions"
                />
              </div>
              <select className={cn(FIELD, 'w-auto')} value={filters.side} onChange={(event) => update({ side: event.target.value })} aria-label="Side">
                <option value="">All sides</option>
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
              </select>
              <select className={cn(FIELD, 'w-auto')} value={filters.symbol} onChange={(event) => update({ symbol: event.target.value })} aria-label="Symbol">
                <option value="">All symbols</option>
                {(options?.symbols ?? []).map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
              </select>
              <select className={cn(FIELD, 'w-auto')} value={filters.reconciliation} onChange={(event) => update({ reconciliation: event.target.value })} aria-label="Reconciliation">
                <option value="">All reconciliations</option>
                {(options?.reconciliations ?? []).map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
              </select>
              <button className="btn text-[11px]" onClick={() => void exportCsv()} disabled={exporting || !data?.total}>
                {exporting ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />} CSV
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 text-[10px] text-faint"><SlidersHorizontal size={11} /> Filters</span>
              <input type="date" className={cn(FIELD, 'w-auto')} value={filters.from} onChange={(event) => update({ from: event.target.value })} aria-label="From date" />
              <span className="text-[10px] text-faint">to</span>
              <input type="date" className={cn(FIELD, 'w-auto')} value={filters.to} onChange={(event) => update({ to: event.target.value })} aria-label="To date" />
              <select className={cn(FIELD, 'w-auto')} value={filters.status} onChange={(event) => update({ status: event.target.value })} aria-label="Ledger status">
                <option value="">Active rows</option>
                <option value="REVERSED">Reversed only</option>
                <option value="IMPORTED">Imported</option>
              </select>
              <select className={cn(FIELD, 'w-auto')} value={filters.sort} onChange={(event) => update({ sort: event.target.value })} aria-label="Sort field">
                <option value="trade_date">Trade date</option>
                <option value="symbol">Symbol</option>
                <option value="net_amount">Net amount</option>
                <option value="charges">Charges</option>
                <option value="cgt">CGT</option>
              </select>
              <select className={cn(FIELD, 'w-auto')} value={filters.order} onChange={(event) => update({ order: event.target.value })} aria-label="Sort direction">
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
              {(filters.q || filters.side || filters.symbol || filters.status || filters.reconciliation || filters.from || filters.to) && (
                <button className="btn text-[10px]" onClick={() => setFilters((current) => ({ ...current, q: '', side: '', symbol: '', status: '', reconciliation: '', from: '', to: '', page: 1 }))}>
                  <X size={11} /> Clear
                </button>
              )}
            </div>
          </div>
          {exportError && <div className="mt-2 text-[11px] text-[#b23b3b] dark:text-[#f08a86]">{exportError}</div>}
        </div>

        {query.isLoading ? (
          <div className="p-4"><Loading label="Loading transactions" rows={5} /></div>
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title="No transactions match" body="Adjust the filters or import a broker SMS. The list never includes raw message text." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Date</th><th>Side</th><th>Security</th><th className="text-right">Qty @ price</th>
                    <th className="text-right">Gross</th><th className="text-right">Costs</th>
                    <th className="text-right">Net</th><th>Bill</th><th>Status</th><th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((tx) => (
                    <tr key={tx.id} className={cn('cursor-pointer', tx.status === 'REVERSED' && 'opacity-55')} onClick={() => setSelected(tx.id)}>
                      <td className="num text-[11px]">{dateLabel(tx.trade_date)}</td>
                      <td><StatusPill status={tx.side} label={tx.side} /></td>
                      <td>
                        <div className="font-medium">{tx.symbol}</div>
                        <div className="max-w-[160px] truncate text-[10px] text-muted">{tx.security_name ?? tx.security_type}</div>
                      </td>
                      <td className="text-right">
                        <div className="num text-[11px]">{fmtQty(tx.quantity)}</div>
                        <div className="num text-[10px] text-muted">@ {fmtMoney(tx.price)}</div>
                      </td>
                      <td className="text-right"><Amount value={tx.gross_amount} /></td>
                      <td className="text-right">
                        <Amount value={tx.total_charges} />
                        {moneyValue(tx.cgt) > 0 && <div className="num text-[9px] text-muted">+ {fmtMoney(tx.cgt)} CGT</div>}
                      </td>
                      <td className="text-right"><Amount value={tx.net_amount} /></td>
                      <td>
                        <div className="text-[11px]">{tx.bill_no ? `#${tx.bill_no}` : '—'}</div>
                        <div className="text-[10px] text-muted">{tx.broker_id ?? '—'}</div>
                      </td>
                      <td><StatusPill status={tx.bill_reconciliation_status ?? tx.reconciliation_status} /></td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <button className="btn h-6 w-6 p-0" onClick={(event) => { event.stopPropagation(); setSelected(tx.id) }} aria-label="Open transaction">
                            <Pencil size={11} />
                          </button>
                          {tx.status !== 'REVERSED' && (
                            <button className="btn h-6 w-6 p-0 text-[#b23b3b] dark:text-[#f08a86]" onClick={(event) => { event.stopPropagation(); setSelected(tx.id); setRequestReverse(true) }} aria-label="Reverse transaction" title="Reverse this transaction (auditable delete)">
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <div className="text-[10px] text-muted">Page {data.page} of {totalPages} · {data.total} row(s) · raw SMS excluded from CSV</div>
              <div className="flex items-center gap-1">
                <button className="btn h-7 w-7 p-0" disabled={data.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))} aria-label="Previous page"><ChevronLeft size={13} /></button>
                <button className="btn h-7 w-7 p-0" disabled={data.page >= totalPages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))} aria-label="Next page"><ChevronRight size={13} /></button>
              </div>
            </div>
          </>
        )}
      </Card>

      <InfoNote>
        Corrections are audited. “Awaiting information” means cost basis, tax rules or broker evidence is missing;
        “Estimated” means a verified rule was applied but the number has not been reconciled to a contract note.
      </InfoNote>

      <TransactionDrawer
        id={selected}
        requestReverse={requestReverse}
        onClose={() => { setSelected(null); setRequestReverse(false) }}
        accounts={accounts.data?.accounts ?? []}
      />
    </div>
  )
}

function Summary({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow text-[9px]">{label}</div>
      <div className={cn('num mt-1 truncate text-[15px] font-medium', tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted">{sub}</div>}
    </div>
  )
}

function TransactionDrawer({
  id,
  requestReverse = false,
  onClose,
  accounts,
}: {
  id: number | null
  requestReverse?: boolean
  onClose: () => void
  accounts: BankAccount[]
}) {
  const { token } = useAccount()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['account', 'transaction', id],
    queryFn: () => accountApi.transaction(token, id as number),
    enabled: id !== null,
  })
  const detail = query.data
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [settle, setSettle] = useState({ amount: '', date: todayIso(), bank_account_id: '', reference: '' })
  const [reversingSettlement, setReversingSettlement] = useState<number | null>(null)
  const [settlementReason, setSettlementReason] = useState('')
  const [reverseReason, setReverseReason] = useState('')
  const [focusReverse, setFocusReverse] = useState(false)
  const reverseSectionRef = useRef<HTMLDivElement | null>(null)

  const fallbackAccount = accounts.find((account) => account.active && account.is_default) ?? accounts.find((account) => account.active) ?? accounts[0]
  // New settlements should only offer active banks. Keep an inactive bank visible
  // when it is already attached to the bill, so the existing history is not hidden.
  const settlementAccounts = accounts.filter(
    (account) => account.active || String(account.id) === settle.bank_account_id,
  )

  useEffect(() => {
    if (requestReverse) setFocusReverse(true)
  }, [requestReverse, id])

  useEffect(() => {
    if (!detail || !focusReverse) return
    const node = reverseSectionRef.current
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [detail, focusReverse])

  useEffect(() => {
    if (!detail) return
    const tx = detail.transaction
    setDraft(draftOf(detail))
    setSettle((current) => ({
      ...current,
      amount: '',
      reference: '',
      date: (tx.side === 'BUY' ? tx.payment_deadline : tx.settlement_date) ?? todayIso(),
      bank_account_id: String(detail.bill.bank_account_id ?? fallbackAccount?.id ?? ''),
    }))
    setMessage(null)
    setReason('')
    setReverseReason('')
    setReversingSettlement(null)
    setSettlementReason('')
    // Only reset the editable draft when a different transaction is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.transaction.id])

  useEffect(() => {
    if (!detail || !fallbackAccount) return
    setSettle((current) => (current.bank_account_id ? current : { ...current, bank_account_id: String(fallbackAccount.id) }))
  }, [detail?.transaction.id, fallbackAccount?.id])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['account'] })
  }

  const save = useMutation({
    mutationFn: () => {
      const tx = detail?.transaction
      if (!tx) throw new Error('Transaction is not loaded.')
      if (!reason.trim()) throw new Error('Add an audit reason before saving a correction.')
      const payload: Record<string, unknown> = {
        symbol: draft.symbol,
        side: draft.side,
        trade_date: draft.trade_date,
        quantity: draft.quantity,
        price: draft.price,
        bill_no: draft.bill_no || null,
        bamt: draft.bamt || null,
        notes: draft.notes || null,
        reason: reason.trim(),
      }
      // Send an explicitly edited deadline, but let the backend recompute it
      // when the side or trade date changed and the user left it untouched.
      if (draft.payment_deadline !== (tx.payment_deadline ?? '')) {
        payload.payment_deadline = draft.payment_deadline || null
      }
      if (draft.settlement_date !== (tx.settlement_date ?? '')) {
        payload.settlement_date = draft.settlement_date || null
      }
      if (draft.edis_status && draft.edis_status !== (tx.edis_status ?? '')) {
        payload.edis_status = draft.edis_status
      }
      if (draft.wacc_status && draft.wacc_status !== (tx.wacc_status ?? '')) {
        payload.wacc_status = draft.wacc_status
      }
      return accountApi.updateTransaction(token, tx.id, payload)
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(['account', 'transaction', id], data)
      setDraft(draftOf(data))
      setSettle((current) => ({
        ...current,
        date:
          (data.transaction.side === 'BUY'
            ? data.bill.payment_deadline
            : data.bill.settlement_date) ?? todayIso(),
        bank_account_id: String(data.bill.bank_account_id ?? current.bank_account_id ?? ''),
      }))
      await invalidate()
      setMessage('Correction saved with an audit entry.')
      setReason('')
    },
  })

  const reverseTx = useMutation({
    mutationFn: () => {
      if (!detail) throw new Error('Transaction is not loaded.')
      if (!reverseReason.trim()) throw new Error('Add a reason for the reversal.')
      return accountApi.reverseTransaction(token, detail.transaction.id, reverseReason.trim())
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(['account', 'transaction', id], data)
      await invalidate()
      setMessage('Transaction reversed. The original row remains in the audit trail.')
      setReverseReason('')
    },
  })

  const addSettlement = useMutation({
    mutationFn: () => {
      if (!detail) throw new Error('Transaction is not loaded.')
      if (!settle.amount || !settle.date) throw new Error('Amount and date are required.')
      return accountApi.createSettlement(token, detail.bill.id, {
        direction: detail.bill.side === 'BUY' ? 'PAYMENT' : 'RECEIPT',
        amount: settle.amount,
        settlement_date: settle.date,
        bank_account_id: settle.bank_account_id ? Number(settle.bank_account_id) : null,
        transaction_id: detail.transaction.id,
        reference: settle.reference || null,
      })
    },
    onSuccess: async () => {
      await invalidate()
      await query.refetch()
      setSettle((current) => ({ ...current, amount: '', reference: '' }))
      setMessage('Settlement recorded. Cash flow now treats it as actual cash.')
    },
  })

  const reverseSettlement = useMutation({
    mutationFn: (settlement: Settlement) => {
      if (!settlementReason.trim()) throw new Error('Add a reason for reversing the settlement.')
      return accountApi.reverseSettlement(token, settlement.id, settlementReason.trim())
    },
    onSuccess: async () => {
      await invalidate()
      await query.refetch()
      setReversingSettlement(null)
      setSettlementReason('')
      setMessage('Settlement reversed. It no longer counts as actual cash.')
    },
  })

  const mutationError = [save.error, reverseTx.error, addSettlement.error, reverseSettlement.error]
    .find((error) => error instanceof Error) as Error | undefined
  const hasActiveSettlements = detail?.settlements.some((settlement) => !settlement.reversed_at) ?? false

  if (id === null) return null

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={detail ? `${detail.transaction.side} ${detail.transaction.symbol}` : 'Transaction'}
      subtitle={detail ? `${dateLabel(detail.transaction.trade_date)} · bill ${detail.bill.bill_no ?? detail.bill.id} · ${detail.bill.broker_id ?? 'broker unknown'}` : 'Loading the audited transaction.'}
    >
      {query.isLoading ? <Loading label="Loading transaction" rows={4} /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : detail ? (
        <div className="space-y-5">
          {message && <InfoNote>{message}</InfoNote>}
          {mutationError && <InfoNote tone="warn">{mutationError.message}</InfoNote>}
          {detail.transaction.status === 'REVERSED' && <InfoNote tone="warn">This row is reversed. It stays visible for audit, but no longer affects holdings or cash obligations.</InfoNote>}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SmallStat label="Quantity" value={fmtQty(detail.transaction.quantity)} />
            <SmallStat label="Price" value={fmtMoney(detail.transaction.price)} />
            <SmallStat label="Gross" value={fmtMoney(detail.transaction.gross_amount)} />
            <SmallStat label="Net" value={fmtMoney(detail.transaction.net_amount)} />
            <SmallStat label="Commission" value={fmtMoney(detail.transaction.commission)} />
            <SmallStat label="SEBON" value={fmtMoney(detail.transaction.sebon_fee)} />
            <SmallStat label="DP charge" value={fmtMoney(detail.transaction.dp_charge)} />
            <SmallStat label="CGT" value={fmtMoney(detail.transaction.cgt)} />
            <SmallStat label="Cost basis" value={detail.transaction.cost_basis ? fmtMoney(detail.transaction.cost_basis) : '—'} />
            <SmallStat label="Realised P&L" value={detail.transaction.realized_pnl ? fmtMoney(detail.transaction.realized_pnl, true) : '—'} />
            <SmallStat label="Rule version" value={detail.transaction.fee_rule_version || '—'} />
            <SmallStat label="Line fee status" value={detail.transaction.reconciliation_status.replaceAll('_', ' ')} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-raised/25 p-3">
              <div className="eyebrow mb-2">Bill evidence</div>
              <div className="space-y-1.5 text-[11px]">
                <Line label="Broker BAmt" value={detail.bill.bamt ? fmtMoney(detail.bill.bamt) : 'Not reported'} />
                <Line label="Calculated cash" value={fmtMoney(detail.bill.calculated_total)} />
                <Line label="Bill cash used" value={fmtMoney(detail.bill.cash_amount)} />
                <Line label="Paid / received" value={`${fmtMoney(detail.bill.paid_amount)} / ${fmtMoney(detail.bill.received_amount)}`} />
                <Line label="Outstanding" value={fmtMoney(detail.bill.outstanding)} />
                <Line label="Payment status" value={detail.bill.payment_status.replaceAll('_', ' ')} />
                <Line label="Reconciliation" value={detail.bill.reconciliation_status.replaceAll('_', ' ')} />
                {detail.bill.bamt && detail.bill.side === 'BUY' && (
                  <Line label="BAmt difference" value={fmtMoney(moneyValue(detail.bill.bamt) - moneyValue(detail.bill.calculated_total), true)} />
                )}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-faint">
                BAmt is broker-reported and is never added to calculated charges a second time. A difference is evidence to review, not an error to hide.
              </p>
            </div>
            <div className="rounded-xl border bg-raised/25 p-3">
              <div className="eyebrow mb-2">Obligations</div>
              <div className="space-y-1.5 text-[11px]">
                <Line label="BUY payment deadline" value={detail.bill.payment_deadline ? dateLabel(detail.bill.payment_deadline) : '—'} />
                <Line label="EDIS deadline" value={detail.bill.edis_deadline ? dateLabel(detail.bill.edis_deadline) : '—'} />
                <Line label="EDIS status" value={detail.bill.edis_status.replaceAll('_', ' ')} />
                <Line label="WACC status" value={detail.bill.wacc_status.replaceAll('_', ' ')} />
                <Line label="CDSC cash settlement" value={detail.bill.settlement_date ? dateLabel(detail.bill.settlement_date) : '—'} />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-faint">BUY payment and SELL EDIS/WACC are T+1 obligations; CDSC cash settlement is T+2. These are not the same date.</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <CardHeader eyebrow="Correct with evidence" title="Edit transaction" subtitle="Every save is audited. A bill-level side or date change updates all lines in that bill." />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Symbol"><input className={FIELD} value={draft.symbol ?? ''} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} /></Field>
                <Field label="Side"><select className={FIELD} value={draft.side ?? ''} disabled={hasActiveSettlements} title={hasActiveSettlements ? 'Reverse the recorded payment or receipt before changing the side.' : undefined} onChange={(e) => setDraft({ ...draft, side: e.target.value })}><option value="BUY">BUY</option><option value="SELL">SELL</option></select></Field>
                <Field label="Trade date"><input type="date" className={FIELD} value={draft.trade_date ?? ''} onChange={(e) => setDraft({ ...draft, trade_date: e.target.value })} /></Field>
                <Field label="Bill no."><input className={FIELD} value={draft.bill_no ?? ''} onChange={(e) => setDraft({ ...draft, bill_no: e.target.value })} /></Field>
                <Field label="Quantity"><input type="number" min="0" step="0.0001" className={FIELD} value={draft.quantity ?? ''} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} /></Field>
                <Field label="Price"><input type="number" min="0" step="0.0001" className={FIELD} value={draft.price ?? ''} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
                <Field label="Broker BAmt"><input type="number" min="0" step="0.01" className={FIELD} value={draft.bamt ?? ''} onChange={(e) => setDraft({ ...draft, bamt: e.target.value })} /></Field>
                <Field label="Payment deadline"><input type="date" className={FIELD} value={draft.payment_deadline ?? ''} onChange={(e) => setDraft({ ...draft, payment_deadline: e.target.value })} /></Field>
                <Field label="Settlement date"><input type="date" className={FIELD} value={draft.settlement_date ?? ''} onChange={(e) => setDraft({ ...draft, settlement_date: e.target.value })} /></Field>
                <Field label="EDIS status"><select className={FIELD} value={draft.edis_status ?? ''} onChange={(e) => setDraft({ ...draft, edis_status: e.target.value })}><option value="">—</option><option value="PENDING">Pending</option><option value="COMPLETED">Completed</option><option value="NOT_REQUIRED">Not required</option><option value="WAIVED">Waived</option></select></Field>
                <Field label="WACC status"><select className={FIELD} value={draft.wacc_status ?? ''} onChange={(e) => setDraft({ ...draft, wacc_status: e.target.value })}><option value="">—</option><option value="PENDING">Pending</option><option value="COMPLETED">Completed</option><option value="NOT_REQUIRED">Not required</option><option value="WAIVED">Waived</option></select></Field>
                <Field label="Notes" className="col-span-2"><textarea className={cn(FIELD, 'min-h-[54px]')} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></Field>
                <Field label="Audit reason (required)" className="col-span-2"><input className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. contract note shows 400 shares" /></Field>
              </div>
              <button className="btn btn-active mt-2 w-full disabled:opacity-50" disabled={save.isPending || detail.transaction.status === 'REVERSED'} onClick={() => save.mutate()}>
                {save.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Pencil size={13} />} Save audited correction
              </button>
            </div>

            <div>
              <CardHeader eyebrow="Actual cash" title="Settlements" subtitle="Partial payments/receipts are allowed; the remainder stays projected. Reversing a settlement makes it non-cash again." />
              {detail.settlements.length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-5 text-center text-[11px] text-muted">No settlement recorded.</div>
              ) : (
                <div className="space-y-2">
                  {detail.settlements.map((settlement) => (
                    <div key={settlement.id} className={cn('rounded-lg border bg-raised/30 px-3 py-2', settlement.reversed_at && 'opacity-55')}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-medium">{settlement.direction} · {fmtMoney(settlement.amount)}</div>
                          <div className="mt-0.5 text-[10px] text-muted">{dateLabel(settlement.settlement_date)} · {settlement.reference ?? 'no reference'}{settlement.reversed_at ? ' · reversed' : ''}</div>
                        </div>
                        {!settlement.reversed_at && (
                          <button className="btn h-6 px-1.5 text-[10px]" onClick={() => {
                            setReversingSettlement(reversingSettlement === settlement.id ? null : settlement.id)
                            setSettlementReason('')
                            reverseSettlement.reset()
                          }}>
                            <RotateCcw size={10} /> Reverse
                          </button>
                        )}
                      </div>
                      {reversingSettlement === settlement.id && (
                        <div className="mt-2 flex gap-1.5">
                          <input className={FIELD} placeholder="Reason required" value={settlementReason} onChange={(e) => setSettlementReason(e.target.value)} />
                          <button className="btn text-[10px]" disabled={reverseSettlement.isPending || !settlementReason.trim()} onClick={() => reverseSettlement.mutate(settlement)}>Confirm</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {detail.bill.side === 'BUY' && detail.bill.payment_status !== 'PAID' || detail.bill.side === 'SELL' && detail.bill.payment_status !== 'RECEIVED' ? (
                <div className="mt-3 rounded-lg border p-3">
                  <div className="eyebrow mb-2">Record {detail.bill.side === 'BUY' ? 'payment' : 'receipt'}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Amount"><input type="number" min="0" step="0.01" className={FIELD} value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} placeholder={detail.bill.outstanding} /></Field>
                    <Field label="Date"><input type="date" className={FIELD} value={settle.date} onChange={(e) => setSettle({ ...settle, date: e.target.value })} /></Field>
                    <Field label="Bank account" className="col-span-2"><select className={FIELD} value={settle.bank_account_id} onChange={(e) => setSettle({ ...settle, bank_account_id: e.target.value })}><option value="">Unassigned</option>{settlementAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.active ? '' : ' (inactive)'}</option>)}</select></Field>
                    <Field label="Reference" className="col-span-2"><input className={FIELD} value={settle.reference} onChange={(e) => setSettle({ ...settle, reference: e.target.value })} placeholder="TMS / bank reference" /></Field>
                  </div>
                  <button className="btn mt-2 w-full" disabled={addSettlement.isPending || !settle.amount || moneyValue(detail.bill.outstanding) <= 0} onClick={() => addSettlement.mutate()}>
                    {addSettlement.isPending ? <RefreshCw size={13} className="animate-spin" /> : null} Record {detail.bill.side === 'BUY' ? 'payment' : 'receipt'}
                  </button>
                </div>
              ) : (
                <InfoNote>This bill is fully settled in the ledger.</InfoNote>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border p-3">
              <div className="eyebrow mb-2">Raw broker message</div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-raised/40 p-3 font-mono text-[10px] leading-relaxed text-muted">{detail.message?.raw_text ?? detail.transaction.raw_text ?? 'Raw message not available.'}</pre>
              <div className="mt-2 text-[10px] text-faint">Private to this vault. Never included in CSV exports or public cache responses.</div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="eyebrow mb-2">Audit trail</div>
              {detail.audit.length === 0 ? <div className="text-[11px] text-muted">No audit entries yet.</div> : (
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {detail.audit.map((event) => (
                    <div key={event.id} className="border-b pb-2 last:border-0 last:pb-0">
                      <div className="text-[10px] font-medium">{event.action.replaceAll('_', ' ')}</div>
                      <div className="mt-0.5 text-[10px] text-muted">{event.note ?? 'No note'} · {event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {detail.transaction.status !== 'REVERSED' && (
            <div className="rounded-xl border border-[#b23b3b]/25 bg-[#b23b3b]/5 p-3">
              <div className="flex items-center gap-2 text-[12px] font-medium"><AlertTriangle size={13} className="text-[#b23b3b] dark:text-[#f08a86]" /> Reverse this transaction</div>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">Reversal is auditable and does not delete the row. Reverse recorded settlements first.</p>
              <div className="mt-2 flex gap-1.5">
                <input className={FIELD} placeholder="Reason for reversal" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
                <button className="btn text-[10px]" disabled={reverseTx.isPending || !reverseReason.trim()} onClick={() => reverseTx.mutate()}>Reverse</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Drawer>
  )
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-raised/30 px-2.5 py-2">
      <div className="eyebrow text-[8px]">{label}</div>
      <div className="num mt-0.5 truncate text-[12px] font-medium">{value}</div>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/50 pb-1 last:border-0 last:pb-0">
      <span className="text-muted">{label}</span>
      <span className="num text-right font-medium">{value}</span>
    </div>
  )
}
