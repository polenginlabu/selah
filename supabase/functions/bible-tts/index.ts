// Bible read-aloud — the server half.
//
// Turns one chunk of Scripture into speech with Gemini TTS and
// returns it as a WAV. Free-tier TTS quotas are per model and tiny, so it
// walks a chain of models (../_shared/ttsModels.js): a model that answers 429 /
// RESOURCE_EXHAUSTED is recorded in public.tts_model_exhaustion until its
// quota resets and the next model is tried in the same request. When every
// TTS model is out, a Gemini Live model reads the text (./live.ts) and the
// audio is kept only if its transcript matches the text word for word
// (../_shared/verbatim.js). When nothing is left the reply is 429 with code
// `quota_exhausted` and the client switches to the device voice. Deployed as a Supabase Edge Function so the Gemini key
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
// for everyone. A lookup checks every model's path, so audio is reused
// whichever model made it. Cache hits cost no Gemini call and no rate-limit
// slot. Storage is best-effort: a failed read is a miss, a failed write is
// only logged. Every audio reply names its model in X-TTS-Model.
//
// Secrets (never in the client):
//   supabase secrets set GEMINI_API_KEY=...
//   optional: GEMINI_TTS_MODELS (comma-separated chain; GEMINI_TTS_MODEL, a
//   single model, is still honoured when it is unset), GEMINI_LIVE_MODEL
//   ("off" disables the Live fallback), TTS_RATE_LIMIT
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AUDIO_TRANSLATIONS } from '../_shared/bible.js'
import { pcmToWav } from '../_shared/wav.js'
import { DEFAULT_STYLE, DEFAULT_VOICE, STYLES, audioObjectPath, buildTtsPrompt, isStyle, isVoice } from '../_shared/ttsConfig.js'
import {
  DEFAULT_LIVE_MODEL, DEFAULT_TTS_MODELS, exhaustionUntil, isQuotaError, isUnknownModel, liveCacheModel,
  parseModelList, pickModels, quotaReply,
} from '../_shared/ttsModels.js'
import { VERBATIM_THRESHOLD, wordSimilarity } from '../_shared/verbatim.js'
import { LiveError, liveSpeak } from './live.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const TTS_MODELS: string[] = parseModelList(Deno.env.get('GEMINI_TTS_MODELS') || Deno.env.get('GEMINI_TTS_MODEL'))
const LIVE_SETTING = (Deno.env.get('GEMINI_LIVE_MODEL') ?? '').trim()
const LIVE_MODEL: string | null = LIVE_SETTING.toLowerCase() === 'off' ? null : LIVE_SETTING || DEFAULT_LIVE_MODEL
const LIVE_KEY: string | null = LIVE_MODEL ? liveCacheModel(LIVE_MODEL) : null
// Cache lookup order: the chain, then the defaults (audio made before the
// chain was changed), then verified Live audio.
const CACHE_MODELS: string[] = [...new Set([...TTS_MODELS, ...DEFAULT_TTS_MODELS, ...(LIVE_KEY ? [LIVE_KEY] : [])])]
const BUCKET = 'bible-audio'
// A DB read must never be able to uncap read-aloud, so this is a constant.
// The client prefetches a whole chapter in ~280-char chunks; cache hits do not count.
const RATE_LIMIT_PER_MINUTE = Number(Deno.env.get('TTS_RATE_LIMIT') ?? '60')
// Keep in sync with TTS_MAX_CHUNK_CHARS in src/lib/bibleTts.js.
const MAX_CHUNK_CHARS = 1200
// The body is read before the rate limit (so cache hits are free); cap it.
const MAX_BODY_BYTES = 16_384
// Under the Edge Function wall clock so we answer before the platform kills us.
// One budget for the whole chain, not per model.
const UPSTREAM_TIMEOUT_MS = 45_000
// Not worth opening a Live session with less time than this left.
const LIVE_MIN_MS = 8_000

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After, X-Audio-Cache, X-TTS-Model',
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

const audioReply = (wav: Blob | Uint8Array, model: string, cache: 'hit' | 'miss') =>
  new Response(wav, {
    headers: { ...CORS, 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Audio-Cache': cache, 'X-TTS-Model': model },
  })

// Models still out of quota. Fails open: a missing table or failed read means
// "try them all", which costs at most one wasted call per model.
async function loadExhausted(admin: SupabaseClient): Promise<Map<string, number>> {
  try {
    const { data, error } = await admin
      .from('tts_model_exhaustion')
      .select('model, exhausted_until')
      .gt('exhausted_until', new Date().toISOString())
    if (error) throw error
    return new Map((data ?? []).map((row: { model: string; exhausted_until: string }) => [row.model, Date.parse(row.exhausted_until)]))
  } catch (err) {
    console.error('bible-tts: exhaustion read failed', sanitizeUpstreamDetail(String((err as Error)?.message ?? err)))
    return new Map()
  }
}

async function markExhausted(admin: SupabaseClient, model: string, until: number) {
  const { error } = await admin.rpc('tts_model_exhausted', { p_model: model, p_until: new Date(until).toISOString() })
  if (error) console.error('bible-tts: exhaustion write failed', sanitizeUpstreamDetail(error.message))
}

type Attempt =
  | { pcm: Uint8Array; sampleRate: number }
  | { quotaUntil: number }
  | { skip: true }
  | { failed: 'timeout' | 'error' }

// One Gemini TTS call, classified so the caller can move down the chain.
async function ttsAttempt(model: string, voice: string, style: string, text: string, deadline: number): Promise<Attempt> {
  let upstream: Response
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
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
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      }
    )
  } catch (err) {
    console.error(`bible-tts: ${model} request failed`, sanitizeUpstreamDetail(String(err)))
    return { failed: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'error' }
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
    if (isUnknownModel(upstream.status, detail)) {
      console.warn(`bible-tts: ${model} is not available (${upstream.status}); skipped. Check GEMINI_TTS_MODELS.`)
      return { skip: true }
    }
    if (isQuotaError(upstream.status, detail)) {
      console.warn(`bible-tts: ${model} out of quota`, sanitizeUpstreamDetail(detail))
      return { quotaUntil: exhaustionUntil({ body: detail, now: Date.now() }) }
    }
    console.error(`bible-tts: ${model} upstream ${upstream.status}`, sanitizeUpstreamDetail(detail))
    return { failed: 'error' }
  }

  try {
    const payload = await upstream.json()
    const inline = payload?.candidates?.[0]?.content?.parts?.[0]?.inlineData
    if (typeof inline?.data !== 'string' || !inline.data) throw new Error('no audio in response')
    // mimeType is e.g. "audio/L16;codec=pcm;rate=24000"; honour the rate if given.
    const rate = Number(/rate=(\d+)/.exec(String(inline.mimeType ?? ''))?.[1])
    return { pcm: Uint8Array.from(atob(inline.data), (c) => c.charCodeAt(0)), sampleRate: rate > 0 ? rate : 24000 }
  } catch (err) {
    console.error(`bible-tts: ${model} unreadable upstream audio`, sanitizeUpstreamDetail(String(err)))
    return { failed: 'error' }
  }
}

function liveInstruction(style: string): string {
  const styleText = STYLES.find((s: { id: string }) => s.id === style)?.instruction ?? ''
  return `You are a text-to-speech reader, not an assistant. ${styleText} Read the user's message aloud exactly as written, word for word, and say nothing else: no greeting, no introduction, no comment and no reply. Do not add, skip, repeat or change any words.`
}

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

  // --- Shared audio cache (any model) --------------------------------------
  const pathFor = (model: string) => audioObjectPath({ model, voice, style, translation, text })
  const bucket = admin.storage.from(BUCKET)
  // ponytail: one download per candidate model in parallel; a chunk cached
  // under several models downloads each copy. Fine for 4-6 models.
  const cachedBlobs = await Promise.all(CACHE_MODELS.map(async (model) => {
    try {
      const { data, error } = await bucket.download(await pathFor(model))
      return !error && data && data.size > 44 ? data : null
    } catch (err) {
      console.error('bible-tts: cache read failed', sanitizeUpstreamDetail(String(err)))
      return null
    }
  }))
  const hitAt = cachedBlobs.findIndex(Boolean)
  if (hitAt >= 0) return audioReply(cachedBlobs[hitAt] as Blob, CACHE_MODELS[hitAt], 'hit')

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

  // --- Gemini TTS, down the model chain ------------------------------------
  const deadline = Date.now() + UPSTREAM_TIMEOUT_MS
  const exhausted = await loadExhausted(admin)
  const usable = pickModels(TTS_MODELS, exhausted, Date.now())
  // Reset times of every model that is out of quota, skipped or just hit.
  const untils: number[] = TTS_MODELS.filter((m) => !usable.includes(m)).map((m) => exhausted.get(m) as number)
  let timedOut = false
  let otherFailure = false
  let made: { pcm: Uint8Array; sampleRate: number; model: string } | null = null

  for (const model of usable) {
    if (deadline - Date.now() < 1_000) {
      timedOut = true
      break
    }
    const attempt = await ttsAttempt(model, voice, style, text, deadline)
    if ('pcm' in attempt) {
      made = { ...attempt, model }
      break
    }
    if ('quotaUntil' in attempt) {
      untils.push(attempt.quotaUntil)
      await markExhausted(admin, model, attempt.quotaUntil)
    } else if ('failed' in attempt) {
      otherFailure = true
      if (attempt.failed === 'timeout') {
        timedOut = true
        break
      }
    }
  }

  // --- Live API, last resort -----------------------------------------------
  if (!made && LIVE_MODEL && LIVE_KEY && !timedOut) {
    const liveUntil = exhausted.get(LIVE_KEY) ?? 0
    if (liveUntil > Date.now()) untils.push(liveUntil)
    else if (deadline - Date.now() >= LIVE_MIN_MS) {
      try {
        const live = await liveSpeak({
          apiKey: GEMINI_API_KEY, model: LIVE_MODEL, voice, instruction: liveInstruction(style), text,
          signal: AbortSignal.timeout(deadline - Date.now()),
        })
        const similarity = wordSimilarity(live.transcript, text)
        if (similarity >= VERBATIM_THRESHOLD) made = { pcm: live.pcm, sampleRate: live.sampleRate, model: LIVE_KEY }
        else console.warn(`bible-tts: Live reading rejected, similarity ${similarity.toFixed(3)}`)
      } catch (err) {
        const detail = sanitizeUpstreamDetail(String((err as Error)?.message ?? err))
        if (err instanceof LiveError && err.quota) {
          const until = exhaustionUntil({ body: detail, now: Date.now() })
          untils.push(until)
          await markExhausted(admin, LIVE_KEY, until)
        }
        console.error('bible-tts: Live fallback failed', detail)
      }
    }
  }

  if (!made) {
    // Every TTS model out of quota: say how long, so the client can switch to
    // the device voice for a long wait or retry a short one. A failed Live
    // attempt does not change that answer.
    if (untils.length && !otherFailure) {
      const { code, retryAfterSec } = quotaReply(untils, Date.now())
      return json(
        code === 'quota_exhausted'
          ? { error: 'The AI voice has reached its daily limit.', code, retryAfterSec }
          : { error: 'Read-aloud is busy right now. Try again shortly.', code, retryAfterSec },
        429,
        { 'Retry-After': String(retryAfterSec) }
      )
    }
    if (timedOut) return json({ error: 'Audio is taking too long right now. Try again shortly.' }, 503)
    console.error('bible-tts: no model produced audio')
    return unavailable()
  }

  const path = await pathFor(made.model)
  const wav = pcmToWav(made.pcm, { sampleRate: made.sampleRate })
  // Store after responding when the runtime allows it. Two users generating the
  // same chunk at once both store it; the later upsert wins, same bytes either way.
  const store = bucket.upload(path, wav, { contentType: 'audio/wav', upsert: true })
    .then(({ error }) => { if (error) console.error('bible-tts: cache write failed', sanitizeUpstreamDetail(error.message)) })
    .catch((err) => console.error('bible-tts: cache write failed', sanitizeUpstreamDetail(String(err))))
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(store)
  else await store

  return audioReply(wav, made.model, 'miss')
})
