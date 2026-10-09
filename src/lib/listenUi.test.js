// Tests for the read-aloud display text: the status line, the toolbar
// button's pressed state and label, and the voice label.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { listenLine, toolbarState, voiceLabel } from './listenUi.js'

const base = { message: 'Sign in to listen to Scripture.', verseLabel: '16', minutes: 4, providerName: 'Gemini' }

test('listenLine describes every player status', () => {
  const line = (status) => listenLine({ ...base, status })
  assert.equal(line('idle'), 'Gemini voice · about 4 min')
  assert.equal(line('preparing'), 'Preparing chapter…')
  assert.equal(line('buffering'), 'Loading audio…')
  assert.equal(line('playing'), 'Verse 16')
  assert.equal(line('paused'), 'Paused · Verse 16')
  assert.equal(line('ended'), 'Chapter finished')
  assert.equal(line('error'), 'Sign in to listen to Scripture.')
  assert.equal(line('offline'), 'Sign in to listen to Scripture.')
})

test('toolbarState is pressed while audio is playing or on its way', () => {
  for (const status of ['playing', 'preparing', 'buffering']) {
    assert.deepEqual(toolbarState(status, 'John', 3), { playing: true, label: 'Pause John 3' })
  }
  for (const status of ['idle', 'paused', 'ended', 'error', 'offline']) {
    assert.deepEqual(toolbarState(status, 'John', 3), { playing: false, label: 'Listen to John 3' })
  }
})

test('voiceLabel names the device voice only when it is reading', () => {
  assert.equal(voiceLabel(true), 'Device voice')
  assert.equal(voiceLabel(false), 'AI-generated voice')
})
