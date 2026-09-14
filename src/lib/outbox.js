/**
 * Offline write queue.
 *
 * Writes made without a connection are stored in IndexedDB and replayed when
 * one returns. The church-basement case is the point: a leader marks thirty
 * people present on bad signal and every tap has to survive.
 *
 * TWO RULES MAKE THIS SAFE
 *
 * 1. Queue ABSOLUTE INTENT, never deltas. "set present = true for this
 *    disciple on this date", not "increment". A replayed absolute write is
 *    harmless; a replayed delta double-counts. Every handler must be
 *    idempotent for the same reason — a flush can be interrupted and retried.
 *
 * 2. Distinguish transient from permanent failures. A dropped packet retries
 *    forever, quietly. A 403 or a deleted row never succeeds, so it is parked
 *    and surfaced — silently discarding a leader's attendance is worse than
 *    interrupting them.
 */

const DB_NAME = 'selah-outbox'
const STORE = 'pending'
const DB_VERSION = 1

const MAX_ATTEMPTS = 8
const BASE_BACKOFF_MS = 2000

let dbPromise = null
const handlers = new Map()
const listeners = new Set()
let flushing = false

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        // autoIncrement gives us FIFO for free: replay order is insertion
        // order, so the last write of a value wins, as it should.
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const result = fn(transaction.objectStore(STORE))
        transaction.oncomplete = () => resolve(result?.result ?? result)
        transaction.onerror = () => reject(transaction.error)
      })
  )
}

/** Registers how to perform one kind of queued write. Must be idempotent. */
export function registerHandler(kind, handler) {
  handlers.set(kind, handler)
}

export function subscribe(listener) {
  listeners.add(listener)
  void notify()
  return () => listeners.delete(listener)
}

async function notify() {
  const items = await all().catch(() => [])
  const state = {
    pending: items.filter((i) => !i.failed).length,
    failed: items.filter((i) => i.failed),
  }
  for (const listener of listeners) listener(state)
}

function all() {
  return tx('readonly', (store) => store.getAll())
}

/**
 * Queues a write and tries to flush immediately.
 * @param kind matches a registerHandler key
 * @param payload plain, structured-cloneable data — the absolute intent
 * @param label short human description, shown if it ends up failing
 */
export async function enqueue(kind, payload, label) {
  await tx('readwrite', (store) =>
    store.add({ kind, payload, label, attempts: 0, failed: false, queuedAt: Date.now() })
  )
  await notify()
  void flush()
}

/**
 * A permanent failure is the server saying "no" — it will say no again on
 * every retry. Anything else (offline, timeout, 5xx, rate limit) is worth
 * retrying, so the default when we cannot tell is to retry rather than drop.
 */
export function isPermanent(error) {
  const status = error?.status ?? error?.statusCode
  if (typeof status === 'number') return status >= 400 && status < 500 && status !== 408 && status !== 429
  // PostgREST surfaces these as codes rather than HTTP status.
  const code = error?.code
  if (typeof code === 'string') {
    if (code === '42501') return true // RLS refusal
    if (code.startsWith('23')) return true // constraint violation
    if (code === 'PGRST116') return true // no row matched
  }
  return false
}

export async function flush() {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    const items = (await all()).filter((i) => !i.failed).sort((a, b) => a.id - b.id)

    for (const item of items) {
      const handler = handlers.get(item.kind)
      if (!handler) {
        // The app changed under a queued item. Park rather than drop.
        await tx('readwrite', (store) =>
          store.put({ ...item, failed: true, error: `No handler for "${item.kind}"` })
        )
        continue
      }

      try {
        await handler(item.payload)
        await tx('readwrite', (store) => store.delete(item.id))
      } catch (err) {
        const attempts = item.attempts + 1
        const permanent = isPermanent(err) || attempts >= MAX_ATTEMPTS
        await tx('readwrite', (store) =>
          store.put({
            ...item,
            attempts,
            failed: permanent,
            error: err?.message ?? String(err),
          })
        )
        // Stop on the first transient failure: the connection is probably
        // gone again, and hammering the rest would just burn the attempt
        // budget on writes that would otherwise have succeeded later.
        if (!permanent) break
      }
    }
  } finally {
    flushing = false
    await notify()
  }
}

/** Drops a parked write the user has chosen to abandon. */
export async function discard(id) {
  await tx('readwrite', (store) => store.delete(id))
  await notify()
}

/** Re-arms a parked write, e.g. after the user fixed the cause. */
export async function retry(id) {
  const items = await all()
  const item = items.find((i) => i.id === id)
  if (!item) return
  await tx('readwrite', (store) => store.put({ ...item, failed: false, attempts: 0, error: null }))
  await notify()
  void flush()
}

let started = false
/** Replays on reconnect, on focus, and periodically while items are waiting. */
export function startOutbox() {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('online', () => void flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush()
  })

  // A backstop: "online" can fire while the connection is still unusable, and
  // visibilitychange never fires if the app is simply left open.
  window.setInterval(() => void flush(), BASE_BACKOFF_MS * 15)

  void flush()
}
