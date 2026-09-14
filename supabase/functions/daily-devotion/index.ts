// SELAH daily devotional engine — the server half.
//
// Deployed as a Supabase Edge Function so the LLM credential never reaches the
// browser (same reasoning as bible-chat). Flow for the first request of a new
// day from a given user:
//   1. Verify the caller's Supabase JWT — that, not CORS, is the boundary.
//   2. If a devotion already exists for today, return it (idempotent; this is
//      also the natural rate limit: one generation per date).
//   3. Pick a topic: random + intentional, biased away from recent topics and
//      toward under-covered ones (see topics.ts).
//   4. Fetch real verse text for the anchor passage (bible-api.com, no key),
//      then hand it to the model verbatim so it can quote safely.
//   5. Ask the model for a strict-JSON SELAH devotion, validate the shape, and
//      upsert the row (ON CONFLICT DO NOTHING) keyed on (user_id, date).
//
// Reuses the same OpenAI-compatible endpoint as bible-chat:
//   supabase secrets set OPENAI_BASE_URL=... OPENAI_API_KEY=...
//   supabase secrets set DEVOTION_MODEL=...   # optional, defaults to CHAT_MODEL (gpt-4o-mini)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { pickTopic, notesFor } from './topics.ts'
import { buildDevotionPrompt } from './prompt.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? '').replace(/\/$/, '')
const API_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const MODEL =
  Deno.env.get('DEVOTION_MODEL') ??
  Deno.env.get('CHAT_MODEL') ??
  'gpt-4o-mini'

const RECENT_WINDOW_DAYS = 7
const HISTORY_LOOKBACK_DAYS = 45
const ALLOWED_DATE_SKEW = 1 // ±1 day around server UTC today covers any timezone
const BIBLE_TRANSLATION = 'web'
const BIBLE_TRANSLATION_NAME = 'World English Bible'

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Reflect the preflight's requested headers instead of hardcoding a list: the
// supabase-js client sends `x-client-info` (and may send other headers across
// versions), and a stale hardcoded list turns into a browser CORS block like
// the one this mirror exists to fix.
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

function todayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function dateNDaysAgo(dateISO: string, n: number) {
  const d = new Date(dateISO + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return todayISO(d)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isNearToday(date: string, serverToday: string) {
  if (!DATE_RE.test(date)) return false
  const local = new Date(date + 'T00:00:00Z').getTime()
  const t0 = new Date(serverToday + 'T00:00:00Z').getTime()
  return Math.abs(local - t0) <= ALLOWED_DATE_SKEW * 86_400_000
}

// --- Verse ground truth -----------------------------------------------------
// bible-api.com needs no key and is what the rest of the app already uses for
// the verse of the day. Try each anchor until one yields real text.
async function fetchAnchorText(references: string[]) {
  for (const ref of references) {
    try {
      const response = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}?translation=${BIBLE_TRANSLATION}`)
      if (!response.ok) continue
      const payload = await response.json()
      const text = (payload.verses ?? [])
        .map((v: { text?: string }) => (v.text ?? '').trim())
        .join(' ')
        .replace(/\s+/g, ' ')
      if (text) return { reference: ref, text }
    } catch {
      // fall through to the next anchor
    }
  }
  return { reference: null, text: null }
}

// --- Model call + strict JSON -------------------------------------------------
class ModelError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message)
  }
}

async function callModel(messages: Array<{ role: string; content: string }>) {
  let upstream: Response
  try {
    upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        temperature: 0.85,
        max_tokens: 2400,
        messages,
      }),
    })
  } catch (err) {
    console.error('daily-devotion: upstream unreachable', err)
    throw new ModelError('The devotional engine is unreachable right now.')
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
    console.error('daily-devotion: upstream error', upstream.status, String(detail).slice(0, 500))
    if (upstream.status === 429) {
      throw new ModelError('The devotional engine is at its usage limit. Try again in a minute.', 429)
    }
    throw new ModelError('The devotional engine had a problem this morning.')
  }
  const payload = await upstream.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new ModelError('The devotional engine returned nothing usable.')
  }
  return content
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* fall through to tolerant extraction */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      /* fall through */
    }
  }
  throw new ModelError('The devotional engine produced unreadable output.')
}

function asList(value: unknown): Array<{ teacher: string; point: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const teacher = typeof item?.teacher === 'string' ? item.teacher.trim() : ''
      const point = typeof item?.point === 'string' ? item.point.trim() : ''
      return teacher && point ? { teacher, point } : null
    })
    .filter(Boolean) as Array<{ teacher: string; point: string }>
}

interface NormalizedDevotion {
  title: string
  keyScripture: string
  keyScriptureText: string
  thought: string
  teaches: string
  trustedTeachers: Array<{ teacher: string; point: string }>
  questions: string[]
  application: string
  prayer: string
  selah: string
}

/**
 * Validates the model's JSON and hard-fixes the two fields that must be
 * ground truth, not model memory: the scripture reference is the anchor we
 * fetched, and the quoted text is replaced with the exact text we fetched.
 */
function normalizeDevotion(raw: unknown, anchor: { reference: string | null; text: string | null }): NormalizedDevotion {
  const s = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const record = (raw ?? {}) as Record<string, unknown>

  const title = s(record.title)
  const keyScripture = s(record.keyScripture) || anchor.reference || ''
  const thought = s(record.thought)
  const teaches = s(record.teaches)
  const application = s(record.application)
  const prayer = s(record.prayer)
  const questions = Array.isArray(record.questions)
    ? record.questions.map((q) => s(q)).filter(Boolean).slice(0, 3)
    : []

  const required = { title, thought, teaches, application, prayer }
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length > 0) {
    throw new ModelError(`The devotional engine skipped: ${missing.join(', ')}`)
  }
  if (questions.length < 2) {
    throw new ModelError('The devotional engine skipped the reflection questions.')
  }

  // Scripture is the anchor text we actually fetched. The model may have
  // paraphrased or embellished; we do not trust it, we override it.
  const keyScriptureText = anchor.text ?? ''

  return {
    title,
    keyScripture: anchor.reference ?? keyScripture,
    keyScriptureText,
    thought,
    teaches,
    trustedTeachers: asList(record.trustedTeachers),
    questions,
    application,
    prayer,
    selah: s(record.selah),
  }
}

// --- The function -----------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const requestedHeaders = req.headers.get('Access-Control-Request-Headers')
    return new Response(null, { headers: corsHeaders(requestedHeaders) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!BASE_URL || !API_KEY) {
    console.error('daily-devotion: OPENAI_BASE_URL / OPENAI_API_KEY not configured')
    return json({ error: 'The daily devotional is not configured yet.' }, 503)
  }

  // Auth: the real boundary.
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in to see today\'s devotion.' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  const user = userData?.user
  if (userError || !user) return json({ error: 'Session expired — sign in again.' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Malformed request.' }, 400)
  }

  const date = String(body.date ?? '')
  const serverToday = todayISO()
  if (!isNearToday(date, serverToday)) {
    return json({ error: 'Invalid date.' }, 400)
  }

  // Already generated for today? Return it — never regenerate in a loop.
  const existing = await admin
    .from('daily_devotions')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .maybeSingle()
  if (existing.error) {
    console.error('daily-devotion: existing fetch failed', existing.error)
    return json({ error: 'Could not read today\'s devotion.' }, 503)
  }
  if (existing.data) return json({ devotion: existing.data })

  // --- Topic selection: random + intentional -------------------------------
  const { data: historyRows } = await admin
    .from('daily_devotions')
    .select('topic, date')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(HISTORY_LOOKBACK_DAYS)
  const history = (historyRows ?? []).map((row) => row.topic as string)
  const cutoff = dateNDaysAgo(date, RECENT_WINDOW_DAYS)
  const recent = (historyRows ?? [])
    .filter((row) => row.date >= cutoff)
    .map((row) => row.topic as string)

  const topic = pickTopic(history, recent)

  // --- Scripture ground truth ----------------------------------------------
  const anchor = await fetchAnchorText(topic.anchors)

  const prompt = buildDevotionPrompt({
    topicLabel: topic.label,
    blurb: topic.blurb,
    anchorReference: anchor.reference,
    anchorText: anchor.text,
    teacherNotes: notesFor(topic),
  })

  // --- Generate (one retry on malformed/insufficient output) ---------------
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: prompt },
  ]

  let devotion: NormalizedDevotion
  try {
    let raw = extractJson(await callModel(messages))
    try {
      devotion = normalizeDevotion(raw, anchor)
    } catch {
      // One measured retry, then give up for the day rather than burn tokens.
      const retry = await callModel([
        ...messages,
        { role: 'user', content: 'Return ONLY the JSON object. No markdown fences, no prose before or after. All fields required.' },
      ])
      devotion = normalizeDevotion(extractJson(retry), anchor)
    }
  } catch (err) {
    if (err instanceof ModelError && err.status === 429) {
      return json({ error: err.message, code: 'rate_limited' }, 429)
    }
    console.error('daily-devotion: generation failed', err)
    return json({ error: 'Could not write today\'s devotion. Try again in a moment.' }, 503)
  }

  // --- Persist single-flight: two tabs on a new day must not double-write ---
  const sources = [
    ...(anchor.reference ? [{ type: 'scripture', value: anchor.reference }] : []),
    ...devotion.trustedTeachers.map((t) => ({ type: 'teacher', value: t.teacher })),
  ]

  const { error: insertError } = await admin
    .from('daily_devotions')
    .upsert(
      {
        user_id: user.id,
        date,
        topic: topic.id,
        topic_label: topic.label,
        title: devotion.title,
        key_scripture: devotion.keyScripture,
        key_scripture_text: devotion.keyScriptureText,
        key_scripture_translation: BIBLE_TRANSLATION_NAME,
        thought: devotion.thought,
        teaches: devotion.teaches,
        trusted_teachers: devotion.trustedTeachers,
        questions: devotion.questions,
        application: devotion.application,
        prayer: devotion.prayer,
        selah: devotion.selah || null,
        sources,
      },
      { onConflict: 'user_id,date', ignoreDuplicates: true }
    )
  if (insertError) {
    console.error('daily-devotion: insert failed', insertError)
    return json({ error: 'Could not save today\'s devotion.' }, 503)
  }

  const saved = await admin
    .from('daily_devotions')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .maybeSingle()
  if (saved.error || !saved.data) {
    console.error('daily-devotion: read-back failed', saved.error)
    return json({ error: 'Could not save today\'s devotion.' }, 503)
  }

  return json({ devotion: saved.data })
})