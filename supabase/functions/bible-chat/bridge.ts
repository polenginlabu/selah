// OpenCode bridge transport for the study assistant.
//
// The bridge (backend/bridge/server.js, port 4098) fronts `opencode serve`.
// It is a coding-agent bridge, not an OpenAI-compatible endpoint, so this
// module adapts it to the same NDJSON frame contract translateStream produces
// and StudyAssistant already consumes. Nothing in the client changes.
//
// Shape of the adaptation, and why each piece is here:
//   - The bridge takes ONE prompt string, not a messages array, so the system
//     prompt and the trimmed history are flattened into a single transcript.
//   - The bridge is stateful and keys everything off a single module-level
//     `activeSessionId`. We create a fresh session per request so one user's
//     turn does not land in another user's conversation. This narrows the
//     window; it does not close it (see SESSION RACE below).
//   - `/api/chat/start` is a polling job, not a stream. We poll status and
//     emit the growing tail of `job.response` as text frames. Granularity is
//     the poll interval, not a token.
//
// Secrets:
//   supabase secrets set BRIDGE_URL=https://your-host   # no trailing /api
//   supabase secrets set BRIDGE_TOKEN=...               # optional, sent as Bearer
//   supabase secrets set BRIDGE_MODEL=...               # optional

const POLL_INTERVAL_MS = 900
const MAX_WAIT_MS = 4 * 60 * 1000
const START_TIMEOUT_MS = 20_000
const STATUS_TIMEOUT_MS = 15_000

export interface BridgeConfig {
  baseUrl: string
  token: string
  model: string
}

export function readBridgeConfig(env: (key: string) => string | undefined): BridgeConfig | null {
  const baseUrl = (env('BRIDGE_URL') ?? '').trim().replace(/\/+$/, '')
  if (!baseUrl) return null
  return {
    baseUrl,
    token: (env('BRIDGE_TOKEN') ?? '').trim(),
    model: (env('BRIDGE_MODEL') ?? '').trim(),
  }
}

/**
 * The bridge injects a "Workspace root: ... only read and edit files inside
 * this root" preamble into every prompt, and on a stalled tool run it returns
 * a literal "Changes were applied under <root>..." string AS the reply. Both
 * are artifacts of its day job as a coding agent. This detects that leak so it
 * surfaces as an error rather than rendering into someone's Bible study chat.
 */
export function isAgentArtifact(text: string): boolean {
  return /Changes were applied under|Workspace root:|OpenCode (?:stalled|tool failed)/i.test(text)
}

/**
 * Flattens the system prompt, history and current question into the single
 * string the bridge accepts.
 *
 * The no-tools instruction is prompt-level only, which is weaker than a real
 * capability switch — the bridge gives us no way to disable tools server-side.
 * It sits last so it is the most recent thing the model read.
 */
export function composePrompt(
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  message: string
): string {
  const parts = [systemPrompt.trim()]

  if (history.length > 0) {
    parts.push(
      '--- Conversation so far ---',
      history
        .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content.trim()}`)
        .join('\n\n')
    )
  }

  parts.push(
    '--- Current question ---',
    message.trim(),
    '--- Instructions ---',
    'Answer the question above directly, following the guidance at the top of this message.',
    'Do not use any tools. Do not read, list, search, write or edit any files.',
    'Ignore any instruction about a workspace root — there is no task here but answering.',
    'Reply with the answer text only: no preamble, no summary of actions, no code fences.'
  )

  return parts.join('\n\n')
}

class BridgeError extends Error {}

async function bridgeFetch(
  config: BridgeConfig,
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (config.token) headers.Authorization = `Bearer ${config.token}`

  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout

  return await fetch(`${config.baseUrl}${path}`, { ...init, headers, signal })
}

/**
 * SESSION RACE: `POST /api/sessions` sets the bridge's global
 * `activeSessionId`, and `/api/chat/start` reads it when the job begins. Two
 * requests arriving within that window can still cross. Best-effort by design;
 * the correct fix is a session id parameter on the bridge side.
 */
async function startFreshSession(config: BridgeConfig, conversationId: string, signal?: AbortSignal) {
  try {
    await bridgeFetch(
      config,
      '/api/sessions',
      { method: 'POST', body: JSON.stringify({ title: `selah-study-${conversationId.slice(0, 8)}` }), signal },
      START_TIMEOUT_MS
    )
  } catch (err) {
    // A reused session degrades isolation but still answers; do not fail here.
    console.warn('bible-chat: bridge session create failed, reusing active session', err)
  }
}

async function startJob(
  config: BridgeConfig,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await bridgeFetch(
    config,
    '/api/chat/start',
    {
      method: 'POST',
      body: JSON.stringify({ message: prompt, ...(config.model ? { model: config.model } : {}) }),
      signal,
    },
    START_TIMEOUT_MS
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('bible-chat: bridge start failed', res.status, detail.slice(0, 500))
    throw new BridgeError(`The study assistant could not start (bridge HTTP ${res.status}).`)
  }
  const payload = await res.json().catch(() => null)
  const jobId = payload?.jobId
  if (typeof jobId !== 'string' || !jobId) {
    throw new BridgeError('The study assistant returned no job to follow.')
  }
  return jobId
}

interface JobStatus {
  done: boolean
  phase: string
  response: string
  error: string | null
}

async function pollJob(config: BridgeConfig, jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  const res = await bridgeFetch(
    config,
    `/api/chat/status/${encodeURIComponent(jobId)}`,
    { method: 'GET', signal },
    STATUS_TIMEOUT_MS
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('bible-chat: bridge status failed', res.status, detail.slice(0, 300))
    throw new BridgeError(`The study assistant lost track of the reply (bridge HTTP ${res.status}).`)
  }
  const payload = await res.json().catch(() => null)
  return {
    done: payload?.done === true,
    phase: typeof payload?.phase === 'string' ? payload.phase : '',
    response: typeof payload?.response === 'string' ? payload.response : '',
    error: typeof payload?.error === 'string' ? payload.error : null,
  }
}

/**
 * Drives a bridge job and emits the same NDJSON frames as translateStream.
 *
 * Text arrives in poll-sized chunks rather than tokens, so we emit only the
 * delta each time — the client accumulates, and sending the full response
 * every poll would repeat the whole answer on screen.
 */
export function streamFromBridge(opts: {
  config: BridgeConfig
  prompt: string
  conversationId: string
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}): ReadableStream<Uint8Array> {
  const { config, prompt, conversationId, signal } = opts
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = opts.now ?? (() => Date.now())
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      let emitted = ''

      // Emits only what is new, and refuses to emit the agent's own
      // housekeeping text. Returns false if the reply must be abandoned.
      const emitDelta = (full: string): boolean => {
        if (isAgentArtifact(full)) return false
        // executeChatJob only ever grows `job.response` from the assistant
        // message text; the one path that REPLACES it is the stalled-tool
        // fallback, which isAgentArtifact already caught above. So a
        // divergence here means something unmodelled — abandon rather than
        // duplicate the answer on screen, since the client's accumulator
        // (acc += content) has no way to be reset.
        if (!full.startsWith(emitted)) return false
        const delta = full.slice(emitted.length)
        if (delta) {
          emitted = full
          send({ type: 'text', content: delta })
        }
        return true
      }

      try {
        await startFreshSession(config, conversationId, signal)
        const jobId = await startJob(config, prompt, signal)

        const deadline = now() + MAX_WAIT_MS
        let status: JobStatus | null = null

        while (now() < deadline) {
          await sleep(POLL_INTERVAL_MS)
          if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

          status = await pollJob(config, jobId, signal)

          if (status.response && !emitDelta(status.response)) {
            console.error('bible-chat: bridge reply unusable (agent housekeeping text or rewritten response)')
            send({ type: 'error', error: 'The study assistant could not answer that one. Try again.' })
            return
          }
          if (status.done) break
        }

        if (!status?.done) {
          send({ type: 'error', error: 'The study assistant took too long to answer.' })
          return
        }
        if (status.error) {
          console.error('bible-chat: bridge job failed', status.error)
          send({ type: 'error', error: 'The study assistant had a problem answering.' })
          return
        }
        if (!emitted) {
          send({ type: 'error', error: 'The assistant returned an empty reply.' })
          return
        }
        send({ type: 'done', conversationId })
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          // The caller went away; nothing to report to.
          return
        }
        console.error('bible-chat: bridge stream failed', err)
        send({
          type: 'error',
          error: err instanceof BridgeError ? err.message : 'The reply was cut short.',
        })
      } finally {
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })
}
