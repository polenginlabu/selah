import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  SPEECH_PREPROCESS_VERSION, DEFAULT_PAUSES, BOOK_NAMES, ABBREVIATIONS, PRONUNCIATIONS,
  numberToWords, ordinalToWords, speechInput, segmentPassage,
} from '../../supabase/functions/_shared/speechText.js'
import { assembleChapter } from '../../supabase/functions/_shared/chapterAudio.js'

test('version is pinned', () => {
  assert.equal(SPEECH_PREPROCESS_VERSION, 'speech-v1')
})

test('66 book names', () => assert.equal(BOOK_NAMES.length, 66))

test('number and ordinal words', () => {
  assert.equal(numberToWords(144000), 'one hundred forty-four thousand')
  assert.equal(ordinalToWords(1), 'first')
  assert.equal(ordinalToWords(21), 'twenty-first')
  assert.equal(ordinalToWords(40), 'fortieth')
})

test('references expand through tables', () => {
  assert.equal(speechInput('John 3:16'), 'John chapter 3 verse 16')
  assert.equal(speechInput('Gen. 1:1-3'), 'Genesis chapter 1 verses 1 to 3')
  assert.equal(speechInput('1 Cor 13'), 'First Corinthians chapter 13')
  assert.equal(speechInput('I Cor 13'), 'First Corinthians chapter 13')
  assert.equal(speechInput('Ps 23'), 'Psalm 23')
})

test('ordinals and cardinals, bare numbers untouched', () => {
  assert.equal(speechInput('the 1st day'), 'the first day')
  assert.equal(speechInput('144,000 sealed'), 'one hundred forty-four thousand sealed')
  assert.equal(speechInput('He had 12 sons and 7 days'), 'He had 12 sons and 7 days')
})

test('abbreviations expand; unknown stay', () => {
  assert.equal(speechInput('see v. 5 and vv. 6'), 'see verse 5 and verses 6')
  assert.equal(speechInput('ch. 4'), 'chapter 4')
  assert.equal(speechInput('the LORD said'), 'the Lord said')
  assert.equal(speechInput('in 500 B.C. and 30 A.D.'), 'in 500 B C and 30 A D')
  assert.equal(speechInput('Xyz. is here'), 'Xyz. is here')
  assert.ok(Object.isFrozen(ABBREVIATIONS))
})

test('pronunciations are whole-word and frozen', () => {
  assert.ok(Object.isFrozen(PRONUNCIATIONS))
  assert.equal(speechInput('Selah.'), 'See-lah.')
  assert.equal(speechInput('Selahs and preSelah'), 'Selahs and preSelah')
})

test('punctuation and quotes', () => {
  assert.equal(speechInput('Wait\u2014now: \u201CHi,\u201D he said; \u2018ok\u2019!'), 'Wait\u2014now: "Hi," he said; \'ok\'!')
  assert.doesNotThrow(() => speechInput('He said "unbalanced and \u201Cmore'))
  assert.equal(speechInput('He said "unbalanced'), 'He said "unbalanced')
})

const rows = [
  { verse: 1, text: '  In the beginning\n God created. ' },
  { verse: 1, text: 'Second row of one.' },
  { verse: 2, text: '   ' },
  { verse: 3, text: 'The LORD said "Selah".', paragraph: true },
  { verse: 4, text: 'End.', heading: 'A Heading' },
]

test('segmentPassage parity with assembleChapter', () => {
  const { chunks, version } = segmentPassage(rows)
  const { text, marks } = assembleChapter(rows)
  assert.equal(version, SPEECH_PREPROCESS_VERSION)
  assert.equal(chunks.map((c) => c.display).join(' '), text)
  assert.deepEqual(chunks.map((c) => c.displayOffset), marks.map((m) => m.at))
  assert.deepEqual(chunks.map((c) => c.verse), marks.map((m) => m.verse))
  for (const c of chunks) {
    assert.deepEqual(Object.keys(c).sort(), ['display', 'displayOffset', 'endVerse', 'kind', 'pauseAfterMs', 'speech', 'verse'])
    assert.equal(c.kind, 'verse')
    assert.equal(text.slice(c.displayOffset, c.displayOffset + c.display.length), c.display)
  }
  assert.equal(chunks[1].speech, 'The Lord said "See-lah".')
})

test('pauses: defaults, paragraph, last zero, clamping, options', () => {
  const { chunks } = segmentPassage(rows)
  assert.equal(chunks[0].pauseAfterMs, DEFAULT_PAUSES.paragraph)
  assert.equal(chunks[1].pauseAfterMs, DEFAULT_PAUSES.verse)
  assert.equal(chunks.at(-1).pauseAfterMs, 0)
  const para = segmentPassage(rows).chunks
  assert.equal(para[0].pauseAfterMs, DEFAULT_PAUSES.paragraph)
  const custom = segmentPassage(rows, { pauses: { verse: 10, paragraph: 20 } }).chunks
  assert.equal(custom[0].pauseAfterMs, 20)
  const bad = segmentPassage(rows, { pauses: { verse: -5, paragraph: NaN } }).chunks
  assert.equal(bad[0].pauseAfterMs, DEFAULT_PAUSES.paragraph)
  const neg = segmentPassage([{ verse: 1, text: 'a' }, { verse: 2, text: 'b' }], { pauses: { verse: -5 } }).chunks
  assert.equal(neg[0].pauseAfterMs, 0)
  const bad2 = segmentPassage([{ verse: 1, text: 'a' }, { verse: 2, text: 'b' }], { pauses: { verse: 'x' } }).chunks
  assert.equal(bad2[0].pauseAfterMs, DEFAULT_PAUSES.verse)
  const huge = segmentPassage([{ verse: 1, text: 'a' }, { verse: 2, text: 'b' }], { pauses: { verse: 1e9 } }).chunks
  assert.equal(huge[0].pauseAfterMs, 10000)
})

test('heading on a continuation row keeps parity with marks', () => {
  const r = [{ verse: 1, text: 'a' }, { verse: 1, text: 'b', heading: 'H' }, { verse: 2, text: 'c' }]
  const { chunks } = segmentPassage(r, { headings: true })
  const { text, marks } = assembleChapter(r)
  const v = chunks.filter((c) => c.kind === 'verse')
  assert.deepEqual(v.map((c) => c.displayOffset), marks.map((m) => m.at))
  assert.deepEqual(v.map((c) => c.verse), marks.map((m) => m.verse))
  assert.equal(v.map((c) => c.display).join(' '), text)
})

test('headings and intro only when enabled, own kind, never merged', () => {
  assert.ok(segmentPassage(rows).chunks.every((c) => c.kind === 'verse'))
  const { chunks } = segmentPassage(rows, { headings: true, intro: 'Genesis, chapter 1.' })
  assert.deepEqual(chunks.map((c) => c.kind), ['intro', 'verse', 'verse', 'heading', 'verse'])
  for (const c of chunks.filter((x) => x.kind !== 'verse')) assert.equal(c.displayOffset, null)
  assert.equal(chunks[3].display, 'A Heading')
  assert.ok(!chunks[2].display.includes('Heading'))
  const verseText = chunks.filter((c) => c.kind === 'verse').map((c) => c.display).join(' ')
  assert.equal(verseText, assembleChapter(rows).text)
})

test('rows are not mutated', () => {
  const copy = structuredClone(rows)
  segmentPassage(rows, { headings: true, intro: 'x' })
  assert.deepEqual(rows, copy)
})

test('empty, null and blank input', () => {
  for (const input of [null, undefined, [], [{ verse: 1, text: '  ' }], [null], 'nope']) {
    assert.deepEqual(segmentPassage(input).chunks, [])
  }
  assert.equal(speechInput(null), '')
})

test('20000-character chapter maps completely and monotonically', () => {
  const big = Array.from({ length: 400 }, (_, i) => ({ verse: i + 1, text: `Verse ${i + 1} ${'word '.repeat(9)}`.trim() }))
  const { text, marks } = assembleChapter(big)
  assert.ok(text.length > 4000)
  const pad = Array.from({ length: 800 }, (_, i) => ({ verse: i + 1, text: `${'lorem ipsum '.repeat(2)}v${i}` }))
  const t0 = assembleChapter(pad).text.length
  assert.ok(t0 >= 20000)
  const { chunks } = segmentPassage(pad)
  assert.equal(chunks.length, assembleChapter(pad).marks.length)
  let last = -1
  for (const c of chunks) { assert.ok(c.displayOffset > last); last = c.displayOffset }
  assert.equal(chunks.map((c) => c.display).join(' '), assembleChapter(pad).text)
  assert.equal(segmentPassage(big).chunks.length, marks.length)
})

test('module is pure and unreferenced', () => {
  const src = readFileSync(new URL('../../supabase/functions/_shared/speechText.js', import.meta.url), 'utf8')
  assert.ok(!/^\s*import\s/m.test(src))
  assert.ok(!/\b(Deno|process|require|fetch|XMLHttpRequest)\b/.test(src.replace(/\/\/.*$/gm, '')))
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir)
    return e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(p)) : [p]
  })
  for (const root of ['../../src/', '../../supabase/functions/']) {
    for (const f of walk(new URL(root, import.meta.url))) {
      if (!/\.(js|jsx|ts|tsx)$/.test(f.pathname) || f.pathname.endsWith('/speechText.js')) continue
      assert.ok(!/speechText/.test(readFileSync(f, 'utf8')), `${f.pathname} references speechText`)
    }
  }
})
