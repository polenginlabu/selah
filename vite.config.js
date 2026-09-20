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
