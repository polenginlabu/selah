// Turning an agent_jobs row into a prompt, and the agent's reply into a result.
//
// Pure and dependency-free so it can be tested without a database, a runner or
// a model. run-agent-job.js does the I/O; everything that can be reasoned
// about in isolation lives here.
import { buildAskTask } from '../../supabase/functions/_shared/agentTask.js'
import {
  buildConsolidationTask,
  extractJson,
  normalizeReport,
} from '../../src/lib/consolidationTask.js'

export class AgentJobError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AgentJobError'
  }
}

/**
 * The prompt for a job, built HERE rather than stored by the caller.
 *
 * The row keeps the question exactly as the admin typed it; the framing that
 * makes it read-only is added at run time. That way the framing cannot be
 * bypassed by a row written before it existed, and changing it does not mean
 * re-writing history.
 *
 * @param {{kind: string, prompt?: string|null, scope_ref?: string|null}} job
 * @returns {string}
 */
export function promptFor(job) {
  if (!job || typeof job !== 'object') throw new AgentJobError('No job to run.')

  if (job.kind === 'ask') {
    const question = String(job.prompt ?? '').trim()
    if (!question) throw new AgentJobError('The job has no question to answer.')
    return buildAskTask(question)
  }

  if (job.kind === 'consolidation') {
    return buildConsolidationTask(job.scope_ref ?? undefined)
  }

  throw new AgentJobError(`Unknown kind of agent job: ${job.kind}`)
}

/**
 * Validates the agent's reply and returns what should be stored in `result`.
 *
 * An 'ask' stores prose. A 'consolidation' stores JSON — but only after it has
 * been parsed and normalised here, so a run that produced something unusable
 * fails NOW, in the runner, where the logs and the debug artifact are. The
 * alternative is a row marked done whose result blows up in the browser hours
 * later.
 *
 * @param {{kind: string}} job
 * @param {string} reply the agent's final text
 * @returns {string}
 */
export function resultFor(job, reply) {
  const text = String(reply ?? '').trim()
  if (!text) throw new AgentJobError('The agent finished but produced no answer.')

  if (job.kind === 'ask') return text

  let parsed
  try {
    parsed = extractJson(text)
  } catch {
    // Show what came back rather than a generic parse failure — an agent that
    // explains why it could not report is more useful than "invalid JSON".
    throw new AgentJobError(`The agent did not return a report: ${text.slice(0, 200)}`)
  }

  // The task tells the agent to return {"error": "..."} rather than invent
  // figures when it cannot read the database. Surface that as the failure it
  // is, instead of storing an empty report as though it were real.
  if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
    throw new AgentJobError(parsed.error)
  }

  const report = normalizeReport(parsed)
  if (!report) throw new AgentJobError('The agent returned an unreadable report.')

  return JSON.stringify(report)
}

/**
 * How long a job of this kind may wait for the agent before the runner gives up.
 *
 * A consolidation reads the whole tree and reasons over it; an ask is one
 * question. Both stay under the BRIDGE's own 10-minute job deadline (see
 * backend/bridge/opencode-bridge/server.js), so a slow run is reported as a
 * clear timeout in the row rather than racing the bridge for who fails first.
 */
export function timeoutMsFor(kind) {
  return kind === 'consolidation' ? 9 * 60 * 1000 : 5 * 60 * 1000
}
