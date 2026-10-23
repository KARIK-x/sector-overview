import { NavLink, Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  Landmark,
  Lock,
  MessageSquareText,
  PieChart,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '../../components/ui'
import { cn } from '../../lib/format'
import { useAccount } from './account-context'

const TABS = [
  { to: '/account', label: 'Overview', icon: Wallet, end: true },
  { to: '/account/transactions', label: 'Transactions', icon: ArrowLeftRight, end: false },
  { to: '/account/cashflow', label: 'Cash Flow', icon: Landmark, end: false },
  { to: '/account/holdings', label: 'Holdings', icon: PieChart, end: false },
  { to: '/account/import', label: 'SMS Import', icon: MessageSquareText, end: false },
  { to: '/account/settings', label: 'Fees & Settings', icon: Settings2, end: false },
]

export function AccountShell() {
  const { me, vault, refreshMe, lock } = useAccount()
  const queryClient = useQueryClient()
  const refresh = async () => {
    await refreshMe()
    await queryClient.invalidateQueries({ queryKey: ['account'] })
  }
  const category =
    vault.investor_category === 'RESIDENT_INDIVIDUAL'
      ? 'Resident individual'
      : vault.investor_category === 'RESIDENT_ENTITY'
        ? 'Resident entity'
        : 'Non-resident'

  return (
    <div>
      <PageHeader
        eyebrow="Private ledger"
        title={vault.label}
        description={`${category} · ${vault.cost_basis_method} cost basis · server-authoritative. Every route is scoped to this vault; the public market cache never sees it.`}
        actions={
          <>
            <span className="chip border-[#1f6f5f]/30 bg-[#1f6f5f]/10 text-[#1f6f5f] dark:text-[#6fbfa8]">
              <ShieldCheck size={11} /> private
            </span>
            <button className="btn text-[11px]" onClick={() => void refresh()} title="Refresh account data">
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="btn text-[11px]" onClick={lock} title="Clear the cached key from this browser">
              <Lock size={13} /> Lock
            </button>
          </>
        }
      />

      <div className="mb-5 flex items-center gap-2 overflow-x-auto border-b pb-2">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors',
                  isActive
                    ? 'border-ink bg-ink text-paper'
                    : 'border-transparent text-muted hover:border-line hover:bg-raised hover:text-ink',
                )
              }
            >
              <Icon size={13} />
              {tab.label}
            </NavLink>
          )
        })}
        <div className="ml-auto hidden shrink-0 items-center gap-1.5 font-mono text-[10px] text-faint sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {me.counts.transactions} trades · {me.counts.messages} messages
        </div>
      </div>

      <Outlet />
    </div>
  )
}
