import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import { Card, CardHeader, EmptyState, ErrorState, InfoNote, Loading } from '../../components/ui'
import { cn, dateLabel } from '../../lib/format'
import {
  accountApi,
  downloadText,
  fmtMoney,
  moneyValue,
  type AuditEvent,
  type BankAccount,
  type FeeRule,
} from '../../lib/account'
import { todayIso, useAccount } from './account-context'
import { Drawer, FIELD, Field, StatusPill } from './parts'

type Category = 'RESIDENT_INDIVIDUAL' | 'RESIDENT_ENTITY' | 'NON_RESIDENT'

export default function Settings() {
  const { token, vault, refreshMe, replaceToken, lock } = useAccount()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(() => ({
    label: vault.label,
    investor_category: vault.investor_category as Category,
    default_broker: vault.default_broker ?? '',
    holidays: (vault.settings.holiday_dates ?? []).join('\n'),
    buy_days: String(vault.settings.buy_payment_business_days),
    edis_days: String(vault.settings.edis_business_days),
    sell_days: String(vault.settings.sell_settlement_business_days),
  }))
  const [bankEditor, setBankEditor] = useState<{ open: boolean; account: BankAccount | null }>({ open: false, account: null })
  const [rotateOpen, setRotateOpen] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [keySaved, setKeySaved] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [feeSearch, setFeeSearch] = useState('')
  const [feeCode, setFeeCode] = useState('')
  const [currentOnly, setCurrentOnly] = useState(false)

  useEffect(() => {
    setForm({
      label: vault.label,
      investor_category: vault.investor_category as Category,
      default_broker: vault.default_broker ?? '',
      holidays: (vault.settings.holiday_dates ?? []).join('\n'),
      buy_days: String(vault.settings.buy_payment_business_days),
      edis_days: String(vault.settings.edis_business_days),
      sell_days: String(vault.settings.sell_settlement_business_days),
    })
  }, [vault])

  const accounts = useQuery({
    queryKey: ['account', 'bank-accounts'],
    queryFn: () => accountApi.bankAccounts(token),
  })
  const fees = useQuery({
    queryKey: ['account', 'fee-rules', currentOnly],
    queryFn: () => accountApi.feeRules(token, currentOnly ? todayIso() : undefined),
  })
  const audit = useQuery({
    queryKey: ['account', 'audit'],
    queryFn: () => accountApi.audit(token, 30),
  })

  const saveSettings = useMutation({
    mutationFn: () => {
      if (!form.label.trim()) throw new Error('Vault label cannot be empty.')
      const holidays = form.holidays.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
      const invalid = holidays.filter((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item) || Number.isNaN(Date.parse(`${item}T00:00:00`)))
      if (invalid.length) throw new Error(`Invalid holiday date(s): ${invalid.join(', ')}. Use YYYY-MM-DD.`)
      return accountApi.updateSettings(token, {
        label: form.label.trim(),
        investor_category: form.investor_category,
        default_broker: form.default_broker.trim() || null,
        holiday_dates: holidays,
        buy_payment_business_days: Number(form.buy_days),
        edis_business_days: Number(form.edis_days),
        sell_settlement_business_days: Number(form.sell_days),
      })
    },
    onSuccess: async () => {
      setNotice('Settings saved. New imports and deadline calculations use these rules; existing rows retain their saved fee snapshots.')
      setError(null)
      await refreshMe()
      await queryClient.invalidateQueries({ queryKey: ['account'] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save settings.'),
  })

  const rotate = useMutation({
    mutationFn: () => accountApi.rotateKey(token),
    onSuccess: async (data) => {
      setNewKey(data.token)
      setKeySaved(false)
      setRotateError(null)
      try {
        await replaceToken(data.token)
      } catch {
        setRotateError('The new key was issued, but this session could not refresh. Save the key and unlock again.')
      }
    },
    onError: (err) => setRotateError(err instanceof Error ? err.message : 'Could not rotate the key.'),
  })

  const feeRows = useMemo(() => {
    const rows = fees.data?.rules ?? []
    return rows.filter((rule) => {
      if (feeCode && !rule.code.startsWith(feeCode)) return false
      if (!feeSearch.trim()) return true
      const haystack = `${rule.code} ${rule.description} ${rule.version} ${rule.notes ?? ''}`.toLowerCase()
      return haystack.includes(feeSearch.trim().toLowerCase())
    })
  }, [fees.data, feeCode, feeSearch])

  const closeRotate = () => {
    if (newKey && !keySaved) return
    setRotateOpen(false)
    setNewKey(null)
    setKeySaved(false)
    setRotateError(null)
  }

  return (
    <div className="space-y-5">
      {notice && <InfoNote>{notice}</InfoNote>}
      {error && <InfoNote tone="warn">{error}</InfoNote>}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader
            eyebrow="Vault"
            title="Identity, investor category and deadlines"
            subtitle="Changing investor category recomputes CGT for existing SELL rows. Fee-rule snapshots on transactions are preserved for audit."
            actions={<span className="chip">{vault.cost_basis_method}</span>}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vault label" className="sm:col-span-2"><input className={FIELD} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} maxLength={120} /></Field>
            <Field label="Investor category" hint="CGT rates and eligibility differ by category.">
              <select className={FIELD} value={form.investor_category} onChange={(e) => setForm({ ...form, investor_category: e.target.value as Category })}>
                <option value="RESIDENT_INDIVIDUAL">Resident individual</option>
                <option value="RESIDENT_ENTITY">Resident entity</option>
                <option value="NON_RESIDENT">Non-resident</option>
              </select>
            </Field>
            <Field label="Default broker" hint="Used when a parsed message has no broker ID."><input className={FIELD} value={form.default_broker} onChange={(e) => setForm({ ...form, default_broker: e.target.value.toUpperCase() })} maxLength={32} placeholder="RK316455" /></Field>
            <Field label="Holiday dates" hint="One YYYY-MM-DD per line or comma separated. NEPSE does not publish a machine-readable holiday feed here; these are your explicit assumptions." className="sm:col-span-2">
              <textarea className={cn(FIELD, 'min-h-[86px] font-mono text-[11px] placeholder:italic placeholder:text-faint')} value={form.holidays} onChange={(e) => setForm({ ...form, holidays: e.target.value })} placeholder="Example only — no holidays configured:&#10;2026-10-20&#10;2026-10-21" />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="BUY payment offset" hint="Business days (T+1 = 1)"><input type="number" min="0" max="10" className={FIELD} value={form.buy_days} onChange={(e) => setForm({ ...form, buy_days: e.target.value })} /></Field>
            <Field label="EDIS/WACC offset" hint="Business days (T+1 = 1)"><input type="number" min="0" max="10" className={FIELD} value={form.edis_days} onChange={(e) => setForm({ ...form, edis_days: e.target.value })} /></Field>
            <Field label="Cash settlement" hint="Business days (T+2 = 2)"><input type="number" min="0" max="10" className={FIELD} value={form.sell_days} onChange={(e) => setForm({ ...form, sell_days: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn btn-active text-[11px] disabled:opacity-50" disabled={saveSettings.isPending} onClick={() => saveSettings.mutate()}>{saveSettings.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save settings</button>
            <button className="btn text-[11px]" onClick={() => setForm({ label: vault.label, investor_category: vault.investor_category as Category, default_broker: vault.default_broker ?? '', holidays: (vault.settings.holiday_dates ?? []).join('\n'), buy_days: String(vault.settings.buy_payment_business_days), edis_days: String(vault.settings.edis_business_days), sell_days: String(vault.settings.sell_settlement_business_days) })}><RefreshCw size={12} /> Reset form</button>
          </div>
          <InfoNote>
            The trading-week calendar is date-aware: Sunday–Thursday before 2026-04-06, Monday–Friday from that date.
            Holidays are never silently guessed. Verify your own settlement dates against TMS and your broker.
          </InfoNote>
        </Card>

        <Card>
          <CardHeader eyebrow="Security" title="Bearer-key vault" subtitle="The server stores only a SHA-256 hash of a high-entropy key. There is no password reset or support override." />
          <div className="space-y-2 text-[11px] leading-relaxed text-muted">
            <div className="flex items-start gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent" /><span>All account endpoints require the key. Every query is filtered by vault ID, so one key cannot read another vault.</span></div>
            <div className="flex items-start gap-2"><ShieldCheck size={13} className="mt-0.5 shrink-0 text-accent" /><span>Account responses use <code className="font-mono text-[10px]">Cache-Control: private, no-store</code> and are excluded from the public market cache.</span></div>
            <div className="flex items-start gap-2"><ShieldX size={13} className="mt-0.5 shrink-0 text-[#b06a14]" /><span>Anyone with the key can read and modify the ledger. Never paste it into chat, email, screenshots or a public issue.</span></div>
          </div>
          <div className="mt-4 grid gap-2">
            <button className="btn text-[11px]" onClick={lock}><Lock size={12} /> Lock this browser</button>
            <button className="btn text-[11px]" onClick={() => { setRotateOpen(true); setNewKey(null); setRotateError(null) }}><KeyRound size={12} /> Rotate recovery key</button>
          </div>
          <div className="mt-4 rounded-lg border bg-raised/35 px-3 py-2 text-[10px] leading-relaxed text-muted">
            When “Remember this device” was used, the browser caches only the key in localStorage. The ledger itself is server-side; clearing site data disconnects this browser but does not delete the vault.
          </div>
        </Card>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div><div className="eyebrow">Cash accounts</div><div className="text-[13px] font-semibold">Banks used for actual cash and bill assignment</div></div>
          <button className="btn btn-active text-[11px]" onClick={() => setBankEditor({ open: true, account: null })}><Plus size={12} /> Add bank account</button>
        </div>
        {accounts.isLoading ? <div className="p-4"><Loading label="Loading bank accounts" rows={2} /></div> : accounts.error ? <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} /> : (accounts.data?.accounts ?? []).length === 0 ? <EmptyState compact title="No bank accounts" body="Add an account and opening balance so cash flow has a starting point." /> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Account</th><th className="text-right">Opening balance</th><th>Opening date</th><th>Status</th><th className="text-right">Edit</th></tr></thead>
              <tbody>
                {(accounts.data?.accounts ?? []).map((account) => (
                  <tr key={account.id}>
                    <td><div className="font-medium">{account.name}</div><div className="text-[10px] text-muted">#{account.id} · {account.currency}</div></td>
                    <td className="text-right"><span className="num">{fmtMoney(account.opening_balance)}</span></td>
                    <td className="num text-[11px]">{dateLabel(account.opening_balance_date)}</td>
                    <td><div className="flex flex-wrap gap-1"><span className={cn('chip', account.active ? 'border-[#1f6f5f]/30 bg-[#1f6f5f]/10 text-[#1f6f5f] dark:text-[#6fbfa8]' : 'border-line bg-raised text-muted')}>{account.active ? 'active' : 'inactive'}</span>{account.is_default && <span className="chip border-accent/30 bg-accent-soft text-accent">default</span>}</div></td>
                    <td className="text-right"><button className="btn h-7 px-2 text-[10px]" onClick={() => setBankEditor({ open: true, account })}><PencilLine size={11} /> Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t px-4 py-2 text-[10px] text-muted">Opening balances and movements are explicit assumptions, not bank feeds. Editing an opening balance changes all subsequent projections.</div>
      </Card>

      <Card pad={false}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 py-3">
          <div><div className="eyebrow">Rules</div><div className="text-[13px] font-semibold">Fee and tax versions by trade date</div><div className="mt-0.5 text-[10px] text-muted">Selected by transaction date. PARTIAL/UNVERIFIED rules are reported as estimates, never as reconciled actuals.</div></div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Rule family"><select className={cn(FIELD, 'w-auto')} value={feeCode} onChange={(e) => setFeeCode(e.target.value)}><option value="">All</option><option value="BROKER_COMMISSION">Brokerage</option><option value="SEBON_FEE">SEBON</option><option value="DP_CHARGE">DP charge</option><option value="CGT">CGT</option></select></Field>
            <Field label="Search"><input className={cn(FIELD, 'w-36')} value={feeSearch} onChange={(e) => setFeeSearch(e.target.value)} placeholder="code or source" /></Field>
            <label className="mb-1 flex items-center gap-1.5 text-[10px] text-muted"><input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} /> Current only</label>
          </div>
        </div>
        {fees.isLoading ? <div className="p-4"><Loading label="Loading fee rules" rows={3} /></div> : fees.error ? <ErrorState error={fees.error} onRetry={() => void fees.refetch()} /> : (
          <div className="table-wrap">
            <table className="data-table compact table-fixed">
              <colgroup><col className="w-[34%]" /><col className="w-[15%]" /><col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[9%]" /><col className="w-[13%]" /></colgroup>
              <thead><tr><th>Code / rule</th><th>Applies to</th><th>Rate</th><th>Effective</th><th>Verification</th><th>Source</th></tr></thead>
              <tbody>
                {feeRows.map((rule) => (
                  <tr key={rule.id}>
                    <td className="wrap-cell align-top"><div className="font-mono text-[10px] font-medium">{rule.code}</div><div className="mt-0.5 text-[10px] leading-relaxed text-muted">{rule.description}</div></td>
                    <td className="wrap-cell align-top"><div className="text-[10px]">{rule.transaction_type} · {rule.security_type}</div><div className="text-[10px] text-muted">{rule.investor_category.replaceAll('_', ' ')} · {rule.holding_period}</div></td>
                    <td className="align-top"><div className="num text-[11px]">{formatRate(rule)}</div>{rule.minimum && <div className="text-[9px] text-muted">min {fmtMoney(rule.minimum)}</div>}</td>
                    <td className="align-top"><div className="num text-[10px]">{dateLabel(rule.effective_from)}</div><div className="num text-[10px] text-muted">{rule.effective_to ? `to ${dateLabel(rule.effective_to)}` : 'open-ended'}</div></td>
                    <td className="align-top"><StatusPill status={rule.verification} /></td>
                    <td className="wrap-cell align-top"><a className="inline-flex items-center gap-1 break-words text-[10px] leading-snug text-accent hover:underline" href={rule.source_url} target="_blank" rel="noreferrer">{rule.source_title}<ExternalLink size={9} className="shrink-0" /></a></td>
                  </tr>
                ))}
                {feeRows.length === 0 && <tr><td colSpan={6} className="text-center text-[11px] text-muted">No rules match that filter.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t px-4 py-3">
          <div className="mb-2 text-[10px] text-muted">{fees.data?.note ?? 'Rules are versioned by effective date.'}</div>
          <div className="flex flex-wrap gap-2">
            {(fees.data?.sources ?? []).map((source, index) => <a key={`${source.url}-${index}`} className="chip border-line bg-raised text-[10px] text-muted hover:text-ink" href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={9} /></a>)}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Audit" title="Recent account events" subtitle="Edits, reversals, settlement changes, imports and key rotation are recorded. Raw SMS is not copied into the audit note." actions={<span className="text-[10px] text-muted">{vault.id.slice(0, 8)}…</span>} />
        {audit.isLoading ? <Loading label="Loading audit trail" rows={3} /> : audit.error ? <ErrorState error={audit.error} onRetry={() => void audit.refetch()} /> : (audit.data?.events ?? []).length === 0 ? <EmptyState compact title="No audit events" body="Actions in this vault will be recorded here." /> : (
          <div className="space-y-1.5">
            {(audit.data?.events ?? []).slice(0, 15).map((event: AuditEvent) => (
              <div key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border bg-raised/25 px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2"><span className="chip">{event.entity_type}</span><span className="text-[11px] font-medium">{event.action.replaceAll('_', ' ')}</span>{event.note && <span className="max-w-[520px] truncate text-[10px] text-muted">{event.note}</span>}</div>
                <span className="num shrink-0 text-[9px] text-faint">{event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BankEditor
        open={bankEditor.open}
        account={bankEditor.account}
        onClose={() => setBankEditor({ open: false, account: null })}
        onSaved={async () => {
          setBankEditor({ open: false, account: null })
          await refreshMe()
          await queryClient.invalidateQueries({ queryKey: ['account'] })
        }}
      />

      <Drawer open={rotateOpen} onClose={closeRotate} title={newKey ? 'Save the new recovery key' : 'Rotate recovery key'} subtitle={newKey ? 'The old key is already invalid. This is the only time the new key will be shown.' : 'The old key stops working immediately. Any browser still using it will be locked out.'}>
        {newKey ? (
          <div className="space-y-3">
            <div className="rounded-xl border bg-raised/40 p-3">
              <div className="eyebrow mb-2">New recovery key</div>
              <code className="block select-all break-all rounded-lg border bg-surface p-3 font-mono text-[11px] leading-relaxed">{newKey}</code>
              <div className="mt-2 flex gap-2">
                <button className="btn text-[11px]" onClick={() => { void navigator.clipboard.writeText(newKey); setRotateError(null) }}><Copy size={12} /> Copy</button>
                <button className="btn text-[11px]" onClick={() => downloadText(`NEPSE private account recovery key\nVault: ${vault.label}\nRotated: ${new Date().toISOString()}\n\n${newKey}\n\nThis key cannot be recovered.\n`, 'nepse-account-recovery-key.txt')}><Download size={12} /> Download</button>
              </div>
            </div>
            {rotateError && <InfoNote tone="warn">{rotateError}</InfoNote>}
            <label className="flex items-start gap-2 text-[11px] leading-relaxed text-muted"><input type="checkbox" className="mt-0.5" checked={keySaved} onChange={(e) => setKeySaved(e.target.checked)} /> I saved this new key. I understand the previous key no longer works and this cannot be recovered.</label>
            <button className="btn btn-active w-full disabled:opacity-50" disabled={!keySaved} onClick={closeRotate}><Check size={13} /> Done</button>
          </div>
        ) : (
          <div className="space-y-3">
            {rotateError && <InfoNote tone="warn">{rotateError}</InfoNote>}
            <div className="rounded-xl border border-[#b23b3b]/25 bg-[#b23b3b]/5 p-3 text-[11px] leading-relaxed text-muted">
              <div className="mb-1 flex items-center gap-2 font-medium text-[#b23b3b] dark:text-[#f08a86]"><AlertTriangle size={13} /> This cannot be undone.</div>
              Rotating invalidates the current key and creates a new one. If another device is using the old key, it will need the new key to reconnect. The server keeps only hashes.
            </div>
            <button className="btn btn-active w-full disabled:opacity-50" disabled={rotate.isPending} onClick={() => rotate.mutate()}>{rotate.isPending ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Rotate key now</button>
          </div>
        )}
      </Drawer>
    </div>
  )
}

function formatRate(rule: FeeRule): string {
  if (rule.calculation === 'TIERED' && rule.brackets.length) {
    const first = Number(rule.brackets[0].rate) * 100
    const last = Number(rule.brackets[rule.brackets.length - 1].rate) * 100
    return `${first.toFixed(2)}% → ${last.toFixed(2)}% (${rule.brackets.length} tiers)`
  }
  if (rule.calculation === 'FLAT') return `${fmtMoney(rule.rate)} flat`
  if (rule.rate === null) return '—'
  const percent = Number(rule.rate) * 100
  return `${percent.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`
}

function BankEditor({
  open,
  account,
  onClose,
  onSaved,
}: {
  open: boolean
  account: BankAccount | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { token } = useAccount()
  const [form, setForm] = useState({ name: '', opening_balance: '0', opening_balance_date: '', is_default: false, active: true })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setForm({
      name: account?.name ?? '',
      opening_balance: account?.opening_balance ?? '0',
      opening_balance_date: account?.opening_balance_date ?? todayIso(),
      is_default: account?.is_default ?? false,
      active: account?.active ?? true,
    })
    setError(null)
  }, [open, account])
  const save = useMutation({
    mutationFn: () => {
      if (!form.name.trim()) throw new Error('Account name is required.')
      if (moneyValue(form.opening_balance) < 0) throw new Error('Opening balance cannot be negative.')
      const payload = {
        name: form.name.trim(),
        opening_balance: form.opening_balance || '0',
        opening_balance_date: form.opening_balance_date,
        is_default: form.is_default,
        ...(account ? { active: form.active } : {}),
      }
      return account
        ? accountApi.updateBankAccount(token, account.id, payload)
        : accountApi.createBankAccount(token, payload)
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the bank account.'),
  })
  return (
    <Drawer open={open} onClose={onClose} title={account ? `Edit ${account.name}` : 'Add bank account'} subtitle="Opening balance is a dated assumption, not a bank feed. It anchors all later cash-flow projections.">
      <div className="space-y-3">
        {error && <InfoNote tone="warn">{error}</InfoNote>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Account name" className="col-span-2"><input className={FIELD} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Opening balance (NPR)"><input type="number" min="0" step="0.01" className={FIELD} value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></Field>
          <Field label="Opening date"><input type="date" className={FIELD} value={form.opening_balance_date} onChange={(e) => setForm({ ...form, opening_balance_date: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Use as the default account for new imports</label>
        {account && <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>}
        <InfoNote>Deactivating the default account makes another account default, if one exists. Existing bills keep their recorded account assignment.</InfoNote>
        <button className="btn btn-active w-full disabled:opacity-50" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />} {account ? 'Save account' : 'Add account'}</button>
      </div>
    </Drawer>
  )
}
