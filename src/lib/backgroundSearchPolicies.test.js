import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Static check of the background_search_settings migration text. It cannot
// prove RLS behavior (that needs a Supabase stack); it catches a policy that
// is dropped, widened to anon, or no longer gated on is_admin().
const sql = readFileSync(
  new URL('../../supabase/migrations/20261015_background_search_settings.sql', import.meta.url), 'utf8',
).replace(/--[^\n]*/g, '')

const policies = [...sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+public\.background_search_settings([^;]*);/gi)]
  .map(([, name, body]) => [name, body.replace(/\s+/g, ' ').trim().toLowerCase()])

test('settings table has RLS enabled', () => {
  assert.match(sql, /alter table public\.background_search_settings enable row level security/i)
})

test('exactly select, insert and update policies, all authenticated and is_admin(); no delete', () => {
  const cmds = policies.map(([, b]) => b.match(/\bfor (select|insert|update|delete)\b/)?.[1]).sort()
  assert.deepEqual(cmds, ['insert', 'select', 'update'])
  for (const [name, body] of policies) {
    assert.match(body, /to authenticated/, name)
    assert.ok(body.includes('public.is_admin()'), name)
  }
})

test('anon has no access and authenticated has no delete grant', () => {
  assert.match(sql, /revoke all on public\.background_search_settings from anon/i)
  assert.match(sql, /grant select, insert, update on public\.background_search_settings to authenticated/i)
  assert.doesNotMatch(sql, /grant[^;]*\b(delete|all)\b[^;]*on public\.background_search_settings/i)
})

test('the preview rate-limit function is executable by service_role only', () => {
  assert.match(sql, /revoke all on function public\.background_preview_rate_limit_hit\(uuid, integer\) from public/i)
  assert.match(sql, /grant execute on function public\.background_preview_rate_limit_hit\(uuid, integer\) to service_role/i)
  assert.doesNotMatch(sql, /grant execute on function public\.background_preview_rate_limit_hit[^;]*\b(anon|authenticated)\b/i)
})
