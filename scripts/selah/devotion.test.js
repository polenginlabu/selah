// Tests for the devotion validator.
//
// The important one here is the source-leak guard. The brief makes research
// sources INTERNAL: what the agent learns from Rick Warren, Vlad Savchuk or
// anyone else should shape the writing, but the reader should meet Scripture
// rather than a reading list. A prompt rule alone does not hold — a model that
// has just read three sermons reaches for "Rick Warren often says..." by
// reflex — so these assert it cannot reach the database.
//
// Run: npm run devotion:test
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractJson, normalizeDevotion, toRow, findLeakedSources, DevotionError } from './devotion.js'

// Within the brief's stated 500-800 word range, so the fixture is a realistic
// pass rather than one sitting on the boundary.
const THOUGHT = 'word '.repeat(600).trim()

const GOOD = {
  topic: 'waiting-on-god',
  topicLabel: 'Waiting on God',
  title: 'The Long Obedience of Waiting',
  keyScripture: 'Isaiah 40:28-31',
  keyScriptureText: 'Have you not known? Have you not heard?...',
  keyScriptureTranslation: 'World English Bible',
  supportingScriptures: ['Psalm 27:14', 'Lamentations 3:25'],
  thought: THOUGHT,
  teaches: 'Isaiah writes to exiles who had waited a long time.',
  questions: [
    'What am I waiting for?',
    'Where am I forcing my own timing?',
    'What would trust look like today?',
  ],
  application: 'Write down one thing you are waiting on and pray over it for five minutes.',
  prayer: 'Father, teach me to wait without despairing.',
  selah: 'Be still for five minutes.',
  researchPerformed: true,
  researchNote: '',
}

test('accepts a complete devotion', () => {
  const d = normalizeDevotion(GOOD)
  assert.equal(d.topicLabel, 'Waiting on God')
  assert.equal(d.questions.length, 3)
  assert.equal('trustedTeachers' in d, false)
})

test('rejects a devotional that names a research source', () => {
  for (const field of ['thought', 'teaches', 'application', 'prayer', 'title']) {
    assert.throws(
      () => normalizeDevotion({ ...GOOD, [field]: `${GOOD[field]} Rick Warren often says this.` }),
      /names its research sources/,
      `a leak in "${field}" must be caught`
    )
  }
})

test('catches a leak in a reflection question too', () => {
  assert.throws(
    () =>
      normalizeDevotion({
        ...GOOD,
        questions: [...GOOD.questions, 'Vlad Savchuk asks whether your life looks different. Does it?'],
      }),
    /names its research sources/
  )
})

test('catches a surname or a ministry name on its own', () => {
  assert.deepEqual(findLeakedSources({ thought: 'As Savchuk teaches,' }), ['Savchuk'])
  assert.deepEqual(findLeakedSources({ thought: 'the Saddleback approach' }), ['Saddleback'])
  assert.deepEqual(findLeakedSources({ thought: 'in his Daily Hope devotional' }), ['Daily Hope'])
  assert.deepEqual(findLeakedSources({ thought: 'Bishop Ballano explains' }), ['Ballano'])
})

test('reports one mention once, not as both full name and surname', () => {
  assert.deepEqual(findLeakedSources({ thought: 'Rick Warren wrote that' }), ['Rick Warren'])
})

test('does not fire on ordinary devotional language', () => {
  assert.deepEqual(findLeakedSources(normalizeDevotion(GOOD)), [])
  // A word-boundary match, so a longer word containing a surname is not a leak.
  assert.deepEqual(findLeakedSources({ thought: 'Paul warned them about warrens of division.' }), [])
})

test('sources record the Scripture only', () => {
  const row = toRow(normalizeDevotion(GOOD), { date: '2026-09-14' })
  assert.deepEqual(row.sources, [{ type: 'scripture', value: 'Isaiah 40:28-31' }])
  assert.equal('trusted_teachers' in row, false)
  assert.equal('user_id' in row, false)
})

test('rejects a devotion missing a required section', () => {
  for (const key of ['prayer', 'application', 'keyScripture', 'thought', 'title']) {
    assert.throws(() => normalizeDevotion({ ...GOOD, [key]: '' }), DevotionError, `should reject empty ${key}`)
  }
})

test('rejects fewer than three reflection questions', () => {
  assert.throws(() => normalizeDevotion({ ...GOOD, questions: ['one', 'two'] }), /3-5/)
})

test('derives a topic slug when the agent omits one', () => {
  assert.equal(normalizeDevotion({ ...GOOD, topic: '' }).topic, 'waiting-on-god')
})

test('extractJson survives an agent that narrates its research first', () => {
  const raw = `I searched several sources and found two sermons.\n\nHere is the devotional:\n\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\n\nLet me know if you want another.`
  assert.equal(extractJson(raw).topicLabel, 'Waiting on God')
})

test('extractJson handles bare JSON and unfenced trailing prose', () => {
  assert.equal(extractJson(JSON.stringify(GOOD)).title, GOOD.title)
  assert.equal(extractJson(`Here you go:\n${JSON.stringify(GOOD)}`).title, GOOD.title)
})

test('extractJson refuses output with no object at all', () => {
  assert.throws(() => extractJson('I could not complete this today.'), DevotionError)
  assert.throws(() => extractJson(''), DevotionError)
})

test('a malformed response is a shape problem, a thin one is a content problem', () => {
  // Shape: reformatting the agent's own text can fix these.
  assert.equal(tryCatch(() => extractJson('no json here')).kind, 'shape')
  assert.equal(tryCatch(() => extractJson('')).kind, 'shape')

  // Content: no amount of reformatting adds the missing words or removes a
  // named source, so these must trigger a fresh run instead.
  assert.equal(tryCatch(() => normalizeDevotion({ ...GOOD, thought: 'too short' })).kind, 'content')
  assert.equal(tryCatch(() => normalizeDevotion({ ...GOOD, prayer: '' })).kind, 'content')
  assert.equal(
    tryCatch(() => normalizeDevotion({ ...GOOD, prayer: 'As Rick Warren prays,' })).kind,
    'content'
  )
})

test('holds the brief to roughly its stated 500-800 word length', () => {
  const words = (n) => 'word '.repeat(n).trim()
  assert.throws(() => normalizeDevotion({ ...GOOD, thought: words(380) }), /only 380 words/)
  assert.doesNotThrow(() => normalizeDevotion({ ...GOOD, thought: words(500) }))
  // A near-miss must pass: regenerating a readable 445-word devotion costs a
  // second full research run and usually returns something no longer.
  assert.doesNotThrow(() => normalizeDevotion({ ...GOOD, thought: words(445) }))
})

function tryCatch(fn) {
  try {
    fn()
  } catch (err) {
    return err
  }
  throw new Error('expected a throw')
}
