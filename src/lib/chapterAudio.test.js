// Tests for per-chapter read-aloud: the text both sides assemble, the split
// into upstream requests (every word once, in order, under the limit), the
// cache path, the provider order and the NDJSON line reader.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_CHAPTER_CHARS, assembleChapter, planRequests, chapterObjectPath, providerChain, ndjsonLines,
} from '../../supabase/functions/_shared/chapterAudio.js'

const words = (s) => s.split(/\s+/).filter(Boolean)
const sample = (n, text = (i) => `Verse ${i} says the Lord is my shepherd and I shall not want.`) =>
  Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: text(i + 1) }))

test('assembleChapter: verses joined by one space, marks at each verse start', () => {
  const { text, marks } = assembleChapter([
    { verse: 1, text: '  In   the\n beginning. ' }, { verse: 2, text: '   ' }, { verse: 3, text: null }, { verse: 4, text: 'Amen.' },
  ])
  assert.equal(text, 'In the beginning. Amen.')
  assert.deepEqual(marks, [{ verse: 1, at: 0 }, { verse: 4, at: 18 }])
  assert.deepEqual(assembleChapter([]), { text: '', marks: [] })
  assert.deepEqual(assembleChapter(undefined), { text: '', marks: [] })
})

test('assembleChapter: consecutive rows of one verse share a mark', () => {
  const { marks } = assembleChapter([{ verse: 1, text: 'One' }, { verse: 1, text: 'more' }, { verse: 2, text: 'Two' }])
  assert.deepEqual(marks, [{ verse: 1, at: 0 }, { verse: 2, at: 9 }])
})

test('the chapter cap fits the longest chapter (Psalm 119) with room', () => {
  assert.ok(MAX_CHAPTER_CHARS >= 19_000 && MAX_CHAPTER_CHARS <= 25_000)
})

test('planRequests: a chapter under the limit is one request with no neighbours', () => {
  const { text, marks } = assembleChapter(sample(10))
  assert.deepEqual(planRequests(text, marks, 10_000), [{ offset: 0, text, previous_text: '', next_text: '' }])
  assert.deepEqual(planRequests('', [], 100), [])
})

test('planRequests: splits at verse starts, keeps every word, carries neighbour text', () => {
  const { text, marks } = assembleChapter(sample(40))
  const parts = planRequests(text, marks, 500, 50)
  assert.ok(parts.length > 1)
  for (const p of parts) {
    assert.ok(p.text.length <= 500, `part of ${p.text.length}`)
    assert.equal(text.slice(p.offset, p.offset + p.text.length), p.text, 'offset points at the part')
    assert.ok(marks.some((m) => m.at === p.offset), 'starts at a verse')
  }
  assert.deepEqual(words(parts.map((p) => p.text).join(' ')), words(text))
  assert.equal(parts[0].previous_text, '')
  assert.equal(parts.at(-1).next_text, '')
  for (let i = 1; i < parts.length; i += 1) {
    assert.ok(parts[i - 1].text.endsWith(parts[i].previous_text), 'previous_text is the end of the part before')
    assert.ok(parts[i].text.startsWith(parts[i - 1].next_text), 'next_text is the start of the part after')
    assert.ok(parts[i].previous_text.length <= 50 && parts[i - 1].next_text.length <= 50)
  }
})

test('planRequests: a verse over the limit splits at sentences, then words, then hard', () => {
  const long = 'One two three. Four five six seven eight nine ten eleven twelve. Thirteen.'
  const { text, marks } = assembleChapter([{ verse: 1, text: long }])
  const parts = planRequests(text, marks, 30)
  for (const p of parts) assert.ok(p.text.length > 0 && p.text.length <= 30, `"${p.text}"`)
  assert.deepEqual(words(parts.map((p) => p.text).join(' ')), words(long))
  assert.equal(parts[0].text, 'One two three.')
  assert.deepEqual(planRequests('x'.repeat(25), [], 10).map((p) => p.text), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
})

test('planRequests: every word in order across many limits', () => {
  const { text, marks } = assembleChapter(sample(30, (i) => `ab cde f. gh ${i} ij kl; mn op qr st!`))
  for (let max = 12; max <= 200; max += 7) {
    const parts = planRequests(text, marks, max)
    for (const p of parts) assert.ok(p.text.length <= max, `max ${max}`)
    assert.deepEqual(words(parts.map((p) => p.text).join(' ')), words(text), `max ${max}`)
  }
})

test('chapterObjectPath is deterministic and changes with every field', async () => {
  const base = { provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice: 'George', style: 'narrator', translation: 'kjv', book: 'JHN', chapter: 11, text: 'Jesus wept.', salt: '{}', ext: 'mp3' }
  const path = await chapterObjectPath(base)
  assert.equal(path, await chapterObjectPath({ ...base }))
  assert.match(path, /^elevenlabs\/eleven_flash_v2_5\/George\/narrator\/kjv\/JHN\/11\/[0-9a-f]{64}\.mp3$/)
  for (const change of [{ provider: 'gemini' }, { model: 'eleven_multilingual_v2' }, { voice: 'Sarah' }, { style: 'gentle' }, { translation: 'web' },
    { book: 'LUK' }, { chapter: 12 }, { text: 'Jesus wept!' }, { salt: '{"speed":1}' }, { ext: 'wav' }]) {
    assert.notEqual(await chapterObjectPath({ ...base, ...change }), path, JSON.stringify(change))
  }
})

test('chapterObjectPath refuses path traversal and odd segments', async () => {
  const base = { provider: 'gemini', model: 'gemini', voice: 'Kore', style: 'narrator', translation: 'kjv', book: 'JHN', chapter: 1, text: 'x', ext: 'wav' }
  for (const change of [{ book: '../JHN' }, { voice: '..' }, { translation: 'a/b' }, { style: '' }, { ext: 'wav/../x' }, { chapter: '1 2' }]) {
    await assert.rejects(chapterObjectPath({ ...base, ...change }), /bad audio path/, JSON.stringify(change))
  }
})

test('providerChain: ElevenLabs then Gemini, skipping missing keys and spent credits', () => {
  const both = { elevenlabs: true, gemini: true }
  const now = 1_000
  assert.deepEqual(providerChain({ preferred: 'elevenlabs', hasKey: both, now }), ['elevenlabs', 'gemini'])
  assert.deepEqual(providerChain({ preferred: 'gemini', hasKey: both, now }), ['gemini'], 'a Gemini voice never uses ElevenLabs')
  assert.deepEqual(providerChain({ preferred: 'elevenlabs', hasKey: { gemini: true }, now }), ['gemini'])
  assert.deepEqual(providerChain({ preferred: 'elevenlabs', hasKey: both, exhausted: new Map([['elevenlabs', now + 1]]), now }), ['gemini'])
  assert.deepEqual(providerChain({ preferred: 'elevenlabs', hasKey: both, exhausted: new Map([['elevenlabs', now]]), now }), ['elevenlabs', 'gemini'], 'an expired window is usable')
  assert.deepEqual(providerChain({ preferred: 'elevenlabs', hasKey: both, now, fallback: false }), ['elevenlabs'], 'previews never stand in')
  assert.deepEqual(providerChain({ preferred: 'elevenlabs', hasKey: { elevenlabs: true }, exhausted: new Map([['elevenlabs', now + 1]]), now }), [], 'nothing left: device voice')
  assert.deepEqual(providerChain({ preferred: 'gemini', hasKey: { elevenlabs: true }, now }), [])
})

test('a Psalm 119-sized chapter splits within the real per-model and Gemini limits, losing nothing', () => {
  const { text, marks } = assembleChapter(sample(176, (i) => `Verse ${i}: Thy word is a lamp unto my feet, and a light unto my path; I will keep thy righteous judgments.`))
  assert.ok(text.length > 15_000 && text.length <= MAX_CHAPTER_CHARS)
  for (const max of [10_000, 6_000]) {
    const parts = planRequests(text, marks, max)
    assert.ok(parts.length >= Math.ceil(text.length / max))
    for (const p of parts) assert.ok(p.text.length <= max && marks.some((m) => m.at === p.offset), `max ${max}`)
    assert.deepEqual(words(parts.map((p) => p.text).join(' ')), words(text))
  }
  assert.equal(planRequests(text, marks, 40_000).length, 1, 'flash fits the whole chapter in one request')
})

const streamOf = (pieces) => new ReadableStream({
  start(c) {
    for (const p of pieces) c.enqueue(new TextEncoder().encode(p))
    c.close()
  },
})

test('ndjsonLines: lines split across chunks, blank lines skipped, last line without newline kept', async () => {
  const out = []
  for await (const line of ndjsonLines(streamOf(['{"a":', '1}\n\n{"b"', ':2}\n', '{"c":3}']))) out.push(JSON.parse(line))
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }])
})
