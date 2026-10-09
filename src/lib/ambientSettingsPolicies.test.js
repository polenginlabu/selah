import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AMBIENT_MODES, EFFECTS, HEMISPHERES, INTENSITIES } from './ambientEffects.js'

// Static check of the ambient settings migration text. It cannot prove
// database behavior (that needs a Supabase stack); it catches the table losing
// its admin-only policies, the read function becoming callable by anon or
// losing its fixed search_path, and the checks drifting from the client lists.
const sql = readFileSync(
  new URL('../../supabase/migrations/20261017_ambient_settings.sql', import.meta.url), 'utf8',
).replace(/--[^\n]*/g, '')

test('RLS is on and every policy is admin-only', () => {
  assert.match(sql, /alter table public\.ambient_settings enable row level security/i)
  const policies = sql.match(/create policy[\s\S]*?;/gi) ?? []
  assert.equal(policies.length, 3)
  for (const p of policies) {
    assert.match(p, /to authenticated/i)
    assert.match(p, /public\.is_admin\(\)/i)
    assert.doesNotMatch(p, /for (delete|all)\b/i)
  }
})

test('anon has no table access and nobody may delete', () => {
  assert.match(sql, /revoke all on public\.ambient_settings from anon/i)
  assert.match(sql, /revoke all on public\.ambient_settings from authenticated/i)
  assert.match(sql, /grant select, insert, update on public\.ambient_settings to authenticated;/i)
  assert.doesNotMatch(sql, /grant[^;]*\b(delete|all)\b[^;]*on public\.ambient_settings/i)
  assert.doesNotMatch(sql, /grant[^;]*on public\.ambient_settings to[^;]*\banon\b/i)
})

test('get_ambient_settings is security definer with a fixed search_path and four public fields', () => {
  assert.match(sql, /security definer\s+set search_path = public, pg_temp/i)
  assert.match(sql, /returns table \(mode text, effect text, intensity text, hemisphere text\)/i)
})

test('only authenticated may execute get_ambient_settings', () => {
  assert.match(sql, /revoke all on function public\.get_ambient_settings\(\) from public/i)
  assert.match(sql, /revoke all on function public\.get_ambient_settings\(\) from anon/i)
  assert.match(sql, /grant execute on function public\.get_ambient_settings\(\) to authenticated/i)
  assert.doesNotMatch(sql, /grant execute on function public\.get_ambient_settings\(\)[^;]*\b(anon|public)\b/i)
})

test('check constraints list exactly the values the client accepts', () => {
  const list = (name) => {
    const m = sql.match(new RegExp(`${name} in \\(([^)]*)\\)`, 'i'))
    return m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1))
  }
  assert.deepEqual(list('mode'), AMBIENT_MODES)
  assert.deepEqual(list('effect'), EFFECTS)
  assert.deepEqual(list('intensity'), INTENSITIES)
  assert.deepEqual(list('hemisphere'), HEMISPHERES)
})

test('the migration only touches its own table and seeds the gold default', () => {
  assert.doesNotMatch(sql, /background_search_settings/i)
  assert.match(sql, /insert into public\.ambient_settings \(id\) values \(true\)\s+on conflict \(id\) do nothing/i)
  assert.match(sql, /mode text not null default 'fixed'/i)
  assert.match(sql, /effect text not null default 'gold'/i)
})
