import { useCallback, useEffect, useState } from 'react'
import { BOOK_IDS } from '../data/bible'
import { CACHE_NAME, MANIFEST_URL, downloadTranslation, getDownloadState, removeTranslation, translationUrls } from '../data/publicBibles/offline'

/**
 * Download state for the bundled public-domain Bibles, keyed by translation id:
 * { status: 'idle' | 'downloading' | 'downloaded' | 'error', done, total, error }.
 *
 * State is read from the service worker's cache, so it survives reloads and is
 * right offline. supported is false when there is no Cache API or no build
 * manifest (the dev server), and the reader then shows no download control.
 */
export function useOfflineBibles(ids) {
  const [manifest, setManifest] = useState(null)
  const [supported, setSupported] = useState(false)
  const [states, setStates] = useState({})

  const update = useCallback((id, next) => setStates((s) => ({ ...s, [id]: { ...s[id], ...next } })), [])

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || !('caches' in window)) return undefined
    fetch(MANIFEST_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then(async (data) => {
        if (cancelled || !ids.every((id) => translationUrls(data, id, BOOK_IDS).length === BOOK_IDS.length)) return
        const cache = await caches.open(CACHE_NAME)
        const entries = await Promise.all(ids.map(async (id) => {
          const { cached, total, complete } = await getDownloadState(cache, translationUrls(data, id, BOOK_IDS))
          return [id, { status: complete ? 'downloaded' : 'idle', done: cached, total, error: '' }]
        }))
        if (cancelled) return
        setManifest(data)
        setStates(Object.fromEntries(entries))
        setSupported(true)
      })
      .catch(() => { /* No manifest or no cache: downloads stay hidden. */ })
    return () => { cancelled = true }
  }, [ids])

  const download = useCallback(async (id) => {
    if (!manifest || states[id]?.status === 'downloading') return
    const urls = translationUrls(manifest, id, BOOK_IDS)
    update(id, { status: 'downloading', error: '' })
    try {
      const cache = await caches.open(CACHE_NAME)
      await downloadTranslation({
        cache, urls,
        fetchFn: (url) => fetch(url),
        onProgress: (done, total) => update(id, { done, total }),
      })
      update(id, { status: 'downloaded', done: urls.length, total: urls.length })
    } catch (err) {
      update(id, { status: 'error', ...(Number.isInteger(err.done) ? { done: err.done } : {}), error: err.message || 'Download failed. Please try again.' })
    }
  }, [manifest, states, update])

  const remove = useCallback(async (id) => {
    if (!manifest) return
    try {
      const cache = await caches.open(CACHE_NAME)
      await removeTranslation(cache, id, translationUrls(manifest, id, BOOK_IDS))
      update(id, { status: 'idle', done: 0, error: '' })
    } catch {
      update(id, { error: 'Could not remove the download. Please try again.' })
    }
  }, [manifest, update])

  return { supported, states, download, remove }
}
