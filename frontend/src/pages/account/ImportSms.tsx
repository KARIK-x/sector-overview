import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Info,
  Loader2,
  MessageSquareText,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardHeader, EmptyState, ErrorState, InfoNote, Loading } from '../../components/ui'
import { cn, dateLabel } from '../../lib/format'
import {
  accountApi,
  fmtMoney,
  type ImportPreview,
  type ImportHistoryRow,
  type MessageOverride,
  type PreviewMessage,
  type SmsMessageRow,
} from '../../lib/account'
import { useAccount, todayIso } from './account-context'
import { Amount, FIELD, Field, StatusPill } from './parts'

type SourceType = 'PASTE' | 'TXT' | 'CSV' | 'XML' | 'JSON'
type LineDraft = { line_no: number; symbol: string; quantity: string; price: string }
type Draft = {
  approved: boolean
  broker_id: string
  trade_date: string
  side: '' | 'BUY' | 'SELL'
  bill_no: string
  bamt: string
  payment_url: string
  lines: LineDraft[]
  expanded: boolean
}

const SAMPLE = `RK316455, you bought HIDCLP-500.0@213.84 JBBL-200.0@377.57 on 2026-04-15 BAmt 183167.22. Please pay through your TMS with in T+1 to avoid Penalty of LATE FEE.BNo.48.

RK316455,You Sold RSML 20.0@4659.00 SYPNL 60.0@1844.83 on 2026-04-15. Please update WACC & do EDIS with in T+1 to avoid 20% Penalty.BNo.48`

function draftFrom(message: PreviewMessage): Draft {
  return {
    approved: !message.duplicate_of && message.status === 'PARSED',
    broker_id: message.broker_id ?? '',
    trade_date: message.trade_date ?? '',
    side: message.side ?? '',
    bill_no: message.bill_no ?? '',
    bamt: message.bamt ?? '',
    payment_url: message.payment_url ?? '',
    lines: message.lines.map((line) => ({
      line_no: line.line_no,
      symbol: line.symbol,
      quantity: line.quantity,
      price: line.price,
    })),
    expanded: message.status !== 'ERROR',
  }
}

function sameNumber(left: string, right: string): boolean {
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9
}

function overridesFor(message: PreviewMessage, draft: Draft): MessageOverride | null {
  const override: MessageOverride = {}
  let dirty = false
  if ((draft.broker_id.trim().toUpperCase() || null) !== (message.broker_id ?? null)) {
    override.broker_id = draft.broker_id.trim().toUpperCase() || undefined
    dirty = true
  }
  if ((draft.trade_date || null) !== (message.trade_date ?? null)) {
    override.trade_date = draft.trade_date || null
    dirty = true
  }
  if ((draft.side || null) !== (message.side ?? null)) {
    override.side = draft.side || null
    dirty = true
  }
  if ((draft.bill_no.trim() || null) !== (message.bill_no ?? null)) {
    override.bill_no = draft.bill_no.trim() || undefined
    dirty = true
  }
  if ((draft.bamt.trim() || null) !== (message.bamt ?? null)) {
    override.bamt = draft.bamt.trim() || null
    dirty = true
  }
  if ((draft.payment_url.trim() || null) !== (message.payment_url ?? null)) {
    override.payment_url = draft.payment_url.trim() || undefined
    dirty = true
  }
  const linesDirty =
    draft.lines.length !== message.lines.length ||
    draft.lines.some((line, index) => {
      const original = message.lines[index]
      return (
        !original ||
        line.symbol.trim().toUpperCase() !== original.symbol ||
        !sameNumber(line.quantity, original.quantity) ||
        !sameNumber(line.price, original.price)
      )
    })
  if (linesDirty) {
    override.lines = draft.lines.map((line, index) => ({
      line_no: index,
      symbol: line.symbol.trim().toUpperCase(),
      quantity: line.quantity,
      price: line.price,
    }))
    dirty = true
  }
  return dirty ? override : null
}

function inferSource(filename: string): SourceType {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'csv') return 'CSV'
  if (ext === 'xml') return 'XML'
  if (ext === 'json') return 'JSON'
  return 'TXT'
}

export default function ImportSms() {
  const { token } = useAccount()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState<string | null>(null)
  const [sourceType, setSourceType] = useState<SourceType>('PASTE')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commitResult, setCommitResult] = useState<{ imported: number; rejected: number; needs_review: number; duplicates: number; buy_bills: number; sell_bills: number; line_items: number } | null>(null)
  const [reopeningId, setReopeningId] = useState<number | null>(null)

  const history = useQuery({
    queryKey: ['account', 'imports'],
    queryFn: () => accountApi.imports(token),
  })
  const reviewMessages = useQuery({
    queryKey: ['account', 'messages', 'NEEDS_REVIEW'],
    queryFn: () => accountApi.messages(token, 'NEEDS_REVIEW'),
  })

  const previewMutation = useMutation({
    mutationFn: (payload: { content: string; source_type: SourceType; filename: string | null }) =>
      accountApi.previewImport(token, {
        source_type: payload.source_type,
        filename: payload.filename,
        content: payload.content,
      }),
    onSuccess: (data) => {
      setPreview(data)
      setDrafts(data.messages.map(draftFrom))
      setCommitResult(null)
      setError(null)
      setMessage(null)
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not parse that input.'),
  })

  const commit = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('Nothing to commit.')
      if (!drafts.some((draft) => draft.approved)) throw new Error('Approve at least one message before committing.')
      return accountApi.commitImport(token, {
        source_type: preview.batch.source_type,
        filename: preview.batch.filename,
        messages: preview.messages.map((row, index) => {
          const draft = drafts[index]
          return {
            raw_text: row.raw_text,
            sender: row.sender,
            received_at: row.received_at,
            approved: draft.approved,
            overrides: overridesFor(row, draft),
          }
        }),
      })
    },
    onSuccess: async (data) => {
      setCommitResult(data.summary as unknown as typeof commitResult)
      setPreview(null)
      setDrafts([])
      setContent('')
      setFilename(null)
      setMessage('Import committed. Duplicate messages were skipped by server-side fingerprint.')
      await queryClient.invalidateQueries({ queryKey: ['account'] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Import failed.'),
  })

  const updateDraft = (index: number, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)))
  const updateLine = (index: number, lineIndex: number, patch: Partial<LineDraft>) =>
    setDrafts((current) =>
      current.map((draft, position) =>
        position === index
          ? { ...draft, lines: draft.lines.map((line, i) => (i === lineIndex ? { ...line, ...patch } : line)) }
          : draft,
      ),
    )

  const approvedCount = drafts.filter((draft) => draft.approved).length
  const duplicateCount = preview?.messages.filter((row) => row.duplicate_of).length ?? 0

  const loadSample = () => {
    setMode('paste')
    setSourceType('PASTE')
    setFilename(null)
    setContent(SAMPLE)
    setPreview(null)
    setCommitResult(null)
    setError(null)
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2_000_000) {
      setError('File is larger than 2 MB. Split the export or use paste.')
      return
    }
    try {
      const text = await file.text()
      setMode('file')
      setFilename(file.name)
      setSourceType(inferSource(file.name))
      setContent(text)
      setPreview(null)
      setCommitResult(null)
      setError(null)
    } catch {
      setError('Could not read that file in this browser.')
    }
  }

  const reopen = async (row: SmsMessageRow) => {
    setReopeningId(row.id)
    setError(null)
    try {
      const detail = await accountApi.message(token, row.id)
      const raw = detail.message.raw_text
      if (!raw) throw new Error('The stored message has no raw text to reopen.')
      setMode('paste')
      setSourceType('PASTE')
      setFilename(null)
      setContent(raw)
      setCommitResult(null)
      previewMutation.mutate({ content: raw, source_type: 'PASTE', filename: null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen that message.')
    } finally {
      setReopeningId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            eyebrow="Controlled import"
            title="Broker SMS to private ledger"
            subtitle="One multi-scrip message stays one bill. Nothing is committed until you review it."
            actions={
              <span className="chip border-[#1f6f5f]/30 bg-[#1f6f5f]/10 text-[#1f6f5f] dark:text-[#6fbfa8]">
                <ShieldCheck size={11} /> server-side parse
              </span>
            }
          />
          <div className="mb-3 flex rounded-lg border bg-raised p-0.5">
            {(['paste', 'file'] as const).map((item) => (
              <button
                key={item}
                className={cn('flex-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors', mode === item ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')}
                onClick={() => {
                  setMode(item)
                  if (item === 'paste') setSourceType('PASTE')
                }}
              >
                {item === 'paste' ? 'Paste message text' : 'Upload .txt / .csv / .xml'}
              </button>
            ))}
          </div>

          {mode === 'paste' ? (
            <textarea
              className={cn(FIELD, 'min-h-[170px] resize-y font-mono text-[11px] leading-relaxed')}
              value={content}
              onChange={(event) => {
                setContent(event.target.value)
                setFilename(null)
                setSourceType('PASTE')
                setPreview(null)
              }}
              placeholder="Paste one or more broker messages. Keep each bill in its own message; do not combine two bills."
            />
          ) : (
            <div
              className="rounded-xl border border-dashed bg-raised/25 p-5 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                void readFile(event.dataTransfer.files[0])
              }}
            >
              <Upload size={22} className="mx-auto text-faint" />
              <div className="mt-2 text-[12px] font-medium">Drop an exported SMS file here</div>
              <div className="mt-1 text-[10px] leading-relaxed text-muted">Plain text, CSV from SMS Backup &amp; Restore, Android XML, or a JSON message array. Max 2 MB.</div>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.text,.csv,.xml,.json,.log,.md"
                className="hidden"
                onChange={(event) => void readFile(event.target.files?.[0])}
              />
              <button className="btn mt-3 text-[11px]" onClick={() => fileRef.current?.click()}><FileText size={12} /> Choose file</button>
              {filename && (
                <div className="mt-3 flex items-center justify-center gap-2 text-[11px]">
                  <span className="font-medium">{filename}</span>
                  <span className="chip">{sourceType}</span>
                  <button className="text-faint hover:text-ink" onClick={() => { setFilename(null); setContent(''); setPreview(null); if (fileRef.current) fileRef.current.value = '' }} aria-label="Remove file"><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          )}

          {error && <div className="mt-3"><InfoNote tone="warn">{error}</InfoNote></div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn btn-active text-[11px] disabled:opacity-50"
              disabled={!content.trim() || previewMutation.isPending}
              onClick={() => {
                setError(null)
                previewMutation.mutate({ content, source_type: sourceType, filename })
              }}
            >
              {previewMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <MessageSquareText size={13} />}
              {previewMutation.isPending ? 'Parsing…' : 'Preview import'}
            </button>
            <button className="btn text-[11px]" onClick={loadSample}>Load synthetic sample</button>
            {content && <button className="btn text-[11px]" onClick={() => { setContent(''); setFilename(null); setPreview(null); setDrafts([]); setError(null) }}><RotateCcw size={12} /> Reset</button>}
          </div>
        </Card>

        <Card>
          <CardHeader eyebrow="Privacy by design" title="What this does and does not read" />
          <div className="space-y-2.5">
            {[
              ['No inbox permission', 'The browser cannot read your SMS database, and this app never asks for it. You choose exactly one paste or file.'],
              ['No messages sent', 'The app never sends SMS, email or notifications to brokers, banks or third parties. It has no third-party message integration.'],
              ['Private vault only', 'Parsed text and trades live in this vault. Account APIs are bearer-key protected and return Cache-Control: private, no-store.'],
              ['iOS limitation', 'Safari does not expose the Messages database. Copy individual messages, or export/share text from the Messages app.'],
              ['Android limitation', 'Android blocks arbitrary SMS reads without a sensitive permission. Export with SMS Backup & Restore or your phone’s exporter, then upload the XML/CSV here.'],
            ].map(([title, body]) => (
              <div key={title} className="flex gap-2.5">
                <Check size={13} className="mt-0.5 shrink-0 text-accent" />
                <div><div className="text-[11px] font-medium">{title}</div><div className="mt-0.5 text-[10px] leading-relaxed text-muted">{body}</div></div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border bg-raised/40 px-3 py-2 text-[10px] leading-relaxed text-muted">
            Do not use real customer messages in a public issue, screenshot or demo. The sample above is synthetic and safe for screenshots.
          </div>
        </Card>
      </div>

      {commitResult && (
        <Card>
          <CardHeader eyebrow="Committed" title="Import summary" subtitle="The batch is complete. Raw text remains private to the message rows." actions={<Link to="/account/transactions" className="btn btn-active text-[11px]">View transactions</Link>} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ['Imported', commitResult.imported ?? 0],
              ['Rejected', commitResult.rejected ?? 0],
              ['Needs review', commitResult.needs_review ?? 0],
              ['Duplicates', commitResult.duplicates ?? 0],
              ['Buy bills', commitResult.buy_bills ?? 0],
              ['Sell bills', commitResult.sell_bills ?? 0],
              ['Line items', commitResult.line_items ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-raised/35 px-3 py-2">
                <div className="eyebrow text-[9px]">{String(label)}</div>
                <div className="num mt-1 text-[16px] font-medium">{String(value)}</div>
              </div>
            ))}
          </div>
          {message && <div className="mt-3"><InfoNote>{message}</InfoNote></div>}
        </Card>
      )}

      {preview && (
        <Card pad={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <div className="eyebrow">Preview · {preview.batch.source_type}{preview.batch.filename ? ` · ${preview.batch.filename}` : ''}</div>
              <div className="text-[14px] font-semibold">{preview.summary.total} message(s), {preview.summary.parsed} ready, {preview.summary.needs_review} need review, {preview.summary.errors} error(s)</div>
              <div className="mt-0.5 text-[10px] text-muted">{preview.summary.buy} buy · {preview.summary.sell} sell · {duplicateCount} duplicate(s) · {preview.summary.unknown_symbols.length ? `${preview.summary.unknown_symbols.length} unknown symbol(s)` : 'all symbols recognised'}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn text-[11px]" onClick={() => setDrafts((current) => current.map((draft, index) => ({ ...draft, approved: !preview.messages[index].duplicate_of && preview.messages[index].status !== 'ERROR' })))}>Approve parsed</button>
              <button className="btn btn-active text-[11px] disabled:opacity-50" disabled={commit.isPending || approvedCount === 0} onClick={() => commit.mutate()}>
                {commit.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Commit {approvedCount} approved
              </button>
            </div>
          </div>
          {preview.summary.unknown_symbols.length > 0 && <div className="border-b bg-[#b06a14]/5 px-4 py-2 text-[10px] text-[#96601a] dark:text-[#e8b06a]">Unknown symbols: {preview.summary.unknown_symbols.join(', ')}. You can import them, but reconcile the symbol before relying on holdings. </div>}
          <div className="divide-y">
            {preview.messages.map((row, index) => {
              const draft = drafts[index]
              if (!draft) return null
              return (
                <div key={`${row.fingerprint}-${index}`} className={cn('p-4', !draft.approved && 'bg-raised/20')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <input type="checkbox" checked={draft.approved} onChange={(event) => updateDraft(index, { approved: event.target.checked })} aria-label="Approve message" />
                      <StatusPill status={row.status} />
                      {row.side && <StatusPill status={row.side} label={row.side} />}
                      <span className="text-[12px] font-medium">{row.broker_id ?? 'Broker unknown'} · {row.trade_date ? dateLabel(row.trade_date) : 'date missing'}</span>
                      {row.duplicate_of && <span className="chip border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]">already imported #{row.duplicate_of}</span>}
                      {!row.duplicate_of && row.previous_status === 'REJECTED' && <span className="chip">will replace rejected draft</span>}
                    </div>
                    <button className="btn h-6 px-1.5 text-[10px]" onClick={() => updateDraft(index, { expanded: !draft.expanded })}>{draft.expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />} {draft.expanded ? 'Collapse' : 'Edit'}</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
                    <span>Gross <b className="num text-ink">{fmtMoney(row.gross_total)}</b></span>
                    <span>BAmt <b className="num text-ink">{row.bamt ? fmtMoney(row.bamt) : '—'}</b></span>
                    <span>Bill <b className="text-ink">{row.bill_no ?? '—'}</b></span>
                    <span>Confidence <b className="text-ink">{row.confidence}%</b></span>
                  </div>
                  {row.errors.length > 0 && <div className="mt-2 space-y-1">{row.errors.map((item) => <div key={item} className="flex gap-1.5 text-[10px] text-[#b23b3b] dark:text-[#f08a86]"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{item}</div>)}</div>}
                  {row.warnings.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{row.warnings.map((item) => <span key={item} className="chip border-[#b06a14]/25 bg-[#b06a14]/5 text-[#96601a] dark:text-[#e8b06a]">{item.replaceAll('_', ' ')}</span>)}</div>}

                  {draft.expanded && (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        <Field label="Broker"><input className={FIELD} value={draft.broker_id} onChange={(event) => updateDraft(index, { broker_id: event.target.value.toUpperCase() })} /></Field>
                        <Field label="Trade date"><input type="date" className={FIELD} value={draft.trade_date} onChange={(event) => updateDraft(index, { trade_date: event.target.value })} /></Field>
                        <Field label="Side"><select className={FIELD} value={draft.side} onChange={(event) => updateDraft(index, { side: event.target.value as Draft['side'] })}><option value="">—</option><option value="BUY">BUY</option><option value="SELL">SELL</option></select></Field>
                        <Field label="Bill no."><input className={FIELD} value={draft.bill_no} onChange={(event) => updateDraft(index, { bill_no: event.target.value })} /></Field>
                        <Field label="BAmt"><input type="number" step="0.01" className={FIELD} value={draft.bamt} onChange={(event) => updateDraft(index, { bamt: event.target.value })} /></Field>
                        <Field label="Payment URL"><input className={FIELD} value={draft.payment_url} onChange={(event) => updateDraft(index, { payment_url: event.target.value })} /></Field>
                      </div>
                      <div className="overflow-hidden rounded-lg border">
                        <table className="data-table">
                          <thead><tr><th>#</th><th>Symbol</th><th className="text-right">Quantity</th><th className="text-right">Price</th><th className="text-right">Gross</th><th /></tr></thead>
                          <tbody>
                            {draft.lines.map((line, lineIndex) => (
                              <tr key={lineIndex}>
                                <td className="num text-[10px]">{lineIndex + 1}</td>
                                <td><input className={cn(FIELD, 'w-24 p-1 font-mono')} value={line.symbol} onChange={(event) => updateLine(index, lineIndex, { symbol: event.target.value.toUpperCase() })} /></td>
                                <td><input type="number" step="0.0001" className={cn(FIELD, 'ml-auto w-28 p-1 text-right')} value={line.quantity} onChange={(event) => updateLine(index, lineIndex, { quantity: event.target.value })} /></td>
                                <td><input type="number" step="0.0001" className={cn(FIELD, 'ml-auto w-28 p-1 text-right')} value={line.price} onChange={(event) => updateLine(index, lineIndex, { price: event.target.value })} /></td>
                                <td className="text-right"><Amount value={String(Number(line.quantity) * Number(line.price) || 0)} /></td>
                                <td className="text-right"><button className="btn h-6 w-6 p-0" onClick={() => updateDraft(index, { lines: draft.lines.filter((_, i) => i !== lineIndex) })} aria-label="Remove line"><Trash2 size={10} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="btn text-[10px]" onClick={() => updateDraft(index, { lines: [...draft.lines, { line_no: draft.lines.length, symbol: '', quantity: '', price: '' }] })}><Plus size={11} /> Add security line</button>
                        <span className="text-[10px] text-muted">Edited values are sent as explicit overrides; the original raw message is preserved.</span>
                      </div>
                      <details className="rounded-lg border bg-raised/30 px-3 py-2">
                        <summary className="cursor-pointer text-[10px] font-medium text-muted">Show original message</summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted">{row.raw_text}</pre>
                      </details>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-raised/20 px-4 py-3">
            <div className="text-[10px] text-muted">Unchecked messages are recorded as rejected. Duplicates are skipped server-side even if checked.</div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted">{approvedCount} approved</span>
              <button className="btn btn-active text-[11px] disabled:opacity-50" disabled={commit.isPending || approvedCount === 0} onClick={() => commit.mutate()}>{commit.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Commit batch</button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card pad={false}>
          <div className="border-b px-4 py-3"><div className="eyebrow">History</div><div className="text-[13px] font-semibold">Import batches</div></div>
          {history.isLoading ? <div className="p-4"><Loading label="Loading imports" rows={3} /></div> : history.error ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : (history.data?.imports ?? []).length === 0 ? <EmptyState compact title="No imports yet" body="Your first committed batch will appear here with its counts." /> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Batch</th><th>Source</th><th className="text-right">Messages</th><th className="text-right">Imported</th><th className="text-right">Review</th><th className="text-right">Dupes</th><th>Status</th></tr></thead>
                <tbody>
                  {(history.data?.imports ?? []).slice(0, 15).map((row: ImportHistoryRow) => (
                    <tr key={row.id}>
                      <td><div className="font-medium">#{row.id}</div><div className="text-[10px] text-muted">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</div></td>
                      <td><div className="text-[11px]">{row.source_type}</div><div className="max-w-[130px] truncate text-[10px] text-muted">{row.filename ?? 'pasted text'}</div></td>
                      <td className="num text-right">{row.message_count}</td>
                      <td className="num text-right">{row.imported_count}</td>
                      <td className="num text-right">{row.review_count}</td>
                      <td className="num text-right">{row.duplicate_count}</td>
                      <td><StatusPill status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader eyebrow="Needs review" title="Fix and reimport" subtitle="Reopening a stored message re-parses it; committing updates the existing row if the fingerprint matches." />
          {reviewMessages.isLoading ? <Loading label="Loading review queue" rows={3} /> : (reviewMessages.data?.messages ?? []).length === 0 ? (
            <EmptyState compact title="Review queue is clear" body="Messages that could not be parsed safely appear here instead of entering the ledger." icon={<Info size={17} />} />
          ) : (
            <div className="space-y-2">
              {(reviewMessages.data?.messages ?? []).slice(0, 8).map((row) => (
                <div key={row.id} className="rounded-lg border bg-raised/30 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium">Message #{row.id} · {row.broker_id ?? 'unknown broker'}</div>
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-muted">{(row.errors[0] ?? row.warnings[0] ?? 'Needs manual review').replaceAll('_', ' ')}</div>
                    </div>
                    <button className="btn h-6 shrink-0 px-2 text-[10px]" disabled={reopeningId === row.id} onClick={() => void reopen(row)}>{reopeningId === row.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />} Reopen</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {message && <InfoNote>{message}</InfoNote>}
      {preview && (
        <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-xl border bg-surface/95 px-4 py-2 shadow-lift backdrop-blur">
          <div className="text-[11px] text-muted"><b>{approvedCount}</b> of {drafts.length} approved · {duplicateCount} duplicate(s) skipped · {todayIso()}</div>
          <button className="btn btn-active text-[11px] disabled:opacity-50" disabled={commit.isPending || approvedCount === 0} onClick={() => commit.mutate()}>{commit.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Commit batch</button>
        </div>
      )}
    </div>
  )
}
