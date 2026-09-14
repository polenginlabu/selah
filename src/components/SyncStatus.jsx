import { useEffect, useState } from 'react'
import { discard, retry, subscribe } from '../lib/outbox'
import { RefreshIcon, XIcon } from '../icons'

/**
 * Shows what is waiting to sync, and what has given up.
 *
 * Deliberately quiet for the normal case: a small count while writes are in
 * the queue, nothing at all once it drains. It only becomes insistent when a
 * write has permanently failed, because that is the case where doing nothing
 * loses a leader's data without telling them.
 */
export function SyncStatus() {
  const [state, setState] = useState({ pending: 0, failed: [] })
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => subscribe(setState), [])

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const { pending, failed } = state
  if (!offline && pending === 0 && failed.length === 0) return null

  return (
    <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-sticky mx-auto max-w-xl px-4">
      {failed.length > 0 ? (
        <div className="rounded-xl border border-red-500/30 bg-surface p-3 shadow-lift">
          <button
            onClick={() => setExpanded((open) => !open)}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="flex-1 text-xs font-semibold text-ink">
              {failed.length} change{failed.length === 1 ? '' : 's'} couldn't be saved
            </span>
            <span className="text-[0.65rem] text-muted">{expanded ? 'Hide' : 'Show'}</span>
          </button>

          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {failed.map((item) => (
                <li key={item.id} className="rounded-lg bg-raised px-2.5 py-2">
                  <p className="text-xs font-medium text-ink">{item.label ?? item.kind}</p>
                  {item.error && (
                    <p className="mt-0.5 break-words text-[0.65rem] text-muted">{item.error}</p>
                  )}
                  <div className="mt-1.5 flex gap-3">
                    <button
                      onClick={() => retry(item.id)}
                      className="text-[0.65rem] font-semibold text-brand-strong dark:text-brand"
                    >
                      Try again
                    </button>
                    <button
                      onClick={() => discard(item.id)}
                      className="text-[0.65rem] font-semibold text-muted"
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 shadow-soft">
          {offline ? (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <span className="text-[0.7rem] text-muted">
                Offline{pending > 0 ? ` · ${pending} waiting to sync` : ' · changes will sync later'}
              </span>
            </>
          ) : (
            <>
              <RefreshIcon width={11} height={11} className="shrink-0 animate-spin text-brand" />
              <span className="text-[0.7rem] text-muted">
                Syncing {pending} change{pending === 1 ? '' : 's'}…
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
