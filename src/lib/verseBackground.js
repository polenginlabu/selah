// Pure pieces of the admin verse-background upload: the crop maths, the
// storage path scheme, and the error type everything raises.
//
// Deliberately free of DOM, Supabase and network so node:test can keep it
// honest without a browser (npm run card:test). The browser half lives in
// verseBackgroundUpload.js. Same pure/renderer split as scripts/selah/background.js,
// which this reuses for date validation and the card's pixel size.

import { assertValidDate, IMAGE_WIDTH, IMAGE_HEIGHT } from '../../scripts/selah/background.js'

export { IMAGE_WIDTH, IMAGE_HEIGHT }

/** Matches scripts/selah/image.js sharp(82) so admin uploads look like generated art. */
export const WEBP_QUALITY = 0.82

export class VerseBackgroundError extends Error {
  constructor(message, kind = 'generic') {
    super(message)
    this.name = 'VerseBackgroundError'
    this.kind = kind
  }
}

/**
 * The source rectangle (in source pixels) that a centre cover-crop needs to
 * fill the card — the browser mirror of sharp's fit: 'cover', position:
 * 'centre' in scripts/selah/image.js.
 */
export function coverCropRect(srcWidth, srcHeight, dstWidth = IMAGE_WIDTH, dstHeight = IMAGE_HEIGHT) {
  if (!(srcWidth > 0) || !(srcHeight > 0) || !(dstWidth > 0) || !(dstHeight > 0)) {
    throw new VerseBackgroundError('The image has no usable size.', 'shape')
  }
  const srcRatio = srcWidth / srcHeight
  const dstRatio = dstWidth / dstHeight
  if (srcRatio > dstRatio) {
    // Wider than the card: crop the sides, keep the full height.
    const sw = srcHeight * dstRatio
    return { sx: (srcWidth - sw) / 2, sy: 0, sw, sh: srcHeight }
  }
  // Taller (or equal): crop the top and bottom, keep the full width.
  const sh = srcWidth / dstRatio
  return { sx: 0, sy: (srcHeight - sh) / 2, sw: srcWidth, sh }
}

/**
 * selah/backgrounds/2026/09/24.webp — the same path scheme the generator and
 * the CLI use, so rows in daily_backgrounds look identical whichever way they
 * arrived.
 */
export function storagePathForDate(dateISO) {
  try {
    assertValidDate(dateISO)
  } catch (err) {
    throw new VerseBackgroundError(err.message, 'date')
  }
  const [year, month, day] = dateISO.split('-')
  return `selah/backgrounds/${year}/${month}/${day}.webp`
}