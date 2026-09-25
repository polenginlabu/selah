// Prayer detail sheet + the distraction-free guided Prayer Mode.
//
// Detail: one prayer item with its description, personal notes, today's verse
// (the current devotion's key scripture when one exists, else the verse of the
// day — never fabricated, both come from the existing Bible data layer) and a
// "Start Prayer" entry into focus mode.
//
// PrayerMode: a portal overlay that walks the user through today's due prayers
// one at a time, each with the same real verse, an optional personal note and
// an "I'm Done Praying" button. Recording is a single idempotent upsert per
// item per local day (completePrayer), so finishing twice never duplicates.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, XIcon } from '../icons'
import { PrayerSheet } from './PrayerSheet'

export function PrayerDetail({ item, category, verse, completed, busy, onComplete, onUncomplete, onStartPrayer, onClose }) {
  return (
    <PrayerSheet title={category?.name ?? 'Prayer'} onClose={onClose}>
      <h3 className="font-sans text-xl font-semibold tracking-tight text-balance">{item.title}</h3>
      {item.description && <p className="mt-2 text-sm leading-relaxed text-ink">{item.description}</p>}

      {item.notes && (
        <div className="mt-4 rounded-xl border border-line bg-raised/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Personal notes</p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{item.notes}</p>
        </div>
      )}

      {verse && (
        <figure className="mt-5 rounded-xl border border-line p-4">
          <blockquote className="font-serif text-sm leading-relaxed text-ink">&ldquo;{verse.text}&rdquo;</blockquote>
          <figcaption className="mt-2 text-xs font-medium text-muted">
            {verse.reference}{verse.translation ? ` (${verse.translation})` : ''}
          </figcaption>
        </figure>
      )}

      <div className="mt-6 space-y-2">
        <button type="button" onClick={onStartPrayer} className="btn-primary w-full">
          Start Prayer
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={completed ? onUncomplete : onComplete}
          className="btn-ghost w-full"
        >
          {completed ? 'Prayed — undo' : 'I prayed for this'}
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        {completed ? 'This prayer is marked done for today.' : 'Marking it prayed keeps today’s checklist honest.'}
      </p>
    </PrayerSheet>
  )
}

export function PrayerMode({ queue, verse, onComplete, onExit }) {
  const [index, setIndex] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const count = queue.length
  const current = queue[index]

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onExit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onExit])

  if (!current) return null

  const finish = async (status) => {
    if (busy) return
    setBusy(true)
    try {
      await onComplete(current.item, { status, note: note.trim() || null })
      setNote('')
      if (index + 1 < count) setIndex(index + 1)
      else setFinished(true)
    } catch {
      // The page's onComplete toasts the failure; stay on this prayer.
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Prayer mode"
      className="fixed inset-0 z-modal overflow-y-auto bg-surface"
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between">
          <div>
            <p className="eyebrow">Prayer</p>
            {!finished && (
              <p className="text-xs font-medium text-muted" aria-live="off">
                {index + 1} of {count}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onExit}
            disabled={busy}
            aria-label="Exit prayer mode"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-raised text-muted transition-colors hover:text-ink"
          >
            <XIcon width={14} height={14} />
          </button>
        </header>

        {finished ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-wash text-brand-strong dark:text-brand">
              <CheckIcon width={22} height={22} />
            </span>
            <h2 className="mt-4 font-sans text-xl font-semibold tracking-tight">
              Today’s prayers are complete.
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
              You’ve brought these prayers before God today. He who began a good work in you is
              faithful to carry it on.
            </p>
            <button type="button" onClick={onExit} className="btn-primary mt-8 w-full max-w-xs">
              Back to Prayer
            </button>
          </div>
        ) : (
          <main className="flex flex-1 flex-col justify-center py-8">
            <p className="eyebrow">{current.category?.name}</p>
            <h2 className="mt-1 font-sans text-2xl font-semibold tracking-tight text-balance">
              {current.item.title}
            </h2>
            {current.item.description && (
              <p className="mt-3 text-sm leading-relaxed text-ink">{current.item.description}</p>
            )}

            {verse && (
              <figure className="mt-6 rounded-xl border border-line p-5">
                <blockquote className="font-serif text-base leading-relaxed text-ink">
                  &ldquo;{verse.text}&rdquo;
                </blockquote>
                <figcaption className="mt-3 text-xs font-medium text-muted">
                  {verse.reference}
                  {verse.translation ? ` (${verse.translation})` : ''}
                </figcaption>
              </figure>
            )}

            <label className="mt-6 block">
              <span className="text-xs font-medium text-muted">
                Write a prayer or reflection (optional)
              </span>
              <textarea
                value={note}
                rows={3}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Lord, please…"
                className="input mt-1.5 resize-none"
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() => finish('prayed')}
              className="btn-primary mt-8 w-full"
            >
              {busy ? 'Saving…' : 'I’m Done Praying'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => finish('skipped')}
              className="btn-ghost mt-2 w-full"
            >
              Skip for now
            </button>
          </main>
        )}
      </div>
    </div>,
    document.body
  )
}