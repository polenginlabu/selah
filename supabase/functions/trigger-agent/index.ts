// Queues a job for the OpenCode agent and asks GitHub to run it.
//
// Same shape as trigger-devotion, and for the same reason: the browser cannot
// run the agent itself, and nothing should hold an agent process open waiting
// for it. This inserts a row, dispatches the workflow, and returns the job id.
// The app then watches the row — so a closed tab loses nothing, and a run that
// takes four minutes is not a four-minute HTTP request.
//
// It replaces the bridge-admin consolidation path, which proxied to an agent
// running on the web host. That could not be kept alive: the shared plan's
// process limiter killed OpenCode whenever it did real work.
//
// Secrets:
//   supabase secrets set GITHUB_TOKEN=github_pat_...   # fine-grained, actions:write
//   supabase secrets set GITHUB_REPO=owner/repo
//   supabase secrets set GITHUB_AGENT_WORKFLOW=agent-job.yml   # optional
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') ?? ''
const GITHUB_REPO = Deno.env.get('GITHUB_REPO') ?? ''
const GITHUB_WORKFLOW = Deno.env.get('GITHUB_AGENT_WORKFLOW') ?? 'agent-job.yml'
const GITHUB_REF = Deno.env.get('GITHUB_REF') ?? 'main'

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('CHAT_ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function corsHeaders(requested: string | null): Record<string, string> {
  return { ...CORS, 'Access-Control-Allow-Headers': requested ?? 'authorization, content-type, x-client-info' }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

const MAX_PROMPT = 4000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('trigger-agent: GITHUB_TOKEN / GITHUB_REPO not configured')
    return json({ error: 'Agent runs are not wired up yet (missing secrets).', code: 'not_configured' }, 503)
  }

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
    console.error('trigger-agent: is_admin failed', adminError)
    return json({ error: 'Could not verify your account.' }, 503)
  }
  if (isAdmin !== true) return json({ error: 'Admins only.' }, 403)

  // --- Inputs ---------------------------------------------------------------
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400)
  }

  const kind = String(body.kind ?? 'ask')
  if (kind !== 'ask' && kind !== 'consolidation') {
    return json({ error: `Unknown job kind: ${kind}` }, 400)
  }

  let prompt: string | null = null
  if (kind === 'ask') {
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) return json({ error: 'Type a question first.' }, 400)
    if (prompt.length > MAX_PROMPT) {
      return json({ error: `That question is too long (max ${MAX_PROMPT} characters).` }, 400)
    }
  }

  let scopeRef: string | null = null
  if (typeof body.ref === 'string' && body.ref.trim()) {
    // An opaque 8-char disciple ref, never a name — the de-identified view is
    // the only thing the agent's database role can read.
    if (!/^[0-9a-f]{1,8}$/i.test(body.ref.trim())) {
      return json({ error: 'A person ref must be 1-8 hex characters.' }, 400)
    }
    scopeRef = body.ref.trim().toLowerCase()
  }

  // --- Queue ----------------------------------------------------------------
  // Service role: agent_jobs has no client insert policy, so "who may run the
  // agent" is decided once, here, by is_admin — not by a policy that would
  // have to be kept in step with it.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: job, error: insertError } = await admin
    .from('agent_jobs')
    .insert({ kind, prompt, scope_ref: scopeRef, requested_by: userData.user.id })
    .select('id')
    .single()

  if (insertError || !job) {
    console.error('trigger-agent: insert failed', insertError)
    return json({ error: 'Could not queue the job.' }, 503)
  }

  // --- Dispatch -------------------------------------------------------------
  const inputs: Record<string, string> = { job_id: job.id }
  if (typeof body.model === 'string' && body.model.trim()) inputs.model = body.model.trim()

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
    console.error('trigger-agent: GitHub unreachable', err)
    await admin.from('agent_jobs')
      .update({ status: 'failed', error: 'Could not reach GitHub to start the run.' })
      .eq('id', job.id)
    return json({ error: 'Could not reach GitHub.' }, 503)
  }

  if (upstream.status !== 204) {
    const detail = await upstream.text().catch(() => '')
    console.error('trigger-agent: dispatch rejected', upstream.status, detail.slice(0, 300))
    // The row must not sit 'queued' forever for a run that will never start.
    await admin.from('agent_jobs')
      .update({ status: 'failed', error: `GitHub rejected the run (HTTP ${upstream.status}).` })
      .eq('id', job.id)
    return json({ error: `GitHub rejected the run (HTTP ${upstream.status}).` }, 502)
  }

  return json({ ok: true, jobId: job.id }, 200)
})
