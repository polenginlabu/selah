import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Stamped into the bundle AND written to /version.json, so a running tab can
// ask the server "is there a newer build than me?" without trusting a single
// cache header. See src/lib/appVersion.js.
const BUILD_ID = new Date().toISOString()

/**
 * Emits version.json next to index.html.
 *
 * Deliberately a separate tiny file rather than a header or a hash in the
 * bundle name: it can be fetched with a cache-busting query string, which is
 * the one thing no cache anywhere — browser, service worker, Apache, or a CDN
 * in front of it — is able to serve stale.
 */
function versionManifest() {
  return {
    name: 'selah-version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId: BUILD_ID }),
      })
    },
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    react(),
    versionManifest(),
    VitePWA({
      // injectManifest, not generateSW: Firebase Cloud Messaging already owns
      // a service worker at scope "/", and only one can win there. Registering
      // a second would silently kill push notifications. So we hand-write ONE
      // worker (src/sw.js) that does both caching and FCM, and let the plugin
      // inject the precache manifest into it.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // We register it ourselves in lib/serviceWorker.js, so the old FCM
      // worker can be torn down first.
      injectRegister: null,
      // public/manifest.json is hand-maintained and already linked from
      // index.html; generating a second one would compete with it.
      manifest: false,
      injectManifest: {
        // jpg/jpeg/webp are here for the devotional hero. Without them the
        // image is bundled but never precached, so it is the one element that
        // breaks when the installed app opens offline — which is the whole
        // reason it is bundled rather than hot-linked.
        globPatterns: ['**/*.{js,css,html,png,jpg,jpeg,webp,svg,woff2,lottie}'],
        // The Bible reader can pull a large chapter payload; the default 2 MiB
        // cap would silently drop assets from the precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // THE STALE-APP BUG.
        //
        // vite-plugin-pwa emits `revision: null` for everything Vite built,
        // because Vite normally content-hashes its output and a hashed URL is
        // its own version. This config overrides entryFileNames to the stable
        // `assets/app.js` (see build.rollupOptions below), which breaks that
        // assumption: `revision: null` tells Workbox the URL is immutable, so
        // it precaches app.js ONCE and never re-fetches it again on any later
        // build. The worker then serves a fresh index.html next to a months-old
        // app.js, which is the app silently reverting to an old version after
        // the post-activation reload — and why only a hard refresh, which
        // bypasses the worker entirely, showed the new code.
        //
        // Anything genuinely content-hashed keeps revision: null, which is
        // correct and keeps those entries out of every future precache diff.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((entry) => {
              if (entry.revision) return entry
              // Vite/Rollup hashes: `name-A1b2C3d4.ext`, base64url alphabet.
              const hashed = /[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(entry.url)
              return hashed ? entry : { ...entry, revision: BUILD_ID }
            }),
            warnings: [],
          }),
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  assetsInclude: ['**/*.lottie'],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/app[extname]',
      },
    },
  },
})
