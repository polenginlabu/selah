import { useCallback, useRef, useState } from 'react'

/**
 * Tracks which rows have a write in flight, so a tap on a slow connection
 * shows it was registered.
 *
 * The pages here update optimistically, which is right — the toggle flips
 * instantly. But that also means a tap on a slow connection looks identical to
 * one that has already saved, so people tap again, and a failure silently
 * reverts with nothing to explain it. This gives each row a pending flag to
 * render, and guarantees the flag is cleared even when the write throws.
 *
 *   const pending = usePending()
 *   await pending.track(disciple.id, () => upsertAttendance(...))
 *   ...
 *   {pending.has(disciple.id) && <Spinner />}
 */
export function usePending() {
  const [keys, setKeys] = useState(() => new Set())
  // A ref alongside the state so track() can read the live set without being
  // recreated on every change, which would break memoised children.
  const live = useRef(new Set())

  const sync = useCallback(() => setKeys(new Set(live.current)), [])

  const track = useCallback(
    async (key, action) => {
      live.current.add(key)
      sync()
      try {
        return await action()
      } finally {
        live.current.delete(key)
        sync()
      }
    },
    [sync]
  )

  const has = useCallback((key) => keys.has(key), [keys])

  return { track, has, count: keys.size }
}
