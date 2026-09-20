// Shared .env loading for the SELAH Node scripts.
//
// Files first, then the process environment — so a developer's .env.local wins
// locally, while CI (which has no such file, both being gitignored) is driven
// entirely by the workflow's env block.

import { readFileSync } from 'node:fs'

const KEYS = [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_STORAGE_BUCKET',
  'BRIDGE_URL', 'BACKGROUND_MODEL', 'GEMINI_API_KEY',
]

export function loadEnv(extraKeys = []) {
  const env = {}
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      // A missing file is fine; a later one, or the process env, may have it.
    }
  }
  for (const key of [...KEYS, ...extraKeys]) {
    if (!env[key] && process.env[key]) env[key] = process.env[key]
  }
  return env
}

/** Fails with the one message that actually helps: which variable, and where. */
export function requireEnv(env, keys) {
  for (const key of keys) {
    if (!env[key]) {
      throw new Error(`Missing ${key}. Put it in .env.local (see .env.local.example).`)
    }
  }
  return env
}
