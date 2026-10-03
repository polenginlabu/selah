import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExplainMessage, getVisitorId, readTextStream, explainVerse } from './zackion.js'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v) }, data }
}

function throwingStorage() {
  return { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
}

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

test('message is the trimmed selection reference, single verse or range', () => {
  assert.equal(buildExplainMessage('John 3:16'), 'John 3:16')
  assert.equal(buildExplainMessage('  John 3:16-18 '), 'John 3:16-18')
  assert.throws(() => buildExplainMessage('  '), /reference is required/)
})

test('visitorId is generated once, persisted and reused', () => {
  const storage = memoryStorage()
  const id = getVisitorId(storage)
  assert.match(id, /^visitor_[a-z0-9]+$/)
  assert.equal(storage.data['zackion:visitorId'], id)
  assert.equal(getVisitorId(storage), id)
  assert.equal(getVisitorId(memoryStorage({ 'zackion:visitorId': 'visitor_abc123' })), 'visitor_abc123')
})

test('visitorId falls back to a stable in-memory id when storage throws', () => {
  const first = getVisitorId(throwingStorage())
  assert.match(first, /^visitor_[a-z0-9]+$/)
  assert.equal(getVisitorId(throwingStorage()), first)
  assert.equal(getVisitorId(null), first)
})

test('readTextStream concatenates chunks and decodes multi-byte characters split across them', async () => {
  const bytes = new TextEncoder().encode('Welcome. 📖 **Scripture**')
  const split = bytes.indexOf(0xf0) + 2 // cut the emoji in half
  const seen = []
  const text = await readTextStream({ body: streamOf([bytes.slice(0, split), bytes.slice(split)]) }, (t) => seen.push(t))
  assert.equal(text, 'Welcome. 📖 **Scripture**')
  assert.equal(seen.at(-1), text)
  assert.ok(seen.length >= 2)
  assert.ok(!seen.some((t) => t.includes('�')))
})

test('readTextStream falls back to response.text() when the body is not streamable', async () => {
  const seen = []
  const text = await readTextStream({ body: null, text: async () => 'whole reply' }, (t) => seen.push(t))
  assert.equal(text, 'whole reply')
  assert.deepEqual(seen, ['whole reply'])
})

test('explainVerse POSTs the reference with a null conversation and streams the reply', async () => {
  let request
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return { ok: true, status: 200, body: streamOf([new TextEncoder().encode('Part one. '), new TextEncoder().encode('Part two.')]) }
  }
  const seen = []
  const text = await explainVerse({ url: 'https://example.test/chat', reference: 'John 3:16-18', onText: (t) => seen.push(t), fetchImpl, storage: memoryStorage() })
  assert.equal(text, 'Part one. Part two.')
  assert.deepEqual(seen, ['Part one. ', 'Part one. Part two.'])
  assert.equal(request.url, 'https://example.test/chat')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers['Content-Type'], 'application/json')
  const body = JSON.parse(request.init.body)
  assert.equal(body.message, 'John 3:16-18')
  assert.equal(body.conversationId, null)
  assert.equal(body.stream, true)
  assert.match(body.visitorId, /^visitor_[a-z0-9]+$/)
})

test('explainVerse turns non-200 and network failures into readable errors', async () => {
  await assert.rejects(
    explainVerse({ url: 'u', reference: 'John 3:16', fetchImpl: async () => ({ ok: false, status: 503 }), storage: memoryStorage() }),
    /unavailable right now \(status 503\)/,
  )
  await assert.rejects(
    explainVerse({ url: 'u', reference: 'John 3:16', fetchImpl: async () => { throw new TypeError('Failed to fetch') }, storage: memoryStorage() }),
    /Could not reach Zackion/,
  )
  await assert.rejects(
    explainVerse({ url: 'u', reference: 'John 3:16', fetchImpl: async () => ({ ok: true, status: 200, body: null, text: async () => '  ' }), storage: memoryStorage() }),
    /empty explanation/,
  )
})

test('visitorId ignores a malformed stored value and replaces it', () => {
  const storage = memoryStorage({ 'zackion:visitorId': 'not a valid id!' })
  const id = getVisitorId(storage)
  assert.match(id, /^visitor_[a-z0-9]+$/)
  assert.equal(storage.data['zackion:visitorId'], id)
})

test('explainVerse reports a mid-stream failure as interrupted, but an abort stays an abort', async () => {
  const failing = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('Partial '))
      controller.error(new TypeError('network error'))
    },
  })
  await assert.rejects(
    explainVerse({ url: 'u', reference: 'John 3:16', fetchImpl: async () => ({ ok: true, status: 200, body: failing }), storage: memoryStorage() }),
    /interrupted/,
  )

  const controller = new AbortController()
  const aborting = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('Partial '))
      controller.abort()
      c.error(new DOMException('Aborted', 'AbortError'))
    },
  })
  await assert.rejects(
    explainVerse({ url: 'u', reference: 'John 3:16', signal: controller.signal, fetchImpl: async () => ({ ok: true, status: 200, body: aborting }), storage: memoryStorage() }),
    (err) => err.name === 'AbortError',
  )
})

test('explainVerse propagates an abort untouched', async () => {
  const controller = new AbortController()
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
  const pending = explainVerse({ url: 'u', reference: 'John 3:16', signal: controller.signal, fetchImpl, storage: memoryStorage() })
  controller.abort()
  await assert.rejects(pending, (err) => err.name === 'AbortError')
})
