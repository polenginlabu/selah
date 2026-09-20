import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { API_BIBLES, parseChapterContent, validChapter } from '../_shared/bible.js'

const API_KEY = Deno.env.get('API_BIBLE_KEY') ?? ''
const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

class ProviderError extends Error {
  constructor(public status: number) { super('Bible provider request failed') }
}

async function upstream(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://rest.api.bible/v1/${path}`)
  url.search = new URLSearchParams(params).toString()
  const response = await fetch(url, {
    headers: { 'api-key': API_KEY }, signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new ProviderError(response.status)
  return response.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in to read these translations.' }, 401)
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return json({ error: 'Session expired. Please sign in again.' }, 401)
  if (!API_KEY) return json({ error: 'API.Bible is not configured. Set the API_BIBLE_KEY Edge Function secret.' }, 503)

  let body
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400)
  try {
    if (body.action === 'bibles') {
      const { data: bibles } = await upstream('bibles', { language: 'eng' })
      return json({ translations: API_BIBLES.filter((b) => bibles.some((v: { id: string }) => v.id === b.bibleId)) })
    }
    const translation = API_BIBLES.find((b) => b.id === body.translation)
    if (!translation) return json({ error: 'Choose an available translation.' }, 400)
    if (body.action === 'chapter') {
      if (!validChapter(body.bookId, body.chapter)) return json({ error: 'Invalid chapter.' }, 400)
      const { data: chapter, meta } = await upstream(`bibles/${translation.bibleId}/chapters/${body.bookId}.${body.chapter}`, {
        // include-titles brings the section headings ("Jesus Feeds the Five
        // Thousand") that translators place above a pericope. They arrive as
        // para nodes with a style of s1/s2/ms, which parseChapterContent keeps
        // separate from the verse text — they are editorial, not Scripture.
        'content-type': 'json', 'include-notes': 'false', 'include-titles': 'true',
        'include-chapter-numbers': 'false', 'include-verse-numbers': 'true', 'include-verse-spans': 'true',
      })
      return json({
        translation: translation.id, translationName: translation.name, abbreviation: translation.abbreviation,
        reference: chapter.reference, verses: parseChapterContent(chapter.content),
        copyright: chapter.copyright, fumsToken: meta?.fumsToken,
      })
    }
    if (body.action === 'search') {
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      const offset = body.offset ?? 0
      if (query.length < 2 || query.length > 120 || !Number.isInteger(offset) || offset < 0 || offset > 1000) {
        return json({ error: 'Enter 2–120 characters to search.' }, 400)
      }
      const { data: results, meta } = await upstream(`bibles/${translation.bibleId}/search`, {
        query, limit: '20', offset: String(offset), sort: 'canonical',
      })
      return json({
        verses: results.verses ?? [], passages: results.passages ?? [],
        total: results.total ?? results.passages?.length ?? 0, fumsToken: meta?.fumsToken,
      })
    }
    return json({ error: 'Unknown Bible action.' }, 400)
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : 502
    console.error('bible-reader: upstream status', status)
    if (status === 429) return json({ error: 'The Bible service is busy. Please try again shortly.' }, 429)
    if (status === 403 || status === 401) return json({ error: 'This translation is not accessible. Check the API.Bible subscription and key.' }, 503)
    if (status === 404) return json({ error: 'This passage is not available in this translation.' }, 404)
    return json({ error: 'Could not reach the Bible service. Please try again.' }, 502)
  }
})
