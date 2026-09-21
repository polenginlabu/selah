#!/usr/bin/env node
// Runs one queued agent job, inside a GitHub Actions runner.
//
// WHY HERE AND NOT ON THE WEB HOST
//
// The agent used to run on the Hostinger box behind a bridge. The shared
// plan's process limiter killed OpenCode every time it did real work — no
// signal that can be caught, so no error to read: ~/opencode.log held thirty
// consecutive "listening" lines and nothing else. A runner has room for it,
// installs it fresh, and is thrown away afterwards. Nothing stays alive.
//
// The cost is latency: a run takes minutes, not seconds. So the app queues a
// job and watches for the result rather than waiting on a request.
//
// Usage:
//   node scripts/run-agent-job.js --job <uuid>
//   node scripts/run-agent-job.js --ask "question"     (local, prints, writes nothing)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BRIDGE_URL, BRIDGE_MODEL,
//      DATABASE_URL (consolidation only)
import { createClient } from '@supabase/supabase-js'
import { runAgent, BridgeError, DEFAULT_MODEL } from './selah/bridge.js'
import { buildConsolidationTask, buildAskTask, ConsolidationError } from './selah/consolidation.js'
import { loadEnv, requireEnv } from './selah/env.js'

function parseArgs() {
  const out = { job: null, ask: null, model: null }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--job') out.job = argv[++i] ?? null
    else if (a === '--ask') out.ask = argv[++i] ?? null
    else if (a === '--model') out.model = argv[++i] ?? null
    else throw new Error(`Unknown argument: ${a}`)
  }
  if (!out.job && !out.ask) throw new Error('Pass --job <uuid> or --ask "question".')
  return out
}

const log = (msg) => console.log(`[selah] ${msg}`)

async function main() {
  const args = parseArgs()
  const env = loadEnv(['DATABASE_URL'])
  const model = args.model ?? env.BRIDGE_MODEL ?? DEFAULT_MODEL

  // --- Local one-off, for trying a prompt without touching the database ----
  if (args.ask) {
    log(`model: ${model}`)
    const answer = await runAgent({
      prompt: buildAskTask(args.ask),
      model,
      ...(env.BRIDGE_URL ? { bridgeUrl: env.BRIDGE_URL } : {}),
      onProgress: (phase, message) => log(`  ${phase} — ${message}`),
    })
    console.log('\n' + answer)
    return
  }

  requireEnv(env, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'])
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: job, error: readError } = await admin
    .from('agent_jobs').select('*').eq('id', args.job).maybeSingle()
  if (readError) throw new Error(`Could not read the job: ${readError.message}`)
  if (!job) throw new Error(`No job with id ${args.job}`)

  // A retried workflow must not run finished work again — the row is the
  // record of what happened, and re-running would overwrite a good result
  // with a second, differently-worded one.
  if (job.status === 'done' || job.status === 'failed') {
    log(`job ${job.id} is already ${job.status} — nothing to do`)
    return
  }

  log(`job ${job.id} (${job.kind})`)
  await admin.from('agent_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), model })
    .eq('id', job.id)

  try {
    const prompt = job.kind === 'consolidation'
      ? buildConsolidationTask(job.scope_ref)
      : buildAskTask(job.prompt)

    log(`model: ${model}`)
    log('asking the agent (this takes a few minutes)')
    const started = Date.now()

    const answer = await runAgent({
      prompt,
      model,
      ...(env.BRIDGE_URL ? { bridgeUrl: env.BRIDGE_URL } : {}),
      onProgress: (phase, message) => log(`  ${phase} — ${message}`),
    })

    log(`finished in ${Math.round((Date.now() - started) / 1000)}s, ${answer.length} characters`)

    // Stored as text whatever the kind. A consolidation reply that is not
    // valid JSON is still worth keeping — the reader parses it, and a bad
    // answer you can read beats an error that threw the evidence away.
    const { error } = await admin.from('agent_jobs')
      .update({ status: 'done', result: answer, finished_at: new Date().toISOString() })
      .eq('id', job.id)
    if (error) throw new Error(`Ran the job but could not save the result: ${error.message}`)
    log('saved')
  } catch (err) {
    const message = err instanceof BridgeError ? `bridge: ${err.message}`
      : err instanceof ConsolidationError ? `task: ${err.message}`
      : err.message
    log(`failed: ${message}`)
    // Record the failure rather than leaving the row 'running' forever — the
    // app shows this text, so it has to be the reason, not a generic string.
    await admin.from('agent_jobs')
      .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
      .eq('id', job.id)
    throw err
  }
}

main().catch((err) => {
  console.error(`\n[selah] ${err.message}\n`)
  process.exitCode = 1
})
