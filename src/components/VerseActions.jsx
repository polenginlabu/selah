// Floating action sheet for the Bible reader's verse selection.
//
// YouVersion-model selection: the passage stays fully interactive while the
// sheet is open, so tapping another verse extends the selection in place (a
// modal backdrop would swallow those taps and break range selection — there is
// deliberately none). The sheet unmounts when the selection clears: ✕, Escape,
// or a downward swipe all clear the selection, as does tapping the anchoring
// verse in the passage. Focus moves into the panel on open and the reader
// returns it to the anchor verse on close.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CheckIcon, XIcon, CopyIcon, ShareIcon, PencilIcon, BookmarkIcon, HighlighterIcon, ChevronDownIcon, BookOpenIcon,
} from '../icons'
import { HIGHLIGHT_COLORS } from '../lib/highlights'

function ActionTile({ icon: Icon, label, active = false, toggle = false, innerRef, onClick }) {
  return (
    <button
      ref={innerRef}
      type="button"
      onClick={onClick}
      aria-pressed={toggle ? active : undefined}
      className={`flex min-h-[3.75rem] flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors ${
        active ? 'bg-brand-wash text-brand-strong dark:text-brand' : 'text-ink hover:bg-raised'
      }`}
    >
      <Icon width={19} height={19} />
      <span>{label}</span>
    </button>
  )
}

function SheetRow({ icon: Icon, label, active = false, toggle = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={toggle ? active : undefined}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
        active ? 'bg-brand-wash text-brand-strong dark:text-brand' : 'text-ink hover:bg-raised'
      }`}
    >
      <Icon width={17} height={17} className={active ? '' : 'text-muted'} />
      <span className="flex-1 text-left">{label}</span>
      {active && <CheckIcon width={16} height={16} className="shrink-0 text-brand-strong dark:text-brand" />}
    </button>
  )
}

export default function VerseActions({
  reference,
  translation,
  count,
  verses,
  highlights,
  allSaved,
  hasHighlight,
  onHighlight,
  onClearHighlights,
  onCopy,
  onShare,
  onReflect,
  onToggleSave,
  onOpenSaved,
  onClose,
}) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const highlightTileRef = useRef(null)
  const moreToggleRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // The reader restores focus to the anchor verse; this panel simply claims it
  // so keyboard and screen-reader users tab into the actions, not to <body>.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      // A native BibleReaderSheet dialog (passage, translation, saved verses, …)
      // owns Escape while it is open; stepping on it would both close the dialog
      // and destroy the selection beneath, stranding focus in the void. The
      // non-modal action sheet yields to modal sheets.
      if (document.querySelector('.bible-sheet[open]')) return
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Downward swipe on the compact sheet dismisses it: there is nothing to
  // scroll, so the drag is ours. When the palette or More row is expanded, or
  // the panel itself is scrollable (short viewport, zoom), vertical drags pan
  // the content instead — the ✕ button remains the dismissal. touch-action
  // stays native so the browser never cancels the gesture mid-swipe.
  function onPanelTouchStart(e) {
    const panel = panelRef.current
    if (paletteOpen || moreOpen || !panel || panel.scrollHeight > panel.clientHeight + 1) { dragRef.current = null; return }
    const touch = e.touches[0]
    dragRef.current = { id: touch.identifier, startY: touch.clientY, delta: 0 }
  }
  function onPanelTouchMove(e) {
    const drag = dragRef.current
    if (!drag) return
    const touch = [...e.changedTouches].find((t) => t.identifier === drag.id)
    if (touch) drag.delta = touch.clientY - drag.startY
  }
  function onPanelTouchEnd() {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && drag.delta > 72) closeRef.current()
  }
  function onPanelTouchCancel() {
    // An interrupted touch stream (browser-cancelled) must never count as a
    // dismiss gesture.
    dragRef.current = null
  }

  // Colors already applied to EVERY selected verse are shown as painted; the
  // painted swatch is what the user taps again to toggle the group's highlight
  // off (applyColor handles that toggle in the reader).
  const painted = useMemo(() => {
    const set = new Set()
    if (!verses.length) return set
    for (const color of HIGHLIGHT_COLORS) {
      if (verses.every((v) => highlights[v.verse] === color.id)) set.add(color.id)
    }
    return set
  }, [verses, highlights])

  return createPortal(
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-modal mx-auto w-[min(100%-1.25rem,36rem)]">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label={`Verse actions: ${reference}`}
        onTouchStart={onPanelTouchStart}
        onTouchMove={onPanelTouchMove}
        onTouchEnd={onPanelTouchEnd}
        onTouchCancel={onPanelTouchCancel}
        className="verse-actions animate-rise motion-reduce:animate-none max-h-[min(60dvh,30rem)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-3 shadow-lift outline-none"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 pl-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{reference}</p>
            {count > 1 && <span className="chip shrink-0 !bg-brand-wash !font-bold !text-brand-strong dark:!text-brand">{count} verses</span>}
            <span className="truncate text-xs text-muted">{translation}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Clear selected verses" className="bible-icon-button !h-10 !w-10">
            <XIcon width={16} height={16} />
          </button>
        </div>
        <p className="mt-1.5 pl-1 text-[0.7rem] leading-snug text-muted">Tap another verse to extend the selection, or tap the first verse to clear.</p>

        <div className="mt-2 grid grid-cols-4 gap-1">
          <ActionTile icon={HighlighterIcon} label="Highlight" active={paletteOpen} toggle onClick={() => setPaletteOpen((open) => !open)} innerRef={highlightTileRef} />
          <ActionTile icon={CopyIcon} label="Copy" onClick={onCopy} />
          <ActionTile icon={ShareIcon} label="Share" onClick={onShare} />
          <ActionTile icon={PencilIcon} label="Reflect" onClick={onReflect} />
        </div>

        {paletteOpen && (
          <div aria-label="Highlight colors" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-raised p-2">
            <span className="pl-1 pr-1 text-xs font-semibold uppercase tracking-wide text-muted">Highlight</span>
            {HIGHLIGHT_COLORS.map((color) => {
              const active = painted.has(color.id)
              return (
                <button
                  key={color.id}
                  type="button"
                  aria-label={active ? `Remove ${color.name} highlight` : `Highlight ${color.name}`}
                  aria-pressed={active}
                  onClick={() => { onHighlight(color.id); setPaletteOpen(false); requestAnimationFrame(() => highlightTileRef.current?.focus({ preventScroll: true })) }}
                  className={`relative h-10 w-10 shrink-0 rounded-full border-2 transition-transform duration-150 ${
                    active ? 'scale-110 border-ink' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ background: color.swatch }}
                >
                  {active && <CheckIcon width={14} height={14} className="absolute inset-0 m-auto text-white drop-shadow-sm" />}
                </button>
              )
            })}
            <button
              type="button"
              disabled={!hasHighlight}
              onClick={() => { onClearHighlights(); setPaletteOpen(false); requestAnimationFrame(() => highlightTileRef.current?.focus({ preventScroll: true })) }}
              className="ml-auto rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:text-ink disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        )}

        <div className="mt-1 flex items-center justify-end">
          <button
            ref={moreToggleRef}
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted hover:text-ink"
          >
            More options
            <ChevronDownIcon width={14} height={14} className={`transition-transform duration-150 ${moreOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {moreOpen && (
          <div className="space-y-1 border-t border-line pt-2">
            <SheetRow icon={BookmarkIcon} label={allSaved ? 'Saved for later' : 'Save for later'} active={allSaved} toggle onClick={onToggleSave} />
            {hasHighlight && <SheetRow icon={HighlighterIcon} label="Remove highlight" onClick={() => { onClearHighlights(); setMoreOpen(false); requestAnimationFrame(() => moreToggleRef.current?.focus({ preventScroll: true })) }} />}
            <SheetRow icon={BookOpenIcon} label="View saved verses" onClick={onOpenSaved} />
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}