// Lets an admin start a devotion run from the app.
//
// The browser cannot generate a devotion itself: the agent stack listens on
// loopback wherever it happens to be running, a run takes several minutes, and
// writing the row needs the service-role key. So this does not generate
// anything — it asks GitHub to run the same nightly workflow, and the app then
// waits for the row to appear.
//
// The GitHub token lives here rather than in the client for the obvious
// reason: a token with actions:write can run any workflow in the repo, and
// anything in a Vite bundle is public.
//
// Secrets:
//   supabase secrets set GITHUB_TOKEN=github_pat_...   # fine-grained, actions:write
//   supabase secrets set GITHUB_REPO=owner/repo
//   supabase secrets set GITHUB_WORKFLOW=daily-devotion.yml   # optional
//   supabase secrets set GITHUB_REF=main                      # optional
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') ?? ''
const GITHUB_REPO = Deno.env.get('GITHUB_REPO') ?? ''
const GITHUB_WORKFLOW = Deno.env.get('GITHUB_WORKFLOW') ?? 'daily-devotion.yml'
const GITHUB_REF = Deno.env.get('GITHUB_REF') ?? 'main'

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('trigger-devotion: GITHUB_TOKEN / GITHUB_REPO not configured')
    return json({ error: 'Devotion runs are not wired up yet (missing secrets).', code: 'not_configured' }, 503)
  }

  // --- Auth -----------------------------------------------------------------
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sign in first.' }, 401)

  // Act AS the caller, so is_admin() sees their JWT. The admin check is the
  // database's, not this function's: the client-side ADMIN_EMAILS list decides
  // what to render and is not a security boundary.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userError } = await asUser.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Session expired — sign in again.' }, 401)

  const { data: isAdmin, error: adminError } = await asUser.rpc('is_admin')
  if (adminError) {
    console.error('trigger-devotion: is_admin failed', adminError)
    return json({ error: 'Could not verify your account.' }, 503)
  }
  if (isAdmin !== true) return json({ error: 'Admins only.' }, 403)

  // --- Inputs ---------------------------------------------------------------
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    /* an empty body is fine — it means "today, no force" */
  }

  const date = String(body.date ?? '')
  if (date && !DATE_RE.test(date)) return json({ error: 'Invalid date.' }, 400)

  const inputs: Record<string, string> = {}
  if (date) inputs.date = date
  if (body.force === true) inputs.force = 'true'
  if (typeof body.model === 'string' && body.model.trim()) inputs.model = body.model.trim()

  // --- Dispatch -------------------------------------------------------------
  let upstream: Response
  try {
    upstream = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'selah-app',
        },
        body: JSON.stringify({ ref: GITHUB_REF, inputs }),
      }
    )
  } catch (err) {
    console.error('trigger-devotion: GitHub unreachable', err)
    return json({ error: 'Could not reach GitHub.' }, 503)
  }

  // A successful dispatch is 204 with no body.
  if (upstream.status === 204) {
    return json({
      ok: true,
      // The API returns no run id, so the app confirms success by watching for
      // the row rather than by polling a run it cannot name.
      message: 'Run started. It usually takes 3-5 minutes.',
      workflow: GITHUB_WORKFLOW,
    })
  }

  const detail = await upstream.text().catch(() => '')
  console.error('trigger-devotion: dispatch failed', upstream.status, detail.slice(0, 300))

  // These two are worth naming: they are configuration mistakes, not outages,
  // and the generic message sends people looking in the wrong place.
  if (upstream.status === 404) {
    return json(
      {
        error:
          'GitHub could not find that workflow. Check GITHUB_REPO, that the workflow file is on the default branch, and that the token can see this repo.',
        code: 'workflow_not_found',
      },
      503
    )
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return json(
      { error: 'GitHub rejected the token. It needs Actions: read and write on this repo.', code: 'bad_token' },
      503
    )
  }

  return json({ error: `GitHub refused the run (HTTP ${upstream.status}).`, code: 'dispatch_failed' }, 503)
})
