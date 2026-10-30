import test from 'node:test'
import assert from 'node:assert/strict'
import { explainWithSelah } from './selahExplain.js'

const BASE = 'https://example.test/bridge.php'

/** A Response-like object whose body yields the given string chunks. */
function streamed(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder()
  let i = 0
  return {
    ok: status < 400,
    status,
    json: async () => JSON.parse(chunks.join('')),
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true }) }) },
  }
}

function fakeFetch(response) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return typeof response === 'function' ? response(init) : response
  }
  return { fetchImpl, calls }
}

const line = (event) => `${JSON.stringify(event)}\n`

test('sends only the reference and translation, with the reader token', async () => {
  const { fetchImpl, calls } = fakeFetch(streamed([line({ type: 'done', cached: true, text: 'Cached.' })]))
  const text = await explainWithSelah({
    base: BASE, reference: 'John 3:16', translation: 'King James Version', getToken: async () => 'jwt', fetchImpl,
  })
  assert.equal(text, 'Cached.')
  assert.equal(calls[0].url, `${BASE}/api/explain/stream`)
  assert.deepEqual(JSON.parse(calls[0].init.body), { reference: 'John 3:16', translation: 'King James Version' })
  assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt')
})

test('shows the answer as it streams, even when lines split across chunks', async () => {
  const body = line({ type: 'delta', text: '## 1. The Meaning' }) + line({ type: 'delta', text: '\n\nGod so loved.' })
    + line({ type: 'done', text: '## 1. The Meaning\n\nGod so loved.' })
  const { fetchImpl } = fakeFetch(streamed([body.slice(0, 10), body.slice(10, 47), body.slice(47)]))
  const seen = []
  const text = await explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, onText: (t) => seen.push(t) })
  assert.equal(text, '## 1. The Meaning\n\nGod so loved.')
  assert.deepEqual(seen, ['## 1. The Meaning', '## 1. The Meaning\n\nGod so loved.', '## 1. The Meaning\n\nGod so loved.'])
})

test('an error line throws so the sheet can fall back', async () => {
  const { fetchImpl } = fakeFetch(streamed([line({ type: 'delta', text: 'Part' }), line({ type: 'error', error: 'provider error' })]))
  await assert.rejects(explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl }), /provider error/)
})

test('a stream that ends without "done" counts as interrupted', async () => {
  const { fetchImpl } = fakeFetch(streamed([line({ type: 'delta', text: 'Half an answer' })]))
  await assert.rejects(explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl }), /interrupted/)
})

test('a refused request (rate limit, busy) throws with the bridge message', async () => {
  const { fetchImpl } = fakeFetch(streamed([JSON.stringify({ error: 'You have reached the explanation limit for now.' })], { status: 429 }))
  await assert.rejects(explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl }), /explanation limit/)
})

test('an empty finished answer throws', async () => {
  const { fetchImpl } = fakeFetch(streamed([line({ type: 'done', text: '   ' })]))
  await assert.rejects(explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl }), /empty explanation/)
})

test('gives up after the timeout', async () => {
  const { fetchImpl } = fakeFetch((init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  }))
  await assert.rejects(
    explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, timeoutMs: 20 }),
    /took too long/,
  )
})

test('closing the sheet aborts without being reported as a timeout', async () => {
  const closed = new AbortController()
  const { fetchImpl } = fakeFetch((init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    closed.abort()
  }))
  await assert.rejects(
    explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, signal: closed.signal }),
    (err) => err.name === 'AbortError',
  )
})

test('a signed-out reader is refused before any request', async () => {
  const { fetchImpl, calls } = fakeFetch(streamed([]))
  await assert.rejects(
    explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', getToken: async () => null, fetchImpl }),
    /Sign in first/,
  )
  assert.equal(calls.length, 0)
})
