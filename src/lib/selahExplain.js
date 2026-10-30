// "Explain" for a verse selection, answered by the SELAH agent on the OpenCode
// bridge (POST /api/explain/stream, through public/bridge.php in production).
//
// Pure and dependency-free so it can be tested under node --test: the bridge
// base URL and the token getter are passed in by the component, never read
// from import.meta.env or Supabase here.
//
// Only the reference and translation name are sent. The bridge builds the
// SELAH prompt itself and bridge.php caches the answer for every reader, so
// there is nothing here a caller could use to steer the agent.
//
// The reply is newline-delimited JSON, read as it arrives:
//   {"type":"delta","text":"..."}  the next piece of the answer
//   {"type":"done","text":"..."}   the whole answer (a cache hit is only this)
//   {"type":"error","error":"..."}
// Any failure throws; ExplainSheet then falls back to Zackion.

export const EXPLAIN_TIMEOUT_MS = 120_000

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
  fetchImpl = globalThis.fetch, timeoutMs = EXPLAIN_TIMEOUT_MS,
}) {
  if (!base) throw new Error('The SELAH bridge is not configured.')
  let token = null
  if (getToken) {
    token = await getToken()
    if (!token) throw new Error('Sign in first.')
  }

  // The caller's signal (sheet closed) or our own deadline, whichever is first.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  const forward = () => controller.abort(signal.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  signal?.addEventListener('abort', forward, { once: true })

  try {
    const res = await fetchImpl(`${base}/api/explain/stream`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ reference, translation }),
    })
    if (!res.ok) {
      let message = ''
      try { message = (await res.json())?.error ?? '' } catch { /* not JSON */ }
      throw new Error(message || `The SELAH bridge answered ${res.status}.`)
    }

    let text = ''
    let done = false
    const handle = (line) => {
      if (!line.trim()) return
      let event
      try { event = JSON.parse(line) } catch { return }
      if (event.type === 'error') throw new Error(`SELAH could not explain this passage: ${event.error}`)
      if (event.type === 'delta' && typeof event.text === 'string') {
        text += event.text
        onText(text)
      } else if (event.type === 'done') {
        text = typeof event.text === 'string' ? event.text : text
        done = true
      }
    }

    const reader = res.body?.getReader?.()
    if (!reader) {
      for (const line of (await res.text()).split('\n')) handle(line)
    } else {
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) handle(line)
      }
      handle(buffer + decoder.decode())
    }

    if (!done) throw new Error('The SELAH explanation was interrupted.')
    if (!text.trim()) throw new Error('SELAH returned an empty explanation.')
    onText(text)
    return text
  } catch (err) {
    if (timedOut) throw new Error('SELAH took too long to explain this passage.')
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forward)
  }
}
