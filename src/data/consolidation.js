import { supabase } from '../lib/supabase'
import { buildConsolidationTask, extractJson, normalizeReport } from '../lib/consolidationTask.js'

// Re-exported so the UI maps refs back to names with the same helpers the task
// and tests use.
export { refOf, buildRefIndex, normalizeReport } from '../lib/consolidationTask.js'

// Runs the discipleship consolidation report through the OpenCode bridge.
//
// Like the "ask the agent" flow (src/data/agent.js), the browser talks to the
// bridge — directly on loopback in development, through bridge.php in
// production. The consolidation task tells OpenCode to read the knowledge base
// and query Supabase (via psql + the least-privilege selah_analyst role), then
// return structured JSON keyed by opaque refs. Names are resolved client-side.

// See src/data/agent.js for why this is NOT VITE_BRIDGE_URL.
const BRIDGE_BASE =
  import.meta.env.VITE_AGENT_BRIDGE_URL ||
  (import.meta.env.DEV
    ? 'http://127.0.0.1:4098'
    : 'https://selah.devocean.website/bridge.php')

// Only the PHP shim needs the caller's JWT — it uses it for the admin gate.
const NEEDS_JWT = !BRIDGE_BASE.startsWith('http://127.0.0.1')
// big-pickle is outside the OpenCode workspace spending cap; every other
// opencode/* model returns an empty reply once that cap is hit.
const CONSOLIDATION_MODEL = 'opencode/big-pickle'
// A consolidation run reads the whole tree and reasons over it — minutes, not
// seconds. The bridge's own job deadline is 10 minutes; keep the client under
// it so we report a clear error rather than racing it.
const CONSOLIDATION_TIMEOUT_MS = 9 * 60 * 1000
const POLL_INTERVAL_MS = 2000

/**
 * Runs the consolidation report and returns it normalised for the UI.
 *
 * @param {object} opts
 * @param {string} [opts.ref] 8-char opaque disciple ref to focus on.
 * @param {(seconds: number, status: string) => void} [opts.onProgress]
 * @returns {Promise<object>} normalized report (see normalizeReport).
 * @throws {Error} with a useful message on failure or empty/error result.
 */
export async function generateConsolidation({ ref, onProgress } = {}) {
  let token = null
  if (NEEDS_JWT) {
    const { data: { session } } = await supabase.auth.getSession()
    token = session?.access_token
    if (!token) throw new Error('Sign in first.')
  }

  const started = await bridgeJson('/api/chat/start', token, {
    method: 'POST',
    body: JSON.stringify({
      message: buildConsolidationTask(ref),
      model: CONSOLIDATION_MODEL,
    }),
  })
  if (!started?.jobId) {
    throw new Error(started?.error || 'The bridge accepted the task but returned no job id.')
  }
  const jobId = encodeURIComponent(started.jobId)

  const deadline = Date.now() + CONSOLIDATION_TIMEOUT_MS
  let lastPhase = ''
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const status = await bridgeJson(`/api/chat/status/${jobId}`, token, { method: 'GET' })
    const phase = `${status.phase}: ${status.message}`
    if (phase !== lastPhase) {
      lastPhase = phase
      onProgress?.(Math.floor((Date.now() - startedAt()) / 1000), status.message)
    }
    if (!status?.done) continue
    if (status.error) throw new Error(`The consolidation run failed: ${status.error}`)
    const text = (status.response ?? '').trim()
    if (!text) throw new Error('The run finished but produced no report.')

    let parsed
    try {
      parsed = extractJson(text)
    } catch {
      // Show what came back rather than a generic parse failure — an agent that
      // explains why it could not report is more useful than "invalid JSON".
      throw new Error(`The agent did not return a report: ${text.slice(0, 200)}`)
    }

    // The task tells the agent to return {"error": "..."} rather than invent
    // figures when it cannot read the database. Surface that as the failure it
    // is, instead of rendering an empty report as though it were real.
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
      throw new Error(parsed.error)
    }

    const report = normalizeReport(parsed)
    if (!report) throw new Error('The agent returned an unreadable report.')
    return report
  }

  throw new Error(`The consolidation did not finish within ${Math.round(CONSOLIDATION_TIMEOUT_MS / 60000)} minutes.`)
}

const startedAt = () => Date.now()

/**
 * Calls a bridge.php endpoint with the caller's Supabase JWT.
 * Throws with a useful message for every non-2xx / non-JSON response.
 */
async function bridgeJson(path, token, init) {
  let res
  try {
    res = await fetch(`${BRIDGE_BASE}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (err) {
    throw new Error(`Could not reach the bridge at ${BRIDGE_BASE}: ${err?.message ?? err}`)
  }

  let raw = ''
  try {
    raw = await res.text()
  } catch {
    raw = ''
  }

  let body = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    // not JSON
  }

  if (!res.ok) {
    const message = body?.error || raw.slice(0, 200) || `HTTP ${res.status}`
    throw new Error(`${message} (${res.status})`)
  }
  if (typeof body !== 'object' || body === null) {
    throw new Error('The bridge returned an unreadable answer.')
  }
  return body
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))