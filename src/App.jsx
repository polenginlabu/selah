import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { SignIn } from './pages/SignIn'
import splashAnimation from './assets/sailing-boat.lottie'

const DevotionEditor = lazy(() => import('./pages/DevotionEditor'))
const BibleReader = lazy(() => import('./pages/BibleReader'))
const ConquestWeek = lazy(() => import('./pages/ConquestWeek'))
const Achievements = lazy(() => import('./pages/Achievements'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const Community = lazy(() => import('./pages/Community'))
const DiscipleTree = lazy(() => import('./pages/DiscipleTree'))
const Attendance = lazy(() => import('./pages/Attendance'))
const Reports = lazy(() => import('./pages/Reports'))
const Admin = lazy(() => import('./pages/Admin'))

function RouteLoadingSpinner() {
  return <SplashScreen />
}

function SplashScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <DotLottieReact src={splashAnimation} autoplay loop backgroundColor="transparent" className="h-40 w-40" />
      <p className="font-sans text-xl font-semibold tracking-tight text-ink">Selah</p>
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
        {/* Admin itself redirects non-admins; the RPCs it calls enforce this in Postgres. */}
        <Route path="admin" element={withSuspense(<Admin />)} />
        <Route path="devotion/new" element={withSuspense(<DevotionEditor />)} />
        <Route path="devotion/:id" element={withSuspense(<DevotionEditor />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
