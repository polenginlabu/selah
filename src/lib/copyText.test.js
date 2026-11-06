import test from 'node:test'
import assert from 'node:assert/strict'
import { copyText } from './copyText.js'

function fakeDoc({ exec = true, throwExec = false } = {}) {
  const doc = {
    appended: [],
    removed: 0,
    created: null,
    body: {
      appendChild(el) { doc.appended.push(el) },
    },
    createElement() {
      const el = {
        style: {},
        selected: false,
        setAttribute(k, v) { this[k] = v },
        select() { this.selected = true },
        remove() { doc.removed++ },
      }
      doc.created = el
      return el
    },
    execCommand(cmd) {
      if (throwExec) throw new Error('boom')
      return cmd === 'copy' && exec
    },
  }
  return doc
}

test('uses Clipboard API when available', async () => {
  let got
  const env = { navigator: { clipboard: { writeText: async (t) => { got = t } } }, document: fakeDoc() }
  assert.equal(await copyText('hi', env), true)
  assert.equal(got, 'hi')
  assert.equal(env.document.appended.length, 0)
})

test('falls back when API rejects', async () => {
  const document = fakeDoc()
  const env = { navigator: { clipboard: { writeText: async () => { throw new Error('no') } } }, document }
  assert.equal(await copyText('hi', env), true)
  assert.equal(document.created.selected, true)
  assert.equal(document.created.readonly, '')
  assert.equal(document.removed, 1)
})

test('returns false with no clipboard and no document', async () => {
  assert.equal(await copyText('hi', {}), false)
})

test('returns false when execCommand returns false, and removes textarea', async () => {
  const document = fakeDoc({ exec: false })
  assert.equal(await copyText('hi', { document }), false)
  assert.equal(document.removed, 1)
})

test('removes textarea even if execCommand throws, never throws', async () => {
  const document = fakeDoc({ throwExec: true })
  assert.equal(await copyText('hi', { document }), false)
  assert.equal(document.removed, 1)
})

test('empty or whitespace text returns false', async () => {
  const document = fakeDoc()
  assert.equal(await copyText('', { document }), false)
  assert.equal(await copyText('   \n', { document }), false)
  assert.equal(document.appended.length, 0)
})
