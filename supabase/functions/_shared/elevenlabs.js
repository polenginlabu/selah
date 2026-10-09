// ElevenLabs text-to-speech for Bible read-aloud: model limits, voice
// settings per reading style, error classification and the mapping from
// character timestamps to verse start times. Used by the bible-tts Edge
// Function. Pure JS (no Deno or Node APIs) so the node tests can import it.
//
// Endpoint: POST /v1/text-to-speech/{voice_id}/stream/with-timestamps
// returns newline-delimited JSON, each line { audio_base64, alignment:
// { characters, character_start_times_seconds, character_end_times_seconds } }.
// Limits and voice ids below are from the ElevenLabs docs as remembered, not
// checked at build time: confirm them there (Models, Voice Library > Default).

// Characters per request, per model. Override the model with ELEVENLABS_MODEL.
export const ELEVENLABS_MODELS = {
  eleven_flash_v2_5: 40_000,
  eleven_turbo_v2_5: 40_000,
  eleven_multilingual_v2: 10_000,
}
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5'
export const OUTPUT_FORMAT = 'mp3_44100_128'
// 128 kbps constant bit rate: seconds of audio from a byte count.
export const MP3_BYTES_PER_SEC = 16_000
// Row in public.tts_model_exhaustion while the account is out of credits.
export const ELEVENLABS_KEY = 'elevenlabs'
export const ELEVENLABS_EXHAUSTION_MS = 60 * 60 * 1000

/** The configured model and its per-request limit; unknown ids fall back to the default. */
export function elevenLabsModel(value) {
  const id = String(value ?? '').trim()
  const known = Object.hasOwn(ELEVENLABS_MODELS, id) ? id : DEFAULT_ELEVENLABS_MODEL
  return { id: known, maxChars: ELEVENLABS_MODELS[known] }
}

const SETTINGS = {
  narrator: { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.95 },
  gentle: { stability: 0.75, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.85 },
}

/** voice_settings for a reading style id (the narrator for anything unknown). */
export const voiceSettings = (style) => SETTINGS[style] ?? SETTINGS.narrator

/**
 * ELEVENLABS_VOICE_IDS ("George=abc123,Sarah=def456") corrects a voice's
 * ElevenLabs id without a deploy. Only names in `names` and plausible ids are kept.
 */
export function parseVoiceIds(value, names = []) {
  const out = new Map()
  for (const pair of String(value ?? '').split(',')) {
    const [name, id] = pair.split('=').map((s) => s?.trim())
    if (names.includes(name) && /^[A-Za-z0-9]{10,40}$/.test(id ?? '')) out.set(name, id)
  }
  return out
}

/**
 * Why an ElevenLabs request failed: 'quota_exceeded' (out of credits; sent as
 * a 401, so the body is checked first), 'bad_key', 'busy' (429 or
 * concurrency), 'voice' (unknown voice) or 'error'.
 */
export function classifyElevenLabs(status, body = '') {
  let detail = ''
  try {
    const d = JSON.parse(body)?.detail
    detail = String(typeof d === 'string' ? d : d?.status ?? d?.code ?? '')
  } catch { /* not JSON */ }
  if (/quota_exceeded/i.test(detail || body)) return 'quota_exceeded'
  if (status === 401 || /invalid_api_key|needs_authorization/i.test(detail)) return 'bad_key'
  if (status === 429 || /too_many_concurrent|system_busy|rate_limit/i.test(detail)) return 'busy'
  if (status === 404 || /voice_not_found/i.test(detail)) return 'voice'
  return 'error'
}

const round2 = (n) => Math.round(n * 100) / 100

/**
 * Turns streamed character timestamps into verse start times, as they arrive.
 * `marks` are the chapter's verse marks and `parts` the requests
 * (planRequests). feed() takes one alignment chunk of part p and returns the
 * verses it starts as [{ verse, t }], t in seconds from the start of the
 * track. partBase is the audio before part p, chunkBase the audio before
 * this chunk: timestamps that restart below what was already seen are taken
 * as relative to the chunk. finish() returns any verse never reached.
 */
export function createVerseTimer(marks, parts) {
  const seen = parts.map(() => 0)
  let next = 0
  let last = 0
  return {
    feed(p, alignment, { partBase = 0, chunkBase = 0 } = {}) {
      const starts = alignment?.character_start_times_seconds
      const part = parts[p]
      if (!part || !Array.isArray(starts) || !starts.length) return []
      const base = Number(starts[0]) + partBase + 0.05 < last ? chunkBase : partBase
      const end = part.offset + part.text.length - 1
      const out = []
      starts.forEach((s, k) => {
        const at = Math.min(part.offset + seen[p] + k, end)
        const t = round2(Math.max(0, Number(s) || 0) + base)
        while (next < marks.length && marks[next].at <= at) out.push({ verse: marks[next++].verse, t })
        if (t > last) last = t
      })
      seen[p] += starts.length
      return out
    },
    finish() {
      const out = []
      while (next < marks.length) out.push({ verse: marks[next++].verse, t: last })
      return out
    },
  }
}
