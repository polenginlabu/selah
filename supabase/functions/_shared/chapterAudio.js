// Per-chapter read-aloud audio: the chapter as one text with verse marks, the
// split into upstream requests, its cache path, the provider order and the
// newline-delimited JSON reader. Shared by the bible-tts Edge Function and the
// browser so both see the exact same text. Pure JS (no Deno or Node APIs) so
// the node tests can import it directly.

// A long chapter (Psalm 119 is ~18k characters) fits; anything bigger is not a chapter.
export const MAX_CHAPTER_CHARS = 20_000
// Neighbour text sent with each request of a split chapter, for continuity.
export const CONTEXT_CHARS = 300

/**
 * The chapter as read: verses joined by single spaces, whitespace collapsed,
 * blank verses skipped. marks: [{ verse, at }], `at` being the character
 * offset in `text` where that verse starts (consecutive rows of one verse
 * share a mark). The same { text, marks } shape deviceVoice.speechSegments reads.
 */
export function assembleChapter(verses) {
  let text = ''
  const marks = []
  for (const row of verses ?? []) {
    const clean = String(row?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    if (text) text += ' '
    if (marks.at(-1)?.verse !== row.verse) marks.push({ verse: row.verse, at: text.length })
    text += clean
  }
  return { text, marks }
}

// Where to end a request that must stop by `limit`: a verse start in the
// second half of the window, else a sentence end, else a space, else a hard cut.
function breakPoint(text, start, limit, verseStarts) {
  for (let i = limit; i > start + (limit - start) / 2; i -= 1) {
    if (verseStarts.has(i + 1) && text[i] === ' ') return i
  }
  for (let i = limit; i > start; i -= 1) if (text[i] === ' ' && /[.!?;:]/.test(text[i - 1])) return i
  for (let i = limit; i > start; i -= 1) if (text[i] === ' ') return i
  return limit
}

/**
 * Splits the chapter into consecutive requests of at most maxChars, preferring
 * verse then sentence boundaries. Returns [{ offset, text, previous_text,
 * next_text }]: `offset` is where the part starts in `text`, and the
 * neighbour texts ('' at the ends) carry the surrounding words.
 */
export function planRequests(text, marks = [], maxChars = MAX_CHAPTER_CHARS, context = CONTEXT_CHARS) {
  const verseStarts = new Set(marks.map((m) => m.at))
  const spans = []
  let start = 0
  while (start < text.length) {
    const end = text.length - start <= maxChars ? text.length : breakPoint(text, start, start + maxChars, verseStarts)
    spans.push([start, end])
    start = end
    while (text[start] === ' ') start += 1
  }
  return spans.map(([s, e]) => ({
    offset: s,
    text: text.slice(s, e),
    previous_text: text.slice(Math.max(0, s - context), s).trim(),
    next_text: text.slice(e, e + context).trim(),
  }))
}

export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const SEGMENT = /^[A-Za-z0-9._-]+$/

/**
 * Storage path of one chapter's track in the bible-audio bucket. The hash
 * covers the text and `salt` (the style prompt or voice settings), so an
 * edited verse or a retuned style never replays old audio.
 */
export async function chapterObjectPath({ provider, model, voice, style, translation, book, chapter, text, salt = '', ext }) {
  const segments = [provider, model, voice, style, translation, book, String(chapter)]
  if (!segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..') || !SEGMENT.test(ext)) throw new Error('bad audio path')
  return `${segments.join('/')}/${await sha256Hex(`${salt}\n${text}`)}.${ext}`
}

/**
 * Providers to try, in order: ElevenLabs then Gemini for an ElevenLabs voice,
 * Gemini alone for a Gemini voice. Drops providers without a key and
 * ElevenLabs while it is out of credits (`exhausted` maps 'elevenlabs' to
 * an until time in ms). An empty list means the device voice.
 */
export function providerChain({ preferred, hasKey = {}, exhausted = new Map(), now = Date.now(), fallback = true }) {
  const order = preferred === 'elevenlabs' ? (fallback ? ['elevenlabs', 'gemini'] : ['elevenlabs']) : ['gemini']
  return order.filter((p) => hasKey[p] && !((exhausted.get(p) ?? 0) > now))
}

/** Non-blank lines of a byte stream (newline-delimited JSON), as strings. */
export async function* ndjsonLines(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let rest = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    rest += value
    const lines = rest.split('\n')
    rest = lines.pop()
    for (const line of lines) if (line.trim()) yield line
  }
  if (rest.trim()) yield rest
}
