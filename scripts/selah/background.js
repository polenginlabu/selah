// Pure logic for the SELAH daily background: which theme a date gets, the
// prompt that theme produces, where the image is stored, and what counts as a
// usable image coming back.
//
// Deliberately free of network, filesystem and Supabase so it can be tested
// directly (npm run background:test) — the same split as prompt.js/devotion.js.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: the model generates BACKGROUND ART
// ONLY. Scripture, the reference, the wordmark and every pixel of type are
// rendered by SELAH itself on the client. A model asked for "a verse card"
// produces misspelled, mistranslated, un-selectable Scripture baked into a
// JPEG, which is both a typography problem and a doctrinal one. So the prompt
// below asks for an empty, quiet room — and buildBackgroundPrompt() is the
// only place a prompt is built, so that rule cannot be bypassed by accident.

export class BackgroundError extends Error {
  constructor(message, kind = 'generic') {
    super(message)
    this.name = 'BackgroundError'
    this.kind = kind
  }
}

/** Target output. Vertical, mobile/social sized. */
export const IMAGE_WIDTH = 1080
export const IMAGE_HEIGHT = 1920

/**
 * The devotional themes from the SELAH brief.
 *
 * Paired with MOTIFS below rather than used alone. Twenty themes on their own
 * repeat every twenty days, and because the same theme would always arrive
 * with the same wording it would also arrive with much the same picture — the
 * app would visibly loop every three weeks.
 */
export const THEMES = [
  'stillness', 'peace', 'hope', 'rest', 'grace',
  'faith', 'joy', 'light', 'renewal', 'trust',
  'wisdom', "God's creation", 'morning', 'evening', 'mountains',
  'ocean', 'forest', 'sky', 'sunrise', 'gentle rain',
]

/**
 * Light, palette and composition variations layered on top of the theme.
 *
 * Nine of these against twenty themes, and 9 and 20 share no factor, so the
 * pairing runs 180 days before it repeats — half a year of distinct
 * backgrounds out of two short lists. (Any length coprime to THEMES.length
 * gives the full cycle; 9 is chosen so consecutive days also differ in motif,
 * not just theme.)
 */
export const MOTIFS = [
  'soft dawn haze with long low light',
  'golden hour warmth and gentle lens bloom',
  'cool blue overcast calm with diffused light',
  'deep dusk tones lit by a single quiet source',
  'muted pastel gradients and very soft focus',
  'fine mist softening layered distance',
  'warm amber light falling across the frame',
  'clear high-altitude air with subtle cool shadows',
  'rain-softened light with quiet reflections',
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function assertValidDate(dateISO) {
  if (typeof dateISO !== 'string' || !DATE_RE.test(dateISO)) {
    throw new BackgroundError(`Bad date: ${dateISO}. Expected YYYY-MM-DD.`, 'date')
  }
  // Catches 2026-02-31 and 2026-13-01, which match the regex but are not days.
  const [y, m, d] = dateISO.split('-').map(Number)
  const parsed = new Date(Date.UTC(y, m - 1, d))
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    throw new BackgroundError(`Not a real date: ${dateISO}.`, 'date')
  }
  return dateISO
}

/** Whole days since the epoch. Stable, timezone-free, and easy to assert on. */
export function dayIndex(dateISO) {
  assertValidDate(dateISO)
  const [y, m, d] = dateISO.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

/**
 * The theme and motif for a date.
 *
 * Deterministic on purpose: re-running the generator for 2026-09-19 must ask
 * for the same picture it asked for the first time, so a retry after a failed
 * upload is a retry rather than a different day's art.
 */
export function themeForDate(dateISO) {
  const index = dayIndex(dateISO)
  // Negative dates (pre-1970) would make % return a negative index. Not a real
  // case, but a crash here would be an obscure one, so normalise.
  const pick = (list, offset) => list[((index + offset) % list.length + list.length) % list.length]
  return { theme: pick(THEMES, 0), motif: pick(MOTIFS, 0) }
}

/**
 * The image prompt. Background art only — see the note at the top of the file.
 *
 * The prohibitions are repeated in several forms ("no text, no words, no
 * letters...") rather than stated once because image models weight a
 * constraint by how much of the prompt it occupies, and a single trailing
 * "no text please" is routinely ignored.
 */
export function buildBackgroundPrompt({ theme, motif } = {}) {
  if (!theme) throw new BackgroundError('A theme is required to build a prompt.', 'shape')

  return [
    'Create a beautiful, peaceful, cinematic background image for the SELAH Bible app.',
    'This image will be used behind Bible verses in a mobile Scripture-sharing card.',
    '',
    'BACKGROUND ONLY.',
    '',
    'Absolutely no text, no words, no letters, no numbers, no Bible verses, no typography,',
    'no logos, no watermarks, no UI elements, and no written symbols.',
    'Do not render any signage, book pages, scrolls or engraved writing of any kind.',
    'Do not include people or faces.',
    '',
    'Create a peaceful Christian devotional atmosphere using natural visual elements,',
    'soft lighting, subtle depth, elegant composition, and a calm contemplative mood.',
    '',
    `Today's theme: ${theme}.`,
    motif ? `Visual treatment: ${motif}.` : '',
    '',
    'Leave generous, uncluttered negative space through the middle of the frame so that',
    'Bible verse typography can be rendered clearly on top of the image by the app.',
    'Keep the composition calm and simple rather than busy or detailed — the Scripture,',
    'not the picture, is the subject.',
    '',
    'The image should feel peaceful, hopeful, warm, reflective, and appropriate for',
    'Scripture meditation.',
    '',
    `Use a vertical ${IMAGE_WIDTH}x${IMAGE_HEIGHT} (9:16) composition optimized for mobile devices`,
    'and social media sharing.',
    '',
    'Do not include any written content.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** selah/backgrounds/2026/09/19.webp */
export function storagePathForDate(dateISO) {
  assertValidDate(dateISO)
  const [year, month, day] = dateISO.split('-')
  return `selah/backgrounds/${year}/${month}/${day}.webp`
}

// --- What came back --------------------------------------------------------

const SIGNATURES = [
  { type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
]

/**
 * Identifies the image by its magic bytes rather than by a claimed MIME type.
 *
 * The agent path can hand back anything — an error page, a base64 string of
 * prose, a zero-length file — and every one of those would sail through a
 * `mime.startsWith('image/')` check. Reading the actual header is the only
 * assertion worth making before spending an upload on it.
 */
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null
  for (const { type, bytes } of SIGNATURES) {
    if (bytes.every((b, i) => buffer[i] === b)) return type
  }
  // WebP is "RIFF????WEBP" — the size field sits between the two markers.
  const ascii = (start, end) => Array.from(buffer.subarray(start, end)).map((b) => String.fromCharCode(b)).join('')
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return null
}

/** Smallest size we will accept as a real 9:16 photograph rather than a stub. */
const MIN_IMAGE_BYTES = 10 * 1024

export function assertUsableImage(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new BackgroundError('The model returned no image data.', 'empty')
  }
  if (buffer.length < MIN_IMAGE_BYTES) {
    throw new BackgroundError(
      `The returned image is only ${buffer.length} bytes — too small to be a real background.`,
      'tiny'
    )
  }
  const type = detectImageType(buffer)
  if (!type) {
    throw new BackgroundError(
      'The returned bytes are not a PNG, JPEG, WebP or GIF image.',
      'shape'
    )
  }
  return type
}

/** The daily_backgrounds row. Mirrors toRow() in devotion.js. */
export function toBackgroundRow({
  date, storagePath, imageUrl, theme, prompt, model, width, height, bytes,
}) {
  assertValidDate(date)
  if (!storagePath) throw new BackgroundError('storagePath is required.', 'shape')
  if (!imageUrl) throw new BackgroundError('imageUrl is required.', 'shape')
  if (!theme) throw new BackgroundError('theme is required.', 'shape')
  return {
    date,
    storage_path: storagePath,
    image_url: imageUrl,
    theme,
    prompt: prompt ?? null,
    model: model ?? null,
    width: width ?? null,
    height: height ?? null,
    bytes: bytes ?? null,
  }
}
