// Tests for the read-aloud chunker. Every chunk becomes one paid TTS request
// that the server rejects above its cap, so these pin: order kept, nothing
// empty, oversized verses split, and no chunk ever over the limit.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkVerses, planChunks, chunkKey, nextToFetch, wavDurationSec, timeline, locateTime, verseAt, verseStart, planVerses, createConcurrency, backoffMs, isQuotaExhausted, TTS_MAX_CHUNK_CHARS, TTS_CHARS_PER_SEC, TTS_CHUNK_CHARS, TTS_FIRST_CHUNK_CHARS, TTS_MAX_INFLIGHT, TTS_START_INFLIGHT } from './bibleTts.js'
import { AUDIO_TRANSLATIONS, API_BIBLES } from '../../supabase/functions/_shared/bible.js'

const words = (s) => s.split(/\s+/).filter(Boolean)

test('audio is offered for every translation the reader supports', () => {
  for (const id of [...API_BIBLES.map((b) => b.id), 'esv', 'nlt', 'web', 'kjv', 'bbe']) {
    assert.ok(AUDIO_TRANSLATIONS.includes(id), `missing ${id}`)
  }
  assert.ok(!AUDIO_TRANSLATIONS.includes('bogus'))
})

const sample = (n, text = (i) => `Verse ${i} says the Lord is my shepherd and I shall not want.`) =>
  Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: text(i + 1) }))

test('chunk sizes: a fast-start first chunk, then large chunks to save daily requests', () => {
  assert.ok(TTS_FIRST_CHUNK_CHARS >= 160 && TTS_FIRST_CHUNK_CHARS <= 220)
  assert.ok(TTS_CHUNK_CHARS >= 900 && TTS_CHUNK_CHARS <= 1000)
  assert.ok(TTS_CHUNK_CHARS < TTS_MAX_CHUNK_CHARS)
})

test('planChunks: a small first chunk, then roughly equal whole-verse chunks', () => {
  const plan = planChunks(sample(60))
  assert.ok(plan[0].text.length <= TTS_FIRST_CHUNK_CHARS && plan[0].text.length >= 160, `first chunk of ${plan[0].text.length}`)
  assert.ok(plan[0].marks.length >= 2, 'packs whole short verses into the first chunk')
  // Every later chunk is filled close to the cap, so a chapter costs few requests.
  assert.ok(plan.length >= 4)
  for (const c of plan.slice(1, -1)) assert.ok(c.text.length <= TTS_CHUNK_CHARS && c.text.length > TTS_CHUNK_CHARS - 70, `chunk of ${c.text.length}`)
  assert.ok(plan.at(-1).text.length <= TTS_CHUNK_CHARS)
  // Whole verses: every chunk starts at a verse start.
  for (const c of plan) assert.equal(c.marks[0].at, 0)
  for (const c of plan) assert.ok(c.text.startsWith(`Verse ${c.marks[0].verse} `))
})

test('planChunks: a long first verse is split so audio still starts quickly', () => {
  const long = 'In the beginning was the Word. And the Word was with God. And the Word was God. The same was in the beginning with God. All things were made by him. And without him was not any thing made that was made.'
  const plan = planChunks([{ verse: 1, text: long }, { verse: 2, text: 'In him was life.' }], { firstMax: 60, maxChars: 900 })
  assert.ok(plan[0].text.length <= 60)
  assert.deepEqual(plan[0].marks, [{ verse: 1, at: 0 }])
  assert.equal(plan[1].marks[0].verse, 1, 'the rest of verse 1 maps back to verse 1')
  assert.deepEqual(words(plan.map((c) => c.text).join(' ')), words(`${long} In him was life.`))
})

test('planChunks: keeps every word in order, no chunk over the hard cap, marks point at verse starts', () => {
  const verses = sample(176, (i) => `Verse ${i} blessed are the undefiled in the way. `.repeat(1 + (i % 4)))
  verses[50].text = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
  verses[3].text = '   '
  const plan = planChunks(verses)
  for (const c of plan) assert.ok(c.text && c.text.length <= TTS_CHUNK_CHARS && TTS_CHUNK_CHARS <= TTS_MAX_CHUNK_CHARS)
  assert.deepEqual(words(plan.map((c) => c.text).join(' ')), words(verses.map((v) => v.text).join(' ')))
  for (const c of plan) for (const m of c.marks) {
    if (m.verse !== 51) assert.ok(c.text.slice(m.at).startsWith(`Verse ${m.verse} `), `mark ${m.verse}`)
  }
  assert.ok(!planVerses(plan).includes(4), 'blank verses are not read')
  assert.equal(planVerses(plan).length, 175)
  assert.deepEqual(planChunks([]), [])
  assert.deepEqual(planChunks(undefined), [])
})

test('planChunks: bridged rows keep their row verse', () => {
  const plan = planChunks([{ verse: 1, endVerse: 2, text: 'One and two.' }, { verse: 3, text: 'Three.' }])
  assert.deepEqual(plan[0].marks.map((m) => m.verse), [1, 3])
})

test('chunkKey is deterministic and changes with every field', () => {
  const base = { translation: 'nivuk', book: 'John', chapter: 3, text: 'For God so loved the world', voice: 'Kore', style: 'narrator' }
  assert.equal(chunkKey(base), chunkKey({ ...base }))
  assert.equal(chunkKey({ translation: 'nivuk', book: 'John', chapter: 3, text: base.text }), chunkKey(base), 'defaults are Kore + narrator')
  for (const change of [{ translation: 'msg' }, { book: 'Luke' }, { chapter: 4 }, { text: 'For God so loved the world.' }, { voice: 'Charon' }, { style: 'gentle' }]) {
    assert.notEqual(chunkKey({ ...base, ...change }), chunkKey(base), JSON.stringify(change))
  }
})

test('nextToFetch: fetches the whole chapter in playback order, capped in flight', () => {
  const none = new Set()
  assert.equal(TTS_START_INFLIGHT, 2)
  assert.deepEqual(nextToFetch({ total: 20, cursor: 0, ready: none, inflight: none }), [0, 1], 'starts at 2, never a burst')
  assert.deepEqual(nextToFetch({ total: 20, cursor: 0, ready: none, inflight: none, maxInflight: 5 }), [0, 1, 2, 3, 4])
  assert.deepEqual(nextToFetch({ total: 20, cursor: 0, ready: new Set([0, 1]), inflight: new Set([2]), maxInflight: 5 }), [3, 4, 5, 6])
  assert.deepEqual(nextToFetch({ total: 20, cursor: 0, ready: none, inflight: new Set([0, 1]) }), [])
  // Far ahead of the cursor is fetched too: no lookahead gate.
  assert.deepEqual(nextToFetch({ total: 20, cursor: 0, ready: new Set(Array.from({ length: 17 }, (_, i) => i)), inflight: none, maxInflight: 5 }), [17, 18, 19])
  assert.deepEqual(nextToFetch({ total: 3, cursor: 0, ready: none, inflight: none, maxInflight: 5 }), [0, 1, 2])
  assert.deepEqual(nextToFetch({ total: 20, cursor: 0, ready: none, inflight: none, maxInflight: 1 }), [0])
  assert.deepEqual(nextToFetch({ total: 0, cursor: 0, ready: none, inflight: none }), [])
})

test('nextToFetch: after a seek, the cursor and what follows come first, then wraps', () => {
  const none = new Set()
  assert.deepEqual(nextToFetch({ total: 10, cursor: 7, ready: none, inflight: none, maxInflight: 5 }), [7, 8, 9, 0, 1])
  assert.deepEqual(nextToFetch({ total: 10, cursor: 7, ready: new Set([7, 8, 9, 0]), inflight: none, maxInflight: 5 }), [1, 2, 3, 4, 5])
  assert.deepEqual(nextToFetch({ total: 5, cursor: 2, ready: new Set([0, 1, 2, 3, 4]), inflight: none }), [], 'all ready')
})

test('nextToFetch: an out-of-range cursor is clamped, not skipped past', () => {
  const none = new Set()
  assert.deepEqual(nextToFetch({ total: 4, cursor: 99, ready: none, inflight: none, maxInflight: 4 }), [3, 0, 1, 2])
  assert.deepEqual(nextToFetch({ total: 4, cursor: -3, ready: none, inflight: none, maxInflight: 4 }), [0, 1, 2, 3])
})

test('createConcurrency: starts at 2, halves on throttle (never below 1), grows after successes up to the cap', () => {
  const c = createConcurrency()
  assert.equal(c.limit, 2)
  c.throttle()
  assert.equal(c.limit, 1)
  c.throttle()
  assert.equal(c.limit, 1, 'never below 1')
  c.success()
  assert.equal(c.limit, 1, 'one success is not enough')
  c.success()
  assert.equal(c.limit, 2)
  c.success()
  c.throttle()
  c.success()
  assert.equal(c.limit, 1, 'a throttle resets the success streak')
  for (let n = 0; n < 20; n += 1) c.success()
  assert.equal(c.limit, TTS_MAX_INFLIGHT, 'capped')
  assert.ok(TTS_MAX_INFLIGHT <= 3, 'a free-tier model allows 3 requests a minute')
  const wide = createConcurrency({ start: 4, max: 4 })
  wide.throttle()
  assert.equal(wide.limit, 2)
})

test('backoffMs: exponential with jitter, capped, Retry-After is a floor', () => {
  const lo = () => 0
  const hi = () => 1
  assert.equal(backoffMs(0, { rand: lo }), 1000)
  assert.equal(backoffMs(0, { rand: hi }), 2000)
  assert.equal(backoffMs(1, { rand: lo }), 2000)
  assert.equal(backoffMs(2, { rand: hi }), 8000)
  for (let a = 0; a < 5; a += 1) {
    const ms = backoffMs(a, {})
    assert.ok(ms >= 1000 * 2 ** a && ms <= 2000 * 2 ** a, `attempt ${a}: ${ms}`)
  }
  assert.equal(backoffMs(20, { rand: hi }), 60_000, 'capped')
  assert.equal(backoffMs(0, { rand: hi, retryAfterSec: 30 }), 30_000, 'Retry-After wins when longer')
  assert.equal(backoffMs(3, { rand: hi, retryAfterSec: 1 }), 16_000, 'backoff wins when longer')
})

test('isQuotaExhausted keys off the server code, not the status', () => {
  assert.ok(isQuotaExhausted({ status: 429, code: 'quota_exhausted' }))
  assert.ok(!isQuotaExhausted({ status: 429, code: 'rate_limited' }))
  assert.ok(!isQuotaExhausted({ status: 429 }))
  assert.ok(!isQuotaExhausted(null))
})

test('nextToFetch: pauses during a rate-limit cooldown and resumes after', () => {
  const args = { total: 5, cursor: 0, ready: new Set(), inflight: new Set(), cooldownUntil: 10_000, maxInflight: 2 }
  assert.deepEqual(nextToFetch({ ...args, now: 9_999 }), [])
  assert.deepEqual(nextToFetch({ ...args, now: 10_000 }), [0, 1])
})

test('wavDurationSec: 24 kHz 16-bit mono is 48000 bytes a second after the header', () => {
  assert.equal(wavDurationSec(44 + 48000), 1)
  assert.equal(wavDurationSec(10), 0)
})

test('timeline and locateTime use real durations where known, estimates elsewhere', () => {
  const plan = [{ text: 'a'.repeat(TTS_CHARS_PER_SEC * 2), marks: [] }, { text: 'b'.repeat(TTS_CHARS_PER_SEC * 4), marks: [] }]
  assert.deepEqual(timeline(plan), { starts: [0, 2], total: 6 })
  assert.deepEqual(timeline(plan, [3]), { starts: [0, 3], total: 7 })
  assert.deepEqual(locateTime(plan, [3], 1), { index: 0, offset: 1 })
  assert.deepEqual(locateTime(plan, [3], 4), { index: 1, offset: 1 })
  assert.deepEqual(locateTime(plan, [3], 0), { index: 0, offset: 0 })
})

test('verseAt and verseStart map between verses and chunk positions', () => {
  const plan = [{ text: 'aaaa bbbb', marks: [{ verse: 1, at: 0 }, { verse: 2, at: 5 }] }, { text: 'cccc', marks: [{ verse: 3, at: 0 }] }]
  assert.equal(verseAt(plan[0], 0), 1)
  assert.equal(verseAt(plan[0], 0.4), 1)
  assert.equal(verseAt(plan[0], 0.6), 2)
  assert.equal(verseAt(plan[0], 1.5), 2)
  assert.equal(verseAt(undefined, 0.5), null)
  assert.deepEqual(verseStart(plan, 2), { index: 0, fraction: 5 / 9 })
  assert.deepEqual(verseStart(plan, 3), { index: 1, fraction: 0 })
  assert.equal(verseStart(plan, 9), null)
  assert.deepEqual(planVerses(plan), [1, 2, 3])
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
