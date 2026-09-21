import { supabase } from '../lib/supabase'
import { normalizeReport } from '../lib/discipleship'

export { refOf, buildRefIndex, normalizeReport } from '../lib/discipleship'

/**
 * Ask the OpenCode bridge (via bridge-admin, admin-gated) to run a
 * consolidation report. Pass `ref` to focus on one person; omit for the tree.
 */
export async function generateConsolidation({ ref } = {}) {
  const { data, error } = await supabase.functions.invoke('bridge-admin', {
    body: { action: 'consolidation', ...(ref ? { ref } : {}) },
  })
  if (error) {
    const message = error.message || 'Could not reach the consolidation service.'
    throw new Error(message)
  }
  if (data?.ok && data?.report) return normalizeReport(data.report)
  throw new Error((data && data.error) || 'The consolidation report could not be generated.')
}