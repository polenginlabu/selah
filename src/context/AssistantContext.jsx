import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Makes the study assistant global — one button, reachable from every page —
 * while still letting whichever page you're on hand it context.
 *
 * The alternative was a separate assistant per page, which meant the same
 * conversation restarting every time you navigated and no way to ask a plain
 * question from, say, the disciple tree.
 */
const AssistantContext = createContext(undefined)

export function AssistantProvider({ children }) {
  const [open, setOpen] = useState(false)
  // What the current page has published as quotable context, if anything.
  const [passage, setPassage] = useState(null)

  const value = useMemo(() => ({ open, setOpen, passage, setPassage }), [open, passage])
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistant() {
  const ctx = useContext(AssistantContext)
  if (!ctx) throw new Error('useAssistant must be used within AssistantProvider')
  return ctx
}

/**
 * Publishes the current page's passage to the global assistant, and clears it
 * on unmount so a stale chapter can't follow you to another page.
 *
 * IMPORTANT: `passage` must be referentially stable — wrap it in useMemo at the
 * call site. An object literal would be a new reference every render and spin
 * this effect forever.
 */
export function useAssistantPassage(passage) {
  const { setPassage } = useAssistant()
  useEffect(() => {
    setPassage(passage ?? null)
    return () => setPassage(null)
  }, [passage, setPassage])
}

/** Opens the panel, optionally seeding the first question. */
export function useOpenAssistant() {
  const { setOpen } = useAssistant()
  return useCallback(() => setOpen(true), [setOpen])
}
