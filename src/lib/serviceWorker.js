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

let registrationPromise = null

export function registerServiceWorker({ onUpdateReady } = {}) {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
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
