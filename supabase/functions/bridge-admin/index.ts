// Lets an admin check the OpenCode bridge from inside SELAH, and ask it to run
// or ask it a question.
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
import { buildAskTask, AgentTaskError, MAX_QUESTION_LENGTH } from '../_shared/agentTask.js'

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

// An ask drives a full agent session, which takes tens of seconds.
// This must stay under the Edge Function's own execution timeout — raise that in
// supabase/config.toml (see docs/discipleship/README.md). Tune with an env var.
// Kept under the Supabase Edge Function wall-clock limit (150s on free), so
// a slow answer fails with our message rather than a bare gateway error.
const ASK_TIMEOUT_MS = Number(Deno.env.get('ASK_TIMEOUT_MS') ?? 120_000)
// big-pickle is outside the OpenCode workspace spending cap; every other
// opencode/* model returns an empty reply once that cap is hit.
const ASK_MODEL = Deno.env.get('ASK_MODEL') ?? 'opencode/big-pickle'

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
// Ask orchestration
// ---------------------------------------------------------------------------

// The task handed to the server-side OpenCode agent. The agent runs inside the
// checked-out SELAH repo, so it can read the prompt + knowledge base committed
// under docs/discipleship/, and connect to Postgres with the least-privilege
// selah_analyst role (see 20260915b_discipleship_signals.sql). The whole point
// of that role is the agent can ONLY read the de-identified discipleship_signals
// view — never names, contacts, or pastoral notes.
/**
 * Sends one question to the agent and waits for the answer.
 *
 * The bridge's job API is start-then-poll rather than request-response,
 * because a model takes far longer than an HTTP request should. This function
 * hides that: it starts a job, polls until it finishes, and returns the text.
 *
 * Synchronous from the caller's point of view, which is only viable because a
 * question is short work. It is NOT viable for anything that takes minutes —
 * a Supabase Edge Function has its own wall-clock limit (150s on the free
 * plan), so ASK_TIMEOUT_MS is deliberately set below it. A job that needs
 * longer needs a queue, not a bigger number here.
 */
async function runAsk(question: string): Promise<string> {
  // The bridge keys off one global active session, so start a fresh one or the
  // answer inherits an unrelated conversation.
  await bridgeFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `selah-ask-${Date.now()}` }),
  }, 20_000).catch(() => {})

  const started = (await bridgeFetch('/api/chat/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: buildAskTask(question), model: ASK_MODEL }),
  }, 20_000)) as { jobId?: string } | null

  if (!started?.jobId) throw new BridgeError('start', 'The bridge accepted the question but returned no job id.', 502)

  const jobId = encodeURIComponent(started.jobId)
  const deadline = Date.now() + ASK_TIMEOUT_MS
  let lastPhase = ''

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const status = (await bridgeFetch(`/api/chat/status/${jobId}`, { method: 'GET' }, 15_000)) as {
      done?: boolean
      error?: unknown
      response?: string
      phase?: string
    } | null

    if (!status) continue
    if (status.phase) lastPhase = status.phase
    if (!status.done) continue

    if (status.error) {
      throw new BridgeError('run', `The agent failed${lastPhase ? ` (last: ${lastPhase})` : ''}: ${String(status.error)}`, 502)
    }
    const text = (status.response ?? '').trim()
    if (!text) throw new BridgeError('read', 'The agent finished but produced no answer.', 502)
    return text
  }

  throw new BridgeError('run', 'The agent did not answer in time.', 504)
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

  // --- Ask (multi-step; handled separately from the simple whitelist) --------
  //
  // Not in ACTIONS because that table maps one action to one bridge path, and
  // this is three calls: open a session, start a job, poll it.
  if (action === 'ask') {
    const question = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!question) return json({ error: 'Type a question first.' }, 400)
    if (question.length > MAX_QUESTION_LENGTH) {
      return json({ error: `That question is too long (max ${MAX_QUESTION_LENGTH} characters).` }, 400)
    }
    try {
      const answer = await runAsk(question)
      return json({ ok: true, answer }, 200)
    } catch (err) {
      // Returned as 200 with ok:false so the UI can show WHICH step failed —
      // "the bridge is down" and "the model produced nothing" need different
      // responses from whoever is reading it.
      if (err instanceof BridgeError) {
        console.error(`bridge-admin: ask failed at ${err.step}:`, err.message)
        return json({ ok: false, step: err.step, error: err.message }, 200)
      }
      if (err instanceof AgentTaskError) {
        return json({ ok: false, step: 'task', error: err.message }, 200)
      }
      console.error('bridge-admin: ask failed', err)
      return json({ ok: false, error: 'The run failed unexpectedly.' }, 200)
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