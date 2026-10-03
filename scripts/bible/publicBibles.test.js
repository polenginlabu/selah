import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOOK_IDS } from '../../supabase/functions/_shared/bible.js'
import { BIBLE_BOOKS } from '../../src/data/books.js'
import { toChapterResult, NO_VERSES } from '../../src/data/publicBibles/shape.js'
import { KNOWN_OMISSIONS } from './build-public-bibles.js'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/data/publicBibles')
const BUNDLED = ['bbe', 'kjv', 'web']
const book = (id, bookId) => JSON.parse(fs.readFileSync(path.join(DIR, id, `${bookId}.json`), 'utf8'))

test('only the public-domain translations are bundled', () => {
  const dirs = fs.readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  assert.deepEqual(dirs, BUNDLED)
})

for (const id of BUNDLED) {
  test(`${id}: every book and chapter is present with non-empty verses`, () => {
    const omitted = []
    BIBLE_BOOKS.forEach((b, index) => {
      const chapters = book(id, BOOK_IDS[index])
      assert.equal(chapters.length, b.chapters, `${id} ${b.name} chapter count`)
      chapters.forEach((verses, c) => {
        assert.ok(verses.length > 0, `${id} ${b.name} ${c + 1} has verses`)
        verses.forEach((text, v) => {
          if (text === null) return omitted.push(`${BOOK_IDS[index]} ${c + 1}:${v + 1}`)
          assert.equal(typeof text, 'string')
          assert.notEqual(text.trim(), '', `${id} ${b.name} ${c + 1}:${v + 1} is empty`)
          assert.doesNotMatch(text, /[¶[\]<>\\]/, `${id} ${b.name} ${c + 1}:${v + 1} has markup`)
        })
      })
    })
    assert.deepEqual(omitted, KNOWN_OMISSIONS[id])
    assert.equal(book(id, 'JHN').length, 21)
    assert.equal(book(id, 'PSA').length, 150)
  })
}

test('KJV John 3 maps to the reader shape without any network request', (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('network used') })
  const result = toChapterResult({ id: 'kjv', name: 'King James Version' }, book('kjv', 'JHN'), 3)
  assert.equal(fetchMock.mock.callCount(), 0)
  assert.equal(result.translation, 'kjv')
  assert.equal(result.translationName, 'King James Version')
  assert.equal(result.abbreviation, 'KJV')
  assert.equal(result.verses.length, 36)
  assert.deepEqual(Object.keys(result).sort(), ['abbreviation', 'translation', 'translationName', 'verses'])
  assert.deepEqual(result.verses[15], {
    verse: 16, endVerse: 16, label: '16',
    text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    heading: null, paragraph: 3,
  })
  assert.equal(result.verses[0].paragraph, 0)
  assert.equal(result.verses[5].paragraph, 1)
})

test('omitted verses are skipped but keep later verse numbers', () => {
  const result = toChapterResult({ id: 'web', name: 'World English Bible' }, book('web', 'ACT'), 8)
  const numbers = result.verses.map((v) => v.verse)
  assert.ok(!numbers.includes(37))
  assert.equal(numbers.at(-1), 40)
  assert.equal(result.verses.find((v) => v.verse === 38).label, '38')
})

test('out-of-range chapters throw the readable no-verses error', () => {
  const meta = { id: 'web', name: 'World English Bible' }
  assert.throws(() => toChapterResult(meta, book('web', 'JHN'), 22), { message: NO_VERSES })
  assert.throws(() => toChapterResult(meta, book('web', 'JHN'), 0), { message: NO_VERSES })
  assert.throws(() => toChapterResult(meta, undefined, 1), { message: NO_VERSES })
  assert.equal(NO_VERSES, 'No verses were returned for this chapter.')
})
