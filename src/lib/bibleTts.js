// Client half of Bible read-aloud. No secrets here, ever — this ships to the
// browser. The bible-tts Edge Function holds the Gemini key and verifies the
// caller's Supabase JWT.

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

function ttsError(message, status, retryAfterSec) {
  const err = new Error(message)
  err.status = status
  if (retryAfterSec) err.retryAfterSec = retryAfterSec
  return err
}

/** Fetches one chunk as a WAV Blob. Throws an Error carrying `status` (and `retryAfterSec` on 429). */
export async function fetchTtsChunk({ translation, text, signal }) {
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
    body: JSON.stringify({ translation, text }),
    signal,
  })
  if (res.ok) return res.blob()

  const payload = await res.json().catch(() => ({}))
  const retryAfterSec = res.status === 429
    ? Math.min(300, Math.max(1, Number(payload?.retryAfterSec) || Number(res.headers.get('Retry-After')) || 60))
    : undefined
  throw ttsError(payload?.error ?? 'Audio is unavailable right now.', res.status, retryAfterSec)
}
