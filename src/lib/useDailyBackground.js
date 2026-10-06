import { useEffect, useState } from 'react'
import { getLatestBackground } from '../data/dailyBackgrounds'

/**
 * The day's background photo for the devotional card and reader, or null.
 *
 * Uses the most recent background on or before `date`, so one failed night
 * shows yesterday's art rather than none. The image is preloaded before it is
 * returned: a background is only handed back once its bytes have arrived, so
 * callers can fade it in over their gradient fallback, and a broken URL never
 * reaches the page as a broken image — it simply leaves the fallback in place.
 * A null `date` fetches nothing, for callers with nothing to show it behind.
 */
export function useDailyBackground(date) {
  const [background, setBackground] = useState(null)

  useEffect(() => {
    let alive = true
    let img = null
    setBackground(null)
    if (!date) return

    getLatestBackground(date)
      .then((row) => {
        if (!alive || !row?.imageUrl) return
        img = new Image()
        img.decoding = 'async'
        img.onload = () => {
          if (alive) setBackground(row)
        }
        img.onerror = () => {
          console.warn('daily background image failed to load', row.imageUrl)
        }
        img.src = row.imageUrl
      })
      .catch((err) => {
        // Decoration only — losing it must not take the page with it.
        console.warn('daily background failed', err)
      })

    return () => {
      alive = false
      if (img) {
        img.onload = null
        img.onerror = null
      }
    }
  }, [date])

  return background
}
