import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// No DOM test runner is installed, so these pin the splash contract at the
// source level: the pre-React splash in index.html and the React one in
// App.jsx have to stay in step or the handoff flashes.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const html = read('../../index.html')
const app = read('../App.jsx')
const main = read('../main.jsx')

const bootRule = html.match(/#boot-splash\s*\{([^}]*)\}/)?.[1] ?? ''

test('boot splash is a fixed full-viewport overlay above the React splash', () => {
  assert.match(bootRule, /position:\s*fixed/)
  assert.match(bootRule, /inset:\s*0/)
  const bootZ = Number(bootRule.match(/z-index:\s*(\d+)/)?.[1])
  const reactZ = Number(app.match(/fixed inset-0 z-\[(\d+)\]/)?.[1])
  assert.ok(reactZ > 0, 'React splash z-index not found')
  assert.ok(bootZ > reactZ, `boot z ${bootZ} must exceed React splash z ${reactZ}`)
})

test('boot splash is an accessible loading status with a decorative lockup', () => {
  assert.match(html, /<div id="boot-splash" role="status" aria-label="Loading">/)
  assert.match(html, /class="lockup" aria-hidden="true"/)
})

test('boot splash light and dark backgrounds match the theme-color metas', () => {
  assert.match(bootRule, /background:\s*#F2F5FF/i)
  assert.match(html, /\.dark #boot-splash\s*\{\s*background:\s*#111418/i)
})

test('boot splash fade is disabled under prefers-reduced-motion', () => {
  const block = html.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*#boot-splash\s*\{([^}]*)\}/)
  assert.ok(block, 'reduced-motion override for #boot-splash missing')
  assert.match(block[1], /transition:\s*none/)
})

test('boot splash is not removed synchronously after render', () => {
  const afterRender = main.slice(main.indexOf('.render('))
  const removeAt = afterRender.indexOf('.remove()')
  assert.ok(removeAt > -1, 'boot splash is never removed')
  const before = afterRender.slice(0, removeAt)
  assert.match(before, /requestAnimationFrame/)
  assert.match(before, /is-done/)
})

test('React splash keeps status semantics and honours reduced motion', () => {
  assert.match(app, /role=\{exiting \? undefined : 'status'\}/)
  assert.match(app, /aria-label=\{exiting \? undefined : 'Loading'\}/)
  assert.match(app, /autoplay=\{!reducedMotion\}/)
  assert.match(app, /loop=\{!reducedMotion\}/)
  assert.match(app, /prefers-reduced-motion: reduce/)
})

test('AuthedApp carries one splash instance from loading through fade-out', () => {
  const body = app.slice(app.indexOf('function AuthedApp()'))
  const end = body.indexOf('\n}\n')
  const fn = body.slice(0, end)
  // A second render site (e.g. an early `if (loading) return <SplashScreen />`)
  // would remount the splash when auth settles and restart the boat.
  assert.equal(fn.match(/<SplashScreen/g)?.length, 1, 'AuthedApp must render <SplashScreen> exactly once')
  assert.doesNotMatch(fn, /return\s*<SplashScreen/)
  assert.match(fn, /\(loading \|\| splashExiting\) && <SplashScreen exiting=\{!loading\}/)
})

test('boot splash lockup matches Logo size 40 used by the React splash', () => {
  assert.match(app, /<Logo size=\{40\} \/>/)
  assert.match(html, /<svg width="40" height="40" viewBox="0 0 40 40"/)
})
