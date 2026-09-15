/**
 * Renders the small slice of Markdown the study assistant actually emits:
 * **bold** section labels, *italic* attributions and prayers, dash bullets,
 * and blank-line paragraphs.
 *
 * Two deliberate decisions:
 *
 * 1. React nodes, never HTML. The content is model output relayed from an
 *    Edge Function — untrusted text by definition. Building elements means
 *    there is no dangerouslySetInnerHTML anywhere near it, so a reply
 *    containing markup is displayed rather than executed.
 *
 * 2. No Markdown dependency. react-markdown plus remark is tens of kilobytes
 *    for four constructs, on a PWA people install over mobile data. If the
 *    assistant ever needs tables, links or headings, swap this for a real
 *    parser rather than growing it.
 */

// Bold first: **x** must win over *x*, or the outer asterisks match as italic
// and leave stray ones behind.
const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*/g

/** Splits one line into text, <strong> and <em> nodes. */
function inline(text, keyPrefix) {
  const nodes = []
  let last = 0
  let match
  INLINE.lastIndex = 0

  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${match.index}`}>{match[1]}</strong>)
    } else {
      nodes.push(<em key={`${keyPrefix}-i${match.index}`}>{match[2]}</em>)
    }
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Line breaks inside a paragraph are meaningful here — the labels rely on them. */
function lines(block, keyPrefix) {
  return block.split('\n').flatMap((line, i) =>
    i === 0
      ? inline(line, `${keyPrefix}-${i}`)
      : [<br key={`${keyPrefix}-br${i}`} />, ...inline(line, `${keyPrefix}-${i}`)]
  )
}

const isBullet = (line) => /^\s*[-*]\s+/.test(line)

export function RichText({ content }) {
  if (!content) return null

  return (
    <>
      {content
        .trim()
        .split(/\n{2,}/)
        .map((block, b) => {
          const blockLines = block.split('\n').filter(Boolean)

          // A block where every line is a dash bullet becomes a real list; a
          // mixed block does not, so a stray dash mid-paragraph stays text.
          if (blockLines.length > 0 && blockLines.every(isBullet)) {
            return (
              <ul key={b} className="my-1 list-disc space-y-0.5 pl-4">
                {blockLines.map((line, i) => (
                  <li key={i}>{inline(line.replace(/^\s*[-*]\s+/, ''), `${b}-${i}`)}</li>
                ))}
              </ul>
            )
          }

          return (
            <p key={b} className="mb-2 last:mb-0">
              {lines(block, String(b))}
            </p>
          )
        })}
    </>
  )
}
