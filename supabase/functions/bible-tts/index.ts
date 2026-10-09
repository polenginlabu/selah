// Bible read-aloud — the server half.
//
// Reads one whole chapter as one continuous audio track. The client sends the
// chapter's verses once; the text is assembled here (../_shared/chapterAudio.js)
// exactly as the browser assembles it for highlighting.
//
// Providers, in order (providerChain):
//   1. ElevenLabs (default for ElevenLabs voices): the stream/with-timestamps
//      endpoint is relayed to the browser as newline-delimited JSON
//      ({ a: base64 MP3 } and { m: [[verse, seconds]] } lines, then
//      { done, d }), so playback starts within a second or two and verses are
//      highlighted from real character timestamps. A chapter over the model's
//      per-request limit is read as consecutive requests with
//      previous_text/next_text, one stream. Out of credits (quota_exceeded)
//      is recorded in public.tts_model_exhaustion for an hour.
//   2. Gemini TTS (Gemini voices, and the fallback for ElevenLabs ones): the
//      chapter in one call, or a few large parts one after another, each walking the model chain
//      (../_shared/ttsModels.js), joined into one WAV.
//   3. Nothing left: an error code, and the client reads with the device voice.
// Falling back only happens before the first byte; X-TTS-Provider and
// X-TTS-Fallback say what happened.
//
// Deployed as a Supabase Edge Function so the keys never reach the browser;
// every request carries the caller's Supabase JWT and is verified below.
// Signed-in, rate-limited (generation only), length-capped, and restricted to
// the AUDIO_TRANSLATIONS, BOOK_IDS, VOICES and STYLES allow-lists.
//
// Every finished track is stored in the private `bible-audio` bucket
// (migrations 20261012, 20261014) keyed by provider, model, voice, style,
// translation, book, chapter and a hash of the text, so each chapter is
// generated once for everyone. Hits are returned whole (X-Audio-Cache: hit,
// verse times in X-TTS-Marks) and cost no upstream call and no rate-limit
// slot. A stream that fails part-way is never stored. Storage is best-effort:
// a failed read is a miss, a failed write is only logged.
//
// Secrets (never in the client):
//   supabase secrets set ELEVENLABS_API_KEY=... GEMINI_API_KEY=...
//   optional: ELEVENLABS_MODEL (eleven_flash_v2_5 | eleven_turbo_v2_5 |
//   eleven_multilingual_v2), ELEVENLABS_VOICE_IDS ("George=<id>,..."),
//   GEMINI_TTS_MODELS (comma-separated chain; GEMINI_TTS_MODEL, a single
//   model, is honoured when it is unset), TTS_RATE_LIMIT
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AUDIO_TRANSLATIONS, BOOK_IDS, validChapter } from '../_shared/bible.js'
import { pcmToWav } from '../_shared/wav.js'
import {
  DEFAULT_STYLE, DEFAULT_VOICE, PREVIEW_TEXT, VOICES, buildTtsPrompt, geminiVoiceFor, isStyle, isVoice, voiceInfo, voiceProvider,
} from '../_shared/ttsConfig.js'
import { exhaustionUntil, isQuotaError, isUnknownModel, parseModelList, pickModels, quotaReply } from '../_shared/ttsModels.js'
import { MAX_CHAPTER_CHARS, assembleChapter, chapterObjectPath, ndjsonLines, planRequests, providerChain } from '../_shared/chapterAudio.js'
import {
  ELEVENLABS_EXHAUSTION_MS, ELEVENLABS_KEY, MP3_BYTES_PER_SEC, OUTPUT_FORMAT, classifyElevenLabs, createVerseTimer,
  elevenLabsModel, parseVoiceIds, voiceSettings,
} from '../_shared/elevenlabs.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY') ?? ''
const EL_MODEL = elevenLabsModel(Deno.env.get('ELEVENLABS_MODEL'))
const EL_VOICE_IDS = parseVoiceIds(Deno.env.get('ELEVENLABS_VOICE_IDS'), VOICES.filter((v) => v.provider === 'elevenlabs').map((v) => v.id))
const TTS_MODELS: string[] = parseModelList(Deno.env.get('GEMINI_TTS_MODELS') || Deno.env.get('GEMINI_TTS_MODEL'))
const BUCKET = 'bible-audio'
// A DB read must never be able to uncap read-aloud, so this is a constant.
// One generated chapter (or preview) is one slot; cache hits do not count.
// A slot can be up to MAX_CHAPTER_CHARS of paid generation, so keep it low.
const RATE_LIMIT_PER_MINUTE = Number(Deno.env.get('TTS_RATE_LIMIT') ?? '6')
// The body (a chapter's verses) is read before the rate limit so cache hits are free; cap it.
const MAX_BODY_BYTES = 65_536
const MAX_VERSES = 200
// Gemini parts are generated one after another; each fits one generateContent
// call (about 6-7 minutes of audio, under the model's output cap). Most
// chapters are a single part.
const GEMINI_PART_CHARS = 6_000
// Under the Edge Function wall clock (150 s on the free plan) so we answer
// before the platform kills us.
const GEMINI_TIMEOUT_MS = 140_000
// ponytail: one timeout per ElevenLabs request covers first byte and the whole
// stream; split it into first-byte and idle timeouts if slow starts show up.
const EL_TIMEOUT_MS = 140_000

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After, X-Audio-Cache, X-TTS-Model, X-TTS-Provider, X-TTS-Fallback, X-TTS-Marks',
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
    .replace(/xi-api-key["'\s:=]+[^\s"',}]+/gi, 'xi-api-key [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, '[redacted]')
    .replace(/\.[A-Za-z0-9_-]{30,}\./g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

// deno-lint-ignore no-explicit-any
const runtime = (globalThis as any).EdgeRuntime
/** Keeps work running after the response, when the runtime allows it. */
async function background(work: Promise<unknown>) {
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(work)
  else await work
}

type Provider = 'elevenlabs' | 'gemini'
type Track = { provider: Provider; model: string; voice: string; ext: 'mp3' | 'wav'; type: string; salt: string }
type Job = { text: string; marks: { verse: number; at: number }[]; style: string; translation: string; book: string; chapter: number }
type Failure = { code: string; retryAfterSec?: number }
type Outcome = { response: Response } | { failure: Failure }
type Mark = { verse: number; t: number }

const elevenLabsVoiceId = (voice: string): string => EL_VOICE_IDS.get(voice) ?? voiceInfo(voice)?.voiceId ?? voice

// The ElevenLabs salt carries the resolved voice id, so correcting an id in
// ELEVENLABS_VOICE_IDS stops replaying audio cached under the old one.
function trackFor(provider: Provider, voice: string, style: string): Track {
  if (provider === 'elevenlabs') {
    return { provider, model: EL_MODEL.id, voice, ext: 'mp3', type: 'audio/mpeg', salt: JSON.stringify({ id: elevenLabsVoiceId(voice), ...voiceSettings(style) }) }
  }
  return { provider, model: 'gemini', voice: geminiVoiceFor(voice), ext: 'wav', type: 'audio/wav', salt: buildTtsPrompt(style, '') }
}

const objectPath = (track: Track, job: Job) => chapterObjectPath({
  provider: track.provider, model: track.model, voice: track.voice, style: job.style, translation: job.translation,
  book: job.book, chapter: job.chapter, text: job.text, salt: track.salt, ext: track.ext,
})
const marksPath = (path: string) => path.replace(/\.mp3$/, '.json')

function trackHeaders(track: Track, cache: 'hit' | 'miss', fallback: string | null, extra: Record<string, string> = {}) {
  return {
    ...CORS, 'Cache-Control': 'no-store', 'X-Audio-Cache': cache, 'X-TTS-Provider': track.provider, 'X-TTS-Model': track.model,
    ...(fallback ? { 'X-TTS-Fallback': fallback } : {}), ...extra,
  }
}

// Models (and ElevenLabs) still out of quota. Fails open: a missing table or
// failed read means "try them all", which costs at most one wasted call each.
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

// --- Cache -------------------------------------------------------------------

async function download(admin: SupabaseClient, path: string): Promise<Blob | null> {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(path)
    return !error && data && data.size > 44 ? data : null
  } catch (err) {
    console.error('bible-tts: cache read failed', sanitizeUpstreamDetail(String(err)))
    return null
  }
}

async function upload(admin: SupabaseClient, path: string, body: Blob | Uint8Array | string, contentType: string) {
  try {
    const { error } = await admin.storage.from(BUCKET).upload(path, body, { contentType, upsert: true })
    if (error) console.error('bible-tts: cache write failed', sanitizeUpstreamDetail(error.message))
  } catch (err) {
    console.error('bible-tts: cache write failed', sanitizeUpstreamDetail(String(err)))
  }
}

async function cachedReply(admin: SupabaseClient, track: Track, path: string, fallback: string | null): Promise<Response | null> {
  const [audio, marks] = await Promise.all([
    download(admin, path),
    track.ext === 'mp3' ? download(admin, marksPath(path)).then((b) => b?.text()).catch(() => null) : null,
  ])
  if (!audio) return null
  const extra: Record<string, string> = {}
  try {
    const list = JSON.parse(marks ?? 'null')?.marks
    if (Array.isArray(list)) extra['X-TTS-Marks'] = JSON.stringify(list.map((m: Mark) => [m.verse, m.t]))
  } catch { /* highlight falls back to an estimate */ }
  return new Response(audio, { headers: trackHeaders(track, 'hit', fallback, { 'Content-Type': track.type, ...extra }) })
}

// --- ElevenLabs --------------------------------------------------------------

class UpstreamError extends Error {
  constructor(readonly code: string, readonly status: number, detail: string) {
    super(detail)
  }
}

type ElevenLabsLine = { part: number; audio: string; alignment: unknown }

/** Every line of every request of the chapter, in order. Throws UpstreamError on a failed request. */
async function* elevenLabsLines(voiceId: string, style: string, parts: ReturnType<typeof planRequests>): AsyncGenerator<ElevenLabsLine> {
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream/with-timestamps?output_format=${OUTPUT_FORMAT}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_API_KEY },
        body: JSON.stringify({
          text: part.text,
          model_id: EL_MODEL.id,
          voice_settings: voiceSettings(style),
          ...(part.previous_text ? { previous_text: part.previous_text } : {}),
          ...(part.next_text ? { next_text: part.next_text } : {}),
        }),
        signal: AbortSignal.timeout(EL_TIMEOUT_MS),
      }
    )
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '')
      throw new UpstreamError(classifyElevenLabs(res.status, detail), res.status, detail)
    }
    for await (const line of ndjsonLines(res.body)) {
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      yield { part: i, audio: typeof msg?.audio_base64 === 'string' ? msg.audio_base64 : '', alignment: msg?.alignment ?? null }
    }
  }
}

function failureOf(err: unknown): Failure {
  if (err instanceof UpstreamError) return { code: err.code === 'voice' ? 'error' : err.code }
  return { code: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'error' }
}

const decodeBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function elevenLabs(admin: SupabaseClient, job: Job, track: Track, path: string, fallback: string | null): Promise<Outcome> {
  const parts = planRequests(job.text, job.marks, EL_MODEL.maxChars)
  const voiceId = elevenLabsVoiceId(track.voice)
  const lines = elevenLabsLines(voiceId, job.style, parts)
  const report = async (err: unknown) => {
    const failure = failureOf(err)
    const detail = sanitizeUpstreamDetail(String((err as Error)?.message ?? err))
    if (failure.code === 'quota_exceeded') await markExhausted(admin, ELEVENLABS_KEY, Date.now() + ELEVENLABS_EXHAUSTION_MS)
    if (failure.code === 'bad_key') console.error('bible-tts: ElevenLabs rejected the API key; check ELEVENLABS_API_KEY', detail)
    else console.error(`bible-tts: ElevenLabs ${failure.code}`, detail)
    return failure
  }

  // Read up to the first audio so a failure before any byte can fall back.
  // Lines before it are kept: their alignment still counts toward verse times.
  const head: ElevenLabsLine[] = []
  try {
    for (;;) {
      const next = await lines.next()
      if (next.done) return { failure: await report(new Error('no audio in response')) }
      head.push(next.value)
      if (next.value.audio) break
    }
  } catch (err) {
    return { failure: await report(err) }
  }

  const timer = createVerseTimer(job.marks, parts)
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const partStart: number[] = []
  const allMarks: Mark[] = []
  let bytes = 0
  let open = true
  let sink!: ReadableStreamDefaultController<Uint8Array>
  // The client leaving early does not stop generation: the track is still stored.
  const body = new ReadableStream<Uint8Array>({ start(c) { sink = c }, cancel() { open = false } })
  const send = (msg: unknown) => {
    if (!open) return
    try { sink.enqueue(encoder.encode(`${JSON.stringify(msg)}\n`)) } catch { open = false }
  }
  const sendMarks = (marks: Mark[]) => {
    allMarks.push(...marks)
    return marks.length ? marks.map((m) => [m.verse, m.t]) : undefined
  }
  const handle = ({ part, audio, alignment }: ElevenLabsLine) => {
    partStart[part] ??= bytes
    const marks = timer.feed(part, alignment, { partBase: partStart[part] / MP3_BYTES_PER_SEC, chunkBase: bytes / MP3_BYTES_PER_SEC })
    if (audio) {
      const raw = decodeBase64(audio)
      chunks.push(raw)
      bytes += raw.length
    }
    send({ ...(audio ? { a: audio } : {}), ...(marks.length ? { m: sendMarks(marks) } : {}) })
  }

  const pump = (async () => {
    let complete = false
    try {
      head.forEach(handle)
      for (;;) {
        const next = await lines.next()
        if (next.done) break
        handle(next.value)
      }
      complete = true
    } catch (err) {
      await report(err)
      send({ error: 'stream' })
    }
    const duration = Math.round((bytes / MP3_BYTES_PER_SEC) * 100) / 100
    if (complete) send({ m: sendMarks(timer.finish()), done: true, d: duration })
    if (open) try { sink.close() } catch { /* client gone */ }
    if (!complete) return
    await upload(admin, marksPath(path), JSON.stringify({ marks: allMarks, duration }), 'application/json')
    await upload(admin, path, new Blob(chunks, { type: track.type }), track.type)
  })()
  background(pump)

  return {
    response: new Response(body, { headers: trackHeaders(track, 'miss', fallback, { 'Content-Type': 'application/x-ndjson' }) }),
  }
}

// --- Gemini ------------------------------------------------------------------

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
    return { pcm: decodeBase64(inline.data), sampleRate: rate > 0 ? rate : 24000 }
  } catch (err) {
    console.error(`bible-tts: ${model} unreadable upstream audio`, sanitizeUpstreamDetail(String(err)))
    return { failed: 'error' }
  }
}

/** One part of the chapter down the model chain. */
async function geminiPart(admin: SupabaseClient, text: string, voice: string, style: string, deadline: number, exhausted: Map<string, number>) {
  const usable = pickModels(TTS_MODELS, exhausted, Date.now())
  // Reset times of every model that is out of quota, skipped or just hit.
  const untils: number[] = TTS_MODELS.filter((m) => !usable.includes(m)).map((m) => exhausted.get(m) as number)
  let otherFailure = false
  for (const model of usable) {
    if (deadline - Date.now() < 1_000) return { failure: { code: 'timeout' } }
    if ((exhausted.get(model) ?? 0) > Date.now()) continue // another part just used it up
    const attempt = await ttsAttempt(model, voice, style, text, deadline)
    if ('pcm' in attempt) return attempt
    if ('quotaUntil' in attempt) {
      untils.push(attempt.quotaUntil)
      exhausted.set(model, attempt.quotaUntil)
      await markExhausted(admin, model, attempt.quotaUntil)
    } else if ('failed' in attempt) {
      if (attempt.failed === 'timeout') return { failure: { code: 'timeout' } }
      otherFailure = true
    }
  }
  if (untils.length && !otherFailure) return { failure: quotaReply(untils, Date.now()) }
  return { failure: { code: 'error' } }
}

async function gemini(admin: SupabaseClient, job: Job, track: Track, path: string, fallback: string | null, exhausted: Map<string, number>): Promise<Outcome> {
  const deadline = Date.now() + GEMINI_TIMEOUT_MS
  // ponytail: parts run one after another so a small per-minute quota is not
  // tripped; a chapter over ~3 parts can run out of wall clock and fall back
  // to the device voice. Raise GEMINI_PART_CHARS or run 2 at once if that shows up.
  const pcm: Uint8Array[] = []
  let sampleRate = 24000
  for (const part of planRequests(job.text, job.marks, GEMINI_PART_CHARS)) {
    const result = await geminiPart(admin, part.text, track.voice, job.style, deadline, exhausted)
    if ('failure' in result) return { failure: result.failure }
    if (!pcm.length) sampleRate = result.sampleRate
    pcm.push(result.pcm)
  }
  // The parts go into the WAV as they are; no joined copy of the chapter.
  const size = pcm.reduce((n, p) => n + p.length, 0)
  const header = pcmToWav(new Uint8Array(0), { sampleRate })
  const view = new DataView(header.buffer)
  view.setUint32(4, 36 + size, true)
  view.setUint32(40, size, true)
  const wav = new Blob([header, ...pcm], { type: track.type })
  // Two users generating the same chapter at once both store it; same bytes either way.
  background(upload(admin, path, wav, track.type))
  return { response: new Response(wav, { headers: trackHeaders(track, 'miss', fallback, { 'Content-Type': track.type }) }) }
}

// --- What the client hears when no provider produced audio ------------------

function failureReply(failures: Failure[]) {
  const last = failures.at(-1) ?? { code: 'error' }
  const credits = failures.some((f) => f.code === 'quota_exceeded')
  if (last.code === 'quota_exhausted' || last.code === 'rate_limited') {
    const { code, retryAfterSec = 60 } = last
    return json(
      code === 'quota_exhausted'
        ? { error: 'The AI voice has reached its daily limit.', code: credits ? 'quota_exceeded' : code, retryAfterSec }
        : { error: 'Read-aloud is busy right now. Try again shortly.', code, retryAfterSec },
      429,
      { 'Retry-After': String(retryAfterSec) }
    )
  }
  // Credits running out is what the reader needs to hear, even if Gemini then failed for another reason.
  if (credits) {
    return json({ error: 'The AI voice credits are used up.', code: 'quota_exceeded', retryAfterSec: 3600 }, 429, { 'Retry-After': '3600' })
  }
  if (last.code === 'busy') {
    return json({ error: 'Read-aloud is busy right now. Try again shortly.', code: 'rate_limited', retryAfterSec: 30 }, 429, { 'Retry-After': '30' })
  }
  // A rejected key (bad_key) is logged server-side only and reads as 'unavailable' here.
  if (last.code === 'timeout') return json({ error: 'Audio is taking too long right now. Try again shortly.', code: 'timeout' }, 503)
  return json({ error: 'Audio is unavailable right now. Try again shortly.', code: 'unavailable' }, 502)
}

// --- Request ----------------------------------------------------------------

/** The chapter (or preview) to read, or an error reply. */
function readJob(body: Record<string, unknown>, style: string): Job | Response {
  if (body.action === 'preview') {
    return { ...assembleChapter([{ verse: 1, text: PREVIEW_TEXT }]), style, translation: 'preview', book: 'preview', chapter: 0 }
  }
  const translation = body.translation
  if (typeof translation !== 'string' || !AUDIO_TRANSLATIONS.includes(translation)) {
    return json({ error: 'Audio is not available for this translation.' }, 400)
  }
  const book = body.book
  const chapter = body.chapter
  if (typeof book !== 'string' || !BOOK_IDS.includes(book) || !validChapter(book, chapter)) {
    return json({ error: 'Unknown chapter.' }, 400)
  }
  const verses = body.verses
  if (!Array.isArray(verses) || !verses.length || verses.length > MAX_VERSES) return json({ error: 'Nothing to read.' }, 400)
  for (const v of verses) {
    if (!v || typeof v !== 'object' || !Number.isInteger(v.verse) || v.verse < 1 || typeof v.text !== 'string') {
      return json({ error: 'Malformed request.' }, 400)
    }
  }
  const { text, marks } = assembleChapter(verses)
  if (!text) return json({ error: 'Nothing to read.' }, 400)
  if (text.length > MAX_CHAPTER_CHARS) return json({ error: `Chapters over ${MAX_CHAPTER_CHARS} characters cannot be read aloud.` }, 400)
  return { text, marks, style, translation, book, chapter: chapter as number }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!GEMINI_API_KEY && !ELEVENLABS_API_KEY) {
    console.error('bible-tts: neither ELEVENLABS_API_KEY nor GEMINI_API_KEY is configured')
    return json({ error: 'Read-aloud is not configured yet.', code: 'not_configured' }, 503)
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
  const action = body.action ?? 'chapter'
  if (action !== 'chapter' && action !== 'preview') return json({ error: 'Malformed request.' }, 400)

  // Missing means the default; anything else must be on the list.
  const voice = body.voice ?? DEFAULT_VOICE
  if (!isVoice(voice)) return json({ error: 'That voice is not available.' }, 400)
  const style = body.style ?? DEFAULT_STYLE
  if (!isStyle(style)) return json({ error: 'That reading style is not available.' }, 400)
  const job = readJob(body, style as string)
  if (job instanceof Response) return job

  // --- Providers in order: cache, then generate -----------------------------
  const preferred = voiceProvider(voice) as Provider
  const exhausted = await loadExhausted(admin)
  const chain = providerChain({
    preferred, hasKey: { elevenlabs: Boolean(ELEVENLABS_API_KEY), gemini: Boolean(GEMINI_API_KEY) }, exhausted,
    now: Date.now(), fallback: action === 'chapter',
  }) as Provider[]
  const creditsOut = preferred === 'elevenlabs' && Boolean(ELEVENLABS_API_KEY) && !chain.includes('elevenlabs')
  // A preview is of one voice: it never stands in another provider's.
  let fallback: string | null = creditsOut ? 'quota_exceeded' : null
  const failures: Failure[] = creditsOut ? [{ code: 'quota_exceeded' }] : []
  if (!chain.length && !failures.length) return json({ error: 'Read-aloud is not configured yet.', code: 'not_configured' }, 503)

  let charged = false
  for (const provider of chain) {
    const track = trackFor(provider, voice as string, job.style)
    const path = await objectPath(track, job)
    const hit = await cachedReply(admin, track, path, fallback)
    if (hit) return hit

    // --- Rate limit (only generation costs a slot) -------------------------
    if (!charged) {
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
      charged = true
    }

    const outcome = provider === 'elevenlabs'
      ? await elevenLabs(admin, job, track, path, fallback)
      : await gemini(admin, job, track, path, fallback, exhausted)
    if ('response' in outcome) return outcome.response
    failures.push(outcome.failure)
    if (provider === 'elevenlabs') fallback = outcome.failure.code === 'quota_exceeded' || outcome.failure.code === 'busy' ? outcome.failure.code : 'error'
  }
  return failureReply(failures)
})
