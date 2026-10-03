// "Explain" for a verse selection, answered by the Zackion AI chat endpoint.
//
// Pure and dependency-free so it can be tested under node --test: the endpoint
// URL (VITE_ZACKION_CHAT_URL) is read by the component and passed in, never
// from import.meta.env here. The endpoint is CORS-open and needs no auth; it
// streams the reply as plain Markdown text. Each explanation is a fresh
// conversation (conversationId: null) — there is no multi-turn chat.
//
// The message is the selection's reference only ("John 3:16", "John 3:16-18"),
// without the translation: formatSelectionReference has no translation suffix
// and the endpoint expects a bare reference.

const VISITOR_KEY = 'zackion:visitorId'
let memoryVisitorId = null

export function buildExplainMessage(reference) {
  const text = String(reference ?? '').trim()
  if (!text) throw new Error('A verse reference is required.')
  return text
}

function randomId() {
  const bytes = new Uint8Array(8)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('')
}

/** Stable per-device "visitor_<random>"; in-memory when storage is unavailable. */
export function getVisitorId(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(VISITOR_KEY)
    if (stored && /^visitor_[a-z0-9]+$/.test(stored)) return stored
  } catch { /* storage blocked — fall through to the in-memory id */ }
  const id = memoryVisitorId ?? `visitor_${randomId()}`
  memoryVisitorId = id
  try { storage?.setItem(VISITOR_KEY, id) } catch { /* keep the in-memory id */ }
  return id
}

/**
 * Reads a streamed text body, calling onText with the text received so far
 * after every chunk. Falls back to response.text() when the body is not a
 * readable stream. Resolves with the full text.
 */
export async function readTextStream(response, onText = () => {}) {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    onText(text)
    return text
  }
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    onText(text)
  }
  const tail = decoder.decode()
  if (tail) { text += tail; onText(text) }
  return text
}

function isAbort(err) {
  return err?.name === 'AbortError'
}

/** POSTs the reference and streams the explanation. Abort errors are rethrown untouched. */
export async function explainVerse({ url, reference, signal, onText, fetchImpl = globalThis.fetch, storage }) {
  const body = JSON.stringify({
    message: buildExplainMessage(reference),
    conversationId: null,
    visitorId: getVisitorId(storage),
    stream: true,
  })
  let response
  try {
    response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal })
  } catch (err) {
    if (isAbort(err)) throw err
    throw new Error('Could not reach Zackion. Check your connection and try again.')
  }
  if (!response.ok) throw new Error(`The explanation service is unavailable right now (status ${response.status}).`)
  try {
    const text = await readTextStream(response, onText)
    if (!text.trim()) throw new Error('Zackion returned an empty explanation. Please try again.')
    return text
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw err
    if (err.message?.startsWith('Zackion returned')) throw err
    throw new Error('The explanation was interrupted. Check your connection and try again.')
  }
}
