// Bottom-sheet dialog for the Prayer feature, built on the native <dialog>
// the way BibleReaderSheet is: the browser supplies focus trapping, Escape,
// and an inert background for free. Same `.bible-sheet` styling class (it is
// just the app's bottom-sheet look).
//
// The sheet is bottom-anchored, so on phones the on-screen keyboard would
// sit on top of its actions: the visual viewport shrinks when the keyboard
// opens (iOS and Android), and we re-anchor the sheet to the visible bottom
// and cap its height so fields and buttons stay reachable. Browsers without
// a visual viewport fall back to the CSS class, which carries a vh → dvh
// fallback chain.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from '../icons'

export function PrayerSheet({ title, onClose, children }) {
  const ref = useRef(null)
  const [sheetStyle, setSheetStyle] = useState(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const layoutH = window.innerHeight
      const vh = vv.height
      // Layout region hidden below the visible area (i.e. the on-screen
      // keyboard, including any visual-viewport pan from focusing a field).
      const keyboard = Math.max(0, layoutH - vh - (vv.offsetTop || 0))
      setSheetStyle({
        maxHeight: `${Math.round(vh * 0.88)}px`,
        bottom: `${Math.round(keyboard)}px`,
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

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
      className="bible-sheet"
      aria-label={title}
      style={sheetStyle || undefined}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-4 px-5 pb-2 pt-4">
        <h2 className="font-sans text-lg font-semibold tracking-tight text-balance">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-raised text-muted transition-colors hover:text-ink"
        >
          <XIcon width={13} height={13} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{children}</div>
    </dialog>,
    document.body
  )
}