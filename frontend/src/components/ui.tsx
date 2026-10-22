import type { ReactNode } from 'react'
import { AlertTriangle, Info, Inbox, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '../lib/format'

export function Card({
  children,
  className,
  pad = true,
}: {
  children: ReactNode
  className?: string
  pad?: boolean
}) {
  return <div className={cn('card', pad && 'card-pad', className)}>{children}</div>
}

export function CardHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <div className="eyebrow mb-2">{eyebrow}</div>
        <h1 className="display text-[34px] sm:text-[44px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Metric({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'pos' | 'neg' | 'warn' | 'neutral'
  className?: string
}) {
  const toneCls =
    tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : tone === 'warn' ? 'warn' : 'text-ink'
  return (
    <div className={cn('min-w-0', className)}>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className={cn('num text-[22px] font-medium leading-none tracking-tight', toneCls)}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] leading-snug text-muted">{sub}</div>}
    </div>
  )
}

const badgeStyles: Record<string, string> = {
  VERIFIED: 'border-[#1f6f5f]/30 bg-[#1f6f5f]/10 text-[#1f6f5f] dark:text-[#6fbfa8] dark:border-[#6fbfa8]/30',
  PROVISIONAL: 'border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]',
  INCOMPLETE: 'border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]',
  PARTIAL_HISTORY: 'border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]',
  STALE: 'border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]',
  UNAVAILABLE: 'border-line bg-raised text-muted',
  FAILED_VALIDATION: 'border-[#b23b3b]/30 bg-[#b23b3b]/10 text-[#b23b3b] dark:text-[#f08a86]',
  SUCCESS: 'border-[#1f6f5f]/30 bg-[#1f6f5f]/10 text-[#1f6f5f] dark:text-[#6fbfa8]',
  RUNNING: 'border-[#2c5d8f]/30 bg-[#2c5d8f]/10 text-[#2c5d8f] dark:text-[#7ab3e8]',
  FAILED: 'border-[#b23b3b]/30 bg-[#b23b3b]/10 text-[#b23b3b] dark:text-[#f08a86]',
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn('chip', badgeStyles[status] ?? 'border-line bg-raised text-muted')}>
      {label ?? status.replaceAll('_', ' ')}
    </span>
  )
}

export function QuadrantBadge({ quadrant }: { quadrant: string | null }) {
  if (!quadrant) return <span className="text-faint">—</span>
  const map: Record<string, string> = {
    WINNING: 'border-[#1f6f5f]/30 bg-[#1f6f5f]/10 text-[#1f6f5f] dark:text-[#6fbfa8]',
    ADVANCING: 'border-[#2c5d8f]/30 bg-[#2c5d8f]/10 text-[#2c5d8f] dark:text-[#7ab3e8]',
    LOSING: 'border-[#b06a14]/30 bg-[#b06a14]/10 text-[#96601a] dark:text-[#e8b06a]',
    LAGGING: 'border-[#b23b3b]/30 bg-[#b23b3b]/10 text-[#b23b3b] dark:text-[#f08a86]',
  }
  return (
    <span className={cn('chip', map[quadrant])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {quadrant}
    </span>
  )
}

export function EmptyState({
  title,
  body,
  icon,
  action,
  compact,
}: {
  title: string
  body?: string
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-16')}>
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full border bg-raised text-muted">
        {icon ?? <Inbox size={17} />}
      </div>
      <div className="text-sm font-medium">{title}</div>
      {body && <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'The request failed.'
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full border border-[#b23b3b]/30 bg-[#b23b3b]/10 text-[#b23b3b] dark:text-[#f08a86]">
        <AlertTriangle size={17} />
      </div>
      <div className="text-sm font-medium">Couldn’t load this view</div>
      <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted">{message}</p>
      {onRetry && (
        <button className="btn mt-4" onClick={onRetry}>
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  )
}

export function Loading({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="animate-fade py-2" role="status" aria-label={label}>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <Loader2 size={13} className="animate-spin" /> {label}…
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton h-8" style={{ opacity: 1 - i * 0.16 }} />
        ))}
      </div>
    </div>
  )
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed',
        tone === 'warn'
          ? 'border-[#b06a14]/25 bg-[#b06a14]/5 text-[#7a5216] dark:text-[#e8b06a]'
          : 'border-line bg-raised text-muted',
      )}
    >
      {tone === 'warn' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <Info size={13} className="mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  )
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  label?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="eyebrow">{label}</span>}
      <div className="inline-flex rounded-lg border bg-raised p-0.5" role="tablist" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            role="tab"
            aria-selected={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md font-mono tabular-nums transition-colors',
              size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-[11px]',
              value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2 last:border-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="num text-right text-[12px] font-medium">{children}</dd>
    </div>
  )
}
