import { supabase } from '../lib/supabase'

// Admin-only status checks for the OpenCode bridge.
//
// The browser never talks to the bridge. It talks to the bridge-admin Edge
// Function, which verifies the caller is an admin in the database and holds the
// bridge's token server-side — see supabase/functions/bridge-admin/index.ts for
// why the direct route is not an option.
//
// Every call resolves rather than throws when the bridge is simply down: "the
// agent is not running" is the answer the admin came for, not an error.

async function call(body) {
  const { data, error } = await supabase.functions.invoke('bridge-admin', { body })
  if (error) {
    throw new Error((await readFunctionError(error)) || 'Could not reach the bridge check.')
  }
  return data
}

/** Composite health: the bridge, and OpenCode behind it. */
export async function getBridgeHealth() {
  const result = await call({ action: 'health' })
  return {
    reachable: result.reachable === true,
    // The bridge reports its own health AND OpenCode's. A healthy bridge in
    // front of a dead OpenCode is the state that produces silent empty
    // replies, so the two are worth showing separately.
    bridgeUp: result.ok === true,
    opencodeUp: result.data?.opencode?.healthy === true,
    activeModel: result.data?.model ?? null,
    rootPath: result.data?.rootPath ?? null,
    sessionId: result.data?.sessionId ?? null,
    error: result.error ?? null,
    status: result.status ?? null,
  }
}

/** Every model OpenCode can reach, grouped by provider for the picker. */
export async function listBridgeModels() {
  const result = await call({ action: 'models' })
  if (!result.ok) {
    return { models: [], activeModel: null, error: result.error ?? 'The bridge did not return a model list.' }
  }
  const models = (result.data?.models ?? []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    provider: m.provider || m.providerId || 'unknown',
    // The bridge's /api/model takes "provider/model"; a bare id only resolves
    // if it happens to be unique across providers.
    qualified: m.providerId ? `${m.providerId}/${m.id}` : m.id,
  }))
  models.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name))
  return { models, activeModel: result.data?.activeModel ?? null, error: null }
}

/** Sets the model the bridge uses when a caller does not name one. */
export async function setBridgeModel(model) {
  const result = await call({ action: 'set-model', model })
  if (!result.ok) throw new Error(result.error || 'The bridge would not accept that model.')
  return result.data?.model ?? model
}

async function readFunctionError(error) {
  const response = error?.context
  if (!(response instanceof Response)) {
    return 'Could not reach the bridge-admin function. If this is the first run, deploy it: supabase functions deploy bridge-admin'
  }
  const status = `HTTP ${response.status}`
  let raw = ''
  try {
    raw = await response.clone().text()
  } catch {
    return `${status} (response body already consumed)`
  }
  try {
    const body = JSON.parse(raw)
    if (typeof body?.error === 'string') return body.error
  } catch {
    /* not JSON — fall through */
  }
  const snippet = raw.slice(0, 300).replace(/\s+/g, ' ').trim()
  return snippet ? `${status}: ${snippet}` : status
}
