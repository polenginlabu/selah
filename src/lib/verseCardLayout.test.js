// Tests for the verse card typesetting.
//
// These exist because the card must hold ANY verse. The reader can select one
// clause of Psalm 117 or the whole of Esther 8:9 (the longest verse in the
// Bible, ~90 words), and both have to come out readable, inside the frame and
// complete — a Scripture card that silently truncates Scripture is worse than
// no card.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARD_WIDTH, CARD_HEIGHT, MARGIN_X, CONTENT_WIDTH,
  wrapText, fitVerse, layoutCard, quoteVerse,
} from './verseCardLayout.js'

// A stand-in for ctx.measureText. Real glyph widths vary, but proportionality
// to length and size is the only property the layout logic actually relies on.
const measure = (text, fontSize) => text.length * fontSize * 0.5

const SHORT = 'The Lord is my shepherd, I lack nothing.'
const LONG = 'Then the king’s scribes were called at that time in the third month, '
  + 'that is, the month Sivan, on the twenty-third day thereof; and it was written '
  + 'according to all that Mordecai commanded unto the Jews, and to the satraps, and '
  + 'the governors and princes of the provinces which are from India unto Ethiopia, '
  + 'a hundred twenty and seven provinces, unto every province according to the writing '
  + 'thereof, and unto every people after their language, and to the Jews according to '
  + 'their writing, and according to their language.'

// --- Wrapping --------------------------------------------------------------

test('no wrapped line exceeds the content column', () => {
  for (const line of wrapText(LONG, 40, measure)) {
    assert.ok(measure(line, 40) <= CONTENT_WIDTH, `"${line}" overflows`)
  }
})

test('wrapping preserves every word, in order', () => {
  const lines = wrapText(LONG, 40, measure)
  assert.equal(lines.join(' '), LONG.trim().replace(/\s+/g, ' '))
})

test('empty input wraps to nothing rather than a blank line', () => {
  assert.deepEqual(wrapText('', 40, measure), [])
  assert.deepEqual(wrapText('   ', 40, measure), [])
  assert.deepEqual(wrapText(null, 40, measure), [])
})

test('a word wider than the column gets its own line instead of hanging', () => {
  const lines = wrapText(`short ${'x'.repeat(400)} short`, 40, measure)
  assert.equal(lines.length, 3)
})

// --- Shrink to fit ---------------------------------------------------------

test('a short verse is set at the largest size', () => {
  const { fontSize, lines } = fitVerse(SHORT, measure)
  assert.equal(fontSize, 76)
  assert.ok(lines.length <= 4)
})

test('the longest verse in the Bible shrinks instead of overflowing', () => {
  const short = fitVerse(SHORT, measure)
  const long = fitVerse(LONG, measure)
  assert.ok(long.fontSize < short.fontSize, 'a long verse was not shrunk')
  assert.ok(long.lines.length <= 14, `${long.lines.length} lines is past the cap`)
})

test('shrinking never drops a word', () => {
  const { lines } = fitVerse(LONG, measure)
  assert.equal(lines.join(' '), LONG.trim().replace(/\s+/g, ' '))
})

test('the verse never shrinks below the legibility floor', () => {
  const absurd = fitVerse('word '.repeat(600), measure)
  assert.equal(absurd.fontSize, 34)
  // Past the floor the block is allowed to run tall rather than be cut.
  assert.equal(absurd.lines.join(' ').split(' ').length, 600)
})

// --- Full layout -----------------------------------------------------------

test('every element sits inside the card', () => {
  for (const verse of [SHORT, LONG]) {
    const l = layoutCard({ verse, reference: 'Psalm 23:1', translation: 'NIV' }, measure)
    for (const line of l.verse.lines) {
      assert.ok(line.x >= MARGIN_X, 'verse starts left of the margin')
      assert.ok(line.y > 0 && line.y < CARD_HEIGHT, 'verse line is off the card')
    }
    assert.ok(l.reference.y < CARD_HEIGHT)
    assert.ok(l.brand.y < CARD_HEIGHT, 'the wordmark fell off the bottom')
  }
})

test('the reading order is verse, then reference, then wordmark', () => {
  const l = layoutCard({ verse: SHORT, reference: 'Psalm 23:1', translation: 'NIV' }, measure)
  const lastVerseY = l.verse.lines.at(-1).y
  assert.ok(lastVerseY < l.reference.y)
  assert.ok(l.reference.y < l.translation.y)
  assert.ok(l.translation.y < l.brand.y)
})

test('the scrim covers the full text block', () => {
  const l = layoutCard({ verse: LONG, reference: 'Esther 8:9', translation: 'WEB' }, measure)
  assert.ok(l.contentTop <= l.verse.lines[0].y, 'the scrim starts below the first line')
  assert.ok(l.contentBottom >= l.brand.y, 'the scrim ends above the wordmark')
  assert.ok(l.contentTop >= 0 && l.contentBottom <= CARD_HEIGHT)
})

test('the translation line is optional', () => {
  const l = layoutCard({ verse: SHORT, reference: 'Psalm 23:1', translation: null }, measure)
  assert.equal(l.translation, null)
  assert.ok(l.brand.y > l.reference.y)
})

test('the card is 9:16', () => {
  assert.equal(CARD_WIDTH / CARD_HEIGHT, 1080 / 1920)
})

// --- Quotes ----------------------------------------------------------------

test('the verse is wrapped in typographic quotes', () => {
  assert.equal(quoteVerse('Be still.'), '“Be still.”')
  assert.equal(quoteVerse('  Be still.  '), '“Be still.”')
})

test('an empty verse is not given empty quotes', () => {
  assert.equal(quoteVerse(''), '')
  assert.equal(quoteVerse(null), '')
})
