// Tests for how the Firebase service account is supplied.
//
// This is the step people get wrong, and every way of getting it wrong fails
// far from the cause: a mangled private key surfaces as an OpenSSL PEM error
// during the upload, minutes later. So all three accepted forms are asserted,
// and so is the newline repair.
//
// No credential is used here — the fixture is a structurally valid service
// account with an obviously fake key.
//
// Run: npm run devotion:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseServiceAccount, StorageError } from './firebaseStorage.js'

const FIXTURE = {
  type: 'service_account',
  project_id: 'devotional-app-test',
  client_email: 'test@devotional-app-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nNOTAREALKEY\n-----END PRIVATE KEY-----\n',
}
const JSON_TEXT = JSON.stringify(FIXTURE)

test('raw JSON is accepted', () => {
  assert.equal(parseServiceAccount(JSON_TEXT).project_id, 'devotional-app-test')
})

test('base64 is accepted', () => {
  const b64 = Buffer.from(JSON_TEXT).toString('base64')
  assert.equal(parseServiceAccount(b64).client_email, FIXTURE.client_email)
})

test('a path to the downloaded file is accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'selah-sa-'))
  const file = join(dir, 'devotional-app-firebase-adminsdk-abc123.json')
  writeFileSync(file, JSON_TEXT)
  assert.equal(parseServiceAccount(file).project_id, 'devotional-app-test')
})

test('a path that does not exist is not silently treated as base64', () => {
  // Would otherwise base64-decode to junk and fail with a confusing message
  // about JSON rather than about the missing file.
  assert.throws(() => parseServiceAccount('/no/such/service-account.json'), StorageError)
})

test('escaped newlines in the private key are repaired', () => {
  // How the key arrives when it has been through a .env file or a shell: the
  // newlines become literal backslash-n, and OpenSSL then rejects the PEM.
  const escaped = JSON.stringify({ ...FIXTURE, private_key: FIXTURE.private_key.replace(/\n/g, '\\n') })
  const parsed = parseServiceAccount(escaped)
  assert.ok(parsed.private_key.includes('\n'), 'newlines were not restored')
  assert.ok(!parsed.private_key.includes('\\n'), 'literal \\n survived')
  assert.equal(parsed.private_key, FIXTURE.private_key)
})

test('an incomplete service account is rejected by field, not later by OpenSSL', () => {
  for (const missing of ['project_id', 'client_email', 'private_key']) {
    const partial = { ...FIXTURE }
    delete partial[missing]
    assert.throws(
      () => parseServiceAccount(JSON.stringify(partial)),
      (err) => err instanceof StorageError && err.message.includes(missing),
      `missing ${missing} was not reported by name`
    )
  }
})

test('an empty value names the variable to set', () => {
  for (const empty of ['', '   ', null, undefined]) {
    assert.throws(
      () => parseServiceAccount(empty),
      (err) => err.message.includes('FIREBASE_SERVICE_ACCOUNT')
    )
  }
})

test('unreadable garbage gives an actionable message', () => {
  assert.throws(
    () => parseServiceAccount('this is not a service account'),
    (err) => err instanceof StorageError && /path to the downloaded/.test(err.message)
  )
})
