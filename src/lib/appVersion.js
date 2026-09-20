/**
 * Last-resort staleness detection.
 *
 * The service worker already tries to update itself (see serviceWorker.js), and
 * public/.htaccess already tells caches not to hold index.html, app.js or
 * sw.js. Both can fail for reasons the app cannot see:
 *
 *   - the host may ignore .htaccess `Header` directives entirely (AllowOverride)
 *   - an edge/CDN layer may serve a stale sw.js regardless of the headers,
 *     so the worker's own update check never notices a new build
 *
 * In both cases every device keeps serving the old bundle from the worker's
 * precache and only a hard refresh — which mobile browsers barely expose —
 * escapes it.
 *
 * This bypasses the whole problem by asking a question no cache can answer
 * from a stored copy: it fetches /version.json with a unique query string
 * every time. A novel URL has no cache entry anywhere, at any layer, so the
 * response is necessarily from the origin.
 *
 * If the build on the server differs from the build running in this tab, the
 * worker is given a chance to swap itself in; if that does not happen, the
 * worker is torn down and the page reloaded, which is the programmatic
 * equivalent of the hard refresh people are doing by hand.
 */

// Replaced at build time by vite.config.js. The fallback keeps `vite dev`
// working, where no version.json is emitted.
const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'

// Long enough not to be chatty, short enough that a deploy reaches an open tab
// within the hour. Each check is a ~40 byte response.
const CHECK_INTERVAL_MS = 15 * 60 * 1000

// How long to let the service worker apply the update on its own before
// forcing it. The normal path (skipWaiting + controllerchange + reload) takes
// a second or two.
const GRACE_MS = 12 * 1000

// Guards against a reload loop. If the server says "new build" but reloading
// does not change what we run — a broken deploy, a cache we cannot defeat —
// we must not reload forever. One forced reload per build id, per tab.
const FORCED_KEY = 'selah:forced-reload-for'

function alreadyForced(buildId) {
  try {
    return sessionStorage.getItem(FORCED_KEY) === buildId
  } catch {
    // Private mode: no memory of previous attempts, so do not force at all
    // rather than risk looping.
    return true
  }
}

function rememberForced(buildId) {
  try { sessionStorage.setItem(FORCED_KEY, buildId) } catch { /* nothing to do */ }
}

/** The build the server is currently serving, or null if it cannot be read. */
async function fetchServerBuildId() {
  try {
    // cache: 'no-store' handles the browser; the query string handles every
    // cache upstream of it, which is the one that actually bites here.
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (!response.ok) return null
    const { buildId } = await response.json()
    return typeof buildId === 'string' ? buildId : null
  } catch {
    // Offline, or version.json is not deployed yet. Either way this check is
    // an optimisation — never let it surface as an error.
    return null
  }
}

/**
 * Forces this tab onto the newest build.
 *
 * Unregisters the worker first. Reloading while it is still in control just
 * re-serves the same precached shell, which is exactly the state we are
 * trying to escape.
 */
async function forceUpdate(serverBuildId) {
  rememberForced(serverBuildId)
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(registrations.map((r) => r.unregister()))
    // The precache survives unregistering, so clear it too — otherwise a
    // re-registered worker can repopulate itself from the old entries.
    if (window.caches) {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('workbox-precache')).map((k) => caches.delete(k)))
    }
  } catch {
    // Best effort. A plain reload may still be enough.
  }
  window.location.reload()
}

let checking = false

/** One check. Exported for the "check now" path and for tests. */
export async function checkForUpdate({ onUpdateFound } = {}) {
  if (checking || BUILD_ID === 'dev') return false
  checking = true
  try {
    const serverBuildId = await fetchServerBuildId()
    if (!serverBuildId || serverBuildId === BUILD_ID) return false

    console.info(`[selah] a newer build is available (${serverBuildId}); this tab is ${BUILD_ID}`)
    onUpdateFound?.(serverBuildId)

    // Give the service worker its chance first: its own swap reloads the page
    // through controllerchange, which is gentler than tearing it down.
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.()
      await registration?.update()
    } catch {
      // Fall through to the forced path.
    }

    if (alreadyForced(serverBuildId)) return true

    // Still here after the grace period means the worker did not swap — the
    // stale-sw.js case. Take it down by hand.
    setTimeout(() => { forceUpdate(serverBuildId) }, GRACE_MS)
    return true
  } finally {
    checking = false
  }
}

/**
 * Starts watching for new builds: on load, whenever the tab is brought back to
 * the foreground, and on a slow interval while it stays open.
 */
export function watchForUpdates(options) {
  if (BUILD_ID === 'dev') return () => {}

  const run = () => { checkForUpdate(options) }

  run()
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') run()
  }, CHECK_INTERVAL_MS)

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(timer)
  }
}

export { BUILD_ID }
