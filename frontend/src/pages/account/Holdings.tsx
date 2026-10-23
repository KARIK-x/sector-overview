import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, PencilLine, PieChart, RefreshCw, Trash2 } from 'lucide-react'
import { Card, CardHeader, EmptyState, ErrorState, InfoNote, Loading, Metric } from '../../components/ui'
import { cn, dateLabel } from '../../lib/format'
import {
  accountApi,
  fmtMoney,
  fmtQty,
  moneyValue,
  type HoldingRow,
} from '../../lib/account'
import { useAccount, todayIso } from './account-context'
import { Amount, Drawer, FIELD, Field, Money, StatusPill } from './parts'

export default function Holdings() {
  const { token } = useAccount()
  const queryClient = useQueryClient()
  const [asOf, setAsOf] = useState(todayIso())
  const [includeClosed, setIncludeClosed] = useState(false)
  const [editing, setEditing] = useState<HoldingRow | null>(null)
  const query = useQuery({
    queryKey: ['account', 'holdings', asOf, includeClosed],
    queryFn: () => accountApi.holdings(token, { as_of: asOf || undefined, include_closed: includeClosed }),
  })

  const data = query.data
  const priced = (data?.rows ?? []).filter((row) => moneyValue(row.market_value) > 0)
  const totalPriced = priced.reduce((sum, row) => sum + moneyValue(row.market_value), 0)
  const maxPosition = Math.max(1, ...priced.map((row) => moneyValue(row.market_value)))

  if (query.isLoading) return <Card><Loading label="Computing WACC holdings" rows={5} /></Card>
  if (query.error || !data) return <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 rounded-xl border bg-surface p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric valueClassName="text-[18px]" label="Open positions" value={String(data.summary.open_positions)} sub={data.method} />
        <Metric valueClassName="text-[18px]" label="Cost basis" value={fmtMoney(data.summary.cost_basis)} sub="WACC, buy charges included" />
        <Metric valueClassName="text-[18px]" label="Market value" value={fmtMoney(data.summary.market_value)} sub="Latest close or manual" />
        <Metric valueClassName="text-[18px]" label="Unrealised P&L" value={data.summary.unrealized_pnl ? fmtMoney(data.summary.unrealized_pnl, true) : '—'} tone={data.summary.unrealized_pnl && moneyValue(data.summary.unrealized_pnl) >= 0 ? 'pos' : data.summary.unrealized_pnl ? 'neg' : 'neutral'} sub="Not cash" />
        <Metric valueClassName="text-[18px]" label="Realised P&L" value={fmtMoney(data.summary.realized_pnl, true)} tone={moneyValue(data.summary.realized_pnl) >= 0 ? 'pos' : 'neg'} sub="After fees and CGT" />
        <Metric valueClassName="text-[18px]" label="Charges" value={fmtMoney(data.summary.charges)} sub="Allocated trading costs" />
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-end gap-3 border-b p-4">
          <Field label="As of"><input type="date" className={cn(FIELD, 'w-auto')} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
          <label className="mb-1 flex items-center gap-1.5 text-[10px] text-muted"><input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} /> Include fully closed positions</label>
          <div className="ml-auto text-[10px] text-muted">{data.holding_period_basis}</div>
        </div>

        {data.rows.length === 0 ? (
          <EmptyState
            title="No holdings to show"
            body="Import a BUY bill to open a position. A SELL reduces the position using WACC; fully closed rows stay hidden unless selected."
            icon={<PieChart size={18} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr><th>Symbol</th><th className="text-right">Qty @ avg</th><th className="text-right">Cost basis</th><th className="text-right">Price</th><th className="text-right">Market value</th><th className="text-right">Unrealised</th><th className="text-right">Realised / charges</th><th>Held</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.symbol} className={cn(row.status === 'CLOSED' && 'opacity-55')}>
                    <td><div className="font-medium">{row.symbol}</div><div className="max-w-[160px] truncate text-[10px] text-muted">{row.name ?? '—'}</div></td>
                    <td className="text-right"><div className="num text-[11px]">{fmtQty(row.quantity)}</div><div className="num text-[10px] text-muted">@ {row.avg_cost ? fmtMoney(row.avg_cost) : '—'}</div></td>
                    <td className="text-right"><Amount value={row.cost_basis} /></td>
                    <td className="text-right"><Amount value={row.market_price} /><div className="text-[9px] text-muted">{row.market_price_source === 'MANUAL' ? 'manual' : row.market_price_date ? dateLabel(row.market_price_date) : '—'}</div></td>
                    <td className="text-right"><Amount value={row.market_value} /></td>
                    <td className="text-right"><Money value={row.unrealized_pnl} signed /></td>
                    <td className="text-right"><Money value={row.realized_pnl} signed /><div className="num text-[9px] text-muted">fee {fmtMoney(row.charges)}</div></td>
                    <td className="num text-[11px]">{row.holding_days === null ? '—' : `${row.holding_days}d`}</td>
                    <td><StatusPill status={row.status} /></td>
                    <td className="text-right"><button className="btn h-6 w-6 p-0" onClick={() => setEditing(row)} aria-label={`Set price for ${row.symbol}`}><PencilLine size={11} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader eyebrow="Concentration" title="Where the position risk sits" subtitle="Share of priced market value. Unpriced positions are excluded, not valued at zero." />
          {priced.length === 0 ? <EmptyState compact title="No market values" body="Set a manual price or load NEPSE daily summaries." /> : (
            <div className="space-y-2">
              {priced.sort((a, b) => moneyValue(b.market_value) - moneyValue(a.market_value)).slice(0, 10).map((row) => (
                <div key={row.symbol}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium">{row.symbol} <span className="font-normal text-muted">{row.name ?? ''}</span></span>
                    <span className="num text-muted">{totalPriced ? `${((moneyValue(row.market_value) / totalPriced) * 100).toFixed(1)}%` : '—'} · {fmtMoney(row.market_value)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-accent" style={{ width: `${(moneyValue(row.market_value) / maxPosition) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader eyebrow="Method & limits" title="How cost basis and tax periods are split" />
          <div className="space-y-2">
            {data.notes.map((note, index) => <div key={`${index}-${note.slice(0, 20)}`} className="flex gap-2 text-[11px] leading-relaxed text-muted"><AlertTriangle size={11} className="mt-0.5 shrink-0 text-faint" />{note}</div>)}
          </div>
          <InfoNote tone="warn">
            A SELL that exceeds recorded quantity is marked “cost basis incomplete” and its realised P&amp;L is not presented as final. Import the missing BUY or correct the trade first.
          </InfoNote>
        </Card>
      </div>

      <PriceDrawer row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: ['account'] }) }} />
    </div>
  )
}

function PriceDrawer({ row, onClose, onSaved }: { row: HoldingRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { token } = useAccount()
  const [price, setPrice] = useState('')
  const [asOf, setAsOf] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!row) return
    setPrice(row.market_price ?? '')
    setAsOf(todayIso())
    setNote('')
    setError(null)
  }, [row])
  const save = useMutation({
    mutationFn: () => {
      if (!row) throw new Error('No holding selected.')
      if (!price || Number(price) <= 0) throw new Error('Enter a positive price.')
      return accountApi.setPrice(token, row.symbol, { price, as_of: asOf, note: note || null })
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the price.'),
  })
  const clear = useMutation({
    mutationFn: () => {
      if (!row) throw new Error('No holding selected.')
      return accountApi.clearPrice(token, row.symbol)
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not clear the price.'),
  })

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={row ? `Manual price · ${row.symbol}` : 'Manual price'}
      subtitle={row ? `${fmtQty(row.quantity)} shares · cost basis ${fmtMoney(row.cost_basis)} · ${row.market_price_source ?? 'no source'}` : undefined}
    >
      {row && (
        <div className="space-y-3">
          {error && <InfoNote tone="warn">{error}</InfoNote>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Price per share"><input type="number" min="0.01" step="0.01" className={FIELD} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={row.market_price ?? ''} /></Field>
            <Field label="As of"><input type="date" className={FIELD} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
            <Field label="Note" className="col-span-2"><input className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. last close before suspension" /></Field>
          </div>
          <InfoNote>
            A manual price is a dated override, not a live quote. It is used only for this vault and can be removed.
          </InfoNote>
          <div className="flex gap-2">
            <button className="btn btn-active flex-1 disabled:opacity-50" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <RefreshCw size={13} className="animate-spin" /> : <PencilLine size={13} />} Save price</button>
            {row.market_price_source === 'MANUAL' && <button className="btn" disabled={clear.isPending} onClick={() => clear.mutate()}><Trash2 size={13} /> Clear</button>}
          </div>
        </div>
      )}
    </Drawer>
  )
}
