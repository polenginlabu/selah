// Lets an admin check the OpenCode bridge from inside SELAH, and ask it to run
// a discipleship consolidation report.
//
// WHY THIS EXISTS RATHER THAN CALLING THE BRIDGE FROM THE BROWSER
//
// The bridge has no user accounts and runs an agent with filesystem access on
// the server it lives on. Its own source says so: until now the only thing
// protecting it was that it listens on loopback. Pointing the browser straight
// at it would mean publishing that port, and a bearer token shipped in a Vite
// bundle is public the moment it is deployed — so the port would become a
// remote shell for anyone who read the JavaScript.
//
// Instead the browser talks to this function, which:
//   1. verifies the caller is a signed-in admin (in the DATABASE, via is_admin)
//   2. holds the bridge token as a server-side secret
//   3. forwards only named actions — never an arbitrary path
//
// So the bridge only ever accepts requests carrying a secret the browser never
// sees, and only for calls this function is willing to make.
//
// Secrets:
//   supabase secrets set BRIDGE_URL=https://your-host/bridge
//   supabase secrets set BRIDGE_TOKEN=the-same-value-as-on-the-bridge
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BRIDGE_URL = (Deno.env.get('BRIDGE_URL') ?? '').replace(/\/+$/, '')
const BRIDGE_TOKEN = Deno.env.get('BRIDGE_TOKEN') ?? ''

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

// The simple whitelist. A caller names an action; it never names a URL, so this
// cannot be turned into a general-purpose proxy into the private network.
const ACTIONS = {
  health: { method: 'GET', path: '/api/health' },
  models: { method: 'GET', path: '/api/models' },
  'set-model': { method: 'POST', path: '/api/model' },
} as const

type ActionName = keyof typeof ACTIONS

// The bridge can take a moment when OpenCode itself is slow to answer, but a
// status check should never hold the page for long.
const TIMEOUT_MS = 12_000

// A consolidation run drives a full agent session, which can take a few minutes.
// This must stay under the Edge Function's own execution timeout — raise that in
// supabase/config.toml (see docs/discipleship/README.md). Tune with an env var.
const CONSOLIDATION_TIMEOUT_MS = Number(Deno.env.get('CONSOLIDATION_TIMEOUT_MS') ?? 240_000)

// ---------------------------------------------------------------------------
// Bridge HTTP helper
// ---------------------------------------------------------------------------
class BridgeError extends Error {
  step: string
  status?: number
  constructor(step: string, message: string, status?: number) {
    super(message)
    this.step = step
    this.status = status
  }
}

async function bridgeFetch(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  let upstream: Response
  try {
    upstream = await fetch(`${BRIDGE_URL}${path}`, {
      ...init,
      headers: {
        ...(BRIDGE_TOKEN ? { Authorization: `Bearer ${BRIDGE_TOKEN}` } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new BridgeError(path, `Could not reach the bridge at ${BRIDGE_URL}: ${String(err)}`)
  }
  if (upstream.status === 401) {
    throw new BridgeError(path, 'The bridge rejected the token. BRIDGE_TOKEN here must match the bridge’s.', 401)
  }
  const raw = await upstream.text()
  if (!upstream.ok) {
    throw new BridgeError(path, `The bridge answered ${upstream.status} for ${path} (${raw.slice(0, 200)})`, upstream.status)
  }
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    throw new BridgeError(path, `The bridge returned a web page rather than JSON for ${path}.`, upstream.status)
  }
}

// ---------------------------------------------------------------------------
// Consolidation orchestration
// ---------------------------------------------------------------------------

// The task handed to the server-side OpenCode agent. The agent runs inside the
// checked-out SELAH repo, so it can read the prompt + knowledge base committed
// under docs/discipleship/, and connect to Postgres with the least-privilege
// selah_analyst role (see 20260915b_discipleship_signals.sql). The whole point
// of that role is the agent can ONLY read the de-identified discipleship_signals
// view — never names, contacts, or pastoral notes.
function buildTask(scopeRef?: string): string {
  const scope = scopeRef
    ? `Focus on the person with ref "${scopeRef}" and lead with their specific situation, then give the one-paragraph tree summary.`
    : 'Cover the whole tree.'
  return [
    'You are running the SELAH consolidation report.',
    '',
    '1. Read docs/discipleship/agent-prompt.md and follow its system prompt exactly.',
    '2. Read docs/discipleship/knowledge-base.md — it is the only source of church procedure. Do not invent church guidance.',
    '3. Connect to PostgreSQL as the selah_analyst role using the connection string in your environment (the DATABASE_URL / pooler connection for that role) and query the view public.discipleship_signals.',
    `4. ${scope}`,
    '5. Produce the consolidation JSON exactly per the schema in agent-prompt.md: a tree summary + flags, and per-person entries keyed by opaque ref.',
    '',
    'Return ONLY the JSON. No prose before or after it.',
  ].join('\n')
}

// Pulls the first balanced JSON object out of a string, tolerating an agent
// that wrapped the JSON in prose or backticks.
function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // fall back to the first { ... } substring
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new BridgeError('parse', 'The agent did not return JSON.', 502)
    }
    return JSON.parse(cleaned.slice(start, end + 1))
  }
}

async function runConsolidation(scopeRef?: string) {
  // The bridge keys off one global active session, so start a fresh one to keep
  // the report from inheriting an unrelated conversation (same as runAgent).
  await bridgeFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `selah-consolidation-${Date.now()}` }),
  }, 20_000).catch(() => {})

  // big-pickle is the only model outside the OpenCode spending cap that returns
  // a reply (see scripts/selah/bridge.js). Start a job, then poll it.
  const started = (await bridgeFetch('/api/chat/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: buildTask(scopeRef), model: 'opencode/big-pickle' }),
  }, 20_000)) as { jobId?: string } | null

  if (!started?.jobId) throw new BridgeError('start', 'The bridge accepted the prompt but returned no job id.', 502)

  const jobId = encodeURIComponent(started.jobId)
  const deadline = Date.now() + CONSOLIDATION_TIMEOUT_MS
  let lastPhase = ''
  let lastMessage = ''

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const status = (await bridgeFetch(`/api/chat/status/${jobId}`, { method: 'GET' }, 15_000)) as {
      done?: boolean
      error?: unknown
      response?: string
      phase?: string
      message?: string
    } | null

    if (!status) continue
    if (status.phase) lastPhase = status.phase
    if (status.message) lastMessage = status.message
    if (!status.done) continue

    if (status.error) {
      const where = lastPhase || lastMessage
      const detail = String(status.error)
      throw new BridgeError(
        'run',
        `The agent failed${where ? ` (last: ${where})` : ''}: ${detail}`,
        502
      )
    }
    const text = (status.response ?? '').trim()
    if (!text) throw new BridgeError('read', 'The agent finished but produced no output.', 502)
    return extractJson(text)
  }

  throw new BridgeError('run', 'The consolidation agent did not finish in time.', 504)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req.headers.get('Access-Control-Request-Headers')) })
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!BRIDGE_URL) {
    return json({ error: 'The bridge is not wired up yet (BRIDGE_URL is not set).', code: 'not_configured' }, 503)
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
    console.error('bridge-admin: is_admin failed', adminError)
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

  const action = String(body.action ?? '')

  // --- Consolidation (multi-step; handled separately from the simple whitelist)
  if (action === 'consolidation') {
    let scopeRef: string | undefined
    const rawRef = body.ref
    if (typeof rawRef === 'string' && rawRef.trim()) {
      // ref is the first 8 chars of a disciple id — short, opaque, stable.
      if (!/^[0-9a-f]{1,8}$/i.test(rawRef.trim())) {
        return json({ error: 'A person ref must be 1-8 hex characters.' }, 400)
      }
      scopeRef = rawRef.trim().toLowerCase()
    }
    try {
      const report = await runConsolidation(scopeRef)
      return json({ ok: true, report }, 200)
    } catch (err) {
      if (err instanceof BridgeError) {
        console.error(`bridge-admin: consolidation failed at ${err.step}:`, err.message)
        return json({ ok: false, step: err.step, error: err.message, status: err.status ?? 502 }, 200)
      }
      console.error('bridge-admin: consolidation failed', err)
      return json({ ok: false, error: 'The consolidation run failed unexpectedly.', status: 500 }, 200)
    }
  }

  const route = ACTIONS[action as ActionName]
  if (!route) return json({ error: `Unknown action: ${action || '(none)'}` }, 400)

  let payload: string | undefined
  if (action === 'set-model') {
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    // Model ids are "provider/model" or a bare id. Anything else is a caller
    // bug, and keeping the shape tight keeps odd values out of the bridge.
    if (!model || model.length > 200 || !/^[\w.\-]+(\/[\w.\-]+)?$/.test(model)) {
      return json({ error: 'A valid model id is required.' }, 400)
    }
    payload = JSON.stringify({ model })
  }

  // --- Forward --------------------------------------------------------------
  let data: unknown
  let status = 200
  try {
    data = await bridgeFetch(route.path, {
      method: route.method,
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      ...(payload ? { body: payload } : {}),
    })
  } catch (err) {
    if (err instanceof BridgeError && err.status) {
      // Known upstream answers (token rejected, HTML page) come back as results,
      // not as failures of this function.
      return json({ ok: false, reachable: true, status: err.status, error: err.message }, 200)
    }
    // Bridge (or the box) being down — report as a result rather than a failure.
    return json({
      ok: false,
      reachable: false,
      error: `Could not reach the bridge at ${BRIDGE_URL}. Is opencode serve and the bridge running?`,
    }, 200)
  }

  return json({ ok: true, reachable: true, status, data }, 200)
})