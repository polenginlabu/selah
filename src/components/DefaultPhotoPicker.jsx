import { useCallback, useEffect, useState } from 'react'
import { getBackgroundById, listBackgrounds } from '../data/dailyBackgrounds'
import { formatDateShort } from '../lib/date'
import { photoCredit } from '../lib/photoCredit'

const PAGE_SIZE = 24

/**
 * Picks the default daily background from the backgrounds we already have,
 * newest first, 24 at a time. Native radios, so the arrow keys move the
 * selection and screen readers announce a radio group. The picked photo is
 * shown above the grid even when it is not on a loaded page.
 */
export function DefaultPhotoPicker({ value, onChange, disabled }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [picked, setPicked] = useState(null)

  // listBackgrounds returns [] on failure (and warns), so an outage reads as
  // "no backgrounds" — the Retry there covers both.
  const loadPage = useCallback(async (before) => {
    setLoading(true)
    const page = await listBackgrounds({ limit: PAGE_SIZE, before })
    setItems((cur) => (before ? [...cur, ...page] : page))
    setHasMore(page.length === PAGE_SIZE)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadPage(null)
  }, [loadPage])

  // The picked photo, from the loaded pages or fetched on its own.
  useEffect(() => {
    if (!value) return setPicked(null)
    const found = items.find((bg) => bg.id === value)
    if (found) return setPicked(found)
    let alive = true
    getBackgroundById(value).then((bg) => alive && setPicked(bg))
    return () => { alive = false }
  }, [value, items])

  const label = (bg) => [formatDateShort(bg.date), photoCredit(bg.attribution)].filter(Boolean).join(' · ')

  return (
    <div className="space-y-3">
      {value && (
        <div className="flex items-center gap-3 rounded-xl border-2 border-brand p-2">
          {picked ? (
            <>
              <img src={picked.imageUrl} alt="" className="aspect-[9/16] w-16 shrink-0 rounded-lg bg-canvas object-cover" />
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-ink">Default photo</p>
                <p className="text-muted">{formatDateShort(picked.date)}</p>
                <p className="truncate text-xs text-muted">{photoCredit(picked.attribution) || 'No credit (uploaded or generated)'}</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">The picked photo no longer exists. Pick another.</p>
          )}
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="text-sm italic text-muted">
          No backgrounds yet.{' '}
          <button type="button" onClick={() => loadPage(null)} className="underline">
            Retry
          </button>
        </p>
      )}

      {items.length > 0 && (
        <div role="radiogroup" aria-label="Default photo" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((bg) => {
            const active = bg.id === value
            return (
              <label key={bg.id} className={`relative cursor-pointer space-y-1 text-xs ${disabled ? 'opacity-60' : ''}`}>
                <input
                  type="radio"
                  name="default-photo"
                  value={bg.id}
                  checked={active}
                  onChange={() => onChange(bg.id)}
                  disabled={disabled}
                  aria-label={label(bg)}
                  className="peer sr-only"
                />
                <img
                  src={bg.imageUrl}
                  alt=""
                  loading="lazy"
                  className={`aspect-[9/16] w-full rounded-lg border-2 bg-canvas object-cover peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${active ? 'border-brand' : 'border-transparent'}`}
                />
                <span className="block text-muted">{formatDateShort(bg.date)}</span>
                <span className="block truncate text-muted">{photoCredit(bg.attribution) || '—'}</span>
              </label>
            )
          })}
        </div>
      )}

      {loading && <p className="text-sm text-muted">Loading photos…</p>}
      {hasMore && !loading && (
        <button type="button" onClick={() => loadPage(items[items.length - 1].date)} className="btn-outline w-full px-3 py-1.5 text-sm">
          Load more
        </button>
      )}
    </div>
  )
}
