#!/usr/bin/env node
// Diagnoses "I have to hard refresh to see my changes".
//
// There are three independent things that cause it, they look identical from
// the browser, and the fix for each is different:
//
//   1. The host ignores .htaccess `Header` directives (AllowOverride), so the
//      no-cache policy on index.html / app.js / sw.js never actually ships.
//   2. The headers ship, but an edge/CDN layer in front of Apache caches
//      sw.js anyway, so the service worker update check never sees a new
//      build and keeps serving the old shell from its precache.
//   3. Everything is configured right and the deploy simply has not landed.
//
// This tells you which one you have by reading the live responses.
//
// Usage:
//   node scripts/check-deploy-cache.js https://your-domain
import { readFileSync } from 'node:fs'

const RESET = '\x1b[0m'
const c = (code, s) => `\x1b[${code}m${s}${RESET}`
const ok = (s) => c(32, s)
const bad = (s) => c(31, s)
const warn = (s) => c(33, s)

async function head(url) {
  const res = await fetch(url, { method: 'GET', headers: { 'Cache-Control': 'no-cache' }, redirect: 'follow' })
  const body = await res.text()
  return { status: res.status, headers: res.headers, body }
}

function reportCacheControl(label, value, expected) {
  if (!value) return { line: `${bad('MISSING')}  ${label} has no Cache-Control`, pass: false }
  const noStore = /no-cache|no-store|max-age=0/.test(value)
  const pass = expected === 'revalidate' ? noStore : /immutable|max-age=\d{5,}/.test(value)
  return {
    line: `${pass ? ok('OK     ') : bad('WRONG  ')}  ${label}: ${value}`,
    pass,
  }
}

async function main() {
  const base = (process.argv[2] || '').replace(/\/+$/, '')
  if (!base) throw new Error('Usage: node scripts/check-deploy-cache.js https://your-domain')

  console.log(`\nChecking ${base}\n${'-'.repeat(60)}`)

  const results = []

  // --- index.html ----------------------------------------------------------
  const index = await head(`${base}/`)
  console.log(`\n[ / ]  HTTP ${index.status}`)
  const idx = reportCacheControl('index.html', index.headers.get('cache-control'), 'revalidate')
  console.log('  ' + idx.line)
  results.push(idx.pass)

  // --- sw.js — the one that actually drives updates ------------------------
  const sw = await head(`${base}/sw.js`)
  console.log(`\n[ /sw.js ]  HTTP ${sw.status}`)
  if (sw.status !== 200) {
    console.log('  ' + bad('The service worker is not being served. Nothing can update.'))
    results.push(false)
  } else {
    const swc = reportCacheControl('sw.js', sw.headers.get('cache-control'), 'revalidate')
    console.log('  ' + swc.line)
    results.push(swc.pass)
    if (!swc.pass) {
      console.log('  ' + warn('This is the big one: a stale sw.js means no device ever'))
      console.log('  ' + warn('learns a new build exists, and only a hard refresh (which'))
      console.log('  ' + warn('bypasses the worker) shows new code.'))
    }

    // Does the live worker match the one we would deploy right now?
    try {
      const local = readFileSync('dist/sw.js', 'utf8')
      const liveHash = sw.body.length
      const localHash = local.length
      console.log(`  live sw.js is ${liveHash} bytes; local dist/sw.js is ${localHash} bytes`)
      if (liveHash !== localHash) {
        console.log('  ' + warn('They differ — the live site is not this build (expected if'))
        console.log('  ' + warn('you have local changes, a problem if you just deployed).'))
      } else {
        console.log('  ' + ok('The deployed worker matches your local build.'))
      }
    } catch {
      console.log('  (no local dist/sw.js to compare — run npm run build first)')
    }
  }

  // --- the entry bundle ----------------------------------------------------
  const app = await head(`${base}/assets/app.js`)
  console.log(`\n[ /assets/app.js ]  HTTP ${app.status}`)
  if (app.status === 200) {
    const appc = reportCacheControl('app.js', app.headers.get('cache-control'), 'revalidate')
    console.log('  ' + appc.line)
    results.push(appc.pass)
  }

  // --- is mod_headers honoured at all? -------------------------------------
  console.log(`\n${'-'.repeat(60)}\nVerdict\n`)
  const anyHeader = [index, sw, app].some((r) => r.headers.get('cache-control'))
  if (!anyHeader) {
    console.log(bad('  No Cache-Control on ANY file.'))
    console.log('  The host is ignoring the .htaccess <IfModule mod_headers.c>')
    console.log('  block — most likely AllowOverride does not permit it. Ask')
    console.log('  Hostinger to allow it, or set the headers in hPanel.')
  } else if (results.every(Boolean)) {
    console.log(ok('  Caching headers are correct on every file.'))
    console.log('  If devices are still stale, they are pinned to an OLD worker')
    console.log('  cached before this fix shipped. That clears itself within 24h')
    console.log("  (the browser's forced update check). To confirm, load the site")
    console.log('  in a private window — that has no worker and shows the truth.')
  } else {
    console.log(warn('  Some files are cached when they should revalidate — see above.'))
  }
  console.log()
}

main().catch((err) => {
  console.error(`\n${err.message}\n`)
  process.exitCode = 1
})
