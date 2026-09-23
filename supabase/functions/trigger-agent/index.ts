// Queues work for the OpenCode agent and asks GitHub to run it.
//
// WHY THIS EXISTS RATHER THAN THE BROWSER CALLING THE AGENT
//
// The agent used to be reached synchronously through a bridge running on the
// web host, proxied by public/bridge.php. That could not hold: the shared
// plan's process limiter killed OpenCode whenever it did real work, silently,
// leaving thirty "listening" lines and no error to read.
//
// So the agent now runs where there is room for it — a GitHub Actions runner
// that installs OpenCode, uses it, and is thrown away. The same shape the
// nightly devotion already uses (see trigger-devotion, which this is modelled
// on). Nothing persistent runs on Hostinger any more; it serves the built
// site and nothing else.
//
// That makes the work ASYNCHRONOUS, so this function does two things and then
// gets out of the way:
//   1. inserts a queued row in agent_jobs (service role — RLS denies every
//      client write, so this is the only door)
//   2. dispatches the agent-job workflow with that row's id
// The app then watches the row. A browser that closes mid-run loses nothing.
//
// The GitHub token lives here rather than in the client for the obvious
// reason: a token with actions:write can run any workflow in the repo, and
// anything in a Vite bundle is public.
//
// Secrets:
//   supabase secrets set GITHUB_TOKEN=github_pat_...   # fine-grained, actions:write
//   supabase secrets set GITHUB_REPO=owner/repo
//   supabase secrets set GITHUB_AGENT_WORKFLOW=agent-job.yml   # optional
//   supabase secrets set GITHUB_REF=main                       # optional
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { MAX_QUESTION_LENGTH } from '../_shared/agentTask.js'

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

const KINDS = ['ask', 'consolidation']
// Matches the scope_ref check constraint in 20260921_agent_jobs.sql.
const REF_RE = /^[0-9a-f]{1,8}$/
// An allowlist, not free text: `model` reaches the agent's command line, and
// the workflow would happily run whatever it is handed.
const MODELS = [
  'opencode/big-pickle',
  'opencode/claude-sonnet-4-6',
  'opencode/claude-opus-4-1',
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('trigger-agent: GITHUB_TOKEN / GITHUB_REPO not configured')
    return json({ error: 'Agent runs are not wired up yet (missing secrets).', code: 'not_configured' }, 503)
  }
  if (!SERVICE_KEY) {
    console.error('trigger-agent: SUPABASE_SERVICE_ROLE_KEY not configured')
    return json({ error: 'Agent runs are not wired up yet (missing secrets).', code: 'not_configured' }, 503)
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

  const kind = String(body.kind ?? '')
  if (!KINDS.includes(kind)) return json({ error: 'Unknown kind of agent job.' }, 400)

  // For 'ask' this is the question EXACTLY as typed. The framing that makes it
  // read-only is added by the runner (scripts/selah/runAgentJob.js), not here,
  // so the stored prompt can never drift from what actually ran.
  let prompt: string | null = null
  if (kind === 'ask') {
    prompt = String(body.question ?? '').trim()
    if (!prompt) return json({ error: 'A question is required.' }, 400)
    if (prompt.length > MAX_QUESTION_LENGTH) {
      return json({ error: `That question is too long (max ${MAX_QUESTION_LENGTH} characters).` }, 400)
    }
  }

  const rawRef = body.ref == null ? '' : String(body.ref).trim()
  if (rawRef && !REF_RE.test(rawRef)) return json({ error: 'Invalid disciple ref.' }, 400)
  const scopeRef = rawRef || null

  const rawModel = body.model == null ? '' : String(body.model).trim()
  if (rawModel && !MODELS.includes(rawModel)) return json({ error: 'Unknown model.' }, 400)

  // --- Queue ----------------------------------------------------------------
  const asService = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: job, error: insertError } = await asService
    .from('agent_jobs')
    .insert({
      kind,
      prompt,
      scope_ref: scopeRef,
      model: rawModel || null,
      requested_by: userData.user.id,
    })
    .select('id')
    .single()

  if (insertError || !job?.id) {
    console.error('trigger-agent: could not queue the job', insertError)
    return json({ error: 'Could not queue the job.' }, 503)
  }

  // --- Dispatch -------------------------------------------------------------
  //
  // From here a failure must also FAIL THE ROW. A queued row nobody will ever
  // claim is the worst outcome available: the app would sit and watch it until
  // its own timeout, reporting "still running" about a run that never started.
  async function abandon(message: string, code: string, status = 503) {
    await asService
      .from('agent_jobs')
      .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
      .eq('id', job.id)
    return json({ error: message, code, jobId: job.id }, status)
  }

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
        body: JSON.stringify({ ref: GITHUB_REF, inputs: { job_id: job.id } }),
      }
    )
  } catch (err) {
    console.error('trigger-agent: GitHub unreachable', err)
    return await abandon('Could not reach GitHub.', 'github_unreachable')
  }

  // A successful dispatch is 204 with no body.
  if (upstream.status === 204) {
    return json({
      ok: true,
      // The API returns no run id, so the app confirms progress by watching the
      // row rather than by polling a run it cannot name.
      jobId: job.id,
      message: 'Run started. A runner takes a minute or two to pick it up.',
      workflow: GITHUB_WORKFLOW,
    })
  }

  const detail = await upstream.text().catch(() => '')
  console.error('trigger-agent: dispatch failed', upstream.status, detail.slice(0, 300))

  // These two are configuration mistakes, not outages, and the generic message
  // sends people looking in the wrong place.
  if (upstream.status === 404) {
    return await abandon(
      'GitHub could not find that workflow. Check GITHUB_REPO, that the workflow file is on the default branch, and that the token can see this repo.',
      'workflow_not_found'
    )
  }
  if (upstream.status === 401 || upstream.status === 403) {
    return await abandon(
      'GitHub rejected the token. It needs Actions: read and write on this repo.',
      'bad_token'
    )
  }

  return await abandon(`GitHub refused the run (HTTP ${upstream.status}).`, 'dispatch_failed')
})
