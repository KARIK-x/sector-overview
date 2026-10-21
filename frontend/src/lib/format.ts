import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function signedPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const v = value * 100
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(0)
}

export function npr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e7) return `NPR ${(value / 1e7).toFixed(2)} cr`
  if (abs >= 1e5) return `NPR ${(value / 1e5).toFixed(2)} lakh`
  return `NPR ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function dateLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return 'text-muted'
  return value > 0 ? 'pos' : 'neg'
}

export function quadrantTone(q: string | null | undefined): string {
  switch (q) {
    case 'WINNING':
      return 'text-[#0e7c66] dark:text-[#4fd1b0]'
    case 'ADVANCING':
      return 'text-[#2c5d8f] dark:text-[#7ab3e8]'
    case 'LOSING':
      return 'text-[#b06a14] dark:text-[#e8b06a]'
    case 'LAGGING':
      return 'text-[#b23b3b] dark:text-[#f08a86]'
    default:
      return 'text-faint'
  }
}

export const QUADRANT_META: Record<
  string,
  { label: string; short: string; color: string; dark: string; description: string }
> = {
  WINNING: {
    label: 'Winning',
    short: 'WIN',
    color: '#0e7c66',
    dark: '#4fd1b0',
    description: 'Positive absolute return and outperforming NEPSE.',
  },
  ADVANCING: {
    label: 'Advancing',
    short: 'ADV',
    color: '#2c5d8f',
    dark: '#7ab3e8',
    description: 'Outperforming NEPSE while still below zero in absolute terms.',
  },
  LOSING: {
    label: 'Losing',
    short: 'LOS',
    color: '#b06a14',
    dark: '#e8b06a',
    description: 'Positive absolute return but lagging the market.',
  },
  LAGGING: {
    label: 'Lagging',
    short: 'LAG',
    color: '#b23b3b',
    dark: '#f08a86',
    description: 'Negative absolute return and underperforming NEPSE.',
  },
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
