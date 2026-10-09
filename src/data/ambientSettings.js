import { supabase } from '../lib/supabase'
import { DEFAULT_AMBIENT_SETTINGS, normalizeAmbientSettings } from '../lib/ambientEffects'

// One read per session, shared by every ambient layer on the page. Cleared
// after a failed read (so the next mount retries) and after an admin save.
let cached = null

/**
 * The public ambient settings {mode, effect, intensity, hemisphere}. Read
 * through get_ambient_settings(), because the settings table is admin-only.
 * Never throws: a failed read (e.g. the migration is not applied yet) is the
 * defaults, which show gold dust.
 */
export function getAmbientSettings() {
  cached ??= supabase.rpc('get_ambient_settings').then(
    ({ data, error }) => {
      if (error) throw error
      return normalizeAmbientSettings(data)
    },
  ).catch((err) => {
    console.warn('ambient settings fetch failed', err)
    cached = null
    return { ...DEFAULT_AMBIENT_SETTINGS }
  })
  return cached
}

/** The admin's settings row, cleaned. A missing row reads as the defaults. */
export async function getAmbientSettingsAdmin() {
  const { data, error } = await supabase
    .from('ambient_settings')
    .select('mode, effect, intensity, hemisphere')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  return normalizeAmbientSettings(data)
}

/** Saves the settings, cleaned. Returns what was stored. */
export async function saveAmbientSettings(settings) {
  const s = normalizeAmbientSettings(settings)
  const { error } = await supabase.from('ambient_settings').upsert({ id: true, ...s }, { onConflict: 'id' })
  if (error) throw error
  cached = null
  return s
}
