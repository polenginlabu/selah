/**
 * Registers the one service worker, and retires the old Firebase-only one.
 *
 * MIGRATION: every existing install has /firebase-messaging-sw.js registered
 * at scope "/". Registering a different script at the same scope replaces that
 * registration, but only once this runs — so anyone who never opens the app
 * again keeps the old worker, and anyone who does gets both caching and push
 * from the single worker. The explicit unregister below covers the case where
 * the browser kept both around under slightly different scopes.
 */

export const SERVICE_WORKER_PATH = '/sw.js'
const LEGACY_PATH = '/firebase-messaging-sw.js'
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

let registrationPromise = null

export function registerServiceWorker({ onUpdateReady } = {}) {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  // vite-plugin-pwa only emits /sw.js on a real build (devOptions is off), so
  // in `vite dev` that path falls through to the SPA index.html and the
  // browser rejects the registration for its text/html MIME type. Nothing to
  // register in dev — skip rather than throw a SecurityError on every boot.
  if (import.meta.env.DEV) return Promise.resolve(null)
  if (registrationPromise) return registrationPromise

  registrationPromise = (async () => {
    // Retire the legacy worker first so it cannot serve stale responses
    // alongside the new one during the changeover.
    try {
      for (const existing of await navigator.serviceWorker.getRegistrations()) {
        if (existing.active?.scriptURL?.endsWith(LEGACY_PATH)) await existing.unregister()
      }
    } catch (err) {
      console.warn('Could not retire the legacy service worker', err)
    }

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH)

    // A new build is precached but the browser only checks for updates on
    // navigation and roughly once a day. That is why a fresh deploy sometimes
    // needs a manual hard refresh to appear. Check on every focus too, so an
    // update is picked up as soon as the user returns to the tab — then the
    // auto-apply below swaps it in without them doing anything.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => {})
      }
    })

    // visibilitychange covers backgrounding, and register() above covers a
    // cold start — but a tab left open and in the foreground for hours hits
    // neither, and would sit on the old build until the browser's own ~24h
    // check. Poll while visible so a deploy lands within the hour.
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => {})
      }
    }, UPDATE_CHECK_INTERVAL_MS)

    // A new build is precached but waiting behind the current one. Let the app
    // decide when to swap — reloading underneath someone mid-devotion is worse
    // than showing them a prompt.
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady?.(() => {
            installing.postMessage({ type: 'SKIP_WAITING' })
          })
        }
      })
    })

    return registration
  })()

  return registrationPromise
}

/** The registration FCM needs; shares the one above rather than making another. */
export function getServiceWorkerRegistration() {
  return registrationPromise ?? registerServiceWorker()
}

/**
 * Reloads once the new worker takes control. Separate from the prompt so the
 * listener is attached before SKIP_WAITING is sent — attaching it afterwards
 * can miss the event entirely on a fast swap.
 */
export function reloadOnControllerChange() {
  if (!('serviceWorker' in navigator)) return
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}
