import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Home } from './pages/Home'
import { SignIn } from './pages/SignIn'
import splashAnimation from './assets/sailing-boat.lottie'

const DevotionEditor = lazy(() => import('./pages/DevotionEditor'))
const DailyDevotion = lazy(() => import('./pages/DailyDevotion'))
const BibleReader = lazy(() => import('./pages/BibleReader'))
const ConquestWeek = lazy(() => import('./pages/ConquestWeek'))
const Achievements = lazy(() => import('./pages/Achievements'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const Community = lazy(() => import('./pages/Community'))
const DiscipleTree = lazy(() => import('./pages/DiscipleTree'))
const Attendance = lazy(() => import('./pages/Attendance'))
const Reports = lazy(() => import('./pages/Reports'))
const Admin = lazy(() => import('./pages/Admin'))
const Goals = lazy(() => import('./pages/Goals'))
// Two named exports from one module. Both resolve the same chunk, so it is
// fetched once — lazy() needs a component as `default`, and a lazy component
// has no properties to reach into.
const PrivacyPolicy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.PrivacyPolicy })))
const TermsOfService = lazy(() => import('./pages/Legal').then((m) => ({ default: m.TermsOfService })))
const DataDeletion = lazy(() => import('./pages/Legal').then((m) => ({ default: m.DataDeletion })))

function RouteLoadingSpinner() {
  return <SplashScreen />
}

function SplashScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="h-40 w-40 overflow-hidden">
        <div style={{ transform: 'translate(-60px, -88px) scale(1.75)', transformOrigin: '0 0' }}>
          <DotLottieReact
            src={splashAnimation}
            autoplay
            loop
            backgroundColor="transparent"
            className="h-40 w-40"
            width={256}
            height={256}
          />
        </div>
      </div>
    </div>
  )
}

function withSuspense(element) {
  return <Suspense fallback={<RouteLoadingSpinner />}>{element}</Suspense>
}

/**
 * Everything behind sign-in. Split out so the legal pages can sit in front of
 * the auth gate below.
 */
function AuthedApp() {
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
        <Route path="goals" element={withSuspense(<Goals />)} />
        <Route path="leaderboard" element={withSuspense(<Leaderboard />)} />
        {/* Admin itself redirects non-admins; the RPCs it calls enforce this in Postgres. */}
        <Route path="admin" element={withSuspense(<Admin />)} />
        {/* The shared SELAH devotional. Distinct from devotion/:id below, which
            is the reader's own journal entry. */}
        <Route path="daily" element={withSuspense(<DailyDevotion />)} />
        <Route path="daily/:date" element={withSuspense(<DailyDevotion />)} />
        <Route path="devotion/new" element={withSuspense(<DevotionEditor />)} />
        <Route path="devotion/:id" element={withSuspense(<DevotionEditor />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

/**
 * Second boundary, inside the router. The one in main.jsx is a last resort and
 * cannot see navigation; this one takes the current path as its reset key, so
 * a page that throws clears itself the moment you navigate elsewhere instead
 * of wedging the whole session.
 */
function RoutedErrorBoundary({ children }) {
  const location = useLocation()
  return <ErrorBoundary routeKey={location.pathname}>{children}</ErrorBoundary>
}

export function App() {
  return (
    <RoutedErrorBoundary>
      <Routes>
        {/* PUBLIC, deliberately. Google will not accept a privacy policy URL it
          cannot reach, and a visitor deciding whether to sign in shouldn't have
          to sign in first to read how their data is handled. These sit ahead of
          the auth gate for that reason. */}
        <Route path="/privacy" element={withSuspense(<PrivacyPolicy />)} />
        <Route path="/terms" element={withSuspense(<TermsOfService />)} />
        <Route path="/data-deletion" element={withSuspense(<DataDeletion />)} />
        <Route path="*" element={<AuthedApp />} />
      </Routes>
    </RoutedErrorBoundary>
  )
}
