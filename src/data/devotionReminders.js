import { supabase } from '../lib/supabase'

export const DEFAULT_REMINDER_TIME = '06:30'

function mapReminderSettings(row) {
  return {
    enabled: row?.enabled ?? false,
    // Postgres `time` reads back as "HH:MM:SS"; the time input wants "HH:MM".
    time: (row?.remind_time ?? DEFAULT_REMINDER_TIME).slice(0, 5),
    followups: row?.followups ?? 2,
  }
}

export async function getReminderSettings(uid) {
  const { data, error } = await supabase
    .from('devotion_reminder_settings')
    .select('enabled, remind_time, followups')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw error
  return mapReminderSettings(data)
}

export async function saveReminderSettings(uid, { enabled, time, followups }) {
  const { error } = await supabase
    .from('devotion_reminder_settings')
    .upsert({ user_id: uid, enabled, remind_time: time, followups })
  if (error) throw error
}

/** Whether the daily devotion is marked complete for `localDate`. */
export async function hasCompletion(uid, localDate) {
  const { data, error } = await supabase
    .from('devotion_completions')
    .select('local_date')
    .eq('user_id', uid)
    .eq('local_date', localDate)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function upsertCompletion(uid, localDate) {
  const { error } = await supabase
    .from('devotion_completions')
    .upsert({ user_id: uid, local_date: localDate }, { onConflict: 'user_id,local_date', ignoreDuplicates: true })
  if (error) throw error
}

export async function deleteCompletion(uid, localDate) {
  const { error } = await supabase
    .from('devotion_completions')
    .delete()
    .eq('user_id', uid)
    .eq('local_date', localDate)
  if (error) throw error
}
