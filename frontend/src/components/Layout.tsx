import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Command, Menu, Moon, Search, Sun, X } from 'lucide-react'
import { NAV } from '../lib/nav'
import { BrandMark } from './Brand'
import { cn, dateLabel } from '../lib/format'
import { useTheme } from '../lib/useTheme'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-3" aria-label="NEPSE Sector Intelligence home">
      <BrandMark className="transition-transform group-hover:-rotate-6" />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]">NEPSE Sector</div>
        <div className="eyebrow mt-0.5 text-[9px]">Intelligence</div>
      </div>
    </Link>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  return (
    <nav className="flex flex-col gap-6" aria-label="Primary">
      {['Overview', 'Labs', 'Context', 'Trust'].map((group) => {
        const items = NAV.filter((n) => n.group === group)
        return (
          <div key={group}>
            <div className="eyebrow mb-2 px-2.5">{group}</div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active =
                  location.pathname === item.to ||
                  (item.to !== '/' && location.pathname.startsWith(item.to))
                const Icon = item.icon
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                        active
                          ? 'bg-raised font-medium text-ink'
                          : 'text-muted hover:bg-raised hover:text-ink',
                      )}
                    >
                      <Icon
                        size={15}
                        strokeWidth={1.8}
                        className={cn(active ? 'text-accent' : 'text-faint group-hover:text-muted')}
                      />
                      <span className="truncate">{item.label}</span>
                      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const navigate = useNavigate()
  const { data: sectors } = useQuery({ queryKey: ['sectors'], queryFn: api.sectors, enabled: open })

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    const navHits = NAV.filter(
      (n) =>
        !term ||
        n.label.toLowerCase().includes(term) ||
        n.description.toLowerCase().includes(term) ||
        n.group.toLowerCase().includes(term),
    )
      // A label match is a stronger signal than a description match, so
      // searching "risk" should surface Risk Lab above pages that merely
      // mention risk in their description.
      .sort((a, b) => {
        if (!term) return 0
        const al = a.label.toLowerCase().includes(term) ? 0 : 1
        const bl = b.label.toLowerCase().includes(term) ? 0 : 1
        return al - bl
      })
      .map((n) => ({
        key: n.to,
        label: n.label,
        hint: n.group,
        to: n.to,
        icon: n.icon,
      }))
    const sectorHits = (sectors ?? [])
      .filter((s) => !term || s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term))
      .slice(0, 6)
      .map((s) => ({
        key: `sector-${s.code}`,
        label: s.name,
        hint: 'Sector',
        to: `/sectors?code=${s.code}`,
        icon: null,
      }))
    return [...navHits, ...sectorHits]
  }, [q, sectors])

  useEffect(() => setIndex(0), [q, open])
  useEffect(() => {
    if (!open) setQ('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndex((i) => Math.min(results.length - 1, i + 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => Math.max(0, i - 1))
      }
      if (e.key === 'Enter' && results[index]) {
        e.preventDefault()
        navigate(results[index].to)
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, results, index, navigate, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/35 px-4 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border bg-surface shadow-lift"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search size={16} className="text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to a page or sector…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && <div className="px-3 py-8 text-center text-xs text-muted">No matches.</div>}
          {results.map((r, i) => {
            const Icon = r.icon
            return (
              <button
                key={r.key}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  navigate(r.to)
                  onClose()
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                  i === index ? 'bg-raised' : '',
                )}
              >
                {Icon ? <Icon size={15} className="text-faint" /> : <span className="h-[15px] w-[15px] rounded-full bg-accent/20" />}
                <span className="flex-1 truncate">{r.label}</span>
                <span className="eyebrow text-[9px]">{r.hint}</span>
                <ArrowUpRight size={13} className="text-faint" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { isDark, toggle } = useTheme()
  const [mobile, setMobile] = useState(false)
  const [palette, setPalette] = useState(false)
  const location = useLocation()
  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', 'layout'],
    queryFn: api.dashboard,
    staleTime: 5 * 60_000,
  })
  const latest = dashboard?.market?.latest_date

  useEffect(() => setMobile(false), [location.pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobile ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobile])

  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r bg-surface/95 lg:flex">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <NavList />
        </div>
        <div className="border-t px-5 py-4">
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span className="font-mono">NEPSE · Sector only</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-accent" />
              live
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-faint">
            Independent research. Not investment advice. Data provenance is documented in the Data Quality Center.
          </p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 w-[86%] max-w-[320px] overflow-y-auto border-r bg-surface p-4 shadow-lift">
            <div className="mb-5 flex items-center justify-between">
              <Logo />
              <button className="btn h-8 w-8 p-0" onClick={() => setMobile(false)} aria-label="Close menu">
                <X size={15} />
              </button>
            </div>
            <NavList onNavigate={() => setMobile(false)} />
            <p className="mt-8 text-[10px] leading-relaxed text-faint">
              Independent research. Not investment advice.
            </p>
          </aside>
        </div>
      )}

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b bg-paper/95">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button className="btn h-8 w-8 p-0 lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu">
              <Menu size={16} />
            </button>
            <div className="hidden items-center gap-2 text-[11px] text-muted sm:flex">
              <span className="font-mono uppercase tracking-[0.14em]">Session</span>
              <span className="num text-ink">{dateLabel(latest)}</span>
              <span className="text-faint">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Verified close
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setPalette(true)}
                className="hidden items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:text-ink sm:flex"
                aria-label="Open command palette"
              >
                <Search size={13} />
                <span>Search</span>
                <kbd className="ml-2 inline-flex items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[9px]">
                  <Command size={9} /> K
                </kbd>
              </button>
              <button
                className="btn h-8 w-8 p-0"
                onClick={toggle}
                aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                {isDark ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <div className="hidden items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">Sector scope</span>
              </div>
            </div>
          </div>
        </header>

        <main id="main" className="shell animate-fade">
          {children}
        </main>
      </div>

      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}
