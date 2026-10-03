// Pure (no Vite imports) so vite.config.js can use it at build time and
// scripts/bible/offlineBibles.test.js can run it under plain node.
//
// Each bundled Bible book is emitted as assets/bible/<translation>-<BOOKID>-<hash>.js
// so a cached chunk says which translation it belongs to, and the build writes
// assets/bible-index.json listing every chunk URL. The "Download for offline"
// option (src/data/publicBibles/offline.js) fetches exactly those URLs, which
// are the ones the reader's dynamic import requests.

// Not "bible-manifest.json": vite.config.js treats a name ending in "-" plus
// 8+ characters as content-hashed and would precache it once, never updated.
export const MANIFEST_FILE = 'assets/bible-index.json'

const SOURCE = /\/src\/data\/publicBibles\/([a-z0-9]+)\/([A-Z0-9]+)\.json$/
const EMITTED = /^assets\/bible\/([a-z0-9]+)-([A-Z0-9]+)-[^/]+\.js$/

/** The bundled book a chunk was built from, or null for any other module. */
export function parseChunkSource(facadeModuleId) {
  const match = SOURCE.exec(facadeModuleId ?? '')
  return match ? { translation: match[1], bookId: match[2] } : null
}

/** Rollup chunkFileNames pattern for a bundled book, or null for any other chunk. */
export function chunkFileName(facadeModuleId) {
  const source = parseChunkSource(facadeModuleId)
  return source ? `assets/bible/${source.translation}-${source.bookId}-[hash].js` : null
}

/** { kjv: { GEN: '/assets/bible/kjv-GEN-abc.js', ... }, ... } from emitted file names. */
export function buildManifest(fileNames) {
  const manifest = {}
  for (const fileName of fileNames) {
    const match = EMITTED.exec(fileName)
    if (!match) continue
    const [, translation, bookId] = match
    manifest[translation] ??= {}
    if (manifest[translation][bookId]) throw new Error(`Two chunks for ${translation} ${bookId}`)
    manifest[translation][bookId] = `/${fileName}`
  }
  return manifest
}
