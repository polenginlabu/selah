import test from 'node:test'
import assert from 'node:assert/strict'
import { BOOK_IDS } from '../../supabase/functions/_shared/bible.js'
import { MANIFEST_FILE, buildManifest, chunkFileName, parseChunkSource } from './chunkManifest.js'
import {
  CACHE_NAME, MANIFEST_URL, downloadTranslation, getDownloadState, interruptedMessage, removeTranslation, translationUrls,
} from '../../src/data/publicBibles/offline.js'

const ORIGIN = 'https://selah.test'
const files = (id) => BOOK_IDS.map((bookId) => `assets/bible/${id}-${bookId}-Ab_9-xY1.js`)
const MANIFEST = buildManifest([...files('web'), ...files('kjv'), ...files('bbe'), 'assets/app.js', 'assets/vendor-x1y2z3w4.js'])
const urlsFor = (id) => translationUrls(MANIFEST, id, BOOK_IDS)

// In-memory stand-in for a Cache API cache: keys are absolute URLs, like the
// Request objects the real cache.keys() returns.
function fakeCache(initial = []) {
  const store = new Map(initial.map((url) => [new URL(url, ORIGIN).href, 'cached']))
  return {
    store,
    async keys() { return [...store.keys()].map((url) => ({ url })) },
    async put(url, response) { store.set(new URL(url, ORIGIN).href, response) },
    async delete(request) { return store.delete(request.url) },
  }
}

const jsResponse = (status = 200, type = 'text/javascript') => ({ status, redirected: false, headers: new Map([['content-type', type]]) })
function fakeFetch({ failAt = Infinity, response = () => jsResponse() } = {}) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    if (calls.length >= failAt) throw new TypeError('Failed to fetch')
    return response(url)
  }
  return { fn, calls }
}

test('chunk names carry the translation and book, and other modules are left alone', () => {
  assert.equal(CACHE_NAME, 'bible-public-v1')
  assert.deepEqual(parseChunkSource('/repo/src/data/publicBibles/kjv/1SA.json'), { translation: 'kjv', bookId: '1SA' })
  assert.equal(chunkFileName('/repo/src/data/publicBibles/kjv/GEN.json'), 'assets/bible/kjv-GEN-[hash].js')
  assert.equal(chunkFileName('/repo/src/pages/BibleReader.jsx'), null)
  assert.equal(chunkFileName('/repo/src/data/publicBibles/index.js'), null)
  assert.equal(chunkFileName(undefined), null)
  assert.equal(chunkFileName(null), null)
})

test('the page fetches the manifest the build writes, and it is revisioned on every build', () => {
  assert.equal(MANIFEST_URL, `/${MANIFEST_FILE}`)
  // Same test vite.config.js manifestTransforms uses to skip revisioning
  // "content-hashed" files; the manifest must not look hashed or it goes stale.
  assert.doesNotMatch(MANIFEST_FILE, /[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/)
})

test('the manifest lists all 66 books per translation and nothing else', () => {
  assert.deepEqual(Object.keys(MANIFEST).sort(), ['bbe', 'kjv', 'web'])
  for (const id of ['web', 'kjv', 'bbe']) {
    const urls = urlsFor(id)
    assert.equal(urls.length, 66)
    assert.ok(urls.every((url) => url.startsWith(`/assets/bible/${id}-`)))
  }
  assert.equal(MANIFEST.kjv.GEN, '/assets/bible/kjv-GEN-Ab_9-xY1.js')
  assert.deepEqual(translationUrls(MANIFEST, 'nivuk', BOOK_IDS), [])
  assert.deepEqual(translationUrls(null, 'kjv', BOOK_IDS), [])
  assert.throws(() => buildManifest(['assets/bible/kjv-GEN-a.js', 'assets/bible/kjv-GEN-b.js']), /Two chunks/)
})

test('a full download stores every book with monotonic progress', async () => {
  const cache = fakeCache()
  const { fn, calls } = fakeFetch()
  const progress = []
  const result = await downloadTranslation({ cache, fetchFn: fn, urls: urlsFor('kjv'), onProgress: (done, total) => progress.push([done, total]) })
  assert.deepEqual(result, { done: 66, total: 66 })
  assert.equal(calls.length, 66)
  assert.deepEqual(progress[0], [0, 66])
  assert.deepEqual(progress.at(-1), [66, 66])
  progress.reduce((prev, [done]) => { assert.ok(done >= prev); return done }, 0)
  assert.deepEqual(await getDownloadState(cache, urlsFor('kjv')), { cached: 66, total: 66, complete: true })
  assert.deepEqual(await getDownloadState(cache, urlsFor('web')), { cached: 0, total: 66, complete: false })
})

test('a retry skips books that are already cached', async () => {
  const already = urlsFor('kjv').slice(0, 23)
  const cache = fakeCache(already)
  assert.deepEqual(await getDownloadState(cache, urlsFor('kjv')), { cached: 23, total: 66, complete: false })
  const { fn, calls } = fakeFetch()
  const progress = []
  await downloadTranslation({ cache, fetchFn: fn, urls: urlsFor('kjv'), onProgress: (done) => progress.push(done) })
  assert.equal(calls.length, 43)
  assert.ok(calls.every((url) => !already.includes(url)))
  assert.equal(progress[0], 23)
})

test('a network failure stops the download with a readable error and keeps saved books', async () => {
  const cache = fakeCache()
  const { fn, calls } = fakeFetch({ failAt: 10 })
  const progress = []
  const err = await downloadTranslation({ cache, fetchFn: fn, urls: urlsFor('kjv'), onProgress: (done) => progress.push(done) }).then(() => null, (e) => e)
  assert.ok(err, 'download rejects')
  const saved = (await getDownloadState(cache, urlsFor('kjv'))).cached
  assert.ok(saved >= 9 && saved < 66, `saved ${saved}`)
  assert.equal(err.done, saved)
  assert.equal(err.total, 66)
  assert.equal(err.message, interruptedMessage(saved, 66))
  assert.match(err.message, new RegExp(`${saved} of 66 books saved`))
  assert.ok(calls.length < 66, 'no further fetches start after a failure')
  assert.ok(Math.max(...progress) <= saved)
})

test('a non-200, redirected or HTML response is never cached and counts as a failure', async () => {
  for (const response of [
    () => jsResponse(404),
    () => jsResponse(500),
    () => ({ ...jsResponse(), redirected: true }),
    () => jsResponse(200, 'text/html'),
  ]) {
    const cache = fakeCache()
    const { fn } = fakeFetch({ response })
    await assert.rejects(downloadTranslation({ cache, fetchFn: fn, urls: urlsFor('bbe'), concurrency: 1 }), /Download interrupted — 0 of 66/)
    assert.equal(cache.store.size, 0)
  }
})

test('the download only requests same-origin bundled chunks', async () => {
  const { fn, calls } = fakeFetch()
  for (const id of ['web', 'kjv', 'bbe']) await downloadTranslation({ cache: fakeCache(), fetchFn: fn, urls: urlsFor(id) })
  assert.equal(calls.length, 198)
  for (const url of calls) {
    assert.match(url, /^\/assets\/bible\/(web|kjv|bbe)-[A-Z0-9]+-[^/]+\.js$/)
    assert.doesNotMatch(url, /api\.esv\.org|api\.nlt\.to|api\.bible|functions\/v1/)
  }
})

test('remove deletes only that translation, including chunks from an older build', async () => {
  const cache = fakeCache([...urlsFor('kjv'), ...urlsFor('web'), '/assets/bible/kjv-GEN-oldhash1.js', '/assets/bible/GEN-legacy12.js', '/assets/app.js'])
  await removeTranslation(cache, 'kjv', urlsFor('kjv'))
  assert.deepEqual(await getDownloadState(cache, urlsFor('kjv')), { cached: 0, total: 66, complete: false })
  assert.deepEqual(await getDownloadState(cache, urlsFor('web')), { cached: 66, total: 66, complete: true })
  const left = [...cache.store.keys()].map((url) => new URL(url).pathname)
  assert.ok(!left.some((path) => path.startsWith('/assets/bible/kjv-')))
  assert.ok(left.includes('/assets/bible/GEN-legacy12.js'))
  assert.ok(left.includes('/assets/app.js'))
})

test('downloads never run more than the concurrency limit at once, and a sequential failure saves exactly the earlier books', async () => {
  let active = 0
  let peak = 0
  const slow = async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active -= 1
    return jsResponse()
  }
  await downloadTranslation({ cache: fakeCache(), fetchFn: slow, urls: urlsFor('web'), concurrency: 3 })
  assert.ok(peak > 1 && peak <= 3, `peak ${peak}`)

  const cache = fakeCache()
  const { fn } = fakeFetch({ failAt: 6 })
  const err = await downloadTranslation({ cache, fetchFn: fn, urls: urlsFor('web'), concurrency: 1 }).then(() => null, (e) => e)
  assert.equal(err.done, 5)
  assert.deepEqual([...cache.store.keys()].map((url) => new URL(url).pathname), urlsFor('web').slice(0, 5))
})

test('an empty URL list is never reported as downloaded', async () => {
  assert.deepEqual(await getDownloadState(fakeCache(), []), { cached: 0, total: 0, complete: false })
})
