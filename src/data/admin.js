import { supabase } from '../lib/supabase'

// Client-side admin list. This ONLY decides whether to render the admin UI —
// it is not a security boundary and must never be treated as one. Every admin
// RPC re-checks the caller against public.admin_emails in the database, so a
// user who edits this array in devtools gets a 403 from Postgres, not access.
// Keep it in sync with the admin_emails table.
export const ADMIN_EMAILS = ['johnpaul.dj21@gmail.com']

export function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.some((entry) => entry.toLowerCase() === email.toLowerCase())
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    xp: row.xp ?? 0,
    level: row.level ?? 1,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    isAdmin: row.is_admin,
  }
}

export async function listUsers() {
  const { data, error } = await supabase.rpc('admin_list_users')
  if (error) throw error
  return (data ?? []).map(mapUser)
}

/** Zeroes one user's XP, achievements, streaks and counters. */
export async function resetUserProgress(userId) {
  const { data, error } = await supabase.rpc('admin_reset_user_progress', { target_id: userId })
  if (error) throw error
  return data ?? 0
}

/** Zeroes progress for every user that has any. Returns rows affected. */
export async function resetAllProgress() {
  const { data, error } = await supabase.rpc('admin_reset_all_progress')
  if (error) throw error
  return data ?? 0
}

/** Deletes the auth user and every row in public referencing them. */
export async function deleteUser(userId) {
  const { error } = await supabase.rpc('admin_delete_user', { target_id: userId })
  if (error) throw error
}
