// Tests for the SSE -> NDJSON translation.
//
// The buffering is the classic failure point: a network chunk boundary lands
// mid-line constantly, and naive splitting corrupts the JSON. These feed the
// translator deliberately hostile chunk splits — including one that cuts a
// single JSON payload in half — and assert the output is still correct.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { translateStream } from './stream.ts'

/** A stream that emits exactly the given string pieces, as raw bytes. */
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p))
      controller.close()
    },
  })
}

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
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

const frame = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

Deno.test('reassembles text across well-formed frames', async () => {
  const frames = await collect(
    translateStream(streamOf([frame('Be '), frame('still, '), frame('and know.'), 'data: [DONE]\n\n']), 'c1')
  )
  const text = frames.filter((f) => f.type === 'text').map((f) => f.content).join('')
  assertEquals(text, 'Be still, and know.')
  assertEquals(frames.at(-1), { type: 'done', conversationId: 'c1' })
})

Deno.test('survives a chunk boundary in the middle of a JSON payload', async () => {
  const whole = frame('Psalm 46 is a song of confidence.')
  const cut = Math.floor(whole.length / 2)
  // The single most likely real-world split, and the one that breaks a naive
  // implementation: half a JSON object arrives, then the rest.
  const frames = await collect(
    translateStream(streamOf([whole.slice(0, cut), whole.slice(cut), 'data: [DONE]\n\n']), 'c2')
  )
  const text = frames.filter((f) => f.type === 'text').map((f) => f.content).join('')
  assertEquals(text, 'Psalm 46 is a song of confidence.')
})

Deno.test('survives a split inside the "data:" prefix itself', async () => {
  const whole = frame('hello')
  const frames = await collect(
    translateStream(streamOf(['da', 'ta', ': ' + whole.slice(6), 'data: [DONE]\n\n']), 'c3')
  )
  const text = frames.filter((f) => f.type === 'text').map((f) => f.content).join('')
  assertEquals(text, 'hello')
})

Deno.test('one byte at a time still reassembles correctly', async () => {
  const whole = frame('slow') + 'data: [DONE]\n\n'
  // One character per chunk — the most adversarial split possible.
  const frames = await collect(translateStream(streamOf([...whole]), 'c4'))
  const text = frames.filter((f) => f.type === 'text').map((f) => f.content).join('')
  assertEquals(text, 'slow')
})

Deno.test('a malformed frame is skipped, not fatal', async () => {
  const frames = await collect(
    translateStream(streamOf([frame('good '), 'data: {not json}\n\n', frame('parts')]), 'c5')
  )
  const text = frames.filter((f) => f.type === 'text').map((f) => f.content).join('')
  assertEquals(text, 'good parts')
  assertEquals(frames.at(-1)?.type, 'done')
})

Deno.test('an empty upstream reports an error, not a successful blank reply', async () => {
  const frames = await collect(translateStream(streamOf(['data: [DONE]\n\n']), 'c6'))
  assertEquals(frames.length, 1)
  assertEquals(frames[0].type, 'error')
})

Deno.test('keepalive comments and blank lines are ignored', async () => {
  const frames = await collect(
    translateStream(streamOf([': keepalive\n\n', '\n', frame('ok'), 'data: [DONE]\n\n']), 'c7')
  )
  const text = frames.filter((f) => f.type === 'text').map((f) => f.content).join('')
  assertEquals(text, 'ok')
})
