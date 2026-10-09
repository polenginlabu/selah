import { useEffect, useState } from 'react'
import { getAmbientSettings } from '../data/ambientSettings'
import { resolveEffect } from '../lib/ambientEffects'
import { AmbientEffect } from './AmbientEffect'

/**
 * The admin-chosen ambient layer: a fixed effect, the season's effect, or
 * nothing. Draws nothing until the settings arrive, so a reader never sees
 * gold swap to snow; a failed read shows gold dust.
 */
export function SeasonalAmbient({ className = '' }) {
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    let alive = true
    getAmbientSettings().then((s) => alive && setSettings(s))
    return () => {
      alive = false
    }
  }, [])

  const effect = settings && resolveEffect(settings, new Date())
  if (!effect) return null
  return <AmbientEffect effect={effect} intensity={settings.intensity} className={className} />
}
