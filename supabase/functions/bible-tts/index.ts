// Bible read-aloud — the server half.
//
// Turns one chunk of Scripture into speech with Gemini TTS and
// returns it as a WAV. Deployed as a Supabase Edge Function so the Gemini key
// never reaches the browser; every request carries the caller's Supabase JWT
// and is verified below, same boundary as bible-chat.
//
// The client sends the text because the chapter it is reading is not available
// server-side. That makes this a signed-in, rate-limited, length-capped TTS
// proxy restricted to the AUDIO_TRANSLATIONS, VOICES and STYLES allow-lists.
//
// Every generated chunk is stored in the private `bible-audio` bucket
// (supabase/migrations/20261012_bible_audio_cache.sql), keyed by model, voice,
// style, translation and a hash of the prompt, so each chunk is generated once
// for everyone. Cache hits cost no Gemini call and no rate-limit slot. Storage
// is best-effort: a failed read is a miss, a failed write is only logged.
//
// Secrets (never in the client):
//   supabase secrets set GEMINI_API_KEY=...
//   optional: GEMINI_TTS_MODEL, TTS_RATE_LIMIT
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AUDIO_TRANSLATIONS } from '../_shared/bible.js'
import { pcmToWav } from '../_shared/wav.js'
import { DEFAULT_STYLE, DEFAULT_VOICE, audioObjectPath, buildTtsPrompt, isStyle, isVoice } from '../_shared/ttsConfig.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const MODEL = Deno.env.get('GEMINI_TTS_MODEL') ?? 'gemini-2.5-flash-preview-tts'
const BUCKET = 'bible-audio'
// A DB read must never be able to uncap read-aloud, so this is a constant.
// The client prefetches a whole chapter in ~280-char chunks; cache hits do not count.
const RATE_LIMIT_PER_MINUTE = Number(Deno.env.get('TTS_RATE_LIMIT') ?? '60')
// Keep in sync with TTS_MAX_CHUNK_CHARS in src/lib/bibleTts.js.
const MAX_CHUNK_CHARS = 1200
// The body is read before the rate limit (so cache hits are free); cap it.
const MAX_BODY_BYTES = 16_384
// Under the Edge Function wall clock so we answer before the platform kills us.
const UPSTREAM_TIMEOUT_MS = 45_000

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After, X-Audio-Cache',
}

// Reflect the preflight's requested headers, as in bible-chat.
function corsHeaders(requestedHeaders: string | null): Record<string, string> {
  return {
    ...CORS,
    'Access-Control-Allow-Headers': requestedHeaders ?? 'authorization, content-type, x-client-info',
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })
}

// Upstream error bodies can carry key fragments. Strip anything that looks
// like a credential before logging, then cap the length. Never relayed.
function sanitizeUpstreamDetail(raw: string): string {
  return raw
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/\b(?:sk|sk-proj|op|opk)\s*[-_A-Za-z0-9]{12,}\b/gi, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, '[redacted]')
    .replace(/\.[A-Za-z0-9_-]{30,}\./g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

const unavailable = () => json({ error: 'Audio is unavailable right now. Try again shortly.' }, 502)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!GEMINI_API_KEY) {
    console.error('bible-tts: GEMINI_API_KEY not configured')
    return json({ error: 'Read-aloud is not configured yet.' }, 503)
  }

  // --- Auth: the real boundary ---------------------------------------------
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in to listen.' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return json({ error: 'Session expired — sign in again.' }, 401)

  // --- Validate (signed-in callers only, body size capped) ------------------
  let body: Record<string, unknown>
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return json({ error: 'Malformed request.' }, 413)
  }
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: 'Malformed request.' }, 413)
    body = JSON.parse(raw)
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }
  if (!body || typeof body !== 'object') return json({ error: 'Malformed request.' }, 400)

  const translation = body.translation
  if (typeof translation !== 'string' || !AUDIO_TRANSLATIONS.includes(translation)) {
    return json({ error: 'Audio is not available for this translation.' }, 400)
  }
  if (typeof body.text !== 'string') return json({ error: 'Nothing to read.' }, 400)
  const text = body.text.trim()
  if (!text) return json({ error: 'Nothing to read.' }, 400)
  if (text.length > MAX_CHUNK_CHARS) {
    return json({ error: `Keep each part under ${MAX_CHUNK_CHARS} characters.` }, 400)
  }
  // Missing means the default (older clients send neither); anything else must be on the list.
  const voice = body.voice ?? DEFAULT_VOICE
  if (!isVoice(voice)) return json({ error: 'That voice is not available.' }, 400)
  const style = body.style ?? DEFAULT_STYLE
  if (!isStyle(style)) return json({ error: 'That reading style is not available.' }, 400)

  // --- Shared audio cache --------------------------------------------------
  const path = await audioObjectPath({ model: MODEL, voice, style, translation, text })
  const bucket = admin.storage.from(BUCKET)
  try {
    const { data: cached, error } = await bucket.download(path)
    if (!error && cached && cached.size > 44) {
      return new Response(cached, {
        headers: { ...CORS, 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Audio-Cache': 'hit' },
      })
    }
  } catch (err) {
    console.error('bible-tts: cache read failed', sanitizeUpstreamDetail(String(err)))
  }

  // --- Rate limit (only generation costs a slot) ---------------------------
  const { data: allowed, error: limitError } = await admin.rpc('tts_rate_limit_hit', {
    p_user_id: user.id,
    p_max_per_minute: RATE_LIMIT_PER_MINUTE,
  })
  if (limitError) {
    // Fail closed. An unavailable limiter must not become an uncapped one.
    console.error('bible-tts: rate limit check failed', limitError)
    return json({ error: 'Please try again in a moment.' }, 503)
  }
  if (allowed === false) {
    return json(
      { error: 'Listening is paused for a minute — carry on shortly.', code: 'rate_limited', retryAfterSec: 60 },
      429,
      { 'Retry-After': '60' }
    )
  }

  // --- Gemini TTS ----------------------------------------------------------
  let upstream: Response
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildTtsPrompt(style, text) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }
    )
  } catch (err) {
    console.error('bible-tts: upstream request failed', sanitizeUpstreamDetail(String(err)))
    return json({ error: 'Audio is taking too long right now. Try again shortly.' }, 503)
  }

  if (upstream.status === 429) {
    console.error('bible-tts: upstream rate limited', sanitizeUpstreamDetail(await upstream.text().catch(() => '')))
    return json(
      { error: 'Read-aloud is busy right now. Try again in a minute.', code: 'rate_limited', retryAfterSec: 60 },
      429,
      { 'Retry-After': '60' }
    )
  }
  if (!upstream.ok) {
    console.error(`bible-tts: upstream ${upstream.status}`, sanitizeUpstreamDetail(await upstream.text().catch(() => '')))
    return unavailable()
  }

  let pcm: Uint8Array
  let sampleRate = 24000
  try {
    const payload = await upstream.json()
    const inline = payload?.candidates?.[0]?.content?.parts?.[0]?.inlineData
    if (typeof inline?.data !== 'string' || !inline.data) throw new Error('no audio in response')
    // mimeType is e.g. "audio/L16;codec=pcm;rate=24000"; honour the rate if given.
    const rate = Number(/rate=(\d+)/.exec(String(inline.mimeType ?? ''))?.[1])
    if (rate > 0) sampleRate = rate
    pcm = Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0))
  } catch (err) {
    console.error('bible-tts: unreadable upstream audio', sanitizeUpstreamDetail(String(err)))
    return unavailable()
  }

  const wav = pcmToWav(pcm, { sampleRate })
  // Store after responding when the runtime allows it. Two users generating the
  // same chunk at once both store it; the later upsert wins, same bytes either way.
  const store = bucket.upload(path, wav, { contentType: 'audio/wav', upsert: true })
    .then(({ error }) => { if (error) console.error('bible-tts: cache write failed', sanitizeUpstreamDetail(error.message)) })
    .catch((err) => console.error('bible-tts: cache write failed', sanitizeUpstreamDetail(String(err))))
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(store)
  else await store

  return new Response(wav, {
    headers: { ...CORS, 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Audio-Cache': 'miss' },
  })
})
