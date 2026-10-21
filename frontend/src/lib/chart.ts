import type { EChartsOption } from 'echarts'

export interface Palette {
  ink: string
  muted: string
  faint: string
  line: string
  surface: string
  paper: string
  accent: string
  grid: string
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function palette(dark: boolean): Palette {
  return {
    ink: cssVar('--ink', dark ? '#e9f0ec' : '#111b18'),
    muted: cssVar('--muted', dark ? '#93a29b' : '#5c6a64'),
    faint: cssVar('--faint', dark ? '#6d7c76' : '#8b9791'),
    line: cssVar('--line', dark ? '#24312c' : '#e0ddd4'),
    surface: cssVar('--surface', dark ? '#111917' : '#fffdf8'),
    paper: cssVar('--paper', dark ? '#0b1110' : '#f5f3ee'),
    accent: cssVar('--accent', dark ? '#4fd1b0' : '#0e7c66'),
    grid: cssVar('--grid', dark ? 'rgba(233,240,236,0.06)' : 'rgba(17,27,24,0.06)'),
  }
}

export function quadrantColor(q: string | null | undefined, dark: boolean): string {
  switch (q) {
    case 'WINNING':
      return dark ? '#4fd1b0' : '#0e7c66'
    case 'ADVANCING':
      return dark ? '#7ab3e8' : '#2c5d8f'
    case 'LOSING':
      return dark ? '#e8b06a' : '#b06a14'
    case 'LAGGING':
      return dark ? '#f08a86' : '#b23b3b'
    default:
      return dark ? '#6d7c76' : '#8b9791'
  }
}

export function heatColor(v: number | null | undefined, maxAbs: number, dark: boolean): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return dark ? '#1a2522' : '#efece4'
  const t = Math.min(1, Math.abs(v) / (maxAbs || 1))
  if (v > 0) {
    const base = dark ? [20, 80, 66] : [14, 124, 102]
    const alpha = 0.12 + 0.88 * Math.pow(t, 0.72)
    return `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${alpha.toFixed(3)})`
  }
  if (v < 0) {
    const base = dark ? [150, 55, 55] : [178, 59, 59]
    const alpha = 0.12 + 0.88 * Math.pow(t, 0.72)
    return `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${alpha.toFixed(3)})`
  }
  return dark ? '#1a2522' : '#efece4'
}

export function baseOption(dark: boolean): EChartsOption {
  const p = palette(dark)
  return {
    backgroundColor: 'transparent',
    animationDuration: 480,
    animationEasing: 'cubicOut',
    textStyle: {
      fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
      color: p.ink,
    },
    tooltip: {
      backgroundColor: p.surface,
      borderColor: p.line,
      borderWidth: 1,
      padding: [9, 11],
      textStyle: { color: p.ink, fontSize: 12, fontFamily: "'IBM Plex Sans', sans-serif" },
      extraCssText: 'border-radius:10px; box-shadow:0 10px 30px -12px rgba(0,0,0,0.28);',
    },
    legend: {
      textStyle: { color: p.muted, fontSize: 11, fontFamily: "'IBM Plex Sans', sans-serif" },
      icon: 'roundRect',
      itemWidth: 9,
      itemHeight: 9,
    },
  }
}

export function axisStyle(dark: boolean, opts: { split?: boolean; labelSize?: number } = {}) {
  const p = palette(dark)
  return {
    axisLine: { lineStyle: { color: p.line } },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontSize: opts.labelSize ?? 10, fontFamily: "'IBM Plex Mono', monospace" },
    splitLine: opts.split === false ? { show: false } : { lineStyle: { color: p.grid, type: 'dashed' as const } },
  }
}

export function tooltipFormatterNumber(value: number | null | undefined, digits = 1, suffix = '%') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}${suffix}`
}
