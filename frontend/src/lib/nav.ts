import {
  Activity,
  BarChart3,
  BookOpen,
  Compass,
  Database,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  LineChart,
  Wallet,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Waves,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  short: string
  icon: LucideIcon
  description: string
  group: string
}

export const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    short: 'Pulse',
    icon: LayoutDashboard,
    description: 'Market pulse, rotation map, breadth, liquidity and risk at a glance.',
    group: 'Overview',
  },
  {
    to: '/new',
    label: 'New',
    short: 'New',
    icon: Sparkles,
    description: 'Every sector and NEPSE on one percentage-change scale, rebased to each series’ own start.',
    group: 'Overview',
  },
  {
    to: '/sectors',
    label: 'Sector Explorer',
    short: 'Sectors',
    icon: Compass,
    description: 'Deep dive into a single sector’s price, breadth, liquidity, risk and fundamentals.',
    group: 'Overview',
  },
  {
    to: '/rotation',
    label: 'Rotation Lab',
    short: 'Rotation',
    icon: LineChart,
    description: 'Absolute vs relative strength quadrants with configurable lookbacks and trails.',
    group: 'Labs',
  },
  {
    to: '/compare',
    label: 'Sector Comparison',
    short: 'Compare',
    icon: GitCompareArrows,
    description: 'Rebase and compare any mix of sector indices against NEPSE over a shared window.',
    group: 'Labs',
  },
  {
    to: '/breadth',
    label: 'Breadth Lab',
    short: 'Breadth',
    icon: Waves,
    description: 'Advance-decline structure, participation and moving-average breadth.',
    group: 'Labs',
  },
  {
    to: '/liquidity',
    label: 'Liquidity Lab',
    short: 'Liquidity',
    icon: BarChart3,
    description: 'Turnover share, concentration and traded value across sectors.',
    group: 'Labs',
  },
  {
    to: '/risk',
    label: 'Risk Lab',
    short: 'Risk',
    icon: ShieldCheck,
    description: 'Volatility, beta, drawdown, VaR and risk-return positioning.',
    group: 'Labs',
  },
  {
    to: '/fundamentals',
    label: 'Fundamentals Lab',
    short: 'Fundamentals',
    icon: Gauge,
    description: 'Sector earnings, valuation and coverage from verified filings.',
    group: 'Context',
  },
  {
    to: '/events',
    label: 'Events & Research',
    short: 'Events',
    icon: Newspaper,
    description: 'Corporate-event coverage and documented research gaps.',
    group: 'Context',
  },
  {
    to: '/research',
    label: 'Quantitative Research',
    short: 'Quant',
    icon: FlaskConical,
    description: 'Factor scores, transition matrices and an illustrative rotation backtest.',
    group: 'Context',
  },
  {
    to: '/data-quality',
    label: 'Data Quality Center',
    short: 'Quality',
    icon: Database,
    description: 'Coverage, freshness, ingestion runs and known data limitations.',
    group: 'Trust',
  },
  {
    to: '/methodology',
    label: 'Methodology',
    short: 'Method',
    icon: BookOpen,
    description: 'Every formula, axis contract, denominator and limitation in one place.',
    group: 'Trust',
  },
  {
    to: '/account',
    label: 'Private Ledger',
    short: 'Account',
    icon: Wallet,
    description: 'Broker SMS imports, verified charges, cash flow, T+1 deadlines and WACC holdings.',
    group: 'Account',
  },
]

export const GROUPS = ['Overview', 'Labs', 'Context', 'Trust', 'Account']

export const NAV_ICON_FALLBACK = Activity
