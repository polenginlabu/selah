// Logic for the SELAH daily background when it comes from a stock image search
// rather than an image model: which words to search for, which results are
// allowed, which one a date gets, and the credit that goes with it.
//
// The look is a minimalist atmospheric landscape illustration — layered hills,
// haze, calm sea, soft light — so both providers are asked for illustrations,
// not photographs, and every query is tried with a style word first. An admin
// can add phrases and deny words and change the style word and image type
// (background_search_settings, see supabase/functions/_shared/backgroundSearch.js);
// without settings, the defaults below apply.
//
// No filesystem and no Supabase. The only network access is through an
// injected `fetchImpl`, so every path — including provider failure and the
// Pixabay-to-Openverse fallback — is tested with stubs (npm run background:test).
//
// LICENSING IS THE POINT OF THIS FILE. Only images whose licence allows free
// commercial use without asking are ever accepted: the Pixabay Content License,
// CC0 and the Public Domain Mark. CC-BY is refused even though it is "free", because it
// requires a credit on every shared card, and the 1080x1920 card carries none.
// Never widen ALLOWED_LICENSES without solving that first.

import { assertValidDate, dayIndex, themeForDate, IMAGE_WIDTH, IMAGE_HEIGHT } from './background.js'
import { DENY_WORDS, mergeDenyWords } from '../../supabase/functions/_shared/backgroundSearch.js'

export const PIXABAY_SEARCH_URL = 'https://pixabay.com/api/'
export const OPENVERSE_SEARCH_URL = 'https://api.openverse.org/v1/images/'
export const USER_AGENT = 'SELAH-daily-background/1.0'

/** provider id -> licence ids it may return that we accept. */
export const ALLOWED_LICENSES = {
  pixabay: ['pixabay content license'],
  openverse: ['cc0', 'pdm'],
}

const LICENSE_URLS = {
  pixabay: 'https://pixabay.com/service/license-summary/',
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  pdm: 'https://creativecommons.org/publicdomain/mark/1.0/',
}

const PROVIDER_LABELS = { pixabay: 'Pixabay', openverse: 'Openverse' }

/** Pixabay's licence as recorded in the attribution. */
export const PIXABAY_LICENSE = 'Pixabay Content License'

/** How many past days an image may not be reused within. */
export const NO_REPEAT_DAYS = 30

/**
 * Visual search phrases for each theme, devotion palette and background
 * rotation alike. Abstract words ("grace", "faith") return images of people
 * praying or holding hands, so each theme is translated into the atmospheric
 * landscape that carries its mood instead: wide, hazy, few elements.
 */
export const THEME_QUERIES = {
  peace: 'misty lake landscape',
  joy: 'meadow hills sunrise',
  hope: 'sunrise over hills',
  faith: 'light through clouds',
  gratitude: 'golden field landscape',
  rest: 'misty forest landscape',
  courage: 'mountain peak dawn',
  stillness: 'still lake mist',
  grace: 'soft clouds sky',
  light: 'sun rays mountains',
  renewal: 'spring hills landscape',
  trust: 'calm sea horizon',
  wisdom: 'lone tree hills',
  "god's creation": 'mountain valley landscape',
  morning: 'morning mist hills',
  evening: 'evening sunset hills',
  mountains: 'misty mountains',
  ocean: 'calm ocean horizon',
  forest: 'misty forest hills',
  sky: 'sky clouds landscape',
  sunrise: 'sunrise landscape',
  'gentle rain': 'rainy misty landscape',
}

/** Last resort when nothing more specific returns a usable image. */
export const GENERIC_QUERY = 'misty mountains landscape'

/**
 * Added to each query, tried before the plain query. Keyword search ANDs its
 * terms, so the plain query is always kept as the fallback: the style word
 * steers the pick, it never empties the pool.
 */
export const STYLE_TERM = 'minimalist'

/** What each provider is asked for: illustrations, never photographs. */
export const PIXABAY_IMAGE_TYPE = 'illustration'
export const OPENVERSE_CATEGORY = 'illustration'

/**
 * Nature words worth lifting straight out of the devotion text. Scripture is
 * full of them ("He leads me beside still waters"), and a photo of the actual
 * image in the day's verse is the closest match a keyword search can make.
 * Keys are what appears in text; values are the search word.
 */
export const NATURE_VOCAB = {
  mountain: 'mountain', mountains: 'mountain', hill: 'hills', hills: 'hills',
  sea: 'sea', seas: 'sea', ocean: 'ocean', waves: 'waves', shore: 'shore',
  river: 'river', rivers: 'river', stream: 'stream', streams: 'stream',
  waters: 'lake', lake: 'lake', rain: 'rain', storm: 'storm', storms: 'storm',
  wind: 'wind', cloud: 'clouds', clouds: 'clouds', sky: 'sky', heavens: 'sky',
  stars: 'stars', star: 'stars', sun: 'sun', sunrise: 'sunrise', dawn: 'dawn',
  morning: 'morning', evening: 'sunset', sunset: 'sunset', night: 'night sky',
  light: 'light', forest: 'forest', tree: 'tree', trees: 'trees',
  field: 'field', fields: 'field', meadow: 'meadow', pasture: 'meadow',
  pastures: 'meadow', valley: 'valley', desert: 'desert', wilderness: 'desert',
  garden: 'garden', flower: 'flowers', flowers: 'flowers', seed: 'seedling',
  harvest: 'wheat field', wheat: 'wheat field', vine: 'vineyard', snow: 'snow',
  path: 'path', road: 'path', rock: 'rocks', spring: 'spring',
}

// DENY_WORDS lives in the shared module so the background-preview Edge
// Function flags exactly what this job would skip.
export { DENY_WORDS }

const DENY_SET = new Set(DENY_WORDS)

/** The deny list as a Set, with the admin's extra words added (never removed). */
export function denySet(extraDeny = []) {
  return extraDeny?.length ? new Set(mergeDenyWords(DENY_WORDS, extraDeny)) : DENY_SET
}

function words(text) {
  return String(text ?? '').toLowerCase().match(/[a-z']+/g) ?? []
}

function themeKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * The searches to try for a day, most specific first, each 2-4 keywords.
 *
 * Several rather than one because keyword search ANDs its terms: a precise
 * four-word query can return nothing on a small CC0 index, and the job should
 * then widen rather than give up. Deterministic for the same devotion.
 *
 * @param {object|null} devotion  {title, topicLabel, theme, themeLabel, keyScripture, keyScriptureText, thought}
 * @param {string} dateISO        used for the theme when there is no devotion
 * @returns {string[]}
 */
export function buildImageQueries(devotion, dateISO) {
  assertValidDate(dateISO)
  const theme = themeKey(devotion?.theme) || themeKey(devotion?.themeLabel) || themeForDate(dateISO).theme
  // hasOwn, not a bare lookup: "constructor" in a devotion must not resolve to
  // Object.prototype.constructor.
  const themePhrase = Object.hasOwn(THEME_QUERIES, theme)
    ? THEME_QUERIES[theme]
    : THEME_QUERIES[themeForDate(dateISO).theme.toLowerCase()]

  // Title and verse first: they are the most deliberate words of the day.
  const text = [
    devotion?.title, devotion?.keyScriptureText, devotion?.topicLabel, devotion?.thought,
  ].filter(Boolean).join(' ')
  const found = []
  for (const w of words(text)) {
    const mapped = Object.hasOwn(NATURE_VOCAB, w) ? NATURE_VOCAB[w] : null
    if (mapped && !found.includes(mapped)) found.push(mapped)
    if (found.length === 2) break
  }

  const themeWords = themePhrase.split(' ')
  const queries = []
  if (found.length) {
    // Some vocabulary maps to two words ("wheat field"), so count words, not entries.
    const combined = [...new Set(found.join(' ').split(' '))].slice(0, 4)
    for (const w of themeWords) {
      if (combined.length >= 4) break
      if (!combined.includes(w)) combined.push(w)
    }
    if (combined.length < 2) combined.push('landscape')
    queries.push(combined.join(' '))
    queries.push(`${found[0]} landscape`)
  }
  queries.push(themePhrase)
  queries.push(GENERIC_QUERY)
  return [...new Set(queries)]
}

export function buildImageQuery(devotion, dateISO) {
  return buildImageQueries(devotion, dateISO)[0]
}

/**
 * Each query with the style term added, then the query itself, in the given
 * order and without duplicates. A query that already has the style term is
 * kept as it is; a blank style term means plain queries only.
 *
 * @param {string[]} queries
 * @param {string} [styleTerm]
 * @returns {string[]}
 */
export function styleQueries(queries, styleTerm = STYLE_TERM) {
  if (!styleTerm) return [...new Set(queries)]
  const out = []
  for (const q of queries) {
    const has = ` ${words(q).join(' ')} `.includes(` ${words(styleTerm).join(' ')} `)
    const styled = has ? q : `${q} ${styleTerm}`
    for (const v of [styled, q]) if (!out.includes(v)) out.push(v)
  }
  return out
}

// --- Candidates ------------------------------------------------------------
//
// One shape for both providers:
//   { provider, sourceId, imageUrl, sourceUrl, creator, creatorUrl, license,
//     licenseUrl, width, height, text }
// `text` is everything descriptive the provider gave us, for the deny-list.

export function normalizePixabay(json) {
  return (json?.hits ?? []).map((h) => ({
    provider: 'pixabay',
    sourceId: `pixabay:${h.id}`,
    // largeImageURL is the biggest size open to every key (1280px on the long
    // side). It is downloaded and re-hosted, never hotlinked.
    imageUrl: h.largeImageURL ?? null,
    sourceUrl: h.pageURL ?? null,
    creator: h.user ?? null,
    creatorUrl: h.user && h.user_id ? `https://pixabay.com/users/${h.user}-${h.user_id}/` : null,
    license: PIXABAY_LICENSE,
    licenseUrl: LICENSE_URLS.pixabay,
    // The original's size, which the search's min_width/min_height filter on.
    width: h.imageWidth ?? null,
    height: h.imageHeight ?? null,
    text: h.tags ?? '',
  }))
}

export function normalizeOpenverse(json) {
  return (json?.results ?? []).map((r) => {
    const license = String(r.license ?? '').toLowerCase()
    return {
      provider: 'openverse',
      sourceId: `openverse:${r.id}`,
      imageUrl: r.url ?? null,
      sourceUrl: r.foreign_landing_url ?? null,
      creator: r.creator ?? null,
      creatorUrl: r.creator_url ?? null,
      license,
      licenseUrl: r.license_url ?? LICENSE_URLS[license] ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
      mature: r.mature === true,
      text: [r.title, ...(r.tags ?? []).map((t) => t?.name)].filter(Boolean).join(' '),
    }
  })
}

export function isAllowedLicense(provider, license) {
  return (ALLOWED_LICENSES[provider] ?? []).includes(String(license ?? '').toLowerCase())
}

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** The first deny-listed word in a candidate's description, or null. */
export function deniedWord(text, deny = DENY_SET) {
  return words(text).find((w) => deny.has(w)) ?? null
}

/** Short side in pixels must cover the card's width without upscaling. */
export function isLargeEnough(width, height) {
  return Math.min(width, height) >= IMAGE_WIDTH
}

/**
 * Smallest short side a downloaded file may have. Pixabay serves at most
 * 1280px on the long side without full API access, so a portrait arrives
 * 720-853px wide and is upscaled to the card's width; every other provider's
 * file must already cover it.
 */
export const PIXABAY_MIN_SHORT_SIDE = 720

export function minShortSide(provider) {
  return provider === 'pixabay' ? PIXABAY_MIN_SHORT_SIDE : IMAGE_WIDTH
}

/**
 * Why a candidate is unusable, or null if it is fine. Dimensions the provider
 * did not report are let through here and checked on the downloaded bytes.
 */
export function rejectionReason(c, { deny = DENY_SET } = {}) {
  if (!c?.imageUrl || !isHttps(c.imageUrl)) return 'not https'
  if (!isAllowedLicense(c.provider, c.license)) return `licence ${c.license || 'unknown'}`
  if (c.mature) return 'mature'
  const word = deniedWord(c.text, deny)
  if (word) return `mentions "${word}"`
  if (c.width && c.height && !isLargeEnough(c.width, c.height)) return 'too small'
  return null
}

export function isSuitableCandidate(c, options) {
  return rejectionReason(c, options) === null
}

/**
 * Usable candidates in the order to try them for a date.
 *
 * Sorted by id first so the provider's ranking churn does not change a date's
 * pick between runs, then rotated so the date's seeded choice comes first. The
 * rest follow in order, for when the first one fails to download.
 *
 * @param {string[]} recentIds sourceIds used in the last NO_REPEAT_DAYS days
 * @param {{deny?: Set<string>}} [options] deny: the deny list (see denySet)
 */
export function rankCandidates(candidates, dateISO, recentIds = [], options = {}) {
  const recent = new Set(recentIds)
  const usable = candidates
    .filter((c) => isSuitableCandidate(c, options) && !recent.has(c.sourceId))
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0))
  if (!usable.length) return []
  const start = ((dayIndex(dateISO) % usable.length) + usable.length) % usable.length
  return [...usable.slice(start), ...usable.slice(0, start)]
}

export function pickCandidate(candidates, dateISO, recentIds = []) {
  return rankCandidates(candidates, dateISO, recentIds)[0] ?? null
}

// --- Attribution -----------------------------------------------------------

/** The record kept on the daily_backgrounds row (attribution jsonb). */
export function buildAttribution(candidate, { query, fetchedAt = new Date().toISOString() } = {}) {
  return {
    provider: candidate.provider,
    sourceId: candidate.sourceId,
    sourceUrl: candidate.sourceUrl ?? null,
    imageUrl: candidate.imageUrl,
    creator: candidate.creator ?? null,
    creatorUrl: candidate.creatorUrl ?? null,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl ?? null,
    query: query ?? null,
    fetchedAt,
  }
}

/** "Photo: Jane Doe · Pixabay" */
export function creditLine(attribution) {
  if (!attribution) return null
  const provider = PROVIDER_LABELS[attribution.provider] ?? attribution.provider
  return `Photo: ${attribution.creator || 'Unknown'} · ${provider}`
}

// --- Providers -------------------------------------------------------------

export class ProviderError extends Error {
  constructor(message, provider) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
  }
}

const STATUS_HINTS = { 400: 'bad request', 401: 'key rejected', 403: 'key rejected', 429: 'rate limited' }

/**
 * Strips a secret, and any `key=` URL parameter, from a message. Pixabay takes
 * its key in the query string, so an error that quotes the request URL would
 * otherwise print it.
 */
export function redact(message, secret) {
  let out = String(message ?? '')
  if (secret) out = out.split(secret).join('[redacted]')
  return out.replace(/([?&]key=)[^&\s"']*/gi, '$1[redacted]')
}

async function getJson(fetchImpl, url, headers, provider, timeoutMs, secret = null) {
  let res
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new ProviderError(redact(`${provider} request failed: ${err.message}`, secret), provider)
  }
  if (!res.ok) {
    const hint = STATUS_HINTS[res.status]
    throw new ProviderError(`${provider} returned HTTP ${res.status}${hint ? ` (${hint})` : ''}`, provider)
  }
  try {
    return await res.json()
  } catch (err) {
    throw new ProviderError(redact(`${provider} returned unreadable JSON: ${err.message}`, secret), provider)
  }
}

export async function searchPixabay(query, {
  apiKey, imageType = PIXABAY_IMAGE_TYPE, fetchImpl = fetch, timeoutMs = 15000,
} = {}) {
  const url = new URL(PIXABAY_SEARCH_URL)
  // Pixabay takes the key only as a query parameter: never log this URL.
  url.search = new URLSearchParams({
    key: apiKey,
    q: String(query).slice(0, 100),
    image_type: imageType,
    orientation: 'vertical',
    safesearch: 'true',
    order: 'popular',
    per_page: '50',
    min_width: String(IMAGE_WIDTH),
    min_height: String(IMAGE_HEIGHT),
  }).toString()
  const json = await getJson(fetchImpl, url, { 'User-Agent': USER_AGENT }, 'pixabay', timeoutMs, apiKey)
  return normalizePixabay(json)
}

/** @param {{category?: string|null}} options category null: any kind of image */
export async function searchOpenverse(query, {
  category = OPENVERSE_CATEGORY, fetchImpl = fetch, timeoutMs = 15000,
} = {}) {
  const url = new URL(OPENVERSE_SEARCH_URL)
  const params = new URLSearchParams({
    q: query,
    license: ALLOWED_LICENSES.openverse.join(','),
    category: category ?? '',
    size: 'large',
    mature: 'false',
    page_size: '20',
  })
  if (!category) params.delete('category')
  url.search = params.toString()
  const json = await getJson(fetchImpl, url, { 'User-Agent': USER_AGENT }, 'openverse', timeoutMs)
  return normalizeOpenverse(json)
}

/**
 * Finds the day's image: Pixabay when a key is set, then Openverse, trying each
 * query from most to least specific — styled first, then plain (styleQueries) —
 * until one returns a usable candidate. `query` is the exact one that matched.
 *
 * A provider that errors is skipped, not fatal — a dead Pixabay key must still
 * leave the keyless path working.
 *
 * The optional settings come from the admin (see _shared/backgroundSearch.js);
 * each defaults to the built-in behaviour. extraDeny only adds to DENY_WORDS.
 *
 * @returns {Promise<{provider: string, query: string, ranked: object[]} | null>}
 */
export async function findBackground({
  queries, dateISO, recentIds = [], pixabayApiKey = null, fetchImpl = fetch, log = () => {},
  styleTerm = STYLE_TERM, extraDeny = [], pixabayImageType = PIXABAY_IMAGE_TYPE,
  openverseCategory = OPENVERSE_CATEGORY, usePixabay = true, useOpenverse = true,
}) {
  const providers = []
  if (pixabayApiKey && usePixabay) {
    providers.push(['pixabay', (q) => searchPixabay(q, { apiKey: pixabayApiKey, imageType: pixabayImageType, fetchImpl })])
  }
  // Openverse is the keyless fallback: it stays on when Pixabay cannot run,
  // even if the admin turned it off, so a setting never empties the search.
  if (useOpenverse || !providers.length) {
    providers.push(['openverse', (q) => searchOpenverse(q, { category: openverseCategory, fetchImpl })])
  }
  const deny = denySet(extraDeny)

  for (const [provider, search] of providers) {
    for (const query of styleQueries(queries, styleTerm)) {
      let candidates
      try {
        candidates = await search(query)
      } catch (err) {
        log(redact(`${err.message} — skipping ${provider}`, pixabayApiKey))
        break
      }
      const ranked = rankCandidates(candidates, dateISO, recentIds, { deny })
      log(`${provider} "${query}": ${candidates.length} results, ${ranked.length} usable`)
      if (ranked.length) return { provider, query, ranked }
    }
  }
  return null
}

/** Downloads one image with a timeout and a size cap. */
export async function downloadImage(url, { fetchImpl = fetch, timeoutMs = 30000, maxBytes = 25 * 1024 * 1024 } = {}) {
  if (!isHttps(url)) throw new ProviderError(`Refusing a non-https image URL: ${url}`, 'download')
  let res
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow',
    })
  } catch (err) {
    throw new ProviderError(`Download failed: ${err.message}`, 'download')
  }
  if (!res.ok) throw new ProviderError(`Download returned HTTP ${res.status}`, 'download')
  const declared = Number(res.headers?.get?.('content-length') ?? 0)
  if (declared > maxBytes) throw new ProviderError(`Image is ${declared} bytes, over the ${maxBytes} cap`, 'download')
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length > maxBytes) throw new ProviderError(`Image is ${buffer.length} bytes, over the ${maxBytes} cap`, 'download')
  return buffer
}
