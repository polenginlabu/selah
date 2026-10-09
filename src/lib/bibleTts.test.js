// Tests for the read-aloud client helpers: the book id the server checks,
// verse lookup by position and by time, the X-TTS-Marks header, and how a
// bible-tts reply is classified.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { bookId, verseAt, verseAtTime, parseMarks, trackOf, isQuotaExhausted, isCreditsExhausted } from './bibleTts.js'
import { AUDIO_TRANSLATIONS, API_BIBLES, BOOK_IDS } from '../../supabase/functions/_shared/bible.js'
import { BIBLE_BOOKS } from '../data/books.js'

test('audio is offered for every translation the reader supports', () => {
  for (const id of [...API_BIBLES.map((b) => b.id), 'esv', 'nlt', 'web', 'kjv', 'bbe']) {
    assert.ok(AUDIO_TRANSLATIONS.includes(id), `missing ${id}`)
  }
  assert.ok(!AUDIO_TRANSLATIONS.includes('bogus'))
})

test('bookId maps every reader book to the canonical id, in order', () => {
  assert.equal(BIBLE_BOOKS.length, BOOK_IDS.length)
  assert.equal(bookId('Genesis'), 'GEN')
  assert.equal(bookId('John'), 'JHN')
  assert.equal(bookId('Revelation'), 'REV')
  assert.equal(bookId('Nope'), null)
})

test('verseAt maps a fraction of the chapter text to its verse', () => {
  const doc = { text: 'aaaa bbbb', marks: [{ verse: 1, at: 0 }, { verse: 2, at: 5 }] }
  assert.equal(verseAt(doc, 0), 1)
  assert.equal(verseAt(doc, 0.4), 1)
  assert.equal(verseAt(doc, 0.6), 2)
  assert.equal(verseAt(doc, 1.5), 2)
  assert.equal(verseAt(undefined, 0.5), null)
  assert.equal(verseAt({ text: '', marks: [] }, 0.5), null)
})

test('verseAtTime: the last verse started by t', () => {
  const marks = [{ verse: 1, t: 0 }, { verse: 2, t: 4.2 }, { verse: 3, t: 9 }]
  assert.equal(verseAtTime(marks, 0), 1)
  assert.equal(verseAtTime(marks, 4.19), 1)
  assert.equal(verseAtTime(marks, 4.2), 2)
  assert.equal(verseAtTime(marks, 100), 3)
  assert.equal(verseAtTime([], 3), null)
  assert.equal(verseAtTime(null, 3), null)
})

test('parseMarks reads [[verse, seconds]] and rejects anything else', () => {
  assert.deepEqual(parseMarks('[[1,0],[2,3.5]]'), [{ verse: 1, t: 0 }, { verse: 2, t: 3.5 }])
  assert.deepEqual(parseMarks('[[1,0],["x"],[2,"y"]]'), [{ verse: 1, t: 0 }])
  for (const bad of [null, '', 'nope', '{}', '[]', '[[1]]']) assert.equal(parseMarks(bad), null, String(bad))
})

test('trackOf: format, provider, fallback and marks from the reply headers', () => {
  const reply = (type, extra = {}) => new Response('x', { headers: { 'Content-Type': type, ...extra } })
  const streamed = trackOf(reply('application/x-ndjson', { 'X-TTS-Provider': 'elevenlabs', 'X-Audio-Cache': 'miss' }))
  assert.equal(streamed.format, 'ndjson')
  assert.equal(streamed.provider, 'elevenlabs')
  assert.equal(streamed.fallback, null)
  assert.equal(streamed.marks, null)
  const hit = trackOf(reply('audio/mpeg', { 'X-TTS-Marks': '[[1,0],[2,2]]', 'X-Audio-Cache': 'hit' }))
  assert.equal(hit.format, 'mp3')
  assert.equal(hit.cache, 'hit')
  assert.deepEqual(hit.marks, [{ verse: 1, t: 0 }, { verse: 2, t: 2 }])
  const gemini = trackOf(reply('audio/wav', { 'X-TTS-Provider': 'gemini', 'X-TTS-Fallback': 'quota_exceeded' }))
  assert.equal(gemini.format, 'wav')
  assert.equal(gemini.fallback, 'quota_exceeded')
})

test('quota codes: Gemini daily limit and ElevenLabs credits are told apart', () => {
  assert.ok(isQuotaExhausted({ status: 429, code: 'quota_exhausted' }))
  assert.ok(!isQuotaExhausted({ status: 429, code: 'rate_limited' }))
  assert.ok(!isQuotaExhausted({ status: 429 }))
  assert.ok(!isQuotaExhausted(null))
  assert.ok(isCreditsExhausted({ status: 429, code: 'quota_exceeded' }))
  assert.ok(!isCreditsExhausted({ status: 429, code: 'quota_exhausted' }))
})
