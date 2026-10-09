import { supabase } from '../lib/supabase'
import { readFunctionError } from './dailyDevotion'
import { normalizeSettings, toSettingsRow } from '../../supabase/functions/_shared/backgroundSearch.js'

/**
 * The admin's background search settings (one row), cleaned. A missing row
 * reads as the defaults, which is also what the nightly job uses then.
 */
export async function getBackgroundSearchSettings() {
  const { data, error } = await supabase
    .from('background_search_settings')
    .select('*')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  return {
    ...normalizeSettings(data),
    updatedAt: data?.updated_at ? new Date(data.updated_at).getTime() : null,
  }
}

/** Saves the settings, cleaned by the same rules the nightly job applies. Returns what was stored. */
export async function saveBackgroundSearchSettings(settings) {
  const row = toSettingsRow(settings)
  const { error } = await supabase.from('background_search_settings').upsert(row, { onConflict: 'id' })
  if (error) throw error
  return normalizeSettings(row)
}

/**
 * Sample results for one phrase from the background-preview Edge Function.
 * Nothing is saved.
 *
 * @returns {Promise<{provider: string, query: string, note: string|null, results: object[]}>}
 */
export async function previewBackgroundSearch(phrase, { styleTerm, imageType, provider = 'auto' } = {}) {
  const { data, error } = await supabase.functions.invoke('background-preview', {
    body: { phrase, style_term: styleTerm, image_type: imageType, provider },
  })
  if (error) throw new Error((await readFunctionError(error, 'background-preview')) || 'Preview failed.')
  return data
}
