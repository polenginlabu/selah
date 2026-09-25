import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * In-app confirmation for destructive actions.
 *
 * Replaces window.confirm, which is jarring on mobile, unstyled, and on iOS
 * can be suppressed entirely — meaning a "confirmed" delete that the user
 * never actually saw.
 *
 * Rendered as a native <dialog> so it joins the top layer above any open
 * sheet (a plain fixed div paints underneath a modal dialog's ::backdrop and
 * becomes unclickable). The browser supplies focus trapping, Escape, and an
 * inert background for free.
 *
 * Pass `confirmPhrase` for the irreversible ones: typing beats a single tap
 * that a mis-touch can trigger.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  confirmPhrase,
  busy = false,
  onCancel,
  onConfirm,
}) {
  const [typed, setTyped] = useState('')
  const ready = !confirmPhrase || typed.trim() === confirmPhrase
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    dialog.showModal()
    return () => {
      // StrictMode double-effects open and close cleanly because this runs
      // again and re-opens; on real unmount the dialog is always left closed.
      if (dialog.open) dialog.close()
    }
  }, [])

  return createPortal(
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-label={title}
      onCancel={onCancel}
      onClick={(e) => {
        if (busy) return
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="flex h-full w-full items-end justify-center p-4 sm:items-center">
        <div className="animate-sheet-up card relative w-full max-w-sm sm:animate-rise">
          <h2 className="text-base">{title}</h2>
          {body && <p className="mt-2 text-sm text-muted text-pretty">{body}</p>}
          {confirmPhrase && (
            <label className="mt-4 block">
              <span className="text-xs font-medium text-muted">
                Type <span className="font-bold text-ink">{confirmPhrase}</span> to confirm
              </span>
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="input mt-1.5"
                placeholder={confirmPhrase}
              />
            </label>
          )}
          <div className="mt-5 flex gap-2">
            <button onClick={onCancel} disabled={busy} className="btn-outline flex-1">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={!ready || busy}
              className="btn-primary flex-1 !bg-red-600 !text-white disabled:opacity-40"
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </dialog>,
    document.body
  )
}