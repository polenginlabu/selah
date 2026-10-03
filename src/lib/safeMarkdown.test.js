import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseInline, parseMarkdown } from './safeMarkdown.js'

function flatten(tokens) {
  return tokens.map((t) => (t.type === 'text' ? t.text : flatten(t.children))).join('')
}

test('HTML in remote text stays literal text, never a tag', () => {
  const input = '<script>alert(1)</script> and <img src=x onerror="alert(2)">'
  const [[line]] = parseMarkdown(input)
  assert.deepEqual(line.tokens, [{ type: 'text', text: input }])
  const [[bold]] = parseMarkdown('**<b onmouseover=alert(3)>hi</b>**')
  assert.equal(bold.tokens[0].type, 'strong')
  assert.deepEqual(bold.tokens[0].children, [{ type: 'text', text: '<b onmouseover=alert(3)>hi</b>' }])
  const types = new Set()
  const walk = (tokens) => tokens.forEach((t) => { types.add(t.type); if (t.children) walk(t.children) })
  parseMarkdown('# <h1>x</h1>\n*<i>y</i>* _<a href="javascript:z">z</a>_').flat().forEach((l) => walk(l.tokens))
  assert.deepEqual([...types].sort(), ['em', 'text'])
})

test('bold and italic markers become tokens', () => {
  assert.deepEqual(parseInline('**📖 Scripture** *"For God so loved"* — John 3:16'), [
    { type: 'strong', children: [{ type: 'text', text: '📖 Scripture' }] },
    { type: 'text', text: ' ' },
    { type: 'em', children: [{ type: 'text', text: '"For God so loved"' }] },
    { type: 'text', text: ' — John 3:16' },
  ])
  assert.deepEqual(parseInline('_grace_ upon grace'), [
    { type: 'em', children: [{ type: 'text', text: 'grace' }] },
    { type: 'text', text: ' upon grace' },
  ])
  assert.deepEqual(parseInline('*a **b** c*'), [
    { type: 'em', children: [{ type: 'text', text: 'a ' }, { type: 'strong', children: [{ type: 'text', text: 'b' }] }, { type: 'text', text: ' c' }] },
  ])
})

test('unclosed markers mid-stream stay literal', () => {
  assert.deepEqual(parseInline('**Reflect'), [{ type: 'text', text: '**Reflect' }])
  assert.deepEqual(parseInline('*For God so'), [{ type: 'text', text: '*For God so' }])
  assert.deepEqual(parseInline('snake_case_name and 2 * 3'), [{ type: 'text', text: 'snake_case_name and 2 * 3' }])
})

test('marker-only and whitespace-only input never yields empty tokens', () => {
  assert.deepEqual(parseInline('****'), [{ type: 'text', text: '****' }])
  assert.deepEqual(parseMarkdown('   \n\n  \n'), [])
})

test('blank lines split paragraphs; single newlines are line breaks; headings are flagged', () => {
  const paragraphs = parseMarkdown('Welcome.\r\n\r\n## 💭 Reflection\nLine one\nLine two\n\n\n\nLast')
  assert.equal(paragraphs.length, 3)
  assert.equal(flatten(paragraphs[0][0].tokens), 'Welcome.')
  assert.deepEqual(paragraphs[1].map((l) => l.heading), [true, false, false])
  assert.equal(flatten(paragraphs[1][0].tokens), '💭 Reflection')
  assert.equal(flatten(paragraphs[1][2].tokens), 'Line two')
  assert.equal(flatten(paragraphs[2][0].tokens), 'Last')
  assert.deepEqual(parseMarkdown(''), [])
})
