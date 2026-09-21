import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAskTask, ASK_PREFIX } from './askTask.js'

// The frontend builds the task that bridge.php will only forward if it starts
// with exactly REQUIRED_PROMPT_PREFIX in public/bridge.php. If the two drift,
// every ask is refused with 403 before it reaches the agent — so the prefix is
// worth pinning down here rather than discovering it in production.

test('the ask task opens with the exact bridge.php required prefix', () => {
  assert.equal(buildAskTask('hi').split('\n')[0], ASK_PREFIX)
})

test('the ask task keeps the question as data, not instructions', () => {
  const task = buildAskTask('What does discipleship_signals expose?')
  assert.match(task, /DO NOT modify, create or delete any file/)
  assert.match(task, /--- QUESTION ---\nWhat does discipleship_signals expose\?$/)
})

test('an empty question is refused', () => {
  assert.throws(() => buildAskTask('   '), /question is required/)
})

test('an overlong question is refused', () => {
  assert.throws(() => buildAskTask('x'.repeat(4001)), /too long/)
})