import { supabase } from './supabase'

// No secrets here, ever — this ships to the browser. The Edge Function holds
// the model credentials and verifies the caller's Supabase JWT.
const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bible-chat`

export const MAX_MESSAGE_CHARS = 600
export const MAX_HISTORY = 12

/**
 * Streams a reply, calling onText with each fragment as it arrives.
 *
 * Resolves with { content, conversationId }. Throws on failure — including a
 * stream that ends without a `done` frame, which must not present as a
 * successful empty reply.
 */
export async function askBibleAssistant({
  message,
  passage,
  history = [],
  conversationId = null,
  onText,
  signal,
}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in to use the study assistant.')

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      message,
      conversationId,
      passage,
      messages: history.slice(-MAX_HISTORY),
    }),
    signal,
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    if (res.status === 429) {
      // Prefer the body: Retry-After is only readable cross-origin when the
      // server exposes it, so treat it as best-effort.
      const secs = Math.min(
        300,
        Math.max(1, Number(payload?.retryAfterSec) || Number(res.headers.get('Retry-After')) || 60)
      )
      const err = new Error(payload?.error ?? 'Too many questions just now.')
      err.retryAfterSec = secs
      err.code = 'rate_limited'
      throw err
    }
    throw new Error(payload?.error ?? 'The study assistant is unavailable.')
  }
  if (!res.body) throw new Error('The study assistant returned nothing.')

  // The header arrives before the body, which matters if the stream dies part
  // way through — we still know which conversation it belonged to.
  let resolvedId = res.headers.get('x-conversation-id') ?? conversationId

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let acc = ''
  let completed = false
  let streamError = null

  const processLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let frame
    try {
      frame = JSON.parse(trimmed)
    } catch {
      return // a torn frame is not worth failing the answer over
    }
    if (frame.type === 'text' && typeof frame.content === 'string') {
      acc += frame.content
      onText?.(acc)
    } else if (frame.type === 'done') {
      completed = true
      if (frame.conversationId) resolvedId = frame.conversationId
    } else if (frame.type === 'error') {
      streamError = new Error(frame.error ?? 'The reply failed.')
      completed = true
    }
  }

  try {
    while (!completed) {
      const { done, value } = await reader.read()
      if (done) {
        // Flush whatever partial line remains.
        processLine(buffer + decoder.decode())
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Keep the trailing partial line for the next chunk — a chunk boundary
      // lands mid-line often, and splitting naively corrupts the JSON.
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        processLine(line)
        if (completed) break
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // already closed
    }
  }

  if (streamError) throw streamError
  if (!completed || !acc.trim()) throw new Error('The reply was cut short — try again.')

  return { content: acc, conversationId: resolvedId }
}
