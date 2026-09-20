// Firebase Storage upload for the SELAH daily background.
//
// Firebase rather than Supabase Storage on purpose: Supabase is the
// application database and its storage quota is kept for user content, while
// these are bulk, immutable, CDN-served images. Only the metadata row goes to
// Supabase (see supabase/migrations/20260919b_daily_backgrounds.sql).
//
// Credentials come from a service account, which is why this only ever runs in
// the GitHub Action or on a developer's machine — never in the browser. A
// service account key can read and write every bucket in the project; the app
// gets a plain download URL and nothing else.

import { readFileSync, existsSync } from 'node:fs'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'

export class StorageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StorageError'
  }
}

/**
 * Reads the service account, however it was supplied.
 *
 * Three accepted forms, because the right one differs by environment:
 *
 *   - a PATH to the downloaded .json    best locally: the key stays in one
 *                                       file outside the repo, and there is no
 *                                       shell encoding step to get wrong
 *   - base64 of that file's contents    best in CI: survives GitHub secrets
 *                                       and .env parsing, which both mangle
 *                                       the newlines inside the private key
 *   - the raw JSON itself               accepted, but a multi-line blob in a
 *                                       .env file will not survive the line
 *                                       parser, so it only works via real env
 *
 * Detected rather than configured: a leading '{' is JSON, an existing file is
 * a path, anything else is treated as base64.
 */
export function parseServiceAccount(value) {
  if (!value?.trim()) {
    throw new StorageError(
      'Missing FIREBASE_SERVICE_ACCOUNT. See README > Daily background generation.'
    )
  }
  const trimmed = value.trim()

  let text
  if (trimmed.startsWith('{')) {
    text = trimmed
  } else if (trimmed.length < 4096 && !trimmed.includes('\n') && existsSync(trimmed)) {
    // Length/newline guard so a base64 blob is never accidentally handed to
    // existsSync, which throws on very long or NUL-bearing strings.
    try {
      text = readFileSync(trimmed, 'utf8')
    } catch (err) {
      throw new StorageError(`Could not read the service account at ${trimmed}: ${err.message}`)
    }
  } else {
    text = Buffer.from(trimmed, 'base64').toString('utf8')
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new StorageError(
      'FIREBASE_SERVICE_ACCOUNT is not a readable service account. Expected one of: ' +
      'a path to the downloaded .json, base64 of that file, or the raw JSON.'
    )
  }
  for (const key of ['project_id', 'client_email', 'private_key']) {
    if (!parsed[key]) throw new StorageError(`The service account JSON has no "${key}".`)
  }
  // A key pasted through a shell or a .env file arrives with literal \n rather
  // than newlines, and openssl then rejects it with an unreadable PEM error.
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  }
  return parsed
}

let bucketPromise = null

/** One app per process; firebase-admin throws on a duplicate default app. */
function getBucket({ serviceAccount, bucketName }) {
  if (!bucketPromise) {
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({ credential: cert(serviceAccount), storageBucket: bucketName })
    bucketPromise = Promise.resolve(getStorage(app).bucket(bucketName))
  }
  return bucketPromise
}

/**
 * Uploads the image and returns a URL the browser can put in an <img>.
 *
 * The object is made public rather than served through a signed URL: the
 * metadata row in Supabase is long-lived and a signed URL would expire under
 * it, leaving every verse card silently broken on a date nobody is looking at.
 * These are generated landscapes with no text and no user data in them — there
 * is nothing here to keep private, and public objects are served by Google's
 * CDN for free rather than costing a token check per view.
 *
 * @returns {Promise<{url: string, path: string, bytes: number}>}
 */
export async function uploadBackground({
  buffer, storagePath, bucketName, serviceAccount, contentType = 'image/webp', metadata = {},
}) {
  if (!buffer?.length) throw new StorageError('Refusing to upload an empty image.')
  if (!bucketName) throw new StorageError('Missing FIREBASE_STORAGE_BUCKET.')

  const bucket = await getBucket({ serviceAccount, bucketName })
  const file = bucket.file(storagePath)

  try {
    await file.save(buffer, {
      contentType,
      resumable: false,
      metadata: {
        contentType,
        // Immutable by construction: the path contains the date, and a given
        // date's background is generated once. A year is safe and keeps the
        // CDN from revalidating on every card.
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: Object.fromEntries(
          Object.entries(metadata).map(([k, v]) => [k, String(v)])
        ),
      },
    })
    await file.makePublic()
  } catch (err) {
    throw new StorageError(`Firebase upload failed for ${storagePath}: ${err.message}`)
  }

  return {
    url: `https://storage.googleapis.com/${bucketName}/${storagePath}`,
    path: storagePath,
    bytes: buffer.length,
  }
}

/** Whether a background already exists, so a rerun does not pay to regenerate. */
export async function backgroundExists({ storagePath, bucketName, serviceAccount }) {
  const bucket = await getBucket({ serviceAccount, bucketName })
  try {
    const [exists] = await bucket.file(storagePath).exists()
    return exists
  } catch (err) {
    throw new StorageError(`Could not check ${storagePath}: ${err.message}`)
  }
}
