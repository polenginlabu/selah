// Study assistant, talking to the OpenCode bridge directly from the browser.
//
// This is a parallel transport to askBibleAssistant() in bibleChat.js, with an
// identical contract — same arguments, same onText(accumulated) callback, same
// { content, conversationId } resolution — so StudyAssistant can swap between
// them by changing one import.
//
// READ THIS BEFORE DEPLOYING IT ANYWHERE PUBLIC
// ---------------------------------------------
// There is no server in this path. That has three consequences, none of which
// a client-side check can fix, because anything here ships to the browser and
// can be edited by whoever is holding it:
//
//   1. The bridge is unauthenticated. Whoever can reach VITE_BRIDGE_URL can
//      drive an OpenCode agent with filesystem access on that host. Keep it on
//      a private network, a VPN, or a dev machine — not the open internet.
//   2. The system prompt is the only thing keeping the assistant from
//      inventing Scripture, and it is now assembled client-side. A user can
//      bypass it entirely by calling the bridge themselves.
//   3. The per-user rate limit (chat_rate_limit_hit) is gone. The spacing
//      below is a courtesy to the box, not a control.
//
// The crisis guardrail DOES still run, and runs before any network call — see
// below. That one is not negotiable regardless of transport.
import {
  CRISIS_SAFE_REPLY,
  MAX_HISTORY,
  MAX_MESSAGE_CHARS,
  buildSystemPrompt,
  isCrisisTurn,
} from '../../supabase/functions/bible-chat/prompt.ts'
import { composePrompt, isAgentArtifact } from '../../supabase/functions/bible-chat/bridge.ts'

export { MAX_MESSAGE_CHARS, MAX_HISTORY }

// 4098 is the BRIDGE. 4097 is `opencode serve` itself, which the bridge
// forwards to — pointing here at 4097 gets OpenCode's HTML web UI back with a
// 200 and nothing works. If you change this line, change it to a bridge.
const BRIDGE_URL = (import.meta.env.VITE_BRIDGE_URL ?? 'http://127.0.0.1:4098').replace(/\/+$/, '')
const BRIDGE_MODEL = import.meta.env.VITE_BRIDGE_MODEL ?? ''

const POLL_INTERVAL_MS = 900
const MAX_WAIT_MS = 4 * 60 * 1000
const MIN_GAP_MS = 3000

export function bridgeConfigured() {
  return Boolean(BRIDGE_URL)
}

let lastSentAt = 0

/**
 * Asks the study assistant through the bridge.
 *
 * Resolves with { content, conversationId }. Throws on failure — including a
 * job that finishes with no text, which must not present as a successful empty
 * reply (same rule as the streaming path).
 */
export async function askBibleAssistantViaBridge({
  message,
  passage,
  history = [],
  conversationId = null,
  onText,
  signal,
}) {

  if (!BRIDGE_URL) throw new Error('The study assistant is not configured (VITE_BRIDGE_URL).')

  const question = String(message ?? '').trim()
  if (!question) throw new Error('Empty message.')
  if (question.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Keep questions under ${MAX_MESSAGE_CHARS} characters.`)
  }

  const id = conversationId ?? crypto.randomUUID()

  // --- Crisis guardrail, before anything leaves the tab --------------------
  //
  // Answered from the fixed human-written script, exactly as the Edge Function
  // does. Two reasons, both unchanged by the transport: a prompt directive is
  // advisory and can be ignored by a model, and the most sensitive message
  // anyone will type into this app should not be sent to an agent at all.
  if (isCrisisTurn(question)) {
    onText?.(CRISIS_SAFE_REPLY)
    return { content: CRISIS_SAFE_REPLY, conversationId: id }
  }

  // Courtesy spacing, not a rate limit: a real one needs a server.
  const gap = Date.now() - lastSentAt
  if (gap < MIN_GAP_MS) {
    const err = new Error('One moment between questions, please.')
    err.code = 'rate_limited'
    err.retryAfterSec = Math.ceil((MIN_GAP_MS - gap) / 1000)
    throw err
  }
  lastSentAt = Date.now()

  const trimmedHistory = history
    .slice(-MAX_HISTORY)
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))

  // Ministry figures are omitted on this path: fetching them needs the user's
  // Supabase session, and this transport exists precisely to avoid that round
  // trip. Questions about attendance or giving get the general answer.
  const systemPrompt = buildSystemPrompt(question, passage ?? null, '')
  const prompt = composePrompt(systemPrompt, trimmedHistory, question)

  await startFreshSession(id, signal)
  const jobId = await startJob(prompt, signal)

  let emitted = ''
  const deadline = Date.now() + MAX_WAIT_MS

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS, signal)

    const status = await pollJob(jobId, signal)

    if (status.response && status.response !== emitted) {
      // The bridge is a coding agent and can hand back its own housekeeping
      // ("Changes were applied under /var/www/html...") as the reply. That must
      // never render in a Bible study chat.
      if (isAgentArtifact(status.response)) {
        console.error('bridge reply unusable: agent housekeeping text')
        throw new Error('The study assistant could not answer that one. Try again.')
      }
      emitted = status.response
      // onText receives the full accumulated text, matching bibleChat.js.
      onText?.(emitted)
    }

    if (status.done) {
      if (status.error) {
        // Bridge internals (tool names, OpenCode errors) stay in the console.
        console.error('bridge job failed', status.error)
        throw new Error('The study assistant had a problem answering.')
      }
      if (!emitted) throw new Error('The assistant returned an empty reply.')
      return { content: emitted, conversationId: id }
    }
  }

  throw new Error('The study assistant took too long to answer.')
}

// --- bridge plumbing --------------------------------------------------------

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError() {
  return new DOMException('aborted', 'AbortError')
}

async function bridgeFetch(path, init, signal) {
  return await fetch(`${BRIDGE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    signal,
  })
}

/**
 * The bridge keys everything off a single module-level activeSessionId, so a
 * fresh session per question is what keeps one person's turn out of another
 * person's conversation. It narrows the window rather than closing it:
 * /api/chat/start reads that global when the job begins, and two requests
 * inside that gap can still cross. Closing it needs a session id on the
 * bridge's own API.
 */
async function startFreshSession(conversationId, signal) {
  try {
    await bridgeFetch(
      '/api/sessions',
      { method: 'POST', body: JSON.stringify({ title: `selah-study-${conversationId.slice(0, 8)}` }) },
      signal
    )
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    // A reused session degrades isolation but still answers.
    console.warn('bridge session create failed, reusing active session', err)
  }
}

async function startJob(prompt, signal) {
  let res
  try {
    res = await bridgeFetch(
      '/api/chat/start',
      {
        method: 'POST',
        body: JSON.stringify({ message: prompt, ...(BRIDGE_MODEL ? { model: BRIDGE_MODEL } : {}) }),
      },
      signal
    )
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    console.error('bridge unreachable', err)
    throw new Error('The study assistant is unreachable right now.')
  }
  if (!res.ok) {
    console.error('bridge start failed', res.status, await res.text().catch(() => ''))
    throw new Error(`The study assistant could not start (bridge HTTP ${res.status}).`)
  }
  // A bridge always answers JSON. HTML here means BRIDGE_URL is pointing at
  // something else — nearly always `opencode serve` on 4097 instead of the
  // bridge on 4098, which serves a web UI and returns 200 for everything.
  const raw = await res.text()
  if (/^\s*<(?:!doctype|html)/i.test(raw)) {
    throw new Error(
      `${BRIDGE_URL} is not the bridge — it returned a web page, not JSON. ` +
        'The bridge is usually on port 4098; 4097 is the OpenCode server behind it.'
    )
  }
  let payload = null
  try {
    payload = JSON.parse(raw)
  } catch {
    /* falls through to the jobId check below */
  }
  if (typeof payload?.jobId !== 'string' || !payload.jobId) {
    throw new Error('The study assistant returned no job to follow.')
  }
  return payload.jobId
}

async function pollJob(jobId, signal) {
  let res
  try {
    res = await bridgeFetch(`/api/chat/status/${encodeURIComponent(jobId)}`, { method: 'GET' }, signal)
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    console.error('bridge status unreachable', err)
    throw new Error('The reply was cut short.')
  }
  if (!res.ok) {
    console.error('bridge status failed', res.status)
    throw new Error(`The study assistant lost track of the reply (bridge HTTP ${res.status}).`)
  }
  const payload = await res.json().catch(() => null)
  return {
    done: payload?.done === true,
    phase: typeof payload?.phase === 'string' ? payload.phase : '',
    response: typeof payload?.response === 'string' ? payload.response : '',
    error: typeof payload?.error === 'string' ? payload.error : null,
  }
}
