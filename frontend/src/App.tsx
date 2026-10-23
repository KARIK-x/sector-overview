import { lazy, Suspense, useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Layout } from './components/Layout'
import { Card, Loading } from './components/ui'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const NewPulse = lazy(() => import('./pages/NewPulse'))
const SectorExplorer = lazy(() => import('./pages/SectorExplorer'))
const RotationLab = lazy(() => import('./pages/RotationLab'))
const Compare = lazy(() => import('./pages/Compare'))
const BreadthLab = lazy(() => import('./pages/BreadthLab'))
const LiquidityLab = lazy(() => import('./pages/LiquidityLab'))
const RiskLab = lazy(() => import('./pages/RiskLab'))
const FundamentalsLab = lazy(() => import('./pages/FundamentalsLab'))
const EventsResearch = lazy(() => import('./pages/EventsResearch'))
const ResearchLab = lazy(() => import('./pages/ResearchLab'))
const DataQuality = lazy(() => import('./pages/DataQuality'))
const Methodology = lazy(() => import('./pages/Methodology'))
const Account = lazy(() => import('./pages/Account'))

function RouteFallback() {
  return (
    <Card>
      <Loading label="Loading view" rows={4} />
    </Card>
  )
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])
  return null
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Compass size={28} className="mb-4 text-faint" />
      <h1 className="display text-[46px]">Off the map.</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        That page is not part of this sector-only application. Return to the dashboard or open a lab.
      </p>
      <Link to="/" className="btn mt-5">Back to dashboard</Link>
    </div>
  )
}

export default function App() {
  return (
    <Layout>
      <ScrollToTop />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewPulse />} />
          <Route path="/sectors" element={<SectorExplorer />} />
          <Route path="/rotation" element={<RotationLab />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/breadth" element={<BreadthLab />} />
          <Route path="/liquidity" element={<LiquidityLab />} />
          <Route path="/risk" element={<RiskLab />} />
          <Route path="/fundamentals" element={<FundamentalsLab />} />
          <Route path="/events" element={<EventsResearch />} />
          <Route path="/research" element={<ResearchLab />} />
          <Route path="/data-quality" element={<DataQuality />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/account/*" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
