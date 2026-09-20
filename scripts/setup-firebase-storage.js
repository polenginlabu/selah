#!/usr/bin/env node
// One-time Firebase Storage setup for the SELAH daily backgrounds.
//
// Exists so the setup does not require the gcloud SDK or the Firebase CLI.
// Everything here is done with the same service account the nightly generator
// already needs, through the @google-cloud/storage client that firebase-admin
// pulls in — so if `npm ci` has run, this works.
//
// What it does:
//   1. Confirms the bucket exists and the service account can reach it.
//   2. Applies deploy/firebase/cors.json to the bucket.
//
// What it does NOT do: security rules. Those are a Firebase product concept
// rather than a GCS one and have no API here — paste
// deploy/firebase/storage.rules into the Firebase console (Storage > Rules).
// Until you do, the bucket keeps whatever rules it already had.
//
// Usage:
//   node scripts/setup-firebase-storage.js
//   node scripts/setup-firebase-storage.js --check    (report, change nothing)
import { readFileSync } from 'node:fs'
import { Storage } from '@google-cloud/storage'
import { parseServiceAccount, StorageError } from './selah/firebaseStorage.js'

function loadEnv() {
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
  for (const key of ['FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_STORAGE_BUCKET']) {
    if (!env[key] && process.env[key]) env[key] = process.env[key]
  }
  return env
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  const env = loadEnv()
  const log = (msg) => console.log(`[selah] ${msg}`)

  for (const key of ['FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_STORAGE_BUCKET']) {
    if (!env[key]) throw new Error(`Missing ${key}. Put it in .env.local (see .env.local.example).`)
  }

  const serviceAccount = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT)
  const bucketName = env.FIREBASE_STORAGE_BUCKET
  log(`project: ${serviceAccount.project_id}`)
  log(`bucket:  ${bucketName}`)

  const storage = new Storage({
    projectId: serviceAccount.project_id,
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
  })
  const bucket = storage.bucket(bucketName)

  const [exists] = await bucket.exists()
  if (!exists) {
    throw new StorageError(
      `The bucket ${bucketName} does not exist, or this service account cannot see it.\n` +
      '  - Enable Storage in the Firebase console if you never have.\n' +
      '  - Check the name is the bucket HOST (…firebasestorage.app), not the project id.\n' +
      '  - Check the service account has the "Storage Object Admin" role.'
    )
  }
  log('bucket reachable')

  const [before] = await bucket.getMetadata()
  log(`current CORS: ${before.cors ? JSON.stringify(before.cors) : '(none set)'}`)

  if (checkOnly) {
    log('--check: nothing changed')
    return
  }

  const cors = JSON.parse(readFileSync('deploy/firebase/cors.json', 'utf8'))
  await bucket.setCorsConfiguration(cors)
  const [after] = await bucket.getMetadata()
  log(`new CORS:     ${JSON.stringify(after.cors)}`)

  log('')
  log('Done. Remaining manual step: paste deploy/firebase/storage.rules into')
  log('the Firebase console under Storage > Rules, then Publish.')
}

main().catch((err) => {
  console.error(`\n[selah] ${err.message}\n`)
  process.exitCode = 1
})
