// Node client for the OpenCode bridge, for the devotion generator.
//
// Deliberately NOT shared with src/lib/bibleChatBridge.js, because the two
// want opposite things from the agent:
//
//   study assistant  — tools OFF, answer in seconds, grounded in one passage
//   daily devotion   — tools ON, research for minutes, verify real sources
//
// Section 5 and section 11 of the SELAH brief only mean anything if the agent
// can genuinely search, so this path lets it, and waits.

const DEFAULT_BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://127.0.0.1:4098'
// big-pickle is outside the OpenCode workspace spending limit that silently
// empties every other model once the monthly cap is hit, so it is the one that
// actually runs. It researches properly (websearch + webfetch) but writes
// shorter than the brief's 500-800 word target, which the validator catches.
const DEFAULT_MODEL = process.env.BRIDGE_MODEL ?? 'opencode/big-pickle'

const POLL_INTERVAL_MS = 2000
// Research takes minutes, not seconds. The bridge's own job deadline is 10
// minutes; stay under it so we report a clear error rather than racing it.
const MAX_WAIT_MS = 9 * 60 * 1000

export class BridgeError extends Error {}

/**
 * Runs one prompt through the bridge and returns the agent's final text.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {string} [opts.bridgeUrl]
 * @param {(phase: string, detail: string) => void} [opts.onProgress]
 */
export async function runAgent({
  prompt,
  model = DEFAULT_MODEL,
  bridgeUrl = DEFAULT_BRIDGE_URL,
  onProgress = () => {},
}) {
  const base = bridgeUrl.replace(/\/+$/, '')

  await assertBridgeReady(base)
  // A fresh session per run: the bridge keys off one global active session, so
  // without this a run inherits the previous run's conversation.
  await post(base, '/api/sessions', { title: `selah-devotion-${Date.now()}` }).catch(() => {})

  const started = await post(base, '/api/chat/start', { message: prompt, model })
  if (!started?.jobId) throw new BridgeError('The bridge accepted the prompt but returned no job id.')

  const deadline = Date.now() + MAX_WAIT_MS
  let lastPhase = ''

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const status = await get(base, `/api/chat/status/${encodeURIComponent(started.jobId)}`)

    const phase = `${status.phase}: ${status.message}`
    if (phase !== lastPhase) {
      lastPhase = phase
      onProgress(status.phase, status.message)
    }

    if (!status.done) continue
    if (status.error) throw new BridgeError(`The agent failed: ${status.error}`)
    if (!status.response?.trim()) throw new BridgeError('The agent finished but produced no output.')
    return status.response
  }

  throw new BridgeError(`The agent did not finish within ${Math.round(MAX_WAIT_MS / 60000)} minutes.`)
}

/**
 * Fails early and specifically. Without this, a bridge pointed at a missing
 * root path or a dead OpenCode looks identical to a slow model: you wait two
 * minutes and get "stalled without progress".
 */
async function assertBridgeReady(base) {
  let health
  try {
    health = await get(base, '/api/health')
  } catch (err) {
    throw new BridgeError(
      `Cannot reach the bridge at ${base}. Is it running? (cd backend/bridge/opencode-bridge && npm start)\n  ${err.message}`
    )
  }
  if (!health?.success) {
    throw new BridgeError(
      `The bridge is up but OpenCode is not: ${health?.error ?? 'unknown'}. Start it with: opencode serve --port 4097`
    )
  }
}

async function get(base, path) {
  const res = await fetch(`${base}${path}`)
  return await parse(res, base, path)
}

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await parse(res, base, path)
}

async function parse(res, base, path) {
  const raw = await res.text()
  // 4097 (OpenCode's own web UI) answers every request with HTML and a 200.
  // Name that mistake instead of failing later on a missing field.
  if (/^\s*<(?:!doctype|html)/i.test(raw)) {
    throw new BridgeError(
      `${base} is not the bridge — it returned a web page. The bridge is port 4098; 4097 is OpenCode behind it.`
    )
  }
  if (!res.ok) throw new BridgeError(`${path} failed: HTTP ${res.status} ${raw.slice(0, 200)}`)
  try {
    return JSON.parse(raw)
  } catch {
    throw new BridgeError(`${path} returned unreadable output: ${raw.slice(0, 200)}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
