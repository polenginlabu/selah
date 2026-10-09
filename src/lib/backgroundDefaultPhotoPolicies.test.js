import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Static check of the default-photo migration text. It cannot prove database
// behavior (that needs a Supabase stack); it catches the read function losing
// its fixed search_path, becoming callable by anon, or the migration widening
// access to the admin-only settings table.
const sql = readFileSync(
  new URL('../../supabase/migrations/20261016_background_default_photo.sql', import.meta.url), 'utf8',
).replace(/--[^\n]*/g, '')

test('default_background_id references daily_backgrounds and is nulled on delete', () => {
  assert.match(sql, /default_background_id uuid\s+references public\.daily_backgrounds\(id\) on delete set null/i)
  assert.match(sql, /use_default_photo boolean not null default false/i)
})

test('get_default_background is security definer with a fixed search_path', () => {
  assert.match(sql, /security definer\s+set search_path = public, pg_temp/i)
})

test('get_default_background returns only the four public fields', () => {
  assert.match(sql, /returns table \(enabled boolean, background_id uuid, image_url text, attribution jsonb\)/i)
})

test('only authenticated may execute it', () => {
  assert.match(sql, /revoke all on function public\.get_default_background\(\) from public/i)
  assert.match(sql, /revoke all on function public\.get_default_background\(\) from anon/i)
  assert.match(sql, /grant execute on function public\.get_default_background\(\) to authenticated/i)
  assert.doesNotMatch(sql, /grant execute on function public\.get_default_background\(\)[^;]*\b(anon|public)\b/i)
})

test('no new table policies or table grants', () => {
  assert.doesNotMatch(sql, /create\s+policy/i)
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete|all)\b/i)
})
