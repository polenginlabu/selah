// Tests for the read-aloud chunker. Every chunk becomes one paid TTS request
// that the server rejects above its cap, so these pin: order kept, nothing
// empty, oversized verses split, and no chunk ever over the limit.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkVerses, TTS_MAX_CHUNK_CHARS } from './bibleTts.js'
import { AUDIO_TRANSLATIONS } from '../../supabase/functions/_shared/bible.js'

const words = (s) => s.split(/\s+/).filter(Boolean)

test('audio is offered only for the bundled public-domain translations', () => {
  assert.deepEqual(AUDIO_TRANSLATIONS, ['web', 'kjv', 'bbe'])
})

test('packs short verses together in order', () => {
  const verses = [{ verse: 1, text: 'In the beginning.' }, { verse: 2, text: 'And the earth.' }, { verse: 3, text: 'Let there be light.' }]
  assert.deepEqual(chunkVerses(verses, 40), ['In the beginning. And the earth.', 'Let there be light.'])
})

test('skips blank verses and never emits an empty chunk', () => {
  const chunks = chunkVerses([{ verse: 1, text: '  ' }, { verse: 2, text: '' }, { verse: 3, text: null }, { verse: 4, text: 'Amen.' }], 100)
  assert.deepEqual(chunks, ['Amen.'])
  assert.deepEqual(chunkVerses([], 100), [])
  assert.deepEqual(chunkVerses(undefined, 100), [])
})

test('splits an oversized verse at sentence then word boundaries', () => {
  const verse = 'One two three. Four five six seven eight nine ten eleven twelve. Thirteen.'
  const chunks = chunkVerses([{ verse: 1, text: verse }], 30)
  for (const c of chunks) assert.ok(c.length > 0 && c.length <= 30, `chunk too long: ${c}`)
  assert.deepEqual(words(chunks.join(' ')), words(verse))
  // Sentences that each fit are kept whole rather than cut mid-sentence.
  assert.deepEqual(chunkVerses([{ verse: 1, text: 'Aaaa bbbb cccc dddd. Eeee ffff gggg hhhh.' }], 25),
    ['Aaaa bbbb cccc dddd.', 'Eeee ffff gggg hhhh.'])
})

test('hard-slices a single word longer than the limit', () => {
  const chunks = chunkVerses([{ verse: 1, text: 'x'.repeat(25) }], 10)
  assert.deepEqual(chunks, ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
})

test('a long chapter keeps every word in order and every chunk within the default cap', () => {
  const verses = Array.from({ length: 176 }, (_, i) => ({
    verse: i + 1,
    text: `Verse ${i + 1} says blessed are the undefiled in the way, who walk in the law. `.repeat(1 + (i % 3)),
  }))
  // One verse far over the cap, as a single run-on sentence.
  verses[50].text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
  const chunks = chunkVerses(verses)
  assert.ok(chunks.length > 1)
  for (const c of chunks) assert.ok(c.trim() && c.length <= TTS_MAX_CHUNK_CHARS, `bad chunk length ${c.length}`)
  assert.deepEqual(words(chunks.join(' ')), words(verses.map((v) => v.text).join(' ')))
})

test('a chunk may be exactly max chars; one more char starts a new chunk', () => {
  const v = [{ verse: 1, text: 'aaaa' }, { verse: 2, text: 'bbbb' }]
  assert.deepEqual(chunkVerses(v, 9), ['aaaa bbbb'])
  assert.deepEqual(chunkVerses(v, 8), ['aaaa', 'bbbb'])
  assert.deepEqual(chunkVerses([{ verse: 1, text: 'x'.repeat(10) }], 10), ['x'.repeat(10)])
})

test('collapses internal whitespace so it is not counted or sent', () => {
  assert.deepEqual(chunkVerses([{ verse: 1, text: '  In   the\n beginning ' }], 100), ['In the beginning'])
})

test('no chunk exceeds max and word order holds across many max values', () => {
  const verses = [
    { verse: 1, text: 'ab cde f. gh ij kl mn.' },
    { verse: 2, text: 'o p q r s t u v w x y z' },
    { verse: 3, text: 'abcd efg hi; jk lm: no pq!' },
  ]
  for (let max = 5; max <= 60; max++) {
    const chunks = chunkVerses(verses, max)
    for (const c of chunks) assert.ok(c.length > 0 && c.length <= max, `max ${max}: bad chunk "${c}"`)
    assert.deepEqual(words(chunks.join(' ')), words(verses.map((v) => v.text).join(' ')), `max ${max}`)
  }
})
