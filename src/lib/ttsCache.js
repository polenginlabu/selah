// Generated read-aloud audio, keyed by chunkKey (src/lib/bibleTts.js).
//
// Two tiers: an in-memory LRU so replay, seek-back and re-opening a chapter in
// this session make no request, and Cache Storage so re-opening it after a
// reload is instant too. Cache Storage is best-effort: when it is missing or
// throws, the memory tier still works. Both are size-capped (oldest dropped
// first) and cleared on sign-out.
const CACHE_NAME = 'selah-tts-v1'
const MEMORY_BYTES = 60 * 1024 * 1024
// About 4-5 chapters of 24 kHz WAV; keeps origin storage well clear of quota so
// the browser never evicts the offline Bible and app shell along with it.
const DISK_BYTES = 40 * 1024 * 1024
const SIZE_HEADER = 'X-Selah-Bytes'
const memory = new Map() // key -> Blob, oldest first

const hasCacheStorage = () => typeof caches !== 'undefined'
const cacheUrl = (key) => `/__selah-tts/${encodeURIComponent(key)}`

function remember(key, blob) {
  memory.delete(key)
  memory.set(key, blob)
  let bytes = 0
  for (const b of memory.values()) bytes += b.size
  // ponytail: linear size scan per insert; fine for the few dozen chunks a session holds.
  for (const [oldest, b] of memory) {
    if (bytes <= MEMORY_BYTES || memory.size === 1) break
    memory.delete(oldest)
    bytes -= b.size
  }
}

/** Synchronous memory hit, or undefined. */
export function peekTtsAudio(key) {
  const blob = memory.get(key)
  if (blob) remember(key, blob)
  return blob
}

/** Memory, then Cache Storage. Resolves undefined on a miss. */
export async function getTtsAudio(key) {
  const hit = peekTtsAudio(key)
  if (hit || !hasCacheStorage()) return hit
  try {
    const res = await (await caches.open(CACHE_NAME)).match(cacheUrl(key))
    if (!res) return undefined
    const blob = await res.blob()
    remember(key, blob)
    return blob
  } catch {
    return undefined
  }
}

/**
 * How many of the oldest entries to drop so the rest fit in maxBytes. `sizes`
 * is oldest first; the newest entry is always kept.
 */
export function overflowCount(sizes, maxBytes = DISK_BYTES) {
  let bytes = sizes.reduce((sum, n) => sum + n, 0)
  let drop = 0
  while (bytes > maxBytes && drop < sizes.length - 1) bytes -= sizes[drop++]
  return drop
}

// Cache Storage keeps entries in insertion order (a re-put moves to the end),
// so the oldest are first. Sizes ride along in a header so trimming never reads
// audio bodies.
async function trimDisk(cache) {
  const keys = await cache.keys()
  const responses = await Promise.all(keys.map((req) => cache.match(req)))
  const drop = overflowCount(responses.map((res) => Number(res?.headers.get(SIZE_HEADER)) || 0))
  await Promise.all(keys.slice(0, drop).map((req) => cache.delete(req)))
}

export function putTtsAudio(key, blob) {
  remember(key, blob)
  if (!hasCacheStorage()) return
  caches.open(CACHE_NAME)
    .then(async (cache) => {
      await cache.put(cacheUrl(key), new Response(blob, {
        headers: { 'Content-Type': blob.type || 'audio/wav', [SIZE_HEADER]: String(blob.size) },
      }))
      await trimDisk(cache)
    })
    .catch(() => { /* quota or private mode: memory still has it */ })
}

export function clearTtsAudio() {
  memory.clear()
  if (hasCacheStorage()) caches.delete(CACHE_NAME).catch(() => {})
}
