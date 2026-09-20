// Tests for section headings ("Jesus Feeds the Five Thousand").
//
// The invariant these exist to protect: a heading is the translators'
// editorial apparatus, NOT Scripture. Publishers word them differently, they
// carry no verse number, and they are not inspired text. So a heading must
// never end up inside verse text, inside a selection, or on a shared verse
// card — it may only ever be displayed beside the verse it introduces.
//
// Run: npm run bible:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChapterContent } from '../../supabase/functions/_shared/bible.js'

/** A USX text node. */
const text = (value, verseId) => ({ type: 'text', text: value, ...(verseId ? { attrs: { verseId } } : {}) })
/** A USX paragraph. `style` decides whether it is Scripture or a heading. */
const para = (style, items) => ({ name: 'para', type: 'tag', attrs: { style }, items })
const verseText = (id, value) => ({ name: 'char', type: 'tag', attrs: { verseId: id }, items: [text(value, id)] })

const JOHN_6 = [
  para('s1', [text('Jesus Feeds the Five Thousand')]),
  para('p', [verseText('JHN.6.1', 'After this Jesus went away to the other side of the Sea of Galilee.')]),
  para('p', [verseText('JHN.6.2', 'And a large crowd was following him.')]),
  para('s1', [text('Jesus Walks on Water')]),
  para('p', [verseText('JHN.6.16', 'When evening came, his disciples went down to the sea.')]),
]

test('a heading is attached to the verse it introduces', () => {
  const verses = parseChapterContent(JOHN_6)
  const byVerse = Object.fromEntries(verses.map((v) => [v.verse, v]))
  assert.equal(byVerse[1].heading, 'Jesus Feeds the Five Thousand')
  assert.equal(byVerse[16].heading, 'Jesus Walks on Water')
})

test('verses between headings carry none', () => {
  const byVerse = Object.fromEntries(parseChapterContent(JOHN_6).map((v) => [v.verse, v]))
  assert.equal(byVerse[2].heading, null)
})

test('heading words NEVER appear in verse text', () => {
  // The failure that matters: a parser that descends into the heading para
  // silently prepends "Jesus Feeds the Five Thousand" to verse 1, and it then
  // travels into every copy, share and verse card.
  for (const verse of parseChapterContent(JOHN_6)) {
    assert.doesNotMatch(verse.text, /Feeds the Five Thousand|Walks on Water/, `leaked into verse ${verse.verse}`)
  }
})

test('verse text is unchanged by headings being enabled', () => {
  const byVerse = Object.fromEntries(parseChapterContent(JOHN_6).map((v) => [v.verse, v]))
  assert.equal(byVerse[1].text, 'After this Jesus went away to the other side of the Sea of Galilee.')
  assert.equal(byVerse[16].text, 'When evening came, his disciples went down to the sea.')
})

test('every heading style translators use is recognised', () => {
  for (const style of ['s', 's1', 's2', 's3', 'ms', 'ms1', 'mr', 'sr', 'd', 'sp']) {
    const verses = parseChapterContent([
      para(style, [text('A Heading')]),
      para('p', [verseText('PSA.3.1', 'O LORD, how many are my foes!')]),
    ])
    assert.equal(verses[0].heading, 'A Heading', `style "${style}" was not treated as a heading`)
    assert.equal(verses[0].text, 'O LORD, how many are my foes!')
  }
})

test('a normal paragraph style is not mistaken for a heading', () => {
  // 'q1' is poetry and 'p' is prose — both are Scripture and must stay so.
  for (const style of ['p', 'q1', 'q2', 'm', 'pi']) {
    const verses = parseChapterContent([
      para(style, [verseText('PSA.1.1', 'Blessed is the man.')]),
    ])
    assert.equal(verses[0].heading, null, `style "${style}" was wrongly treated as a heading`)
    assert.equal(verses[0].text, 'Blessed is the man.')
  }
})

test('a major heading and its section heading are combined, not lost', () => {
  const verses = parseChapterContent([
    para('ms', [text('BOOK ONE')]),
    para('mr', [text('Psalms 1-41')]),
    para('p', [verseText('PSA.1.1', 'Blessed is the man.')]),
  ])
  assert.equal(verses[0].heading, 'BOOK ONE — Psalms 1-41')
})

test('a chapter with no headings still parses', () => {
  const verses = parseChapterContent([para('p', [verseText('JHN.1.1', 'In the beginning was the Word.')])])
  assert.equal(verses.length, 1)
  assert.equal(verses[0].heading, null)
})

test('a trailing heading with no verse after it is dropped, not attached backwards', () => {
  // Otherwise the last verse of a chapter would inherit the NEXT chapter's
  // heading, which is both wrong and confusing.
  const verses = parseChapterContent([
    para('p', [verseText('JHN.6.71', 'He spoke of Judas.')]),
    para('s1', [text('The Next Chapter Heading')]),
  ])
  assert.equal(verses.length, 1)
  assert.equal(verses[0].heading, null)
  assert.doesNotMatch(verses[0].text, /Next Chapter/)
})

test('whitespace inside a heading is collapsed', () => {
  const verses = parseChapterContent([
    para('s1', [text('Jesus   Feeds\n  the  Crowd')]),
    para('p', [verseText('JHN.6.1', 'After this.')]),
  ])
  assert.equal(verses[0].heading, 'Jesus Feeds the Crowd')
})
