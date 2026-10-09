// Gemini TTS model fallback chain and per-model quota bookkeeping, used by the
// bible-tts Edge Function. Pure JS (no Deno or Node APIs) so the node tests
// can import it directly.
//
// On the free tier every TTS model has its own small quota (a few requests a
// minute, ~10 a day). When one is used up the function moves to the next and
// remembers the exhausted one in public.tts_model_exhaustion
// (supabase/migrations/20261013_tts_model_exhaustion.sql) so later requests
// skip it without spending a call.

// Tried in this order. Override with the GEMINI_TTS_MODELS secret
// (comma-separated). The 3.x ids are best guesses: confirm the exact ids in
// AI Studio (Models list) and edit here or set the secret. An unknown id
// returns 404 upstream and is simply skipped.
export const DEFAULT_TTS_MODELS = [
  'gemini-3.8-flash-preview-tts',
  'gemini-3.1-flash-preview-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-3.8-flash-lite-preview-tts',
]

// Last resort when every TTS model is exhausted: a Live API model reads the
// text, and only audio whose transcript matches the text is kept. Override
// with GEMINI_LIVE_MODEL; confirm the id in AI Studio. Set it to "off" to disable.
export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live-preview'

// Storage paths and the exhaustion table key Live audio under this prefix so
// it never collides with a TTS model's.
export const liveCacheModel = (model) => `live-${model}`

const MINUTE_MS = 60_000
// A per-minute window this long or longer means "not soon": the client should
// stop waiting and use the device voice.
export const QUOTA_LONG_WAIT_SEC = 300

/** Comma-separated ids, trimmed, blanks and duplicates dropped; the defaults when empty. */
export function parseModelList(value, defaults = DEFAULT_TTS_MODELS) {
  const ids = [...new Set(String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
  return ids.length ? ids : [...defaults]
}

/** The chain minus models still exhausted at `now`. `exhausted` maps model -> until (ms). */
export function pickModels(chain, exhausted = new Map(), now = Date.now()) {
  return chain.filter((model) => !((exhausted.get(model) ?? 0) > now))
}

// Wall-clock fields of an instant in Los Angeles.
const LA = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
})
const laParts = (ms) => Object.fromEntries(LA.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]))
// UTC offset of Los Angeles at an instant, in ms (negative: -8h or -7h).
function laOffset(ms) {
  const p = laParts(ms)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** The next midnight in America/Los_Angeles after `now` (ms), DST-correct. Daily quotas reset then. */
export function nextPacificMidnight(now = Date.now()) {
  const p = laParts(now)
  const wall = Date.UTC(p.year, p.month - 1, p.day + 1) // tomorrow 00:00 as if it were UTC
  // Midnight is never inside a DST gap (those are at 02:00), so two passes settle it.
  let utc = wall - laOffset(wall)
  utc = wall - laOffset(utc)
  return utc
}

/** True when an upstream reply means this model's quota is used up. */
export function isQuotaError(status, body = '') {
  return status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(String(body))
}

/** True when the model id is not served (unknown or retired): skip it for this request only. */
export function isUnknownModel(status, body = '') {
  return status === 404 || (status === 400 && /not found|is not supported|unknown model|invalid model/i.test(String(body)))
}

/** True when the exhausted quota is a daily one (requests per day). */
export function isDailyQuota(body = '') {
  return /PerDay|per_day|per day|\bRPD\b|daily/i.test(String(body))
}

/** Upstream RetryInfo delay in seconds ("retryDelay": "37s"), or 0. */
export function retryDelaySec(body = '') {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(String(body))
  return m ? Math.ceil(Number(m[1])) : 0
}

/** When an exhausted model is worth trying again: next Pacific midnight for a daily quota, else 60 s or the upstream delay if longer. */
export function exhaustionUntil({ body = '', now = Date.now() } = {}) {
  if (isDailyQuota(body)) return nextPacificMidnight(now)
  return now + Math.max(MINUTE_MS, retryDelaySec(body) * 1000)
}

/**
 * What to tell the client when no model produced audio and every one was out
 * of quota. `untils` are the exhausted_until times (ms) of every model tried
 * or skipped. A long wait is `quota_exhausted` (the client switches to the
 * device voice); a short one is a transient `rate_limited`.
 */
export function quotaReply(untils, now = Date.now()) {
  const soonest = untils.filter((t) => t > now).reduce((a, b) => Math.min(a, b), Infinity)
  const retryAfterSec = Number.isFinite(soonest) ? Math.max(1, Math.ceil((soonest - now) / 1000)) : 60
  return retryAfterSec >= QUOTA_LONG_WAIT_SEC
    ? { code: 'quota_exhausted', retryAfterSec }
    : { code: 'rate_limited', retryAfterSec }
}
