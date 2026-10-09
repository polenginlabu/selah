import { AmbientEffect } from './AmbientEffect'

/** Slowly drifting, twinkling gold motes — the ambient layer's default effect. */
export function GoldDust(props) {
  return <AmbientEffect {...props} effect="gold" />
}
