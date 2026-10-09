// Client half of Bible read-aloud. No secrets here, ever — this ships to the
// browser. The bible-tts Edge Function holds the ElevenLabs and Gemini keys
// and verifies the caller's Supabase JWT. One request reads a whole chapter.
import { BIBLE_BOOKS } from '../data/books.js'
import { BOOK_IDS } from '../../supabase/functions/_shared/bible.js'
import { DEFAULT_STYLE, DEFAULT_VOICE } from '../../supabase/functions/_shared/ttsConfig.js'

// Calm read-aloud is about 150 words a minute, roughly 14 characters a second:
// the chapter length shown until the real one is known.
export const CHARS_PER_SEC = 14

/** The canonical book id (JHN) the server expects for a reader book name (John). */
export const bookId = (name) => BOOK_IDS[BIBLE_BOOKS.findIndex((b) => b.name === name)] ?? null

/** The verse being read `fraction` (0..1) of the way through { text, marks }, weighted by characters. */
export function verseAt(doc, fraction) {
  if (!doc?.marks?.length) return null
  const pos = Math.max(0, Math.min(1, fraction || 0)) * doc.text.length
  let verse = doc.marks[0].verse
  for (const mark of doc.marks) if (mark.at <= pos) verse = mark.verse
  return verse
}

/** The verse being read at `t` seconds, from verse start times [{ verse, t }] in order. */
export function verseAtTime(marks, t) {
  if (!marks?.length) return null
  let verse = marks[0].verse
  for (const mark of marks) {
    if (mark.t > t) break
    verse = mark.verse
  }
  return verse
}

/** Verse start times from the X-TTS-Marks header ([[verse, seconds], ...]), or null. */
export function parseMarks(value) {
  try {
    const list = JSON.parse(value ?? 'null')
    if (!Array.isArray(list)) return null
    const marks = list.filter((m) => Array.isArray(m) && Number.isFinite(m[1])).map(([verse, t]) => ({ verse, t }))
    return marks.length ? marks : null
  } catch {
    return null
  }
}

/** Gemini is out for a long while (daily quota): use the device voice. */
export const isQuotaExhausted = (err) => err?.code === 'quota_exhausted'
/** ElevenLabs is out of credits and nothing else could read. */
export const isCreditsExhausted = (err) => err?.code === 'quota_exceeded'

function ttsError(message, status, retryAfterSec, code) {
  const err = new Error(message)
  err.status = status
  if (retryAfterSec) err.retryAfterSec = retryAfterSec
  if (code) err.code = code
  return err
}

/**
 * What a bible-tts reply carries: `format` is 'ndjson' (ElevenLabs, being
 * generated: read it with streamAudio.readTrack), 'mp3' or 'wav' (whole
 * file); `marks` are verse start times when known.
 */
export function trackOf(response) {
  const type = response.headers.get('Content-Type') ?? ''
  return {
    response,
    format: type.includes('ndjson') ? 'ndjson' : type.includes('mpeg') ? 'mp3' : 'wav',
    provider: response.headers.get('X-TTS-Provider'),
    fallback: response.headers.get('X-TTS-Fallback'),
    cache: response.headers.get('X-Audio-Cache'),
    marks: parseMarks(response.headers.get('X-TTS-Marks')),
  }
}

async function post(body, signal) {
  // Imported lazily so the pure helpers stay importable under node --test.
  const { supabase } = await import('./supabase')
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw ttsError('Sign in to listen', 401)

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bible-tts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  if (res.ok) return trackOf(res)

  const payload = await res.json().catch(() => ({}))
  const code = typeof payload?.code === 'string' ? payload.code : undefined
  // A daily limit can be hours away; a transient wait is capped at 5 minutes.
  const retryAfterSec = res.status === 429
    ? Math.min(code === 'quota_exhausted' || code === 'quota_exceeded' ? 86_400 : 300, Math.max(1, Number(payload?.retryAfterSec) || Number(res.headers.get('Retry-After')) || 60))
    : undefined
  throw ttsError(payload?.error ?? 'Audio is unavailable right now.', res.status, retryAfterSec, code)
}

/**
 * Requests a whole chapter's audio. Resolves to a track (trackOf) as soon as
 * the reply starts; throws an Error carrying `status`, and `code` and
 * `retryAfterSec` when the server gives them.
 */
export function requestChapter({ translation, book, chapter, verses, voice = DEFAULT_VOICE, style = DEFAULT_STYLE, signal }) {
  return post({
    action: 'chapter', translation, book: bookId(book), chapter, voice, style,
    verses: (verses ?? []).map(({ verse, text }) => ({ verse, text })),
  }, signal)
}

/** A voice's short fixed preview, as a track. */
export function requestPreview({ voice, style = DEFAULT_STYLE, signal }) {
  return post({ action: 'preview', voice, style }, signal)
}
