// Tests for reading a streamed chapter track: audio pieces in order, verse
// times as they arrive, and a stream the server could not finish rejected
// (so it is never treated as the whole chapter).
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { base64Bytes, bufferedEnd, canStream, readTrack } from './streamAudio.js'

const ndjson = (lines) => new Response(new ReadableStream({
  start(c) {
    for (const l of lines) c.enqueue(new TextEncoder().encode(`${JSON.stringify(l)}\n`))
    c.close()
  },
}))
const b64 = (bytes) => btoa(String.fromCharCode(...bytes))

test('base64Bytes decodes to raw bytes', () => {
  assert.deepEqual([...base64Bytes(b64([0, 1, 254, 255]))], [0, 1, 254, 255])
})

test('readTrack: streamed audio and verse times in order', async () => {
  const track = { format: 'ndjson', response: ndjson([{ a: b64([1, 2]), m: [[1, 0]] }, { a: b64([3]) }, { m: [[2, 1.5]], done: true, d: 2 }]) }
  const heard = []
  const timed = []
  const { blob, marks } = await readTrack(track, { onAudio: async (b) => heard.push([...b]), onMarks: (m) => timed.push(...m) })
  assert.deepEqual(heard, [[1, 2], [3]])
  assert.deepEqual(timed, [{ verse: 1, t: 0 }, { verse: 2, t: 1.5 }])
  assert.deepEqual(marks, timed)
  assert.equal(blob.type, 'audio/mpeg')
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3])
})

test('readTrack: an error line or a missing end rejects with code stream', async () => {
  await assert.rejects(readTrack({ format: 'ndjson', response: ndjson([{ a: b64([1]) }, { error: 'stream' }]) }), (err) => err.code === 'stream')
  await assert.rejects(readTrack({ format: 'ndjson', response: ndjson([{ a: b64([1]) }]) }), (err) => err.code === 'stream')
})

test('readTrack: a whole file passes through with its header marks', async () => {
  const marks = [{ verse: 1, t: 0 }]
  const { blob, marks: got } = await readTrack({ format: 'mp3', marks, response: new Response(new Uint8Array([9, 9])) })
  assert.equal(blob.size, 2)
  assert.equal(got, marks)
  assert.equal((await readTrack({ format: 'wav', marks: null, response: new Response('x') })).marks, null)
})

test('no Media Source under node; bufferedEnd copes with nothing buffered', () => {
  assert.equal(canStream(), false)
  assert.equal(bufferedEnd(null), 0)
  assert.equal(bufferedEnd({ buffered: { length: 0 } }), 0)
  assert.equal(bufferedEnd({ buffered: { length: 2, end: (i) => [3, 7][i] } }), 7)
})
