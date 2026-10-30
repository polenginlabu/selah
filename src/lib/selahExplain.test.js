import test from 'node:test'
import assert from 'node:assert/strict'
import { explainWithSelah } from './selahExplain.js'

const BASE = 'https://example.test/bridge.php'

function fakeFetch(responses) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected call to ${url}`)
    return { ok: next.status === undefined || next.status < 400, status: next.status ?? 200, json: async () => next.body }
  }
  return { fetchImpl, calls }
}

const noSleep = async () => {}

test('sends only the reference and translation, with the reader token', async () => {
  const { fetchImpl, calls } = fakeFetch([{ body: { success: true, done: true, cached: true, response: 'Cached.' } }])
  const text = await explainWithSelah({
    base: BASE, reference: 'John 3:16', translation: 'King James Version',
    getToken: async () => 'jwt', fetchImpl, sleepImpl: noSleep,
  })
  assert.equal(text, 'Cached.')
  assert.equal(calls[0].url, `${BASE}/api/explain/start`)
  assert.deepEqual(JSON.parse(calls[0].init.body), { reference: 'John 3:16', translation: 'King James Version' })
  assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt')
})

test('polls the job and streams partial text until it is done', async () => {
  const { fetchImpl, calls } = fakeFetch([
    { body: { success: true, jobId: 'job_abc' } },
    { body: { done: false, response: '' } },
    { body: { done: false, response: '## 1. The Meaning' } },
    { body: { done: true, response: '## 1. The Meaning\n\nGod so loved.' } },
  ])
  const seen = []
  const text = await explainWithSelah({
    base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, sleepImpl: noSleep, onText: (t) => seen.push(t),
  })
  assert.equal(text, '## 1. The Meaning\n\nGod so loved.')
  assert.deepEqual(seen, ['## 1. The Meaning', '## 1. The Meaning\n\nGod so loved.'])
  assert.equal(calls[1].url, `${BASE}/api/chat/status/job_abc`)
})

test('a failed job throws so the sheet can fall back', async () => {
  const { fetchImpl } = fakeFetch([
    { body: { success: true, jobId: 'job_abc' } },
    { body: { done: true, error: 'provider error' } },
  ])
  await assert.rejects(
    explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, sleepImpl: noSleep }),
    /provider error/,
  )
})

test('a refused start (rate limit, busy) throws with the bridge message', async () => {
  const { fetchImpl } = fakeFetch([{ status: 429, body: { error: 'You have reached the explanation limit for now.' } }])
  await assert.rejects(
    explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, sleepImpl: noSleep }),
    /explanation limit/,
  )
})

test('an empty finished answer throws', async () => {
  const { fetchImpl } = fakeFetch([{ body: { done: true, response: '   ' } }])
  await assert.rejects(
    explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, sleepImpl: noSleep }),
    /empty explanation/,
  )
})

test('gives up after the timeout', async () => {
  let clock = 0
  const { fetchImpl } = fakeFetch([
    { body: { success: true, jobId: 'job_abc' } },
    { body: { done: false, response: '' } },
    { body: { done: false, response: '' } },
  ])
  await assert.rejects(
    explainWithSelah({
      base: BASE, reference: 'John 3:16', translation: 'KJV', fetchImpl, timeoutMs: 3000,
      sleepImpl: async (ms) => { clock += ms }, now: () => clock,
    }),
    /took too long/,
  )
})

test('a signed-out reader is refused before any request', async () => {
  const { fetchImpl, calls } = fakeFetch([])
  await assert.rejects(
    explainWithSelah({ base: BASE, reference: 'John 3:16', translation: 'KJV', getToken: async () => null, fetchImpl }),
    /Sign in first/,
  )
  assert.equal(calls.length, 0)
})
