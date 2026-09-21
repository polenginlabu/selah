import { supabase } from '../lib/supabase'

// Queued work for the OpenCode agent.
//
// The agent runs in a GitHub Actions runner, not on our web host — the shared
// plan's process limiter killed it whenever it did real work. That makes a run
// asynchronous: a runner takes a few minutes to start, so the app queues a job
// and watches the row rather than waiting on a request.
//
// The consequence worth designing around: closing the tab must not lose the
// answer. The row is the record, so it does not.

/** Queues a job and returns its id. Admin-only, enforced in the database. */
export async function queueAgentJob({ kind = 'ask', prompt = '', ref = null, model = null } = {}) {
  const { data, error } = await supabase.functions.invoke('trigger-agent', {
    body: {
      kind,
      ...(kind === 'ask' ? { prompt } : {}),
      ...(ref ? { ref } : {}),
      ...(model ? { model } : {}),
    },
  })
  if (error) throw new Error((await readFunctionError(error)) || 'Could not start the agent run.')
  if (!data?.jobId) throw new Error(data?.error || 'The run did not start.')
  return data.jobId
}

export async function getAgentJob(id) {
  const { data, error } = await supabase.from('agent_jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error('Could not read the job.')
  return data ? mapRow(data) : null
}

/** The caller's recent jobs, newest first. RLS limits this to their own. */
export async function listAgentJobs({ limit = 10 } = {}) {
  const { data, error } = await supabase
    .from('agent_jobs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) {
    console.warn('agent job list failed', error)
    return []
  }
  return (data ?? []).map(mapRow)
}

/**
 * Polls until the job finishes.
 *
 * A runner spends its first minute or two installing OpenCode before anything
 * happens, so this is deliberately patient and reports elapsed seconds rather
 * than looking stuck. `signal` lets the caller stop watching — which does NOT
 * stop the run; the row still completes.
 */
export async function waitForAgentJob(id, { timeoutMs = 20 * 60 * 1000, intervalMs = 5000, signal, onTick } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

    const job = await getAgentJob(id).catch(() => null)
    if (job?.status === 'done' || job?.status === 'failed') return job
    onTick?.(Math.round((Date.now() - startedAt) / 1000), job?.status ?? 'queued')
  }
  throw new Error('The run did not finish within 20 minutes. Check the Actions tab.')
}

function mapRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    scopeRef: row.scope_ref,
    status: row.status,
    result: row.result,
    error: row.error,
    model: row.model,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null,
  }
}

async function readFunctionError(error) {
  const response = error?.context
  if (!(response instanceof Response)) {
    return 'Could not reach the trigger-agent function. If this is the first run, deploy it: supabase functions deploy trigger-agent'
  }
  let raw = ''
  try {
    raw = await response.clone().text()
  } catch {
    return `HTTP ${response.status}`
  }
  try {
    const body = JSON.parse(raw)
    if (typeof body?.error === 'string') return body.error
  } catch { /* not JSON */ }
  const snippet = raw.slice(0, 300).replace(/\s+/g, ' ').trim()
  return snippet ? `HTTP ${response.status}: ${snippet}` : `HTTP ${response.status}`
}
