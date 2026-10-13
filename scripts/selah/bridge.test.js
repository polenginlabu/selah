// Bridge protocol tests: all requests are mocked and polling uses a virtual clock.
// Run: node --test scripts/selah/bridge.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { syncBuiltinESMExports } from 'node:module'
import { BridgeError, runAgent, runImageAgent } from './bridge.js'
import { createDevotionAgent } from './devotionAgent.js'

const BIG = 'opencode/big-pickle'
const LING = 'opencode/ling-3.1-flash-free'
const MIMO = 'opencode/mimo-v2.6-flash-free'
const BUDGET = 'OpenCode provider error: Upstream request failed: Policy budget exceeded'
const BRIDGE_URL = 'http://bridge.test:4098'
const NINE_MINUTES = 9 * 60 * 1000

const completed = (response = 'A researched devotion.') => ({ done: true, response })
const failed = (error = BUDGET) => ({ done: true, error })
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body),
})

function bridge(t, jobs, { intercept } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 })
  // Keep bridge.js's named timers/promises import on the mocked clock too.
  syncBuiltinESMExports()
  t.after(() => {
    t.mock.timers.reset()
    syncBuiltinESMExports()
  })
  const calls = []
  const starts = []
  const sessions = []
  const polls = new Map()
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const path = new URL(url).pathname
    const call = { path, ...options, body: options.body && JSON.parse(options.body) }
    calls.push(call)
    options.signal?.throwIfAborted()
    const intercepted = await intercept?.(call)
    if (intercepted !== undefined) return intercepted
    if (path === '/api/health') return jsonResponse({ success: true })
    if (path === '/api/sessions') {
      sessions.push(call)
      return jsonResponse({ id: `session-${sessions.length}` })
    }
    if (path === '/api/chat/start') {
      starts.push(call.body)
      assert.ok(starts.length <= jobs.length, 'unexpected extra model attempt')
      return jsonResponse({ jobId: `job-${starts.length}` })
    }
    const match = path.match(/^\/api\/chat\/status\/job-(\d+)$/)
    assert.ok(match, `unexpected request: ${path}`)
    const index = Number(match[1]) - 1
    const statuses = Array.isArray(jobs[index]) ? jobs[index] : [jobs[index]]
    const poll = polls.get(index) ?? 0
    polls.set(index, poll + 1)
    return jsonResponse(statuses[Math.min(poll, statuses.length - 1)])
  })
  return { calls, starts, sessions, models: () => starts.map((start) => start.model) }
}

// Yield real event-loop turns to settle fetch/JSON promises, then advance only
// the mocked polling clock. Attach rejection handlers before advancing time.
async function finish(t, promise, { step = 2000, ticks = 300 } = {}) {
  let settled = false
  const result = promise.then(
    (value) => { settled = true; return { value } },
    (error) => { settled = true; return { error } },
  )
  for (let i = 0; i < ticks && !settled; i += 1) {
    await nextTurn()
    if (!settled) t.mock.timers.tick(step)
  }
  await nextTurn()
  assert.ok(settled, 'agent did not settle within the virtual clock budget')
  const outcome = await result
  if (outcome.error) throw outcome.error
  return outcome.value
}

function devotion(options = {}) {
  return createDevotionAgent({ model: BIG, bridgeUrl: BRIDGE_URL, ...options })
}

test('the exact policy budget error recovers on Ling with a fresh session and the same prompt', async (t) => {
  const mock = bridge(t, [failed(), completed('  unchanged response\n')])
  const progress = []
  const ask = devotion({ onProgress: (...event) => progress.push(event) })
  assert.equal(await finish(t, ask('Research today’s passage')), '  unchanged response\n')
  assert.deepEqual(mock.models(), [BIG, LING])
  assert.deepEqual(mock.starts.map((start) => start.message), Array(2).fill('Research today’s passage'))
  assert.equal(mock.sessions.length, 2)
  assert.deepEqual(mock.calls.map(({ path }) => path), [
    '/api/health', '/api/sessions', '/api/chat/start', '/api/chat/status/job-1',
    '/api/health', '/api/sessions', '/api/chat/start', '/api/chat/status/job-2',
  ])
  const fallback = progress.filter(([phase]) => phase === 'fallback')
  assert.equal(fallback.length, 1)
  assert.ok(fallback[0][1].includes(BIG) && fallback[0][1].includes(LING))
  assert.ok(fallback[0][1].includes(BUDGET))
})

test('default daily-devotion model order is Big Pickle, Ling, then MiMo', async (t) => {
  const mock = bridge(t, [failed(), failed('OpenCode provider error: rate limit exceeded'), completed()])
  const ask = createDevotionAgent({ bridgeUrl: BRIDGE_URL })
  assert.equal(await finish(t, ask('Research')), 'A researched devotion.')
  assert.deepEqual(mock.models(), [BIG, LING, MIMO])
})

test('configured order trims and deduplicates models, including duplicates of the primary', async (t) => {
  const mock = bridge(t, [failed(), failed(), completed()])
  const ask = devotion({
    model: ` ${MIMO} `,
    fallbackModels: `, ${MIMO}, ${BIG}, , ${BIG}, ${LING}, ${MIMO},`,
  })
  await finish(t, ask('Research'))
  assert.deepEqual(mock.models(), [MIMO, BIG, LING])
})

test('an explicitly empty fallback list disables switching', async (t) => {
  const mock = bridge(t, [failed()])
  await assert.rejects(finish(t, devotion({ fallbackModels: '' })('Research')), (error) => {
    assert.ok(error instanceof BridgeError)
    assert.ok(error.message.includes(BUDGET))
    assert.match(error.message, /BRIDGE_FALLBACK_MODELS/)
    return true
  })
  assert.deepEqual(mock.models(), [BIG])
})

test('exhaustion preserves every original provider reason and never revisits failed models', async (t) => {
  const reasons = [
    `${BUDGET}: workspace daily allowance`,
    'OpenCode provider error: quota exhausted: account 123',
    'OpenCode provider error: model is unavailable: maintenance ticket 456',
  ]
  const mock = bridge(t, reasons.map((reason) => failed(reason)))
  const ask = devotion()
  const checkError = (error) => {
    assert.ok(error instanceof BridgeError)
    for (const reason of reasons) assert.ok(error.message.includes(reason), reason)
    for (const model of [BIG, LING, MIMO]) assert.ok(error.message.includes(model), model)
    assert.match(error.message, /shared|workspace/i)
    return true
  }
  await assert.rejects(finish(t, ask('Research')), checkError)
  await assert.rejects(ask('Try again'), checkError)
  assert.deepEqual(mock.models(), [BIG, LING, MIMO])
})

for (const reason of [
  'OpenCode provider error: Insufficient account funds',
  'OpenCode provider error: Insufficient balance',
  'OpenCode provider error: You exceeded your current quota, please check your plan and billing details.',
  'OpenCode provider error: insufficient_quota',
  'OpenCode provider error: too many requests (429)',
  'OpenCode provider error: service unavailable (503)',
  'OpenCode provider error: model missing-model not found',
]) {
  test(`a completed provider failure permits fallback: ${reason}`, async (t) => {
    const mock = bridge(t, [failed(reason), completed()])
    await finish(t, devotion()('Research'))
    assert.deepEqual(mock.models(), [BIG, LING])
  })
}

test('a nonterminal status error does not authorize another model', async (t) => {
  const mock = bridge(t, [[
    { done: false, error: BUDGET, phase: 'research', message: 'Working' },
    completed('The original job recovered.'),
  ]])
  assert.equal(await finish(t, devotion()('Research')), 'The original job recovered.')
  assert.deepEqual(mock.models(), [BIG])
})

for (const reason of [
  'OpenCode provider error: authentication failed (401): invalid API key',
  'OpenCode provider error: forbidden (403)',
  'Tool error: websearch rate limit exceeded (429)',
  'policy budget exceeded',
  'OpenCode stalled without progress',
  'OpenCode provider error: request timed out',
  'OpenCode provider error: invalid request: unsupported parameter',
]) {
  test(`does not switch for terminal non-retryable failure: ${reason}`, async (t) => {
    const mock = bridge(t, [failed(reason)])
    await assert.rejects(finish(t, devotion()('Research')), (error) => {
      assert.ok(error.message.includes(reason))
      return true
    })
    assert.deepEqual(mock.models(), [BIG])
  })
}

test('empty output fails without another model attempt', async (t) => {
  const mock = bridge(t, [completed(' \n\t')])
  await assert.rejects(finish(t, devotion()('Research')), /produced no output/)
  assert.deepEqual(mock.models(), [BIG])
})

for (const endpoint of ['/api/health', '/api/sessions', '/api/chat/start', '/api/chat/status/job-1']) {
  for (const failure of ['network', 'HTTP']) {
    test(`${failure} failure at ${endpoint} never starts a fallback`, async (t) => {
      const mock = bridge(t, [completed()], {
        intercept: ({ path }) => {
          if (path !== endpoint) return
          if (failure === 'network') throw new Error('fetch failed: connection reset')
          return jsonResponse({ error: BUDGET }, 429)
        },
      })
      await assert.rejects(finish(t, devotion()('Research')), failure === 'network' ? /connection reset/ : /HTTP 429/)
      assert.deepEqual(mock.models(), endpoint.includes('/status/') ? [BIG] : [])
    })
  }
}

for (const body of [null, {}, { id: '' }]) {
  test(`a missing fresh session fails closed: ${JSON.stringify(body)}`, async (t) => {
    const mock = bridge(t, [], {
      intercept: ({ path }) => path === '/api/sessions' ? jsonResponse(body) : undefined,
    })
    await assert.rejects(finish(t, devotion()('Research')), /fresh session/)
    assert.deepEqual(mock.starts, [])
  })
}

test('fallback also fails closed if its fresh session cannot be created', async (t) => {
  let sessions = 0
  const mock = bridge(t, [failed()], {
    intercept: ({ path }) => {
      if (path === '/api/sessions' && ++sessions === 2) return jsonResponse({}, 503)
    },
  })
  await assert.rejects(finish(t, devotion()('Research')), /HTTP 503/)
  assert.deepEqual(mock.models(), [BIG])
})

test('content-validation asks keep the working model and advance past it only if it later fails', async (t) => {
  const mock = bridge(t, [failed(), completed('Needs formatting'), completed('Still incomplete'), failed(), completed('Valid devotion')])
  const ask = devotion()
  assert.equal(await finish(t, ask('Research')), 'Needs formatting')
  assert.equal(await finish(t, ask('Reformat the research')), 'Still incomplete')
  assert.equal(await finish(t, ask('Add missing content')), 'Valid devotion')
  assert.deepEqual(mock.models(), [BIG, LING, LING, LING, MIMO])
  assert.deepEqual(mock.starts.map(({ message }) => message), [
    'Research', 'Research', 'Reformat the research', 'Add missing content', 'Add missing content',
  ])
  assert.equal(mock.sessions.length, 5)
  assert.equal(new Set(mock.calls.map(({ signal }) => signal)).size, 1)
  assert.ok(mock.calls[0].signal instanceof AbortSignal)
})

test('the default nine-minute deadline spans fallback and later content-validation asks', async (t) => {
  const mock = bridge(t, [failed(), completed('Needs formatting'), failed()])
  const ask = devotion()
  const start = Date.now()
  assert.equal(await finish(t, ask('Research')), 'Needs formatting')
  t.mock.timers.tick(NINE_MINUTES - (Date.now() - start) - 1000)
  await assert.rejects(finish(t, ask('Reformat')), /overall 9 minute time limit/)
  const count = mock.calls.length
  await assert.rejects(ask('Try another model'), /time limit/)
  assert.equal(mock.calls.length, count)
  assert.deepEqual(mock.models(), [BIG, LING, LING])
})

test('a provider failure arriving exactly at the deadline does not start another model', async (t) => {
  const mock = bridge(t, [failed()])
  await assert.rejects(finish(t, devotion({ maxWaitMs: 2000 })('Research')), /overall.*time limit/)
  assert.deepEqual(mock.models(), [BIG])
})

test('an unfinished job times out without fallback or replay', async (t) => {
  const mock = bridge(t, [{ done: false, phase: 'research', message: 'Still working' }])
  await assert.rejects(finish(t, devotion({ maxWaitMs: 4000 })('Research')), /time limit/)
  assert.deepEqual(mock.models(), [BIG])
})

// AbortSignal.timeout uses Node's internal real clock, outside MockTimers.
// Supply its standard AbortController equivalent to control expiry while still
// checking that the same actual AbortSignal reaches every network operation.
for (const endpoint of ['/api/health', '/api/sessions', '/api/chat/start', '/api/chat/status/job-1']) {
  test(`the shared deadline aborts an in-flight request at ${endpoint}`, async (t) => {
    let deadlineSignal
    const mock = bridge(t, [completed()], {
      intercept: ({ path, signal }) => {
        if (path !== endpoint) return
        assert.ok(signal instanceof AbortSignal)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    })
    const timeout = t.mock.method(AbortSignal, 'timeout', (ms) => {
      assert.equal(ms, 6000)
      const controller = new AbortController()
      deadlineSignal = controller.signal
      setTimeout(() => controller.abort(new DOMException('Deadline expired', 'TimeoutError')), ms)
      return deadlineSignal
    })
    const ask = devotion({ maxWaitMs: 6000 })
    await assert.rejects(finish(t, ask('Research')), /overall.*time limit/)
    assert.equal(mock.calls.at(-1).path, endpoint, 'the request was in flight when its signal expired')
    assert.equal(deadlineSignal.aborted, true)
    assert.ok(mock.calls.every(({ signal }) => signal === deadlineSignal))
    const count = mock.calls.length
    await assert.rejects(ask('Retry'), /time limit/)
    assert.equal(mock.calls.length, count)
    assert.equal(timeout.mock.callCount(), 1)
    assert.deepEqual(mock.models(), endpoint.includes('/status/') ? [BIG] : [])
  })
}

for (const [name, run, model, setting] of [
  ['text', runAgent, 'anthropic/claude-sonnet', 'BRIDGE_MODEL'],
  ['image', runImageAgent, 'google/gemini-3.1-flash-image', 'BACKGROUND_MODEL'],
]) {
  test(`${name} budget errors preserve the reason, explain the model/configuration and never fall back`, async (t) => {
    const mock = bridge(t, [failed()])
    await assert.rejects(finish(t, run({ prompt: 'Generate', model, bridgeUrl: BRIDGE_URL })), (error) => {
      assert.ok(error instanceof BridgeError)
      for (const detail of [BUDGET, model, setting, '--model']) assert.ok(error.message.includes(detail), detail)
      assert.match(error.message, /provider\/workspace/)
      assert.match(error.message, /shared budget/i)
      return true
    })
    assert.deepEqual(mock.models(), [model])
  })
}

test('generic text returns the exact successful response and permits a non-Zen model', async (t) => {
  const raw = '\n  Research with intentional whitespace.\n'
  const mock = bridge(t, [completed(raw)])
  assert.equal(await finish(t, runAgent({ prompt: 'Research', model: 'anthropic/custom', bridgeUrl: BRIDGE_URL })), raw)
  assert.deepEqual(mock.models(), ['anthropic/custom'])
})

test('image generation returns the first image bytes unchanged without requiring prose', async (t) => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255])
  const mock = bridge(t, [{ done: true, images: [{ data: bytes.toString('base64') }, { data: 'YWJj' }] }])
  const output = await finish(t, runImageAgent({ prompt: 'Paint', model: 'google/image', bridgeUrl: BRIDGE_URL }))
  assert.ok(Buffer.isBuffer(output))
  assert.deepEqual(output, bytes)
  assert.deepEqual(mock.models(), ['google/image'])
})

for (const options of [
  { model: 'google/gemini' },
  { model: 'opencode/' },
  { model: 'opencode/a/b' },
  { model: 'opencode/model with spaces' },
  { model: '', fallbackModels: '' },
  { fallbackModels: `${LING},openai/gpt` },
  { fallbackModels: 'not-a-provider-model' },
  { fallbackModels: 'opencode/' },
]) {
  test(`invalid/non-Zen configuration is rejected before fetch: ${JSON.stringify(options)}`, (t) => {
    const mock = bridge(t, [])
    assert.throws(() => devotion(options), /Zen IDs.*BRIDGE_MODEL.*BRIDGE_FALLBACK_MODELS/)
    assert.deepEqual(mock.calls, [])
  })
}

for (const maxWaitMs of [0, -1, 1.5, NaN, Infinity, NINE_MINUTES + 1]) {
  test(`invalid devotion deadline ${maxWaitMs} is rejected before fetch`, (t) => {
    const mock = bridge(t, [])
    assert.throws(() => devotion({ maxWaitMs }), /between 1 ms and 9 minutes/)
    assert.deepEqual(mock.calls, [])
  })
}
