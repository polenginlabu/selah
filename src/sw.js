/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

/**
 * The ONE service worker for Selah.
 *
 * It has to do two unrelated jobs because only one worker can own scope "/",
 * and Firebase Cloud Messaging was here first. Splitting them into two files
 * would mean the second registration silently evicts the first, and push
 * notifications would stop with no error anywhere.
 *
 *   1. Offline: precache the app shell, cache Scripture and API reads.
 *   2. Push: background FCM messages, moved here from the old
 *      firebase-messaging-sw.js.
 */

// --- 1. App shell ----------------------------------------------------------

// __WB_MANIFEST is replaced at build time with this build's exact asset list.
precacheAndRoute(self.__WB_MANIFEST)
// Old builds leave their own caches behind; without this they accumulate on
// the device forever.
cleanupOutdatedCaches()

// Selah is a single-page app: every route must resolve to index.html. Without
// this, opening the installed app offline on /goals is a 404 rather than the
// app. Excluded: anything that is genuinely a server call.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/auth\//, /\/functions\/v1\//],
  })
)

// --- 2. Runtime caching ----------------------------------------------------

// Scripture is immutable — Psalm 46 will not change — so once a chapter has
// been read it can be served from cache indefinitely. This is what makes the
// Bible reader work on a bad connection.
registerRoute(
  ({ url }) => url.hostname === 'api.esv.org' || url.hostname === 'api.nlt.to',
  new StaleWhileRevalidate({
    cacheName: 'scripture-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
)

// Supabase REST reads: network first so fresh data always wins, falling back
// to the last response when offline. Deliberately GET only — a queued write
// must go through the outbox in lib/outbox.js, not a cache.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && url.pathname.startsWith('/rest/v1/'),
  new NetworkFirst({
    cacheName: 'supabase-reads-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  })
)

// Google profile pictures, so avatars don't vanish offline.
registerRoute(
  ({ url }) => url.hostname.endsWith('googleusercontent.com'),
  new StaleWhileRevalidate({
    cacheName: 'avatars-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
)

// --- 3. Update handling ----------------------------------------------------

// Let the page tell a waiting worker to take over, so an update can be applied
// on the user's cue instead of only after every tab is closed.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// --- 4. Firebase Cloud Messaging ------------------------------------------
// Moved verbatim from public/firebase-messaging-sw.js. These config values are
// public client identifiers, not secrets — the same values are already in the
// app bundle. Security comes from Firebase rules, not from hiding them.

importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyB2H-cIP67lbW0amDtACMQwRYhLTSN_Xns',
  authDomain: 'devotional-app-c2633.firebaseapp.com',
  projectId: 'devotional-app-c2633',
  storageBucket: 'devotional-app-c2633.firebasestorage.app',
  messagingSenderId: '205410997272',
  appId: '1:205410997272:web:aaf7006381448a71821f6d',
})

firebase.messaging().onBackgroundMessage((payload) => {
  const { title, body } = payload.notification ?? {}
  if (!title) return
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/favicon-32.png',
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => 'focus' in c)
      return existing ? existing.focus() : self.clients.openWindow('/')
    })
  )
})
