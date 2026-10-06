import { test } from 'node:test'
import assert from 'node:assert/strict'
import { photoCredit, photoCreditHref } from './photoCredit.js'

test('photoCredit names the creator and the known provider', () => {
  assert.equal(photoCredit({ provider: 'pixabay', creator: 'Jane Doe' }), 'Photo: Jane Doe · Pixabay')
  assert.equal(photoCredit({ provider: 'openverse', creator: 'A. N. Other' }), 'Photo: A. N. Other · Openverse')
})

test('photoCredit falls back for an unknown creator or provider', () => {
  assert.equal(photoCredit({ provider: 'unsplash', creator: '' }), 'Photo: Unknown · unsplash')
})

test('photoCredit is empty without attribution', () => {
  assert.equal(photoCredit(null), '')
  assert.equal(photoCredit(undefined), '')
})

test('photoCreditHref only returns https links', () => {
  assert.equal(photoCreditHref({ sourceUrl: 'https://pixabay.com/photos/1' }), 'https://pixabay.com/photos/1')
  assert.equal(photoCreditHref({ sourceUrl: 'http://example.com' }), null)
  assert.equal(photoCreditHref({ sourceUrl: 'javascript:alert(1)' }), null)
  assert.equal(photoCreditHref({}), null)
  assert.equal(photoCreditHref(null), null)
})
