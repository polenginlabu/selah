import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,lottie}'],
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
