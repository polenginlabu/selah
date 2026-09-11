import { useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * In-app confirmation for destructive actions.
 *
 * Replaces window.confirm, which is jarring on mobile, unstyled, and on iOS
 * can be suppressed entirely — meaning a "confirmed" delete that the user
 * never actually saw.
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

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center p-4 sm:items-center">
      <div
        className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={busy ? undefined : onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-sheet-up card relative w-full max-w-sm sm:animate-rise"
      >
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
    </div>,
    document.body
  )
}
