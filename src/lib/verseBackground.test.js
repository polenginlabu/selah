import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  VerseBackgroundError,
  coverCropRect,
  storagePathForDate,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  WEBP_QUALITY,
} from './verseBackground.js'

test('card dimensions and quality match the generator pipeline', () => {
  assert.equal(IMAGE_WIDTH, 1080)
  assert.equal(IMAGE_HEIGHT, 1920)
  assert.equal(WEBP_QUALITY, 0.82) // scripts/selah/image.js sharp(82)
})

test('coverCropRect leaves an identical-aspect source untouched', () => {
  assert.deepEqual(coverCropRect(1080, 1920), { sx: 0, sy: 0, sw: 1080, sh: 1920 })
})

test('coverCropRect crops a wide (landscape) source down the sides, centred', () => {
  // 2000x1000 into 1080x1920: keep full height, crop the width to 1000*0.5625.
  const rect = coverCropRect(2000, 1000)
  assert.deepEqual(rect, { sx: 718.75, sy: 0, sw: 562.5, sh: 1000 })
  assert.equal(rect.sw / rect.sh, IMAGE_WIDTH / IMAGE_HEIGHT)
})

test('coverCropRect crops a tall source top and bottom, centred', () => {
  // 900x2200 into 1080x1920: keep full width, crop the height to 900/0.5625.
  const rect = coverCropRect(900, 2200)
  assert.deepEqual(rect, { sx: 0, sy: 300, sw: 900, sh: 1600 })
  assert.equal(rect.sw / rect.sh, IMAGE_WIDTH / IMAGE_HEIGHT)
})

test('coverCropRect crops a square source to the card ratio', () => {
  assert.deepEqual(coverCropRect(1000, 1000), { sx: 218.75, sy: 0, sw: 562.5, sh: 1000 })
})

test('coverCropRect rejects sources without a usable size', () => {
  assert.throws(() => coverCropRect(0, 100), VerseBackgroundError)
  assert.throws(() => coverCropRect(100, -1), VerseBackgroundError)
  assert.throws(() => coverCropRect(100, 100, 0, 1920), VerseBackgroundError)
})

test('storagePathForDate builds the generator path scheme', () => {
  assert.equal(storagePathForDate('2026-09-24'), 'selah/backgrounds/2026/09/24.webp')
  assert.equal(storagePathForDate('2020-01-02'), 'selah/backgrounds/2020/01/02.webp')
})

test('storagePathForDate rejects malformed or impossible dates', () => {
  for (const bad of ['2026-13-01', '2026-02-31', '09-24-2026', 'not-a-date', '', null, undefined]) {
    assert.throws(
      () => storagePathForDate(bad),
      (err) => err instanceof VerseBackgroundError && err.kind === 'date',
      `expected ${String(bad)} to be rejected`
    )
  }
})