import { supabase } from '../lib/supabase'

// Ask the OpenCode agent a question.
//
// The browser never talks to the bridge. It calls bridge-admin, which verifies
// the caller is an admin in the database and holds the bridge token
// server-side — see supabase/functions/bridge-admin/index.ts for why the
// direct route is not an option.
//
// Synchronous: the Edge Function starts a job on the bridge and polls it until
// it answers. That only works because a question is short work — tens of
// seconds, comfortably inside the function's own wall-clock limit.

/**
 * @param {string} question
 * @returns {Promise<string>} the agent's answer
 */
export async function askAgent(question) {
  const { data, error } = await supabase.functions.invoke('bridge-admin', {
    body: { action: 'ask', prompt: question },
  })
  if (error) throw new Error((await readFunctionError(error)) || 'Could not reach the agent.')

  // The function answers 200 with ok:false for a failure it understands, so
  // the step is preserved — "the bridge is down" and "the model said nothing"
  // want different responses from whoever is reading it.
  if (!data?.ok) {
    const step = data?.step ? ` (${data.step})` : ''
    throw new Error(`${data?.error || 'The agent could not answer.'}${step}`)
  }
  return data.answer
}

async function readFunctionError(error) {
  const response = error?.context
  if (!(response instanceof Response)) {
    return 'Could not reach the bridge-admin function. If this is the first run, deploy it: supabase functions deploy bridge-admin'
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
