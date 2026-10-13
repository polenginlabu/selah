// Node client for the OpenCode bridge, for the devotion generator.
//
// Deliberately NOT shared with src/lib/bibleChatBridge.js, because the two
// want opposite things from the agent:
//
//   study assistant  — tools OFF, answer in seconds, grounded in one passage
//   daily devotion   — tools ON, research for minutes, verify real sources
//
// Section 5 and section 11 of the SELAH brief only mean anything if the agent
// can genuinely search, so this path lets it, and waits.

import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://127.0.0.1:4098'
// The default is catalog-listed as free, but provider/workspace limits still apply.
export const DEFAULT_MODEL = process.env.BRIDGE_MODEL?.trim() || 'opencode/big-pickle'

const POLL_INTERVAL_MS = 2000
// Research takes minutes, not seconds. The bridge's own job deadline is 10
// minutes; stay under it so we report a clear error rather than racing it.
const MAX_WAIT_MS = 9 * 60 * 1000

export class BridgeError extends Error {}

// Only a terminal job's explicit provider failure can authorize a fallback.
// Network errors, tool failures and stalled/unfinished jobs must not be replayed.
function agentFailure(raw, model, setting) {
  const reason = String(raw)
  let kind = null
  if (/^OpenCode provider error:/i.test(reason)) {
    if (/policy budget exceeded|(?:budget|quota|credits?) (?:exceeded|exhausted)|exceeded (?:your |the )?(?:current |monthly |daily )?quota\b|insufficient[_ ](?:quota|credits|(?:account )?funds|balance)|(?:monthly )?spend(?:ing)? limit (?:reached|exceeded)/i.test(reason)) kind = 'budget'
    else if (/rate[_ -]?limit|too many requests|\b429\b/i.test(reason)) kind = 'rate_limit'
    else if (/model (?:\S+ )?(?:is )?(?:unavailable|not found|not available)|service unavailable|overloaded|\b50[234]\b/i.test(reason)) kind = 'unavailable'
  }
  const guidance = kind === 'budget'
    ? ` Check the provider/workspace allowance and billing policy for ${model}. A shared budget limit can block every model on that provider. Select an authorized model with ${setting} or --model.`
    : ''
  return Object.assign(new BridgeError(`The agent failed (${model}): ${reason}${guidance}`), { kind, model })
}

/**
 * Runs one prompt through the bridge and returns the agent's final text.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {string} [opts.bridgeUrl]
 * @param {(phase: string, detail: string) => void} [opts.onProgress]
 * @param {number} [opts.maxWaitMs] must stay under the bridge's own 10-minute
 *   job deadline, so a slow run fails here with a clear message rather than
 *   racing the bridge for which of the two gives up first.
 * @param {AbortSignal} [opts.signal] optional overall deadline across attempts
 */
export async function runAgent({
  prompt,
  model = DEFAULT_MODEL,
  bridgeUrl = DEFAULT_BRIDGE_URL,
  onProgress = () => {},
  maxWaitMs = MAX_WAIT_MS,
  signal,
}) {
  const base = bridgeUrl.replace(/\/+$/, '')

  await assertBridgeReady(base, signal)
  // A fresh session per run: the bridge keys off one global active session, so
  // without this a run inherits the previous run's conversation.
  const session = await post(base, '/api/sessions', { title: `selah-${Date.now()}` }, signal)
  if (!session?.id) throw new BridgeError('The bridge did not create a fresh session.')

  const started = await post(base, '/api/chat/start', { message: prompt, model }, signal)
  if (!started?.jobId) throw new BridgeError('The bridge accepted the prompt but returned no job id.')

  const deadline = Date.now() + maxWaitMs
  let lastPhase = ''

  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS, undefined, { signal })
    const status = await get(base, `/api/chat/status/${encodeURIComponent(started.jobId)}`, signal)

    const phase = `${status.phase}: ${status.message}`
    if (phase !== lastPhase) {
      lastPhase = phase
      onProgress(status.phase, status.message)
    }

    if (!status.done) continue
    if (status.error) throw agentFailure(status.error, model, 'BRIDGE_MODEL')
    if (!status.response?.trim()) throw new BridgeError('The agent finished but produced no output.')
    return status.response
  }

  throw new BridgeError(`The agent did not finish within ${Math.round(maxWaitMs / 60000)} minutes.`)
}

/** Nano Banana 2. See scripts/generate-daily-background.js. */
export const DEFAULT_IMAGE_MODEL = process.env.BACKGROUND_MODEL ?? 'google/gemini-3.1-flash-image'

// An image model answers in one shot — no research, no tool loop. Waiting the
// full text deadline on a wedged image job just holds a CI runner.
const IMAGE_MAX_WAIT_MS = 4 * 60 * 1000

/**
 * Runs one prompt through the bridge and returns the generated IMAGE bytes.
 *
 * Separate from runAgent() because the two want different things back: runAgent
 * insists on non-empty prose and would reject a perfectly good image reply that
 * came with no words attached.
 *
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {string} [opts.bridgeUrl]
 * @param {(phase: string, detail: string) => void} [opts.onProgress]
 * @returns {Promise<Buffer>} the first image returned
 */
export async function runImageAgent({
  prompt,
  model = DEFAULT_IMAGE_MODEL,
  bridgeUrl = DEFAULT_BRIDGE_URL,
  onProgress = () => {},
}) {
  const base = bridgeUrl.replace(/\/+$/, '')

  await assertBridgeReady(base)
  await post(base, '/api/sessions', { title: `selah-background-${Date.now()}` }).catch(() => {})

  const started = await post(base, '/api/chat/start', { message: prompt, model })
  if (!started?.jobId) throw new BridgeError('The bridge accepted the prompt but returned no job id.')

  const deadline = Date.now() + IMAGE_MAX_WAIT_MS
  let lastPhase = ''

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const status = await get(base, `/api/chat/status/${encodeURIComponent(started.jobId)}`)

    const phase = `${status.phase}: ${status.message}`
    if (phase !== lastPhase) {
      lastPhase = phase
      onProgress(status.phase, status.message)
    }

    if (!status.done) continue
    if (status.error) throw agentFailure(status.error, model, 'BACKGROUND_MODEL')

    const images = status.images ?? []
    if (!images.length) {
      // The most useful thing to say here is what DID come back. A text model
      // set as BACKGROUND_MODEL by mistake is the likeliest cause by far, and
      // it produces a cheerful paragraph about how it cannot generate images.
      const seen = status.unknownParts?.length ? ` Unrecognised parts: ${status.unknownParts.join(', ')}.` : ''
      const said = status.response?.trim()
        ? ` The model said: "${status.response.trim().slice(0, 200)}"`
        : ''
      throw new BridgeError(
        `The agent returned no image. Is ${model} an image model?${seen}${said}`
      )
    }

    return await resolveImage(images[0], base)
  }

  throw new BridgeError(
    `The image did not arrive within ${Math.round(IMAGE_MAX_WAIT_MS / 60000)} minutes.`
  )
}

/**
 * Turns one image part into bytes, whichever way it was handed over.
 *
 * See extractImagesFromParts() in the bridge for why this has to cope with
 * three carriers rather than one.
 */
async function resolveImage(image, base) {
  if (image.data) return Buffer.from(image.data, 'base64')

  if (image.url?.startsWith('data:')) {
    const comma = image.url.indexOf(',')
    if (comma === -1) throw new BridgeError('The image data URL is malformed.')
    return Buffer.from(image.url.slice(comma + 1), 'base64')
  }

  if (image.url) {
    // A relative URL is served by the bridge/OpenCode rather than the internet.
    const target = image.url.startsWith('http') ? image.url : `${base}${image.url}`
    const res = await fetch(target)
    if (!res.ok) throw new BridgeError(`Could not download the image: HTTP ${res.status} from ${target}`)
    return Buffer.from(await res.arrayBuffer())
  }

  if (image.path) {
    const { readFile } = await import('node:fs/promises')
    try {
      return await readFile(image.path)
    } catch (err) {
      throw new BridgeError(`The agent reported an image at ${image.path} but it could not be read: ${err.message}`)
    }
  }

  throw new BridgeError('The image part carried no data, url or path.')
}

/**
 * Fails early and specifically. Without this, a bridge pointed at a missing
 * root path or a dead OpenCode looks identical to a slow model: you wait two
 * minutes and get "stalled without progress".
 */
async function assertBridgeReady(base, signal) {
  let health
  try {
    health = await get(base, '/api/health', signal)
  } catch (err) {
    throw new BridgeError(
      `Cannot reach the bridge at ${base}. Is it running? (cd backend/bridge/opencode-bridge && npm start)\n  ${err.message}`
    )
  }
  if (!health?.success) {
    throw new BridgeError(
      `The bridge is up but OpenCode is not: ${health?.error ?? 'unknown'}. Start it with: opencode serve --port 4097`
    )
  }
}

async function get(base, path, signal) {
  const res = await fetch(`${base}${path}`, { signal })
  return await parse(res, base, path)
}

async function post(base, path, body, signal) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return await parse(res, base, path)
}

async function parse(res, base, path) {
  const raw = await res.text()
  // 4097 (OpenCode's own web UI) answers every request with HTML and a 200.
  // Name that mistake instead of failing later on a missing field.
  if (/^\s*<(?:!doctype|html)/i.test(raw)) {
    throw new BridgeError(
      `${base} is not the bridge — it returned a web page. The bridge is port 4098; 4097 is OpenCode behind it.`
    )
  }
  if (!res.ok) throw new BridgeError(`${path} failed: HTTP ${res.status} ${raw.slice(0, 200)}`)
  try {
    return JSON.parse(raw)
  } catch {
    throw new BridgeError(`${path} returned unreadable output: ${raw.slice(0, 200)}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
