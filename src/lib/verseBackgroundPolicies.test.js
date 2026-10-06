import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// Static check of the storage.objects policies for the verse-backgrounds
// bucket, applying migrations in filename order (last definition wins).
// It cannot prove RLS behavior; that needs a Supabase stack.
const DIR = new URL('../../supabase/migrations/', import.meta.url)

function effectivePolicies() {
  const policies = new Map()
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
  for (const f of files) {
    const sql = readFileSync(new URL(f, DIR), 'utf8').replace(/--[^\n]*/g, '')
    for (const m of sql.matchAll(/drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+storage\.objects/gi)) {
      policies.delete(m[1])
    }
    for (const m of sql.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+storage\.objects([^;]*);/gi)) {
      policies.set(m[1], m[2].replace(/\s+/g, ' ').trim().toLowerCase())
    }
  }
  return [...policies.entries()].filter(([, body]) => body.includes('verse-backgrounds'))
}

const ADMIN = "bucket_id = 'verse-backgrounds' and public.is_admin()"

test('verse-backgrounds has an admin-only SELECT policy', () => {
  const sel = effectivePolicies().filter(([, b]) => /\bfor select\b/.test(b))
  assert.equal(sel.length, 1)
  assert.match(sel[0][1], /to authenticated/)
  assert.ok(sel[0][1].includes(`using (${ADMIN})`))
})

test('every verse-backgrounds policy targets authenticated and requires is_admin()', () => {
  const all = effectivePolicies()
  const cmds = all.map(([, b]) => b.match(/\bfor (select|insert|update|delete)\b/)?.[1]).sort()
  assert.deepEqual(cmds, ['delete', 'insert', 'select', 'update'])
  for (const [name, body] of all) {
    assert.match(body, /to authenticated/, name)
    assert.ok(body.includes('public.is_admin()'), name)
    assert.doesNotMatch(body, /\b(anon|public)\s*(,|$)|to public|using \(true\)|with check \(true\)/, name)
  }
})

test('UPDATE policy has both USING and WITH CHECK', () => {
  const upd = effectivePolicies().find(([, b]) => /\bfor update\b/.test(b))
  assert.ok(upd[1].includes(`using (${ADMIN})`))
  assert.ok(upd[1].includes(`with check (${ADMIN})`))
})
