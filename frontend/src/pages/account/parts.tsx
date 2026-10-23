import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/format'
import { fmtMoney, moneyValue, statusTone } from '../../lib/account'

export const FIELD =
  'w-full rounded-lg border bg-surface px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:border-accent disabled:opacity-60'

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string
  children: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-faint">{hint}</span>}
    </label>
  )
}

export function Money({
  value,
  signed = false,
  tone = 'auto',
  className,
}: {
  value: string | number | null | undefined
  signed?: boolean
  tone?: 'auto' | 'pos' | 'neg' | 'warn' | 'neutral'
  className?: string
}) {
  const numeric = moneyValue(value)
  const cls =
    tone === 'pos'
      ? 'pos'
      : tone === 'neg'
        ? 'neg'
        : tone === 'warn'
          ? 'warn'
          : tone === 'neutral'
            ? 'text-ink'
            : numeric > 0
              ? 'pos'
              : numeric < 0
                ? 'neg'
                : 'text-muted'
  return <span className={cn('num whitespace-nowrap', cls, className)}>{fmtMoney(value, signed)}</span>
}

export function Amount({
  value,
  signed = false,
  className,
}: {
  value: string | number | null | undefined
  signed?: boolean
  className?: string
}) {
  const numeric = moneyValue(value)
  return (
    <span className={cn('num whitespace-nowrap', numeric < 0 ? 'neg' : numeric > 0 && signed ? 'pos' : 'text-ink', className)}>
      {fmtMoney(value, signed)}
    </span>
  )
}

export function StatusPill({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <span className={cn('chip', statusTone(status), className)}>
      {(label ?? status).replaceAll('_', ' ')}
    </span>
  )
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/35" onMouseDown={onClose}>
      <aside
        className={cn(
          'flex h-full w-full flex-col border-l bg-surface shadow-lift',
          wide ? 'max-w-4xl' : 'max-w-2xl',
        )}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold leading-tight">{title}</div>
            {subtitle && <div className="mt-1 text-[11px] leading-relaxed text-muted">{subtitle}</div>}
          </div>
          <button className="btn h-8 w-8 shrink-0 p-0" onClick={onClose} aria-label="Close panel">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-8">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}

export function MiniStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'pos' | 'neg' | 'warn' | 'neutral'
}) {
  return (
    <div className="rounded-lg border bg-raised/35 px-3 py-2">
      <div className="eyebrow text-[9px]">{label}</div>
      <div
        className={cn(
          'num mt-1 text-[14px] font-medium',
          tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : tone === 'warn' ? 'warn' : 'text-ink',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] leading-snug text-muted">{sub}</div>}
    </div>
  )
}
