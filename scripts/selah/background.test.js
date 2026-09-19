// Tests for the daily background logic.
//
// The one that matters most is the no-text guard. The whole feature rests on a
// division of labour — the model paints, SELAH sets the type — and the only
// thing holding the model to its half is the wording of the prompt. A prompt
// that drifts into asking for "a verse card" produces misspelled Scripture
// burned into a JPEG, which no amount of client code can undo. So the
// prohibitions are asserted, not assumed.
//
// Run: npm run background:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  THEMES, MOTIFS, IMAGE_WIDTH, IMAGE_HEIGHT,
  dayIndex, themeForDate, buildBackgroundPrompt, storagePathForDate,
  assertValidDate, detectImageType, assertUsableImage, toBackgroundRow,
  BackgroundError,
} from './background.js'

// --- Theme selection -------------------------------------------------------

test('a date always gets the same theme', () => {
  assert.deepEqual(themeForDate('2026-09-19'), themeForDate('2026-09-19'))
})

test('consecutive days differ in both theme and motif', () => {
  const a = themeForDate('2026-09-19')
  const b = themeForDate('2026-09-20')
  assert.notEqual(a.theme, b.theme)
  assert.notEqual(a.motif, b.motif)
})

test('themes and motifs always come from the published lists', () => {
  for (let i = 0; i < 400; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
    const { theme, motif } = themeForDate(date)
    assert.ok(THEMES.includes(theme), `${theme} is not a known theme`)
    assert.ok(MOTIFS.includes(motif), `${motif} is not a known motif`)
  }
})

test('the theme/motif pairing runs a full 180 days before repeating', () => {
  // 20 themes x 9 motifs, coprime, so every combination appears once before any
  // combination appears twice. If someone adds a 10th motif this test fails,
  // which is the point: 10 and 20 share a factor and the cycle collapses to 20.
  assert.equal(THEMES.length * MOTIFS.length, 180)
  const seen = new Set()
  for (let i = 0; i < 180; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10)
    const { theme, motif } = themeForDate(date)
    seen.add(`${theme}|${motif}`)
  }
  assert.equal(seen.size, 180, 'the rotation repeats before it should')
})

test('dayIndex advances by exactly one per day and survives month ends', () => {
  assert.equal(dayIndex('2026-09-20') - dayIndex('2026-09-19'), 1)
  assert.equal(dayIndex('2026-03-01') - dayIndex('2026-02-28'), 1)
  assert.equal(dayIndex('2027-01-01') - dayIndex('2026-12-31'), 1)
})

// --- The prompt ------------------------------------------------------------

test('the prompt forbids text in every form the model might reach for', () => {
  const prompt = buildBackgroundPrompt(themeForDate('2026-09-19')).toLowerCase()
  for (const banned of [
    'no text', 'no words', 'no letters', 'no numbers', 'no bible verses',
    'no typography', 'no logos', 'no watermarks', 'no ui elements',
  ]) {
    assert.ok(prompt.includes(banned), `the prompt no longer says "${banned}"`)
  }
  assert.ok(prompt.includes('background only'))
  assert.ok(prompt.includes('do not include any written content'))
})

test('the prompt never asks the model for Scripture', () => {
  const prompt = buildBackgroundPrompt(themeForDate('2026-09-19'))
  // "bible verses" appears only inside the prohibition, never as a request.
  assert.doesNotMatch(prompt, /(write|render|include|add|generate|show)[^.\n]{0,40}\b(verse|scripture|reference|quote)\b/i)
})

test('the prompt asks for people to be left out', () => {
  assert.match(buildBackgroundPrompt(themeForDate('2026-01-01')), /Do not include people or faces/i)
})

test('the prompt carries the day theme and the 9:16 size', () => {
  const prompt = buildBackgroundPrompt({ theme: 'stillness', motif: 'soft dawn haze with long low light' })
  assert.match(prompt, /Today's theme: stillness\./)
  assert.match(prompt, /soft dawn haze with long low light/)
  assert.ok(prompt.includes(`${IMAGE_WIDTH}x${IMAGE_HEIGHT}`))
})

test('a prompt cannot be built without a theme', () => {
  assert.throws(() => buildBackgroundPrompt({}), BackgroundError)
})

// --- Storage paths ---------------------------------------------------------

test('the storage path is date-derived and zero-padded', () => {
  assert.equal(storagePathForDate('2026-09-19'), 'selah/backgrounds/2026/09/19.webp')
  assert.equal(storagePathForDate('2026-01-05'), 'selah/backgrounds/2026/01/05.webp')
})

test('bad dates are rejected rather than producing a junk path', () => {
  for (const bad of ['19-09-2026', '2026-9-19', 'today', '', null, '2026-02-31', '2026-13-01']) {
    assert.throws(() => storagePathForDate(bad), BackgroundError, `accepted ${bad}`)
  }
})

test('a real leap day is accepted', () => {
  assert.equal(assertValidDate('2028-02-29'), '2028-02-29')
  assert.throws(() => assertValidDate('2026-02-29'), BackgroundError)
})

// --- What came back --------------------------------------------------------

const png = (size = 20 * 1024) => {
  const b = Buffer.alloc(size)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b)
  return b
}

test('image formats are identified by their magic bytes', () => {
  assert.equal(detectImageType(png()), 'png')

  const jpeg = Buffer.alloc(20 * 1024)
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(jpeg)
  assert.equal(detectImageType(jpeg), 'jpeg')

  const webp = Buffer.alloc(20 * 1024)
  webp.write('RIFF', 0); webp.write('WEBP', 8)
  assert.equal(detectImageType(webp), 'webp')
})

test('prose pretending to be an image is rejected', () => {
  // The realistic failure: a text model is configured by mistake and answers
  // with a friendly paragraph, which base64-decodes into perfectly valid bytes.
  const prose = Buffer.from('I am unable to generate images, but here is a description...'.repeat(400))
  assert.throws(() => assertUsableImage(prose), BackgroundError)
})

test('an empty or truncated image is rejected before it costs an upload', () => {
  assert.throws(() => assertUsableImage(Buffer.alloc(0)), BackgroundError)
  assert.throws(() => assertUsableImage(png(200)), BackgroundError)
})

test('a plausible image passes', () => {
  assert.equal(assertUsableImage(png()), 'png')
})

// --- The row ---------------------------------------------------------------

const ROW = {
  date: '2026-09-19',
  storagePath: 'selah/backgrounds/2026/09/19.webp',
  imageUrl: 'https://storage.googleapis.com/bucket/selah/backgrounds/2026/09/19.webp',
  theme: 'ocean',
  prompt: 'x',
  model: 'google/gemini-3.1-flash-image',
  width: IMAGE_WIDTH,
  height: IMAGE_HEIGHT,
  bytes: 240_000,
}

test('the row maps to the database column names', () => {
  const row = toBackgroundRow(ROW)
  assert.equal(row.storage_path, ROW.storagePath)
  assert.equal(row.image_url, ROW.imageUrl)
  assert.equal(row.date, '2026-09-19')
  assert.equal(row.theme, 'ocean')
  assert.equal(row.width, IMAGE_WIDTH)
})

test('a row without an image URL is refused', () => {
  // Guards the invariant the generator depends on: the metadata row must never
  // point at nothing, because the app treats its presence as "there is a
  // background today".
  assert.throws(() => toBackgroundRow({ ...ROW, imageUrl: '' }), BackgroundError)
  assert.throws(() => toBackgroundRow({ ...ROW, storagePath: '' }), BackgroundError)
  assert.throws(() => toBackgroundRow({ ...ROW, theme: '' }), BackgroundError)
})

test('optional columns default to null rather than undefined', () => {
  const row = toBackgroundRow({ ...ROW, prompt: undefined, width: undefined })
  assert.equal(row.prompt, null)
  assert.equal(row.width, null)
})
