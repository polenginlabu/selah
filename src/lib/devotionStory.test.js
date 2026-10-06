import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStorySections,
  nextSectionIndex,
  paginateParagraphs,
  splitProse,
  THOUGHT_PAGE_WORDS,
} from './devotionStory.js'

const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ')

const FULL = {
  title: 'Peace that holds',
  thought: `${words(60)}\n\n${words(60)}\n\n${words(30)}`,
  teaches: 'It teaches this.\n\nAnd this.',
  questions: ['Where do you need peace?', 'Who can you tell?'],
  application: 'Do one thing.',
  prayer: 'Lord, steady me.\n\nAmen.',
  selah: 'Sit quietly for two minutes.',
  researchNote: null,
}

test('splitProse splits on blank lines and drops empty parts', () => {
  assert.deepEqual(splitProse('One.\n\nTwo.\n  \n\nThree.'), ['One.', 'Two.', 'Three.'])
  assert.deepEqual(splitProse('  Single line\nstill one paragraph  '), ['Single line\nstill one paragraph'])
})

test('splitProse returns [] for null, empty and whitespace-only input', () => {
  assert.deepEqual(splitProse(null), [])
  assert.deepEqual(splitProse(undefined), [])
  assert.deepEqual(splitProse(''), [])
  assert.deepEqual(splitProse('   \n\n   '), [])
})

test('paginateParagraphs groups paragraphs up to the word limit', () => {
  const pages = paginateParagraphs([words(50), words(50), words(50)], 110)
  assert.equal(pages.length, 2)
  assert.equal(pages[0].length, 2)
  assert.equal(pages[1].length, 1)
})

test('paginateParagraphs gives an over-long paragraph its own page and never splits it', () => {
  const long = words(300)
  const pages = paginateParagraphs([words(20), long, words(20)], 110)
  assert.deepEqual(pages, [[words(20)], [long], [words(20)]])
})

test('paginateParagraphs fills a page to exactly the limit and breaks one word over', () => {
  assert.equal(paginateParagraphs([words(55), words(55)], 110).length, 1)
  assert.equal(paginateParagraphs([words(55), words(56)], 110).length, 2)
})

test('buildStorySections keeps every thought paragraph in order across pages', () => {
  const thought = [words(60, 'a'), words(60, 'b'), words(30, 'c')].join('\n\n')
  const flat = buildStorySections({ thought })
    .filter((s) => s.kind === 'thought')
    .flatMap((s) => s.paragraphs)
  assert.deepEqual(flat, splitProse(thought))
})

test('paginateParagraphs handles empty and missing input', () => {
  assert.deepEqual(paginateParagraphs([]), [])
  assert.deepEqual(paginateParagraphs(undefined), [])
})

test('buildStorySections orders a full devotion from scripture to selah', () => {
  const sections = buildStorySections(FULL)
  assert.deepEqual(
    sections.map((s) => s.id),
    ['scripture', 'thought-1', 'thought-2', 'teaches', 'reflect', 'apply', 'pray', 'selah']
  )
  assert.equal(sections[1].label, 'The Thought (1 of 2)')
  assert.equal(sections[2].page, 2)
  assert.equal(sections[2].pages, 2)
  assert.deepEqual(sections.find((s) => s.id === 'pray').paragraphs, ['Lord, steady me.', 'Amen.'])
  assert.equal(sections.at(-1).label, 'Selah')
})

test('buildStorySections ids are unique', () => {
  const ids = buildStorySections(FULL).map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('buildStorySections omits sections with no content', () => {
  const sections = buildStorySections({
    thought: 'Short thought.',
    teaches: '',
    questions: [],
    application: '   ',
    prayer: 'Amen.',
    selah: null,
  })
  assert.deepEqual(
    sections.map((s) => s.id),
    ['scripture', 'thought-1', 'pray', 'selah']
  )
  assert.equal(sections[1].label, 'The Thought')
  // The closing screen stays so the reader can still mark the day complete.
  assert.equal(sections.at(-1).label, 'Finish')
  assert.deepEqual(sections.at(-1).paragraphs, [])
})

test('buildStorySections keeps the opening and closing screens for an empty devotion', () => {
  assert.deepEqual(
    buildStorySections({}).map((s) => s.id),
    ['scripture', 'selah']
  )
  assert.deepEqual(buildStorySections(null), [])
})

test('buildStorySections attaches the research note to teaches, then the last thought, then scripture', () => {
  const withTeaches = buildStorySections({ ...FULL, researchNote: 'No sources found.' })
  assert.deepEqual(withTeaches.filter((s) => s.note).map((s) => s.id), ['teaches'])

  const noTeaches = buildStorySections({ ...FULL, teaches: '', researchNote: 'No sources found.' })
  assert.deepEqual(noTeaches.filter((s) => s.note).map((s) => s.id), ['thought-2'])

  const bare = buildStorySections({ researchNote: 'No sources found.' })
  assert.deepEqual(bare.filter((s) => s.note).map((s) => s.id), ['scripture'])

  assert.equal(buildStorySections(FULL).some((s) => s.note), false)
})

test('buildStorySections respects a custom page size', () => {
  const sections = buildStorySections({ thought: `${words(10)}\n\n${words(10)}` }, { maxWords: 10 })
  assert.equal(sections.filter((s) => s.kind === 'thought').length, 2)
  assert.ok(THOUGHT_PAGE_WORDS > 10)
})

test('nextSectionIndex moves one section for arrows and page keys, clamped', () => {
  assert.equal(nextSectionIndex('ArrowDown', 0, 5), 1)
  assert.equal(nextSectionIndex('PageDown', 3, 5), 4)
  assert.equal(nextSectionIndex('ArrowDown', 4, 5), 4)
  assert.equal(nextSectionIndex('ArrowUp', 2, 5), 1)
  assert.equal(nextSectionIndex('PageUp', 0, 5), 0)
})

test('nextSectionIndex jumps to the ends for Home and End', () => {
  assert.equal(nextSectionIndex('Home', 3, 5), 0)
  assert.equal(nextSectionIndex('End', 1, 5), 4)
})

test('nextSectionIndex ignores other keys and empty stories', () => {
  assert.equal(nextSectionIndex('Tab', 1, 5), null)
  assert.equal(nextSectionIndex(' ', 1, 5), null)
  assert.equal(nextSectionIndex('Enter', 1, 5), null)
  assert.equal(nextSectionIndex('ArrowDown', 0, 0), null)
})

test('nextSectionIndex clamps an out-of-range current index', () => {
  assert.equal(nextSectionIndex('ArrowDown', 9, 3), 2)
  assert.equal(nextSectionIndex('ArrowUp', -4, 3), 0)
})
