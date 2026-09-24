// The browser half of the admin verse-background upload: decode the chosen
// file, centre-crop it to the card, encode it as WebP, ship the bytes to
// Supabase Storage and record the daily_backgrounds row.
//
// Pure maths and the path scheme live in ./verseBackground.js (tested by
// node:test without a DOM); this file holds the DOM, Supabase and network
// pieces.
//
// Storage split: admin uploads go to the `verse-backgrounds` bucket in
// Supabase Storage rather than Firebase, where the nightly generator's art
// lives. Deliberate — a manual upload is one small WebP per swap against a
// nightly stream of generated art, and a storage policy gated on is_admin()
// keeps the write authority in the database where every other admin write
// already lives. The card cannot tell the feeds apart: it only reads image_url,
// and Supabase Storage serves `Access-Control-Allow-Origin: *`, so the card's
// crossOrigin='anonymous' canvas stays untainted.

import { supabase } from './supabase'
import {
  VerseBackgroundError,
  coverCropRect,
  storagePathForDate,
  IMAGE_WIDTH,
  IMAGE_HEIGHT,
  WEBP_QUALITY,
} from './verseBackground'

const BUCKET = 'verse-backgrounds'

// A WebP under this size is a stub, not a photo (mirrors MIN_IMAGE_BYTES in
// the scripts). The upper bound keeps a giant file from being decoded at all.
const MIN_RESIZED_BYTES = 10 * 1024
const MAX_FILE_BYTES = 30 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function validateFile(file) {
  const type = (file?.type ?? '').toLowerCase()
  if (!ACCEPTED_TYPES.has(type)) {
    throw new VerseBackgroundError('Choose a JPEG, PNG, WebP or GIF image.', 'shape')
  }
  if (file.size < MIN_RESIZED_BYTES) {
    throw new VerseBackgroundError('That file looks too small to be a real photo.', 'tiny')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new VerseBackgroundError('That file is larger than 30 MB — pick a smaller one.', 'large')
  }
}

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new VerseBackgroundError('The file is not a readable image.', 'shape'))
    }
    img.src = url
  })
}

/**
 * Resizes any image to the exact card format: centre cover-crop → 1080×1920 →
 * WebP at the same quality the generator pipeline uses.
 *
 * @returns {Promise<{blob: Blob, width: number, height: number, bytes: number}>}
 */
export async function resizeImageToWebp(
  file,
  { width = IMAGE_WIDTH, height = IMAGE_HEIGHT, quality = WEBP_QUALITY } = {}
) {
  validateFile(file)
  const img = await decodeImage(file)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new VerseBackgroundError('Canvas is unavailable in this browser.', 'encode')

  const { sx, sy, sw, sh } = coverCropRect(img.naturalWidth, img.naturalHeight, width, height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new VerseBackgroundError('This browser could not encode WebP.', 'encode')),
      'image/webp',
      quality
    )
  })
  if (blob.size < MIN_RESIZED_BYTES) {
    throw new VerseBackgroundError('Encoding produced an empty image — try a different file.', 'tiny')
  }
  return { blob, width, height, bytes: blob.size }
}

/**
 * Uploads the resized image for `date` and records the background row.
 *
 * Re-uploading a date replaces it (storage upsert + row upsert on date), so
 * swapping a bad background is just picking the date that already has one.
 */
export async function uploadVerseBackground({ date, theme, image, model = 'admin-upload' }) {
  const path = storagePathForDate(date)
  const cleanTheme = theme?.trim() ?? ''
  if (!cleanTheme) throw new VerseBackgroundError('A theme is required for this date.', 'shape')

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, image.blob, {
    contentType: 'image/webp',
    // Replaces an existing object, matching the CLI's --force.
    upsert: true,
    // Short-lived on purpose: unlike the nightly art (cached immutable for a
    // year), an admin swap must be visible quickly.
    cacheControl: '300',
  })
  if (uploadError) {
    throw new VerseBackgroundError(uploadError.message ?? 'Could not upload the image.', 'upload')
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const publicUrl = data?.publicUrl ?? ''

  const { error: rowError } = await supabase.rpc('admin_upsert_daily_background', {
    p_date: date,
    p_theme: cleanTheme,
    p_storage_path: path,
    p_image_url: publicUrl,
    p_width: image.width,
    p_height: image.height,
    p_bytes: image.blob.size,
    p_model: model,
  })
  if (rowError) {
    // The bytes are already in storage; leaving them orphaned would make a
    // retry upsert over a row that never appeared. Clean up best-effort, then
    // surface the real failure.
    try {
      await supabase.storage.from(BUCKET).remove([path])
    } catch {
      // An orphan object is invisible — no row points at it — and the next
      // upload overwrites the path anyway.
    }
    throw new VerseBackgroundError(rowError.message ?? 'Could not save the background record.', 'row')
  }

  return { date, path, url: publicUrl }
}

/**
 * Removes a background: the row first, then its object. Row-first so a failed
 * deletion leaves the existing background fully intact; if the object removal
 * fails the orphan is invisible and the next upload overwrites the path.
 */
export async function removeVerseBackground({ date, storagePath }) {
  const { error } = await supabase.rpc('admin_delete_daily_background', { p_date: date })
  if (error) throw new VerseBackgroundError(error.message ?? 'Could not delete the record.', 'row')
  try {
    await supabase.storage.from(BUCKET).remove([storagePath])
  } catch {
    // See uploadVerseBackground — an orphan is harmless.
  }
}