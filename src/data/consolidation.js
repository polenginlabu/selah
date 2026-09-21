import { normalizeReport } from '../lib/discipleship'
// Reused rather than reimplemented: the same parser the runner uses, so the
// browser and the Action cannot disagree about what counts as a valid reply.
// (Same pattern as BibleReader importing supabase/functions/_shared/bible.js.)
import { extractJson } from '../../scripts/selah/consolidation.js'
import { queueAgentJob, waitForAgentJob } from './agentJobs'

export { refOf, buildRefIndex, normalizeReport } from '../lib/discipleship'

/**
 * Runs the discipleship consolidation report.
 *
 * The agent runs in a GitHub Actions runner, exactly like the nightly
 * devotion. It used to run on the web host behind a bridge, which could not be
 * kept alive — the shared plan's process limiter killed OpenCode whenever it
 * did real work, so the report failed more often than it succeeded.
 *
 * The cost is time: a runner spends its first minute or two installing
 * OpenCode. Hence `onProgress`, so the caller can show something truthful
 * instead of a silent spinner.
 *
 * @param {object} opts
 * @param {string} [opts.ref] 8-char opaque disciple ref to focus on
 * @param {(seconds: number, status: string) => void} [opts.onProgress]
 */
export async function generateConsolidation({ ref, onProgress, signal } = {}) {
  const jobId = await queueAgentJob({ kind: 'consolidation', ref })

  const job = await waitForAgentJob(jobId, {
    signal,
    onTick: (seconds, status) => onProgress?.(seconds, status),
  })

  if (job.status === 'failed') {
    throw new Error(job.error || 'The consolidation run failed.')
  }
  if (!job.result?.trim()) {
    throw new Error('The run finished but produced no report.')
  }

  let parsed
  try {
    parsed = extractJson(job.result)
  } catch {
    // Show what came back rather than a generic parse failure — an agent that
    // explains why it could not report is more useful than "invalid JSON".
    throw new Error(`The agent did not return a report: ${job.result.slice(0, 200)}`)
  }

  // The task tells the agent to return {"error": "..."} rather than invent
  // figures when it cannot read the database. Surface that as the failure it
  // is, instead of rendering an empty report as though it were real.
  if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
    throw new Error(parsed.error)
  }

  return normalizeReport(parsed)
}
