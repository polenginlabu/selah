// "Download for offline" for the bundled public-domain Bibles. Pure, with the
// cache and fetch passed in, so scripts/bible/offlineBibles.test.js can run it
// under plain node. Licensed translations are never downloaded: their API
// terms restrict storing full text, so they stay cached per chapter on read.

// The cache src/sw.js serves assets/bible/ chunks from. Writing the downloaded
// chunks here is what makes a downloaded book open offline.
export const CACHE_NAME = 'bible-public-v1'
// Written by the build (scripts/bible/chunkManifest.js, MANIFEST_FILE).
export const MANIFEST_URL = '/assets/bible-index.json'

/** Chunk URLs for one translation, in book order, from the build manifest. */
export function translationUrls(manifest, id, bookIds) {
  const books = manifest?.[id]
  if (!books) return []
  return bookIds.map((bookId) => books[bookId]).filter(Boolean)
}

const pathOf = (url) => new URL(url, 'http://local').pathname
const prefixOf = (id) => `/assets/bible/${id}-`

async function cachedPaths(cache) {
  return new Set((await cache.keys()).map((request) => pathOf(request.url)))
}

/** How many of the URLs are in the cache. complete means all of them. */
export async function getDownloadState(cache, urls) {
  const paths = await cachedPaths(cache)
  const cached = urls.filter((url) => paths.has(pathOf(url))).length
  return { cached, total: urls.length, complete: urls.length > 0 && cached === urls.length }
}

/** A readable message for a stopped download, with how much was saved. */
export function interruptedMessage(done, total) {
  return `Download interrupted — ${done} of ${total} books saved. Check your connection and retry.`
}

/**
 * Fetches every URL not already cached and stores it. Calls
 * onProgress(done, total) with done counting cached books. Stops at the first
 * failure and rejects with an Error carrying done/total; books saved before
 * that stay in the cache, so a retry only fetches the rest. Only a real 200
 * JavaScript response is stored, so a server's index.html fallback is never
 * kept as a book.
 */
export async function downloadTranslation({ cache, fetchFn, urls, concurrency = 4, onProgress = () => {} }) {
  const paths = await cachedPaths(cache)
  const pending = urls.filter((url) => !paths.has(pathOf(url)))
  const total = urls.length
  let done = total - pending.length
  let failed = null
  onProgress(done, total)

  async function worker() {
    while (!failed && pending.length) {
      const url = pending.shift()
      try {
        const response = await fetchFn(url)
        const type = response.headers?.get?.('content-type') ?? ''
        if (response.status !== 200 || response.redirected || (type && !type.includes('javascript'))) {
          throw new Error(`Unexpected response ${response.status} for ${url}`)
        }
        await cache.put(url, response)
        done += 1
        onProgress(done, total)
      } catch (err) {
        failed ??= err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker))

  if (failed) {
    const error = new Error(interruptedMessage(done, total))
    error.done = done
    error.total = total
    error.cause = failed
    throw error
  }
  return { done, total }
}

/**
 * Deletes the translation's chunks, including ones left by an older build
 * (a different hash), and leaves every other translation alone.
 */
export async function removeTranslation(cache, id, urls = []) {
  const prefix = prefixOf(id)
  const keys = await cache.keys()
  const targets = new Set(urls.map(pathOf))
  await Promise.all(keys
    .filter((request) => { const path = pathOf(request.url); return targets.has(path) || path.startsWith(prefix) })
    .map((request) => cache.delete(request)))
}
