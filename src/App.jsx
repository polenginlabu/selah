import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Logo } from './components/Logo'
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
const Prayer = lazy(() => import('./pages/Prayer'))
// Two named exports from one module. Both resolve the same chunk, so it is
// fetched once — lazy() needs a component as `default`, and a lazy component
// has no properties to reach into.
const PrivacyPolicy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.PrivacyPolicy })))
const TermsOfService = lazy(() => import('./pages/Legal').then((m) => ({ default: m.TermsOfService })))
const DataDeletion = lazy(() => import('./pages/Legal').then((m) => ({ default: m.DataDeletion })))

function RouteLoadingSpinner() {
  return <SplashScreen />
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

// The global reduced-motion rule in index.css only reaches CSS animations; the
// Lottie player is driven from JS, so the splash has to ask for itself.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(REDUCED_MOTION).matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION)
    if (!query?.addEventListener) return
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * Full-screen splash, mirroring #boot-splash in index.html: same opaque
 * canvas, same safe-area padding, same 40px lockup at the exact centre. The
 * boot splash fades away on top of this one, so the only thing that changes at
 * the handoff is the boat rising in above the lockup.
 *
 * Portalled to <body> because the route fallback renders inside Layout's
 * <main>, whose `rise` animation applies a transform — and a transformed
 * ancestor would trap a position:fixed child inside it.
 */
function SplashScreen({ exiting = false, onExited }) {
  const reducedMotion = usePrefersReducedMotion()

  // Backstop for onAnimationEnd: if the exit animation never runs, the overlay
  // must still go, or it would sit over the app for good.
  useEffect(() => {
    if (!exiting) return
    const timer = setTimeout(onExited, 400)
    return () => clearTimeout(timer)
  }, [exiting, onExited])

  return createPortal(
    <div
      role={exiting ? undefined : 'status'}
      aria-live={exiting ? undefined : 'polite'}
      aria-label={exiting ? undefined : 'Loading'}
      aria-hidden={exiting || undefined}
      onAnimationEnd={(e) => {
        if (exiting && e.target === e.currentTarget) onExited()
      }}
      className={`fixed inset-0 z-[100] grid touch-none place-items-center overscroll-none bg-canvas pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] ${
        exiting ? 'pointer-events-none animate-[fadeIn_240ms_ease-in_reverse_both]' : ''
      }`}
    >
      <span className="sr-only">Loading…</span>
      <div className="relative" aria-hidden="true">
        {/* Hangs above the lockup rather than stacking with it, so the lockup
            keeps the boot splash's position to the pixel. */}
        <div className="absolute bottom-full left-1/2 mb-5 -translate-x-1/2">
          {/* 88px window onto the 256px animation; the translate is the crop,
              in the same proportion to the window as before. */}
          <div className="h-[88px] w-[88px] animate-rise overflow-hidden">
            <div style={{ transform: 'translate(-33px, -48.4px) scale(1.75)', transformOrigin: '0 0' }}>
              <DotLottieReact
                key={reducedMotion ? 'still' : 'sailing'}
                src={splashAnimation}
                autoplay={!reducedMotion}
                loop={!reducedMotion}
                backgroundColor="transparent"
                className="h-[88px] w-[88px]"
                width={256}
                height={256}
              />
            </div>
          </div>
        </div>
        <Logo size={40} />
      </div>
    </div>,
    document.body
  )
}

/**
 * Keeps the splash on screen for its fade-out after auth settles. Purely
 * presentational: the app renders underneath the moment `loading` flips, and
 * the fading overlay ignores pointer events.
 */
function useSplashExit(loading) {
  const [wasLoading, setWasLoading] = useState(loading)
  const [exiting, setExiting] = useState(false)
  if (wasLoading !== loading) {
    setWasLoading(loading)
    setExiting(!loading)
  }
  const finish = useCallback(() => setExiting(false), [])
  return [exiting, finish]
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
  const [splashExiting, finishSplashExit] = useSplashExit(loading)

  // One splash at one tree position for both phases, so the fade-out carries
  // on the same instance — the boat keeps sailing instead of remounting.
  return (
    <>
      {!loading && (user ? <AuthedRoutes /> : <SignIn />)}
      {(loading || splashExiting) && <SplashScreen exiting={!loading} onExited={finishSplashExit} />}
    </>
  )
}

function AuthedRoutes() {
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
        <Route path="prayer" element={withSuspense(<Prayer />)} />
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
