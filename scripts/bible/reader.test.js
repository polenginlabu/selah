import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChapterContent, formatSelectionReference, validChapter, BOOK_IDS } from '../../supabase/functions/_shared/bible.js'
import { BIBLE_BOOKS } from '../../src/data/books.js'

const text = (id, value) => ({ type: 'text', attrs: { verseId: id }, text: value })
const para = (...items) => ({ name: 'para', type: 'tag', items })

test('preserves nested AMP text, excludes verse numbers/notes, and separates paragraph fragments', () => {
  const result = parseChapterContent([
    para({ name: 'verse', items: [text('JHN.3.1', '1')] }, text('JHN.3.1', 'Before '),
      { name: 'char', items: [text('JHN.3.1', 'emphasis')] },
      { name: 'note', items: [text('JHN.3.1', 'footnote')] }),
    para(text('JHN.3.1', 'after.'), text('JHN.3.2', 'Next verse.')),
  ])
  assert.equal(result.length, 2)
  assert.equal(result[0].text, 'Before emphasis after.')
  assert.equal(result[1].paragraph, 1)
})

test('MSG bridged verses remain one passage with the complete selection reference', () => {
  const result = parseChapterContent([para(
    text('JHN.3.1-JHN.3.2', 'A bridged passage.'),
    text('JHN.3.3-JHN.3.4', 'The next passage.'),
    text('JHN.3.6', 'Another verse.'),
  )])
  assert.equal(result.length, 3)
  assert.equal(result[0].label, '1–2')
  assert.equal(result[0].endVerse, 2)
  assert.equal(formatSelectionReference('John', 3, result), 'John 3:1-4, 6')
})

test('refuses empty content rather than showing an empty chapter', () => {
  assert.throws(() => parseChapterContent([]), /No verses/)
  assert.throws(() => parseChapterContent({}), /Unexpected/)
})

test('validates every canonical book boundary and disallows arbitrary upstream paths', () => {
  assert.equal(BOOK_IDS.length, BIBLE_BOOKS.length)
  BIBLE_BOOKS.forEach((b, i) => {
    assert.equal(validChapter(BOOK_IDS[i], b.chapters), true, b.name)
    assert.equal(validChapter(BOOK_IDS[i], b.chapters + 1), false, b.name)
  })
  for (const chapter of [0, -1, 1.5, '1', null]) assert.equal(validChapter('JHN', chapter), false)
  assert.equal(validChapter('../bibles', 1), false)
})
