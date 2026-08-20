import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { SignIn } from './pages/SignIn'
import { SproutIcon } from './icons'

const DevotionEditor = lazy(() => import('./pages/DevotionEditor'))
const BibleReader = lazy(() => import('./pages/BibleReader'))
const ConquestWeek = lazy(() => import('./pages/ConquestWeek'))
const Achievements = lazy(() => import('./pages/Achievements'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const Community = lazy(() => import('./pages/Community'))
const DiscipleTree = lazy(() => import('./pages/DiscipleTree'))
const Attendance = lazy(() => import('./pages/Attendance'))
const Reports = lazy(() => import('./pages/Reports'))

function RouteLoadingSpinner() {
  return (
    <div className="mt-10 flex justify-center">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
    </div>
  )
}

function SplashScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex h-16 w-16 animate-pulse items-center justify-center rounded-3xl bg-brand-wash text-brand-strong shadow-glow dark:text-brand">
        <SproutIcon width={32} height={32} />
      </span>
      <p className="font-serif text-xl font-semibold tracking-tight text-ink">Selah</p>
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" />
    </div>
  )
}

function withSuspense(element) {
  return <Suspense fallback={<RouteLoadingSpinner />}>{element}</Suspense>
}

export function App() {
  const { user, loading } = useAuth()

  if (loading) return <SplashScreen />
  if (!user) return <SignIn />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="bible" element={withSuspense(<BibleReader />)} />
        <Route path="conquest" element={withSuspense(<ConquestWeek />)} />
        <Route path="achievements" element={withSuspense(<Achievements />)} />
        <Route path="community" element={withSuspense(<Community />)} />
        <Route path="disciple" element={withSuspense(<DiscipleTree />)} />
        <Route path="attendance" element={withSuspense(<Attendance />)} />
        <Route path="attendance/reports" element={withSuspense(<Reports />)} />
        <Route path="leaderboard" element={withSuspense(<Leaderboard />)} />
        <Route path="devotion/new" element={withSuspense(<DevotionEditor />)} />
        <Route path="devotion/:id" element={withSuspense(<DevotionEditor />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
