// "Explain" for a verse selection, answered by the SELAH agent on the OpenCode
// bridge (POST /api/explain/start, then poll /api/chat/status/<jobId>).
//
// Pure and dependency-free so it can be tested under node --test: the bridge
// base URL and the token getter are passed in by the component, never read
// from import.meta.env or Supabase here.
//
// Only the reference and translation name are sent. The bridge builds the
// SELAH prompt itself and bridge.php caches the answer for every reader, so
// there is nothing here a caller could use to steer the agent. A cached
// answer comes back from the start call already done.
//
// Any failure throws; ExplainSheet then falls back to Zackion.

export const EXPLAIN_TIMEOUT_MS = 120_000
export const EXPLAIN_POLL_MS = 2000

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }, { once: true })
})

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}

/**
 * @param {object} args
 * @param {string} args.base        bridge base URL (bridge.php in production)
 * @param {string} args.reference   "John 3:16"
 * @param {string} args.translation "World English Bible"
 * @param {() => Promise<string|null>} [args.getToken] Supabase access token; omit for a local bridge
 * @param {(text: string) => void} [args.onText] called with the text so far
 * @returns {Promise<string>} the finished explanation
 */
export async function explainWithSelah({
  base, reference, translation, signal, getToken, onText = () => {},
  fetchImpl = globalThis.fetch, sleepImpl = sleep, now = Date.now, timeoutMs = EXPLAIN_TIMEOUT_MS,
}) {
  if (!base) throw new Error('The SELAH bridge is not configured.')
  let token = null
  if (getToken) {
    token = await getToken()
    if (!token) throw new Error('Sign in first.')
  }

  const call = async (path, init) => {
    if (signal?.aborted) throw abortError()
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    let body = null
    try { body = await res.json() } catch { /* not JSON */ }
    if (!res.ok) throw new Error(body?.error || `The SELAH bridge answered ${res.status}.`)
    if (!body || typeof body !== 'object') throw new Error('The SELAH bridge returned an unreadable answer.')
    return body
  }

  const started = await call('/api/explain/start', {
    method: 'POST',
    body: JSON.stringify({ reference, translation }),
  })
  if (started.done) return finish(started, onText)
  if (!started.jobId) throw new Error('The SELAH bridge returned no job id.')

  const deadline = now() + timeoutMs
  const statusPath = `/api/chat/status/${encodeURIComponent(started.jobId)}`
  let shown = ''
  while (now() < deadline) {
    await sleepImpl(EXPLAIN_POLL_MS, signal)
    const status = await call(statusPath, { method: 'GET' })
    if (status.error) throw new Error(`SELAH could not explain this passage: ${status.error}`)
    if (status.done) return finish(status, onText)
    const partial = typeof status.response === 'string' ? status.response : ''
    if (partial && partial !== shown) {
      shown = partial
      onText(partial)
    }
  }
  throw new Error('SELAH took too long to explain this passage.')
}

function finish(body, onText) {
  const text = typeof body.response === 'string' ? body.response.trim() : ''
  if (!text) throw new Error('SELAH returned an empty explanation.')
  onText(text)
  return text
}
