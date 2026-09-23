import { supabase } from './supabase'

// Queueing work for the OpenCode agent, and waiting for it.
//
// WHY THE BROWSER NO LONGER TALKS TO THE AGENT
//
// It used to: the panel called bridge.php on the web host, which forwarded to
// a bridge running beside it. That could not hold — the shared plan's process
// limiter killed OpenCode whenever it did real work, silently. The agent now
// runs in a GitHub Actions runner that is created for the job and thrown away
// after it (.github/workflows/agent-job.yml), which means the work is
// ASYNCHRONOUS and has to live somewhere while it runs.
//
// It lives in the agent_jobs table. This module does both halves:
//   queue   POST to the trigger-agent Edge Function (admin gate + dispatch)
//   watch   poll the row until it reaches a terminal status
//
// Nothing here is a security boundary. The Edge Function checks is_admin in
// the database, and RLS lets a requester read only their own jobs.

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trigger-agent`

const POLL_INTERVAL_MS = 3000
// A runner is not instant: GitHub takes a minute or two to allocate one, and
// only then does the job start. Whatever the caller allows for the RUN, the
// wait for a runner comes on top.
export const RUNNER_STARTUP_ALLOWANCE_MS = 4 * 60 * 1000

/**
 * Queues a job and resolves with its id.
 *
 * @param {object} opts
 * @param {'ask'|'consolidation'} opts.kind
 * @param {string} [opts.question] for 'ask' — the question exactly as typed.
 *   The read-only framing is added by the runner, not here: a prompt built in
 *   the browser is a prompt an admin could edit before sending.
 * @param {string} [opts.ref] for 'consolidation' — an 8-char opaque disciple ref.
 * @returns {Promise<string>} the job id
 */
export async function queueAgentJob({ kind, question, ref }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in first.')

  let res
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        kind,
        ...(question ? { question } : {}),
        ...(ref ? { ref } : {}),
      }),
    })
  } catch (err) {
    throw new Error(`Could not reach the server: ${err?.message ?? err}`)
  }

  let body = null
  try {
    body = await res.json()
  } catch {
    // Not JSON — handled below, where the status code is still useful.
  }

  if (!res.ok || !body?.jobId) {
    throw new Error(body?.error || `Could not start the run (HTTP ${res.status}).`)
  }
  return body.jobId
}

/**
 * Watches a queued job until it finishes, and resolves with its `result` text.
 *
 * @param {object} opts
 * @param {string} opts.jobId
 * @param {number} opts.runTimeoutMs how long the RUN itself may take; the wait
 *   for a runner to pick it up is added to this.
 * @param {(seconds: number, status: string) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>}
 */
export async function awaitAgentJob({ jobId, runTimeoutMs, onProgress, signal }) {
  const startedAt = Date.now()
  const deadline = startedAt + runTimeoutMs + RUNNER_STARTUP_ALLOWANCE_MS
  let lastStatus = ''

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await sleep(POLL_INTERVAL_MS)

    const { data: job, error } = await supabase
      .from('agent_jobs')
      .select('status, result, error')
      .eq('id', jobId)
      .single()

    // A transient read failure is not a failed job — the run continues on the
    // runner regardless of whether this poll landed. Keep watching.
    if (error || !job) continue

    if (job.status !== lastStatus) {
      lastStatus = job.status
      onProgress?.(Math.floor((Date.now() - startedAt) / 1000), describe(job.status))
    }

    if (job.status === 'failed') throw new Error(job.error || 'The run failed.')
    if (job.status === 'done') {
      const text = (job.result ?? '').trim()
      if (!text) throw new Error('The run finished but produced no answer.')
      return text
    }
  }

  // The row outlives this wait, so the work is not lost — only this page's
  // patience with it.
  throw new Error(
    `The run did not finish within ${Math.round(
      (runTimeoutMs + RUNNER_STARTUP_ALLOWANCE_MS) / 60000
    )} minutes. It may still complete — check back shortly.`
  )
}

function describe(status) {
  if (status === 'queued') return 'waiting for a runner to pick it up'
  if (status === 'running') return 'the agent is working'
  return status
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
