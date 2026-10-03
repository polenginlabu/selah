/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { CacheExpiration, ExpirationPlugin } from 'workbox-expiration'
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
// been read it is served from cache with no further network request. This is
// what makes the Bible reader work offline and on a bad connection. Only a
// real 200 is kept: CacheFirst never revalidates, so a cached opaque failure
// would stick.
registerRoute(
  ({ url }) => url.hostname === 'api.esv.org' || url.hostname === 'api.nlt.to',
  new CacheFirst({
    cacheName: 'scripture-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
)

// Bundled public-domain Bibles (src/data/publicBibles): one chunk per book,
// kept out of the precache by vite.config.js so installing the app doesn't
// download three whole Bibles. A book is cached the first time it is opened.
// The filename is content-hashed, so a cached book stays valid across deploys.
// "Download for offline" (src/data/publicBibles/offline.js) writes a whole
// translation into this same cache, so downloaded books are served from here.
// Expiration only counts entries this route has served, and a build has at
// most 198 books (three translations), so on-demand reading alone can never
// reach the limit; the headroom is for books left by older builds, which are
// least recently used and so are evicted first.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/assets/bible/'),
  new CacheFirst({
    cacheName: 'bible-public-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 500 }),
    ],
  })
)

// API.Bible translations (NIV UK, MSG, AMP) come through the bible-reader edge
// function as a POST, and the Cache API cannot store POST requests, so no
// stock strategy can serve them offline. Instead, chapter reads are cached
// under a synthetic GET key built from the request body. Search and catalogue
// calls pass straight through. A cached chapter is served without contacting
// the function, so it stays readable on this device without a session.
const edgeChapters = new CacheExpiration('scripture-edge-v1', { maxEntries: 300 })
registerRoute(
  ({ url }) => url.pathname.endsWith('/functions/v1/bible-reader'),
  async ({ request }) => {
    const body = await request.clone().json().catch(() => null)
    const { action, translation, bookId, chapter } = body ?? {}
    if (action !== 'chapter' || !translation || !bookId || !chapter) return fetch(request)
    const key = `${self.location.origin}/__bible-chapter/${[translation, bookId, chapter].map(encodeURIComponent).join('/')}`
    const cache = await caches.open('scripture-edge-v1')
    const cached = await cache.match(key)
    if (cached) return cached
    const response = await fetch(request)
    if (response.status === 200) {
      await cache.put(key, response.clone())
      await edgeChapters.updateTimestamp(key)
      await edgeChapters.expireEntries()
    }
    return response
  },
  'POST'
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

// Take over as soon as a new build installs instead of waiting for every tab
// to close. The page reloads itself on controllerchange, so the swap lands
// quickly — no waiting phase, no lingering on a stale bundle. The trade-off is
// that an in-flight action can be interrupted by the reload; the app accepts
// that for now in exchange for never serving a stale build.
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Let the page tell a waiting worker to take over, so an update can be applied
// on the user's cue instead of only after every tab is closed. (Kept for
// backwards compatibility — the worker now skips waiting on its own, but an
// older page may still post this message.)
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

  // Foreground banners are the page's job (Layout.jsx onMessage). The compat
  // SDK suppresses the SW path when a window is focused on most platforms,
  // but iOS PWAs can deliver the same push to BOTH the SW and the open page —
  // double banner. Explicitly skip here when a window is visible, so the
  // foreground and background paths stay mutually exclusive on every platform.
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const visible = clients.some((c) => c.visibilityState === 'visible' && 'focus' in c)
    if (visible) return
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
    })
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
