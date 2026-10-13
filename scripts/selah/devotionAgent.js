// Daily-devotion-only fallback. Generic agent jobs and image generation still
// run a single model. Content validation/reformatting shares this same runner,
// so it never starts again at a provider model that already failed.
import { BridgeError, DEFAULT_MODEL, runAgent } from './bridge.js'

export const DEFAULT_FALLBACK_MODELS = 'opencode/ling-3.1-flash-free,opencode/mimo-v2.6-flash-free'
const MAX_WAIT_MS = 9 * 60 * 1000

export function createDevotionAgent({
  model = DEFAULT_MODEL,
  fallbackModels = DEFAULT_FALLBACK_MODELS,
  bridgeUrl,
  onProgress = () => {},
  maxWaitMs = MAX_WAIT_MS,
} = {}) {
  const models = [...new Set([model, ...fallbackModels.split(',')].map((value) => value.trim()).filter(Boolean))]
  if (!models.length || models.some((value) => !/^opencode\/[^\s/]+$/.test(value))) {
    throw new BridgeError('Daily devotion models must be OpenCode Zen IDs (opencode/model). Check BRIDGE_MODEL and BRIDGE_FALLBACK_MODELS.')
  }
  if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs <= 0 || maxWaitMs > MAX_WAIT_MS) {
    throw new BridgeError('The devotion time limit must be between 1 ms and 9 minutes.')
  }
  let index = 0
  let deadline
  let signal
  const failures = []
  const timeout = () => new BridgeError(`The devotion exceeded its overall ${Math.round(maxWaitMs / 60000)} minute time limit. No additional model was started; the last bridge job may still be finishing.`)

  return async function ask(prompt) {
    if (!signal) {
      deadline = Date.now() + maxWaitMs
      signal = AbortSignal.timeout(maxWaitMs)
    }
    while (index < models.length) {
      if (signal.aborted || Date.now() >= deadline) throw timeout()
      const current = models[index]
      onProgress('model', `Using ${current}`)
      try {
        const reply = await runAgent({ prompt, model: current, bridgeUrl, onProgress, maxWaitMs: deadline - Date.now(), signal })
        if (signal.aborted || Date.now() >= deadline) throw timeout()
        return reply
      } catch (error) {
        if (signal.aborted || Date.now() >= deadline) throw timeout()
        if (!(error instanceof BridgeError) || !['budget', 'rate_limit', 'unavailable'].includes(error.kind)) throw error
        failures.push(error.message)
        index += 1
        if (index < models.length) {
          onProgress('fallback', `${current} failed (${error.kind}); switching to ${models[index]}. ${error.message}`)
        }
      }
    }
    throw new BridgeError(`All configured Zen models failed. Shared workspace budget restrictions may affect every fallback. Check the Zen allowance/policy or BRIDGE_MODEL and BRIDGE_FALLBACK_MODELS.\n${failures.join('\n')}`)
  }
}
