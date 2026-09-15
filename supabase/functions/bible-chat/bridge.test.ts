// Tests for the OpenCode bridge transport.
//
// Two things here are easy to get wrong and expensive when wrong:
//   1. The delta arithmetic. The bridge reports the WHOLE response so far on
//      every poll, while the client does `acc += content`. Emitting the full
//      string each time repeats the entire answer on screen.
//   2. The agent-artifact leak. The bridge is a coding agent and can return
//      "Changes were applied under /var/www/html..." as the reply text. That
//      must never render into a Bible study chat.
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { composePrompt, isAgentArtifact, readBridgeConfig, streamFromBridge } from './bridge.ts'

const CONFIG = { baseUrl: 'http://bridge.test', token: '', model: '' }

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

/** Stubs fetch with a scripted sequence of status payloads. */
function withBridge(statuses: Array<Record<string, unknown>>, run: () => Promise<void>) {
  const original = globalThis.fetch
  let polls = 0
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/api/sessions')) {
      return Promise.resolve(new Response(JSON.stringify({ id: 'sess_1' }), { status: 200 }))
    }
    if (url.endsWith('/api/chat/start')) {
      return Promise.resolve(new Response(JSON.stringify({ jobId: 'job_1' }), { status: 200 }))
    }
    const payload = statuses[Math.min(polls++, statuses.length - 1)]
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  }) as typeof fetch
  return run().finally(() => {
    globalThis.fetch = original
  })
}

const noSleep = () => Promise.resolve()

Deno.test('emits only the new tail of each poll, never the whole response', async () => {
  await withBridge(
    [
      { done: false, phase: 'responding', response: 'Paul writes' },
      { done: false, phase: 'responding', response: 'Paul writes to the church' },
      { done: true, phase: 'done', response: 'Paul writes to the church at Corinth.' },
    ],
    async () => {
      const frames = await collect(
        streamFromBridge({ config: CONFIG, prompt: 'p', conversationId: 'c1', sleep: noSleep })
      )
      const text = frames.filter((f) => f.type === 'text').map((f) => f.content)
      assertEquals(text, ['Paul writes', ' to the church', ' at Corinth.'])
      assertEquals(text.join(''), 'Paul writes to the church at Corinth.')
      assertEquals(frames.at(-1), { type: 'done', conversationId: 'c1' })
    }
  )
})

Deno.test('never renders the agent housekeeping reply', async () => {
  await withBridge(
    [
      {
        done: true,
        phase: 'done',
        response:
          'Changes were applied under /var/www/html, but OpenCode did not send a final summary. Completed tools: edit.',
      },
    ],
    async () => {
      const frames = await collect(
        streamFromBridge({ config: CONFIG, prompt: 'p', conversationId: 'c1', sleep: noSleep })
      )
      assertEquals(frames.length, 1)
      assertEquals(frames[0].type, 'error')
      assertEquals(
        frames.some((f) => String(f.content ?? '').includes('/var/www/html')),
        false
      )
    }
  )
})

Deno.test('a failed job reports an error, not an empty success', async () => {
  await withBridge(
    [{ done: true, phase: 'error', response: '', error: 'OpenCode stalled while running tool: read' }],
    async () => {
      const frames = await collect(
        streamFromBridge({ config: CONFIG, prompt: 'p', conversationId: 'c1', sleep: noSleep })
      )
      assertEquals(frames.map((f) => f.type), ['error'])
      // The bridge's internal tool names stay in the logs, not the chat.
      assertEquals(String(frames[0].error).includes('OpenCode'), false)
    }
  )
})

Deno.test('an empty completed job is an error, not a blank reply', async () => {
  await withBridge([{ done: true, phase: 'done', response: '' }], async () => {
    const frames = await collect(
      streamFromBridge({ config: CONFIG, prompt: 'p', conversationId: 'c1', sleep: noSleep })
    )
    assertEquals(frames.map((f) => f.type), ['error'])
  })
})

Deno.test('a job that never finishes times out rather than hanging', async () => {
  await withBridge([{ done: false, phase: 'working', response: '' }], async () => {
    let clock = 0
    const frames = await collect(
      streamFromBridge({
        config: CONFIG,
        prompt: 'p',
        conversationId: 'c1',
        sleep: noSleep,
        now: () => (clock += 30_000),
      })
    )
    assertEquals(frames.map((f) => f.type), ['error'])
    assertStringIncludes(String(frames[0].error), 'too long')
  })
})

Deno.test('composePrompt carries system, history and question in order', () => {
  const prompt = composePrompt('SYSTEM RULES', [{ role: 'user', content: 'who wrote this?' }], 'and when?')
  assertEquals(prompt.indexOf('SYSTEM RULES') < prompt.indexOf('who wrote this?'), true)
  assertEquals(prompt.indexOf('who wrote this?') < prompt.indexOf('and when?'), true)
  assertStringIncludes(prompt, 'Do not use any tools.')
})

Deno.test('composePrompt omits the history block when there is none', () => {
  const prompt = composePrompt('SYSTEM RULES', [], 'first question')
  assertEquals(prompt.includes('Conversation so far'), false)
})

Deno.test('isAgentArtifact catches the bridge leaks and passes ordinary answers', () => {
  assertEquals(isAgentArtifact('Changes were applied under /var/www/html'), true)
  assertEquals(isAgentArtifact('Workspace root: /var/www/html'), true)
  assertEquals(isAgentArtifact('Paul is writing to a divided church in Corinth.'), false)
})

Deno.test('readBridgeConfig is off unless BRIDGE_URL is set, and trims the trailing slash', () => {
  assertEquals(readBridgeConfig(() => undefined), null)
  assertEquals(readBridgeConfig((k) => (k === 'BRIDGE_URL' ? '  ' : undefined)), null)
  assertEquals(
    readBridgeConfig((k) => (k === 'BRIDGE_URL' ? 'https://host/' : undefined))?.baseUrl,
    'https://host'
  )
})
