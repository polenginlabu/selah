// Lets an admin see what a background search phrase would return, before
// putting it in the nightly settings. Nothing is downloaded, stored or written
// to daily_backgrounds: it only lists thumbnails, tags, licence and source.
//
// The Pixabay key lives here rather than in the client because anything in a
// Vite bundle is public, and Pixabay takes the key in the query string — so it
// is never echoed, logged or returned (see redact()).
//
// Admins only (is_admin(), as trigger-devotion), rate-limited per admin in
// Postgres (background_preview_rate_limit_hit), and the only things a caller
// chooses are the phrase, style term, image type, provider and page — each
// validated against the same rules the nightly job uses
// (_shared/backgroundSearch.js). No URL or raw parameter is forwarded.
//
// Secrets:
//   supabase secrets set PIXABAY_API_KEY=...   # optional; Openverse without it
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  DENY_WORDS, DEFAULT_STYLE_TERM, IMAGE_TYPES, MAX_STYLE_LEN, cleanPhrase, mergeDenyWords, normalizeSettings,
} from '../_shared/backgroundSearch.js'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PIXABAY_API_KEY = Deno.env.get('PIXABAY_API_KEY') ?? ''

const RATE_LIMIT_PER_WINDOW = 30 // per admin per 10 minutes
const PER_PAGE = 12
const MAX_PAGE = 5
const TIMEOUT_MS = 10000
const USER_AGENT = 'SELAH-background-preview/1.0'
// Same as the nightly job (scripts/selah/background.js, stockBackground.js).
const IMAGE_WIDTH = 1080
const IMAGE_HEIGHT = 1920
// Must match ALLOWED_LICENSES in scripts/selah/stockBackground.js. Used only
// to flag results here; the nightly job enforces its own copy.
const ALLOWED_LICENSES: Record<string, string[]> = {
  pixabay: ['pixabay content license'],
  openverse: ['cc0', 'pdm'],
}
const PROVIDERS = ['auto', 'pixabay', 'openverse']

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function corsHeaders(requested: string | null): Record<string, string> {
  return {
    ...CORS,
    'Access-Control-Allow-Headers': requested ?? 'authorization, content-type, x-client-info',
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  })
}

function redact(message: string): string {
  let out = String(message ?? '')
  if (PIXABAY_API_KEY) out = out.split(PIXABAY_API_KEY).join('[redacted]')
  return out.replace(/([?&]key=)[^&\s"']*/gi, '$1[redacted]')
}

function isHttps(url: unknown): boolean {
  try {
    return new URL(String(url)).protocol === 'https:'
  } catch {
    return false
  }
}

type Result = {
  provider: string
  id: string
  thumbUrl: string | null
  tags: string
  license: string
  licenseUrl: string | null
  sourceUrl: string | null
  creator: string | null
  width: number | null
  height: number | null
  mature?: boolean
  rejected?: string | null
}

/** Same rules, in the same order, as rejectionReason() in stockBackground.js. */
function rejection(r: Result, imageUrl: unknown, deny: Set<string>): string | null {
  if (!isHttps(imageUrl)) return 'not https'
  if (!(ALLOWED_LICENSES[r.provider] ?? []).includes(r.license.toLowerCase())) return `licence ${r.license || 'unknown'}`
  if (r.mature) return 'mature'
  const word = (r.tags.toLowerCase().match(/[a-z']+/g) ?? []).find((w) => deny.has(w))
  if (word) return `mentions "${word}"`
  if (r.width && r.height && Math.min(r.width, r.height) < IMAGE_WIDTH) return 'too small'
  return null
}

class UpstreamError extends Error {}

async function getJson(url: URL, provider: string) {
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw new UpstreamError(redact(`${provider} request failed: ${(err as Error).message}`))
  }
  // Never echo the body: it can quote the request, key and all.
  if (!res.ok) throw new UpstreamError(`${provider} returned HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new UpstreamError(`${provider} returned unreadable JSON`)
  }
}

async function searchPixabay(q: string, imageType: string, page: number, deny: Set<string>): Promise<Result[]> {
  const url = new URL('https://pixabay.com/api/')
  url.search = new URLSearchParams({
    key: PIXABAY_API_KEY,
    q: q.slice(0, 100),
    image_type: imageType,
    orientation: 'vertical',
    safesearch: 'true',
    order: 'popular',
    per_page: String(PER_PAGE),
    page: String(page),
    min_width: String(IMAGE_WIDTH),
    min_height: String(IMAGE_HEIGHT),
  }).toString()
  const body = await getJson(url, 'pixabay')
  return (body?.hits ?? []).map((h: Record<string, unknown>) => {
    const r: Result = {
      provider: 'pixabay',
      id: `pixabay:${h.id}`,
      thumbUrl: isHttps(h.webformatURL) ? String(h.webformatURL) : null,
      tags: String(h.tags ?? ''),
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      sourceUrl: isHttps(h.pageURL) ? String(h.pageURL) : null,
      creator: h.user ? String(h.user) : null,
      width: Number(h.imageWidth) || null,
      height: Number(h.imageHeight) || null,
    }
    return { ...r, rejected: rejection(r, h.largeImageURL, deny) }
  })
}

async function searchOpenverse(q: string, category: string | null, page: number, deny: Set<string>): Promise<Result[]> {
  const url = new URL('https://api.openverse.org/v1/images/')
  const params = new URLSearchParams({
    q,
    license: ALLOWED_LICENSES.openverse.join(','),
    size: 'large',
    mature: 'false',
    page_size: String(PER_PAGE),
    page: String(page),
  })
  if (category) params.set('category', category)
  url.search = params.toString()
  const body = await getJson(url, 'openverse')
  return (body?.results ?? []).map((o: Record<string, any>) => {
    const r: Result = {
      provider: 'openverse',
      id: `openverse:${o.id}`,
      thumbUrl: isHttps(o.thumbnail) ? String(o.thumbnail) : null,
      tags: [o.title, ...(o.tags ?? []).map((t: { name?: string }) => t?.name)].filter(Boolean).join(', '),
      license: String(o.license ?? '').toLowerCase(),
      licenseUrl: isHttps(o.license_url) ? String(o.license_url) : null,
      sourceUrl: isHttps(o.foreign_landing_url) ? String(o.foreign_landing_url) : null,
      creator: o.creator ? String(o.creator) : null,
      width: Number(o.width) || null,
      height: Number(o.height) || null,
      mature: o.mature === true,
    }
    return { ...r, rejected: rejection(r, o.url, deny) }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // --- Auth -----------------------------------------------------------------
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in first.' }, 401)

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Session expired — sign in again.' }, 401)

  const { data: isAdmin, error: adminError } = await asUser.rpc('is_admin')
  if (adminError) {
    console.error('background-preview: is_admin failed', adminError.message)
    return json({ error: 'Could not verify your account.' }, 503)
  }
  if (isAdmin !== true) return json({ error: 'Admins only.' }, 403)

  // --- Inputs ---------------------------------------------------------------
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Send a JSON body.' }, 400)
  }
  if (!body || typeof body !== 'object') return json({ error: 'Send a JSON body.' }, 400)

  const phrase = cleanPhrase(body.phrase)
  if (!phrase) {
    return json({ error: 'The phrase must be 1-60 letters, digits, spaces, apostrophes or hyphens.' }, 400)
  }
  let styleTerm = DEFAULT_STYLE_TERM
  if (typeof body.style_term === 'string') {
    styleTerm = body.style_term.trim() === '' ? '' : cleanPhrase(body.style_term, MAX_STYLE_LEN) ?? ''
    if (body.style_term.trim() && !styleTerm) return json({ error: 'Invalid style term.' }, 400)
  }
  const imageType = String(body.image_type ?? 'illustration')
  if (!Object.hasOwn(IMAGE_TYPES, imageType)) return json({ error: 'Invalid image type.' }, 400)
  const provider = String(body.provider ?? 'auto')
  if (!PROVIDERS.includes(provider)) return json({ error: 'Invalid provider.' }, 400)
  const page = body.page === undefined ? 1 : Number(body.page)
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return json({ error: `Page must be 1-${MAX_PAGE}.` }, 400)

  // --- Rate limit -----------------------------------------------------------
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: allowed, error: limitError } = await admin.rpc('background_preview_rate_limit_hit', {
    p_user_id: userData.user.id,
    p_max_per_window: RATE_LIMIT_PER_WINDOW,
  })
  if (limitError) {
    console.error('background-preview: rate limit check failed', limitError.message)
    return json({ error: 'Preview is not set up yet (run the background search migration).' }, 503)
  }
  if (allowed !== true) {
    return json({ error: 'Too many previews — try again in a few minutes.', code: 'rate_limited' }, 429, { 'Retry-After': '600' })
  }

  // Flag what the nightly job would skip, with the saved extra deny words.
  const saved = await admin.from('background_search_settings').select('deny_words').eq('id', true).maybeSingle()
  const deny = new Set(mergeDenyWords(DENY_WORDS, normalizeSettings(saved.data).denyWords))

  // --- Search ---------------------------------------------------------------
  const query = styleTerm && !` ${phrase} `.includes(` ${styleTerm} `) ? `${phrase} ${styleTerm}` : phrase
  const types = IMAGE_TYPES[imageType as keyof typeof IMAGE_TYPES]
  const usePixabay = provider === 'pixabay' || (provider === 'auto' && Boolean(PIXABAY_API_KEY))
  if (usePixabay && !PIXABAY_API_KEY) {
    return json({ error: 'PIXABAY_API_KEY is not set for this function — preview with Openverse.' }, 400)
  }

  let note: string | null = usePixabay ? null : (provider === 'auto' ? 'No Pixabay key here — showing Openverse.' : null)
  let results: Result[]
  let used = usePixabay ? 'pixabay' : 'openverse'
  try {
    results = usePixabay
      ? await searchPixabay(query, types.pixabay, page, deny)
      : await searchOpenverse(query, types.openverse, page, deny)
  } catch (err) {
    const message = err instanceof UpstreamError ? err.message : 'search failed'
    console.error('background-preview:', redact(message))
    if (!(usePixabay && provider === 'auto')) return json({ error: redact(message) }, 502)
    // As the nightly job does: a failing Pixabay falls back to Openverse.
    try {
      results = await searchOpenverse(query, types.openverse, page, deny)
      used = 'openverse'
      note = `${redact(message)} — showing Openverse.`
    } catch (err2) {
      const message2 = err2 instanceof UpstreamError ? err2.message : 'search failed'
      return json({ error: redact(message2) }, 502)
    }
  }

  return json({ provider: used, query, page, note, results })
})
