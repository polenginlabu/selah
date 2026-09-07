import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/date'

function mapMeditationSettings(row) {
  return {
    enabled: row?.enabled ?? false,
    frequencyHours: row?.frequency_hours ?? 4,
    focusWord: row?.focus_word_date === todayISO() ? (row?.focus_word ?? '') : '',
  }
}

export async function getMeditationSettings(uid) {
  const { data, error } = await supabase
    .from('meditation_settings')
    .select('enabled, frequency_hours, focus_word, focus_word_date')
    .eq('user_id', uid)
    .maybeSingle()
  if (error) throw error
  return mapMeditationSettings(data)
}

export async function setMeditationFocusWord(uid, word) {
  const { error } = await supabase
    .from('meditation_settings')
    .upsert({ user_id: uid, focus_word: word, focus_word_date: todayISO() })
  if (error) throw error
}

export async function setMeditationPreferences(uid, { enabled, frequencyHours }) {
  const { error } = await supabase
    .from('meditation_settings')
    .upsert({ user_id: uid, enabled, frequency_hours: frequencyHours })
  if (error) throw error
}
