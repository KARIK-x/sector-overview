import { cn } from '../lib/format'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('h-9 w-9 shrink-0 text-accent', className)}
      role="img"
      aria-label="NEPSE Sector Intelligence mark"
      fill="none"
    >
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
      <path d="M20 4 A16 16 0 0 1 36 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M36 20 A16 16 0 0 1 20 36" stroke="currentColor" strokeOpacity="0.62" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 36 A16 16 0 0 1 4 20" stroke="currentColor" strokeOpacity="0.38" strokeWidth="3" strokeLinecap="round" />
      <path d="M4 20 A16 16 0 0 1 20 4" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20" cy="20" r="3.5" fill="currentColor" />
      <path d="M30 10l4.5-4.5M34.5 5.5l-0.2 4.2M34.5 5.5l-4.2 0.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark className="h-8 w-8" />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]">NEPSE Sector</div>
        {!compact && <div className="eyebrow mt-0.5 text-[9px]">Intelligence</div>}
      </div>
    </div>
  )
}
