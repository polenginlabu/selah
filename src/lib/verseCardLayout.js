// Typesetting maths for the shareable verse card.
//
// Split out from the canvas drawing so it can be tested without a DOM: every
// function here takes a `measure(text, fontSize) => width` callback instead of
// touching a CanvasRenderingContext. The component passes the real
// ctx.measureText; the tests pass a predictable stub.
//
// The card is always rendered at a fixed 1080x1920 and scaled down for
// display, so these numbers are absolute device pixels rather than anything
// responsive. That is what makes the preview and the exported PNG identical:
// there is only one layout, computed once.

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1920

// Generous side margins — the verse should sit in a calm column, not run edge
// to edge like a social media caption.
export const MARGIN_X = 120
export const CONTENT_WIDTH = CARD_WIDTH - MARGIN_X * 2

// The verse shrinks to fit rather than overflowing or being truncated: a long
// passage is still Scripture and must be readable in full.
const MAX_VERSE_SIZE = 76
const MIN_VERSE_SIZE = 34
const LINE_HEIGHT_RATIO = 1.42

// Below this the card stops being a quiet image and becomes a wall of text.
// Past it we stop shrinking and let the card grow taller instead.
const MAX_VERSE_LINES = 14

/**
 * Greedy word wrap. Returns the lines a string breaks into at `fontSize`.
 *
 * A single word longer than the column (a very long transliteration, or a
 * pasted URL) is left on its own overflowing line rather than hyphenated —
 * breaking a word mid-Scripture reads worse than one wide line, and the
 * shrink-to-fit loop usually resolves it anyway.
 */
export function wrapText(text, fontSize, measure, maxWidth = CONTENT_WIDTH) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []

  const lines = []
  let line = words[0]
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`
    if (measure(candidate, fontSize) <= maxWidth) line = candidate
    else { lines.push(line); line = word }
  }
  lines.push(line)
  return lines
}

/**
 * Largest verse size that fits in MAX_VERSE_LINES, and the lines it produces.
 *
 * Steps down in 2px increments rather than solving analytically because text
 * width is not linear in font size once kerning and hinting are involved —
 * measuring is the only honest answer, and fifteen measurements is nothing.
 */
export function fitVerse(text, measure) {
  let lines = []
  for (let size = MAX_VERSE_SIZE; size >= MIN_VERSE_SIZE; size -= 2) {
    lines = wrapText(text, size, measure)
    if (lines.length <= MAX_VERSE_LINES) {
      return { fontSize: size, lines, lineHeight: Math.round(size * LINE_HEIGHT_RATIO) }
    }
  }
  // Longer than even the minimum size can hold in 14 lines. Keep the minimum
  // and let the block run tall; the card is scrollable in preview and the
  // export simply grows, which is better than cutting a verse off.
  return {
    fontSize: MIN_VERSE_SIZE,
    lines,
    lineHeight: Math.round(MIN_VERSE_SIZE * LINE_HEIGHT_RATIO),
  }
}

/**
 * Vertical placement of the whole composition.
 *
 * The verse block is centred on the card's optical centre (slightly above the
 * true centre, because the reference and wordmark sit below it and the eye
 * reads a block as low when it is mathematically centred).
 */
export function layoutCard({ verse, reference, translation }, measure) {
  const fitted = fitVerse(verse, measure)
  const verseHeight = fitted.lines.length * fitted.lineHeight

  const referenceSize = 40
  const brandSize = 34
  const gapAfterVerse = 64
  const gapBeforeBrand = 56

  const hasTranslation = Boolean(translation)
  const referenceBlock = referenceSize + (hasTranslation ? referenceSize * 0.9 : 0)
  const totalHeight = verseHeight + gapAfterVerse + referenceBlock + gapBeforeBrand + brandSize

  // 0.46 rather than 0.5 — see above.
  const top = Math.max(MARGIN_X, CARD_HEIGHT * 0.46 - totalHeight / 2)

  let y = top + fitted.fontSize
  const verseLines = fitted.lines.map((text, i) => ({
    text,
    x: MARGIN_X,
    y: y + i * fitted.lineHeight,
  }))
  y += (fitted.lines.length - 1) * fitted.lineHeight + gapAfterVerse

  const referenceY = y + referenceSize
  const translationY = hasTranslation ? referenceY + referenceSize * 0.9 : null
  const brandY = (translationY ?? referenceY) + gapBeforeBrand + brandSize

  return {
    verse: { fontSize: fitted.fontSize, lineHeight: fitted.lineHeight, lines: verseLines },
    reference: { text: reference, fontSize: referenceSize, x: MARGIN_X, y: referenceY },
    translation: hasTranslation
      ? { text: translation, fontSize: Math.round(referenceSize * 0.62), x: MARGIN_X, y: translationY }
      : null,
    brand: { fontSize: brandSize, x: MARGIN_X, y: brandY },
    // Where the darkening scrim must reach to keep every glyph legible. Padded
    // past the text so the gradient fades out beyond it rather than ending on
    // a hard edge at the last baseline.
    contentBottom: Math.min(CARD_HEIGHT, brandY + 120),
    contentTop: Math.max(0, top - 140),
  }
}

/**
 * Curly quotes around the verse, straight ones left alone inside it.
 *
 * Typographic quotes are the single cheapest thing that makes a card look
 * designed rather than generated, and Bible API text arrives unquoted.
 */
export function quoteVerse(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return ''
  return `“${trimmed}”`
}
