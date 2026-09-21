import { supabase } from '../lib/supabase'
import { buildAskTask } from '../lib/askTask.js'

// Ask the OpenCode agent a question.
//
// The browser talks DIRECTLY to bridge.php on the same server as the bridge —
// not through a Supabase Edge Function. The Edge Function route worked but was
// slow and flaky: it lived in a different region, and the path back to this
// host intermittently hung. Direct is one hop and reliable.
//
// Security is preserved: the caller sends its own Supabase JWT, bridge.php
// verifies it is a real admin (is_admin in the database) and then forwards to
// the bridge with the server-side BRIDGE_TOKEN. The bridge token never leaves
// the server.

// The public host that runs bridge.php and, behind it, the OpenCode bridge.
// Same origin as the deployed app, so no CORS in production.
const BRIDGE_BASE = 'https://selah.devocean.website/bridge.php'
// big-pickle is outside the OpenCode workspace spending cap; every other
// opencode/* model returns an empty reply once that cap is hit.
const ASK_MODEL = 'opencode/big-pickle'
// A question can take a couple of minutes; keep it comfortably under the
// AskAgentPanel copy ("up to two minutes").
const ASK_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 2000

/**
 * @param {string} question
 * @returns {Promise<string>} the agent's answer
 */
export async function askAgent(question) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Sign in first.')

  const started = await bridgeJson('/api/chat/start', token, {
    method: 'POST',
    body: JSON.stringify({ message: buildAskTask(question), model: ASK_MODEL }),
  })
  if (!started?.jobId) {
    throw new Error(started?.error || 'The bridge accepted the question but returned no job id.')
  }
  const jobId = encodeURIComponent(started.jobId)

  const deadline = Date.now() + ASK_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const status = await bridgeJson(`/api/chat/status/${jobId}`, token, { method: 'GET' })
    if (!status?.done) continue
    if (status.error) throw new Error(`The agent failed: ${status.error}`)
    const text = (status.response ?? '').trim()
    if (!text) throw new Error('The agent finished but produced no answer.')
    return text
  }
  throw new Error('The agent did not answer in time.')
}

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
        Authorization: `Bearer ${token}`,
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