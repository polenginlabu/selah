// Client half of Bible read-aloud. No secrets here, ever — this ships to the
// browser. The bible-tts Edge Function holds the Gemini key and verifies the
// caller's Supabase JWT.
import { DEFAULT_STYLE, DEFAULT_VOICE, buildTtsPrompt } from '../../supabase/functions/_shared/ttsConfig.js'

// Keep in sync with MAX_CHUNK_CHARS in supabase/functions/bible-tts/index.ts.
export const TTS_MAX_CHUNK_CHARS = 1200

/** Splits text that is too long on its own: sentences, then words, then hard slices. */
function splitLong(text, maxChars) {
  if (text.length <= maxChars) return [text]
  const sentences = text.split(/(?<=[.!?;:])\s+/)
  if (sentences.length > 1) return sentences.flatMap((s) => splitLong(s, maxChars))
  const words = text.split(/\s+/)
  if (words.length > 1) return words.flatMap((w) => splitLong(w, maxChars))
  const slices = []
  for (let i = 0; i < text.length; i += maxChars) slices.push(text.slice(i, i + maxChars))
  return slices
}

/**
 * Packs consecutive verses into chunks of at most maxChars, in order.
 * A verse is only split when it cannot fit in a chunk by itself.
 */
export function chunkVerses(verses, maxChars = TTS_MAX_CHUNK_CHARS) {
  const chunks = []
  let current = ''
  for (const { text } of verses ?? []) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    for (const part of splitLong(clean, maxChars)) {
      if (!current) current = part
      else if (current.length + 1 + part.length <= maxChars) current += ` ${part}`
      else {
        chunks.push(current)
        current = part
      }
    }
  }
  if (current) chunks.push(current)
  return chunks
}

// Small, roughly equal chunks: each takes a few seconds to synthesise, so the
// whole chapter can be fetched in parallel from the moment play is pressed and
// playback never outruns it. The first is smaller still so audio starts sooner.
export const TTS_FIRST_CHUNK_CHARS = 160
export const TTS_CHUNK_CHARS = 280
// Requests in flight at once while prefetching a chapter.
export const TTS_MAX_INFLIGHT = 5
// Calm read-aloud is about 150 words a minute, roughly 14 characters a second.
export const TTS_CHARS_PER_SEC = 14

/**
 * Plans a chapter as chunks that remember their verses. Returns
 * [{ text, marks: [{ verse, at }] }], where `at` is the character offset in
 * `text` where that verse (row.verse) starts. The first chunk is at most
 * firstMax characters and the rest at most maxChars; verses are only split
 * when they cannot fit a chunk by themselves.
 */
export function planChunks(verses, { firstMax = TTS_FIRST_CHUNK_CHARS, maxChars = TTS_CHUNK_CHARS } = {}) {
  const queue = []
  for (const row of verses ?? []) {
    const clean = String(row?.text ?? '').replace(/\s+/g, ' ').trim()
    if (clean) for (const text of splitLong(clean, maxChars)) queue.push({ text, verse: row.verse })
  }
  const chunks = []
  let current = null
  for (let i = 0; i < queue.length; i += 1) {
    const part = queue[i]
    const limit = chunks.length ? maxChars : Math.min(maxChars, firstMax)
    if (current && current.text.length + 1 + part.text.length <= limit) {
      if (current.marks.at(-1).verse !== part.verse) current.marks.push({ verse: part.verse, at: current.text.length + 1 })
      current.text += ` ${part.text}`
    } else if (current) {
      chunks.push(current)
      current = null
      i -= 1 // re-place this part under the next chunk's limit
    } else if (part.text.length > limit) {
      queue.splice(i, 1, ...splitLong(part.text, limit).map((text) => ({ text, verse: part.verse })))
      i -= 1
    } else {
      current = { text: part.text, marks: [{ verse: part.verse, at: 0 }] }
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/** FNV-1a, synchronous so cache lookups need no await. */
function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Cache key for one chunk's audio. Hashing the full prompt (style instruction
 * + text) means a re-chunked chapter or a reworded style never replays stale
 * audio. The server model is not known here; its own cache keys include it.
 */
export function chunkKey({ translation, book, chapter, text, voice = DEFAULT_VOICE, style = DEFAULT_STYLE }) {
  return `${voice}/${style}/${translation}/${book}/${chapter}/${text.length}-${hash(buildTtsPrompt(style, text))}`
}

/**
 * Which chunk indices to start fetching now: the whole chapter in playback
 * order from the cursor to the end, then the chunks before it, skipping ready
 * and in-flight ones, never more than `maxInflight` at once, and nothing
 * during a rate-limit cooldown.
 */
export function nextToFetch({ total, cursor, ready, inflight, maxInflight = TTS_MAX_INFLIGHT, cooldownUntil = 0, now = Date.now() }) {
  if (now < cooldownUntil) return []
  const start = []
  const from = Math.min(Math.max(0, cursor), Math.max(0, total - 1))
  for (let n = 0; n < total; n += 1) {
    if (inflight.size + start.length >= maxInflight) break
    const i = (from + n) % total
    if (!ready.has(i) && !inflight.has(i)) start.push(i)
  }
  return start
}

/** Seconds of audio in a 16-bit mono PCM WAV of `bytes` bytes (44-byte header). */
export function wavDurationSec(bytes, sampleRate = 24000) {
  return Math.max(0, bytes - 44) / (sampleRate * 2)
}

/** Chapter timeline: start second of each chunk and the total, using known durations where we have them. */
export function timeline(plan, durations = []) {
  const starts = []
  let total = 0
  plan.forEach((chunk, i) => {
    starts.push(total)
    total += durations[i] ?? chunk.text.length / TTS_CHARS_PER_SEC
  })
  return { starts, total }
}

/** Chunk index and seconds into it for a chapter-level time. */
export function locateTime(plan, durations, t) {
  const { starts } = timeline(plan, durations)
  let index = 0
  while (index + 1 < starts.length && starts[index + 1] <= t) index += 1
  return { index, offset: Math.max(0, t - (starts[index] ?? 0)) }
}

/** The verse being read `fraction` (0..1) of the way through a chunk, weighted by characters. */
export function verseAt(chunk, fraction) {
  if (!chunk) return null
  const pos = Math.max(0, Math.min(1, fraction || 0)) * chunk.text.length
  let verse = chunk.marks[0]?.verse ?? null
  for (const mark of chunk.marks) if (mark.at <= pos) verse = mark.verse
  return verse
}

/** Where a verse starts: { index, fraction } of the first chunk that reads it, or null. */
export function verseStart(plan, verse) {
  for (let index = 0; index < plan.length; index += 1) {
    const mark = plan[index].marks.find((m) => m.verse === verse)
    if (mark) return { index, fraction: mark.at / plan[index].text.length }
  }
  return null
}

/** Every verse the plan reads, in order, once each. */
export function planVerses(plan) {
  return [...new Set(plan.flatMap((chunk) => chunk.marks.map((m) => m.verse)))]
}

function ttsError(message, status, retryAfterSec) {
  const err = new Error(message)
  err.status = status
  if (retryAfterSec) err.retryAfterSec = retryAfterSec
  return err
}

/**
 * Fetches one chunk as a WAV Blob. Throws an Error carrying `status` (and
 * `retryAfterSec` on 429); a transient 502/503 is retried once.
 */
export async function fetchTtsChunk(args) {
  try {
    return await requestTtsChunk(args)
  } catch (err) {
    if (err?.status !== 502 && err?.status !== 503) throw err
    await new Promise((resolve) => setTimeout(resolve, 800))
    if (args.signal?.aborted) throw err
    return requestTtsChunk(args)
  }
}

async function requestTtsChunk({ translation, text, voice = DEFAULT_VOICE, style = DEFAULT_STYLE, signal }) {
  // Imported lazily so chunkVerses stays importable under node --test.
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
    body: JSON.stringify({ translation, text, voice, style }),
    signal,
  })
  if (res.ok) return res.blob()

  const payload = await res.json().catch(() => ({}))
  const retryAfterSec = res.status === 429
    ? Math.min(300, Math.max(1, Number(payload?.retryAfterSec) || Number(res.headers.get('Retry-After')) || 60))
    : undefined
  throw ttsError(payload?.error ?? 'Audio is unavailable right now.', res.status, retryAfterSec)
}
