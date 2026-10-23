import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import {
  AccountApiError,
  accountApi,
  clearAccountToken,
  clearPendingCreation,
  downloadText,
  readAccountToken,
  readPendingCreation,
  storeAccountToken,
  storePendingCreation,
  type AccountMe,
  type AccountVault,
  type PendingCreation,
} from '../../lib/account'
import { Card, ErrorState, InfoNote, Loading } from '../../components/ui'
import { cn } from '../../lib/format'

type AccountStatus = 'loading' | 'locked' | 'ready' | 'error'

interface AccountContextValue {
  token: string
  me: AccountMe
  vault: AccountVault
  refreshMe: () => Promise<void>
  replaceToken: (token: string) => Promise<void>
  lock: () => void
}

const AccountContext = createContext<AccountContextValue | null>(null)

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext)
  if (!value) throw new Error('useAccount must be used inside AccountProvider')
  return value
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date())
}

function AccountGate({
  onUnlock,
  initialError,
}: {
  onUnlock: (token: string, remember: boolean) => Promise<void>
  initialError: string | null
}) {
  const [mode, setMode] = useState<'create' | 'unlock'>('create')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [showKey, setShowKey] = useState(false)
  const [created, setCreated] = useState<PendingCreation | null>(() => readPendingCreation())
  const [saved, setSaved] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [form, setForm] = useState({
    label: 'Personal account',
    investor_category: 'RESIDENT_INDIVIDUAL',
    opening_balance: '0',
    opening_balance_date: todayIso(),
    default_broker: '',
    bank_account_name: 'Primary bank',
  })

  useEffect(() => {
    if (!created || saved) return
    const warnUnsavedKey = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnUnsavedKey)
    return () => window.removeEventListener('beforeunload', warnUnsavedKey)
  }, [created, saved])

  const finishCreate = async () => {
    if (!created || !saved) return
    setBusy(true)
    setError(null)
    try {
      await onUnlock(created.token, remember)
      clearPendingCreation()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock the new vault.')
    } finally {
      setBusy(false)
    }
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await accountApi.createVault({
        label: form.label,
        investor_category: form.investor_category,
        opening_balance: form.opening_balance,
        opening_balance_date: form.opening_balance_date,
        default_broker: form.default_broker.trim() || undefined,
        bank_account_name: form.bank_account_name,
      })
      const creation = { token: response.token, label: response.vault.label }
      storePendingCreation(creation)
      setCreated(creation)
      setSaved(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the vault.')
    } finally {
      setBusy(false)
    }
  }

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onUnlock(keyInput.trim(), remember)
      clearPendingCreation()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock this vault.')
    } finally {
      setBusy(false)
    }
  }

  const copyKey = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setError(null)
    } catch {
      setError('Clipboard access was blocked. Use Download instead.')
    }
  }

  const field =
    'w-full rounded-lg border bg-surface px-3 py-2 text-[13px] outline-none transition-colors focus:border-accent'
  const label = 'mb-1 block text-[11px] font-medium text-muted'

  if (created) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <Card className="overflow-hidden">
          <div className="border-b bg-raised/60 px-5 py-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-accent" />
              <span className="eyebrow">Vault created · key shown once</span>
            </div>
            <h1 className="display mt-2 text-[32px]">Save your recovery key.</h1>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              This key is the only way to open the ledger. It is stored on the server as a SHA-256 hash,
              never as plain text. There is no password reset and no support override.
            </p>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-xl border bg-raised/50 p-4">
              <div className="eyebrow mb-2">Recovery key</div>
              <code className="block select-all break-all rounded-lg border bg-surface p-3 font-mono text-[11px] leading-relaxed">
                {created.token}
              </code>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn text-[11px]" onClick={() => void copyKey()}>
                  <Copy size={13} /> Copy
                </button>
                <button
                  type="button"
                  className="btn text-[11px]"
                  onClick={() =>
                    downloadText(
                      `NEPSE private account recovery key\nVault: ${created.label}\nCreated: ${new Date().toISOString()}\n\n${created.token}\n\nThis key cannot be recovered. Store it in a password manager or offline safe.\n`,
                      'nepse-account-recovery-key.txt',
                    )
                  }
                >
                  <Download size={13} /> Download
                </button>
              </div>
            </div>
            <InfoNote tone="warn">
              Do not paste this key into a chat, email, screenshot, or public issue. Anyone with it can
              read and modify this vault. The app stores only a hash.
            </InfoNote>
            <label className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={saved}
                onChange={(event) => setSaved(event.target.checked)}
              />
              I saved this key somewhere safe. I understand it cannot be recovered if lost.
            </label>
            <button
              type="button"
              className="btn btn-active w-full disabled:opacity-50"
              disabled={!saved || busy}
              onClick={() => void finishCreate()}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightIcon />}
              {busy ? 'Opening vault…' : 'Continue to the ledger'}
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5 py-6 lg:grid-cols-[0.9fr_1.1fr] lg:py-10">
      <div className="rounded-2xl border bg-surface p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl border bg-raised text-accent">
            <Lock size={18} />
          </div>
          <div>
            <div className="eyebrow">Private account</div>
            <div className="text-sm font-semibold">A ledger that belongs to you</div>
          </div>
        </div>
        <h1 className="display mt-6 text-[40px] leading-none">Your trades. Your cash. Yours alone.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Import broker SMS, reconcile real charges, track T+1 and T+2 obligations, and see what cash is
          actually available. Nothing here is public and nothing is inferred from the market.
        </p>
        <div className="mt-6 space-y-3 text-[12px]">
          {[
            ['Bearer-key vault', 'The server stores only a SHA-256 hash of a high-entropy key. Every query is scoped to that vault.'],
            ['Server-authoritative ledger', 'The browser may cache the key locally, but transactions and balances live in the private vault, never in localStorage.'],
            ['No SMS permissions', 'You paste or upload an exported message file. The app never asks for your inbox or sends messages anywhere.'],
            ['No invented numbers', 'Missing cost basis, tax rules, or prices are marked awaiting information or estimated — never silently filled.'],
          ].map(([title, body]) => (
            <div key={title} className="flex gap-3">
              <Check size={14} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <div className="font-medium text-ink">{title}</div>
                <div className="mt-0.5 leading-relaxed text-muted">{body}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-xl border bg-raised/50 p-3 text-[11px] leading-relaxed text-muted">
          This is a personal record-keeping tool, not investment or tax advice. Fee and CGT rules are
          versioned by trade date and can change; review the source and effective-date notes in Fees &amp; Settings.
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex rounded-lg border bg-raised p-0.5">
          {(['create', 'unlock'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMode(item)
                setError(null)
              }}
              className={cn(
                'flex-1 rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
                mode === item ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
              )}
            >
              {item === 'create' ? 'Create a vault' : 'Unlock existing'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-3 flex gap-2 rounded-lg border border-[#b23b3b]/25 bg-[#b23b3b]/5 px-3 py-2 text-[11px] text-[#b23b3b] dark:text-[#f08a86]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {mode === 'create' ? (
          <form className="space-y-3" onSubmit={(event) => void create(event)}>
            <div>
              <label className={label} htmlFor="vault-label">Vault label</label>
              <input id="vault-label" className={field} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} maxLength={120} required />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="investor">Investor category</label>
                <select id="investor" className={field} value={form.investor_category} onChange={(e) => setForm({ ...form, investor_category: e.target.value })}>
                  <option value="RESIDENT_INDIVIDUAL">Resident individual</option>
                  <option value="RESIDENT_ENTITY">Resident entity</option>
                  <option value="NON_RESIDENT">Non-resident</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="broker">Default broker (optional)</label>
                <input id="broker" className={field} value={form.default_broker} onChange={(e) => setForm({ ...form, default_broker: e.target.value })} placeholder="RK316455" maxLength={32} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="opening">Opening cash (NPR)</label>
                <input id="opening" type="number" min="0" step="0.01" className={field} value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
              </div>
              <div>
                <label className={label} htmlFor="opening-date">Opening date</label>
                <input id="opening-date" type="date" className={field} value={form.opening_balance_date} onChange={(e) => setForm({ ...form, opening_balance_date: e.target.value })} required />
              </div>
            </div>
            <div>
              <label className={label} htmlFor="bank-name">First bank account label</label>
              <input id="bank-name" className={field} value={form.bank_account_name} onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })} maxLength={120} required />
            </div>
            <InfoNote>
              Opening cash is an explicit assumption, not a bank feed. You can add accounts, deposits,
              withdrawals and transfers later. Pasted SMS remains private to this vault.
            </InfoNote>
            <button className="btn btn-active w-full disabled:opacity-50" disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
              {busy ? 'Creating vault…' : 'Create private vault'}
            </button>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={(event) => void unlock(event)}>
            <div>
              <label className={label} htmlFor="recovery-key">Recovery key</label>
              <div className="relative">
                <input
                  id="recovery-key"
                  type={showKey ? 'text' : 'password'}
                  className={cn(field, 'pr-10 font-mono text-[11px]')}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Paste your private bearer key"
                  autoComplete="off"
                  required
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
                  onClick={() => setShowKey((value) => !value)}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <label className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
              <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember this key on this device. This writes only the credential to localStorage; the
              ledger itself stays server-side.
            </label>
            <InfoNote tone="warn">
              On a shared computer, leave this off. Locking the account clears the cached credential.
            </InfoNote>
            <button className="btn btn-active w-full disabled:opacity-50" disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              {busy ? 'Checking key…' : 'Unlock private ledger'}
            </button>
          </form>
        )}
      </Card>
    </div>
  )
}

function ArrowRightIcon() {
  return <Check size={14} />
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(() => readAccountToken())
  const [me, setMe] = useState<AccountMe | null>(null)
  const [status, setStatus] = useState<AccountStatus>(() => (readAccountToken() ? 'loading' : 'locked'))
  const [error, setError] = useState<string | null>(null)
  const skipNextTokenLoad = useRef(false)

  const fetchMe = useCallback(async (candidate: string) => {
    return await accountApi.me(candidate)
  }, [])

  useEffect(() => {
    if (!token) {
      setMe(null)
      setStatus('locked')
      return
    }
    if (skipNextTokenLoad.current) {
      // Key rotation already fetched /me for the new key. Re-running the full
      // loading state here would unmount Settings and hide the one-time key.
      skipNextTokenLoad.current = false
      return
    }
    let cancelled = false
    setStatus('loading')
    void fetchMe(token)
      .then((data) => {
        if (cancelled) return
        setMe(data)
        setStatus('ready')
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof AccountApiError && err.status === 401) {
          clearAccountToken()
          queryClient.removeQueries({ queryKey: ['account'] })
          setToken(null)
          setMe(null)
          setStatus('locked')
          setError('That key was not accepted. Check it and try again.')
        } else {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Could not reach the account service.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [token, fetchMe, queryClient])

  const unlock = useCallback(
    async (candidate: string, remember: boolean) => {
      if (!candidate.trim()) throw new Error('Enter your recovery key.')
      const data = await fetchMe(candidate.trim())
      storeAccountToken(candidate.trim(), remember)
      queryClient.removeQueries({ queryKey: ['account'] })
      setToken(candidate.trim())
      setMe(data)
      setStatus('ready')
      setError(null)
    },
    [fetchMe, queryClient],
  )

  const refreshMe = useCallback(async () => {
    if (!token) return
    const data = await fetchMe(token)
    setMe(data)
    setStatus('ready')
  }, [fetchMe, token])

  const replaceToken = useCallback(async (candidate: string) => {
    const data = await fetchMe(candidate)
    storeAccountToken(candidate, false)
    skipNextTokenLoad.current = true
    setToken(candidate)
    setMe(data)
    setStatus('ready')
    setError(null)
  }, [fetchMe])

  const lock = useCallback(() => {
    clearAccountToken()
    clearPendingCreation()
    queryClient.removeQueries({ queryKey: ['account'] })
    setToken(null)
    setMe(null)
    setStatus('locked')
    setError(null)
  }, [queryClient])

  const value = useMemo<AccountContextValue | null>(() => {
    if (!token || !me) return null
    return { token, me, vault: me.vault, refreshMe, replaceToken, lock }
  }, [token, me, refreshMe, replaceToken, lock])

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <Card><Loading label="Opening the private ledger" rows={3} /></Card>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Card>
          <ErrorState
            error={new Error(error ?? 'Could not load the account.')}
            onRetry={() => {
              if (!token) return
              setStatus('loading')
              void refreshMe().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Retry failed.')
                setStatus('error')
              })
            }}
          />
          <div className="mt-2 text-center">
            <button className="btn text-[11px]" onClick={lock}>Use a different key</button>
          </div>
        </Card>
      </div>
    )
  }

  if (status === 'locked' || !value) {
    return <AccountGate onUnlock={unlock} initialError={error} />
  }

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}
