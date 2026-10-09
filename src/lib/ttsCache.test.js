// Tests for the read-aloud audio cache (memory tier; Cache Storage is absent
// under node, which is the fallback path the browser takes when it throws).
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { peekTtsAudio, getTtsAudio, putTtsAudio, clearTtsAudio, overflowCount } from './ttsCache.js'

const MB = 1024 * 1024
const fake = (mb) => ({ size: mb * MB, type: 'audio/wav' })

test('put then peek/get returns the same audio; a miss is undefined', async () => {
  clearTtsAudio()
  const a = fake(1)
  putTtsAudio('k1', a)
  assert.equal(peekTtsAudio('k1'), a)
  assert.equal(await getTtsAudio('k1'), a)
  assert.equal(peekTtsAudio('nope'), undefined)
  assert.equal(await getTtsAudio('nope'), undefined)
})

test('evicts the least recently used audio past the memory cap', () => {
  clearTtsAudio()
  putTtsAudio('A', fake(25))
  putTtsAudio('B', fake(25))
  putTtsAudio('C', fake(25)) // 75 MB > 60 MB: A goes
  assert.equal(peekTtsAudio('A'), undefined)
  assert.ok(peekTtsAudio('B')) // B is now most recent
  putTtsAudio('D', fake(25)) // C is the oldest now
  assert.equal(peekTtsAudio('C'), undefined)
  assert.ok(peekTtsAudio('B') && peekTtsAudio('D'))
})

test('a single item over the cap is still kept', () => {
  clearTtsAudio()
  putTtsAudio('big', fake(80))
  assert.ok(peekTtsAudio('big'))
})

test('overflowCount drops the oldest disk entries until under the cap, keeping the newest', () => {
  assert.equal(overflowCount([10, 10, 10], 30), 0)
  assert.equal(overflowCount([10, 10, 10, 10], 30), 1)
  assert.equal(overflowCount([25, 1, 1, 10], 30), 1)
  assert.equal(overflowCount([5, 50], 30), 1) // newest alone over cap is kept
  assert.equal(overflowCount([50], 30), 0)
  assert.equal(overflowCount([], 30), 0)
})

test('clearTtsAudio empties memory', () => {
  putTtsAudio('x', fake(1))
  clearTtsAudio()
  assert.equal(peekTtsAudio('x'), undefined)
})
