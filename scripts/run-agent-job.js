#!/usr/bin/env node
// Runs one queued agent_jobs row and writes the result back.
//
// Called by .github/workflows/agent-job.yml, which has already started
// `opencode serve` and the bridge inside the runner. The app queued the row
// (supabase/functions/trigger-agent) and is watching it; everything this
// script does is visible there within a couple of seconds.
//
// The row is the ONLY channel. Nothing is printed for the app to read, no port
// is exposed, and a runner that dies takes nothing with it but the job — which
// is why every exit path below writes a terminal status first.
//
// Usage:
//   node scripts/run-agent-job.js --job <uuid>
//   JOB_ID=<uuid> node scripts/run-agent-job.js
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (service role: RLS denies every
//                                              client write to agent_jobs)
//   BRIDGE_URL     (default http://127.0.0.1:4098)
import { mkdirSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, requireEnv } from './selah/env.js'
import { runAgent, BridgeError } from './selah/bridge.js'
import { promptFor, resultFor, timeoutMsFor, AgentJobError } from './selah/agentJob.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseArgs() {
  const argv = process.argv.slice(2)
  let job = process.env.JOB_ID ?? null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--job') job = argv[++i] ?? null
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  const id = String(job ?? '').trim()
  if (!UUID_RE.test(id)) throw new Error('Pass a job id: --job <uuid> (or set JOB_ID).')
  return { jobId: id }
}

async function main() {
  const { jobId } = parseArgs()
  const env = requireEnv(loadEnv(), ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: job, error: readError } = await db
    .from('agent_jobs')
    .select('id, kind, prompt, scope_ref, status, model')
    .eq('id', jobId)
    .single()

  if (readError || !job) {
    // Nothing to write back to, so this is the one failure that can only go to
    // the log. A job id that does not exist means the dispatch and the insert
    // disagreed, which is a bug in trigger-agent, not a bad run.
    throw new Error(`No agent_jobs row with id ${jobId}: ${readError?.message ?? 'not found'}`)
  }

  // Claim it. The `.eq('status', 'queued')` is what makes a double dispatch
  // harmless: the second runner updates no rows, sees that, and stops rather
  // than paying for a duplicate run and racing to write the result.
  const { data: claimed, error: claimError } = await db
    .from('agent_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id')

  if (claimError) throw new Error(`Could not claim the job: ${claimError.message}`)
  if (!claimed?.length) {
    console.log(`job ${job.id} is already ${job.status} — another runner has it. Nothing to do.`)
    return
  }

  console.log(`running ${job.kind} job ${job.id}`)

  try {
    const prompt = promptFor(job)
    // Keeps a bad run diagnosable without paying for another one. Uploaded by
    // the workflow on failure; never contains anything the admin cannot see.
    writeDebug(job.id, 'prompt.txt', prompt)

    const reply = await runAgent({
      prompt,
      bridgeUrl: env.BRIDGE_URL ?? 'http://127.0.0.1:4098',
      maxWaitMs: timeoutMsFor(job.kind),
      ...(job.model ? { model: job.model } : {}),
      onProgress: (phase, detail) => console.log(`  ${phase}: ${detail}`),
    })
    writeDebug(job.id, 'reply.txt', reply)

    await finish(db, job.id, { status: 'done', result: resultFor(job, reply) })
    console.log(`job ${job.id} done`)
  } catch (err) {
    // A BridgeError or an AgentJobError is an expected way for a run to fail
    // and its message is written for the admin who asked. Anything else is a
    // bug here, so it goes to the log in full and the row gets a message that
    // does not pretend to explain it.
    const expected = err instanceof BridgeError || err instanceof AgentJobError
    if (!expected) console.error(err)
    await finish(db, job.id, {
      status: 'failed',
      error: expected ? err.message : 'The run failed unexpectedly. See the workflow logs.',
    })
    process.exitCode = 1
  }
}

async function finish(db, id, fields) {
  const { error } = await db
    .from('agent_jobs')
    .update({ ...fields, finished_at: new Date().toISOString() })
    .eq('id', id)
  // The app is watching this row, so failing to write it leaves the job
  // "running" until the app's own timeout. Worth a loud log line.
  if (error) console.error(`could not write the result for ${id}: ${error.message}`)
}

function writeDebug(id, name, text) {
  try {
    mkdirSync('.selah-debug', { recursive: true })
    writeFileSync(`.selah-debug/${id}-${name}`, text)
  } catch {
    // Diagnostics are not worth failing a run that otherwise worked.
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
