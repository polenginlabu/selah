// API.Bible IDs verified against the account's English-language catalogue.
export const API_BIBLES = [
  { id: 'nivuk', bibleId: '3e2eb613d45e131e-01', abbreviation: 'NIV UK', name: 'New International Version (Anglicised)', description: 'Clear, contemporary English · 2011 edition' },
  { id: 'msg', bibleId: '6f11a7de016f942e-01', abbreviation: 'MSG', name: 'The Message', description: 'A conversational rendering by Eugene H. Peterson' },
  { id: 'amp', bibleId: 'a81b73293d3080c9-01', abbreviation: 'AMP', name: 'Amplified Bible', description: 'Expanded wording for deeper understanding' },
]

// Canonical Protestant order, matching src/data/books.js.
export const BOOK_IDS = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ')
const CHAPTER_COUNTS = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22]

export function validChapter(bookId, chapter) {
  const index = BOOK_IDS.indexOf(bookId)
  return index >= 0 && Number.isInteger(chapter) && chapter > 0 && chapter <= CHAPTER_COUNTS[index]
}

// USX paragraph styles that are a heading rather than Scripture:
//   s, s1..s4  section heading      "Jesus Feeds the Five Thousand"
//   ms, ms1..  major section        "BOOK ONE"
//   mr, sr     the reference line under one, "(Matthew 14:13-21)"
//   d          descriptive title    a psalm's "A Psalm of David"
//   sp         speaker              "Job:" in the poetic dialogues
const HEADING_STYLES = /^(s\d*|ms\d*|mr|sr|d|sp)$/

/** Every text descendant of a node, concatenated. */
function collectText(node) {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text' && typeof node.text === 'string') return node.text
  return (node.items ?? []).map(collectText).join('')
}

// JSON content avoids executing provider HTML. MSG's verse bridges must stay
// together (e.g. 1–2), while AMP's nested italic/Jesus-speech nodes stay intact.
//
// Section headings are returned SEPARATELY from verse text, attached to the
// verse they introduce. They are the translators' editorial apparatus, not
// inspired text — different publishers word them differently and they carry no
// verse number — so they must never end up inside a verse, inside a selection,
// or on a shared verse card.
export function parseChapterContent(content) {
  const nodes = typeof content === 'string' ? JSON.parse(content) : content
  if (!Array.isArray(nodes)) throw new Error('Unexpected Scripture content format.')
  const verses = new Map()
  let paragraph = -1
  let pendingHeading = null
  function walk(node, inheritedId) {
    if (!node || typeof node !== 'object') return
    if (['verse', 'chapter', 'note'].includes(node.name)) return

    // A heading para is captured whole and NOT descended into, so its words
    // cannot leak into the verse that follows. It is held until the next verse
    // appears, which is the one it introduces.
    if (node.name === 'para' && HEADING_STYLES.test(node.attrs?.style ?? '')) {
      const text = collectText(node).replace(/\s+/g, ' ').trim()
      if (text) pendingHeading = pendingHeading ? `${pendingHeading} — ${text}` : text
      return
    }

    if (node.name === 'para') paragraph += 1
    const id = node.attrs?.verseId || inheritedId
    if (node.type === 'text' && id && typeof node.text === 'string') {
      const matches = [...id.matchAll(/[A-Z0-9]{3}\.\d+\.(\d+)/g)].map((m) => Number(m[1]))
      if (!matches.length) throw new Error('Unexpected verse identifier.')
      const start = matches[0]
      const end = matches.at(-1)
      if (!verses.has(id)) {
        verses.set(id, {
          id, verse: start, endVerse: end, label: start === end ? String(start) : `${start}–${end}`,
          paragraph: Math.max(paragraph, 0), text: '', heading: pendingHeading,
        })
        pendingHeading = null
      }
      verses.get(id).text += node.text
    }
    for (const child of node.items ?? []) walk(child, id)
    // Poetry and paragraph boundaries need whitespace even when the upstream
    // text fragments do not end in a space.
    if (node.name === 'para' && verses.size) {
      const last = [...verses.values()].at(-1)
      last.text += ' '
    }
  }
  nodes.forEach((node) => walk(node))
  const result = [...verses.values()].map((v) => ({ ...v, text: v.text.replace(/\s+/g, ' ').trim() })).filter((v) => v.text)
  if (!result.length) throw new Error('No verses were returned for this chapter.')
  return result
}

export function formatSelectionReference(book, chapter, verses) {
  const numbers = [...new Set(verses.flatMap((v) => Array.from(
    { length: (v.endVerse ?? v.verse) - v.verse + 1 }, (_, i) => v.verse + i,
  )))].sort((a, b) => a - b)
  const ranges = []
  for (let i = 0; i < numbers.length; i += 1) {
    const start = numbers[i]
    while (numbers[i + 1] === numbers[i] + 1) i += 1
    ranges.push(start === numbers[i] ? `${start}` : `${start}-${numbers[i]}`)
  }
  return `${book} ${chapter}:${ranges.join(', ')}`
}
