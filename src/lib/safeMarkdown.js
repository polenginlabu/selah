// A deliberately tiny Markdown subset for remote text (Zackion explanations).
//
// parseMarkdown returns plain data — paragraphs of lines of inline tokens —
// that a component maps to React elements, so nothing in the remote text is
// ever interpreted as HTML: "<script>" stays a text token and React escapes it.
// Supported: blank-line paragraphs, single-newline line breaks, "# " headings
// (rendered bold), **bold**, *italic* and _italic_. Unclosed markers — common
// mid-stream — stay literal text until their closing marker arrives.
// Unlike src/components/RichText.jsx (the study assistant's JSX renderer) the
// parsing is pure JS, so its escaping is covered by node --test.

function pushText(tokens, text) {
  if (!text) return
  const last = tokens[tokens.length - 1]
  if (last?.type === 'text') last.text += text
  else tokens.push({ type: 'text', text })
}

const WORD = /[\p{L}\p{N}]/u

export function parseInline(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        tokens.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
      pushText(tokens, '**')
      i += 2
      continue
    }
    const ch = text[i]
    // "_" only opens/closes at word boundaries so snake_case stays literal.
    if ((ch === '*' || (ch === '_' && !WORD.test(text[i - 1] ?? ''))) && text[i + 1] && text[i + 1] !== ' ' && text[i + 1] !== ch) {
      let end = i + 1
      for (;;) {
        end = text.indexOf(ch, end)
        if (end === -1) break
        if (ch === '*' && text[end + 1] === '*') { end += 2; continue }
        if (ch === '_' && WORD.test(text[end + 1] ?? '')) { end += 1; continue }
        break
      }
      if (end > i + 1 && text[end - 1] !== ' ') {
        tokens.push({ type: 'em', children: parseInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    pushText(tokens, ch)
    i += 1
  }
  return tokens
}

/** @returns {{ heading: boolean, tokens: object[] }[][]} paragraphs → lines */
export function parseMarkdown(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) => block.split('\n').filter((line) => line.trim()).map((line) => {
      const heading = /^#{1,6}\s+/.test(line)
      return { heading, tokens: parseInline(heading ? line.replace(/^#{1,6}\s+/, '') : line) }
    }))
    .filter((lines) => lines.length)
}
