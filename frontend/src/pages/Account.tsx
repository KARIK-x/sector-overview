import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AccountProvider } from './account/account-context'
import { AccountShell } from './account/AccountShell'

const Overview = lazy(() => import('./account/Overview'))
const Transactions = lazy(() => import('./account/Transactions'))
const CashFlow = lazy(() => import('./account/CashFlow'))
const Holdings = lazy(() => import('./account/Holdings'))
const ImportSms = lazy(() => import('./account/ImportSms'))
const Settings = lazy(() => import('./account/Settings'))

export default function Account() {
  return (
    <AccountProvider>
      <Routes>
        <Route element={<AccountShell />}>
          <Route index element={<Overview />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="cashflow" element={<CashFlow />} />
          <Route path="holdings" element={<Holdings />} />
          <Route path="import" element={<ImportSms />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/account" replace />} />
        </Route>
      </Routes>
    </AccountProvider>
  )
}
