// Preserve the existing optional ESV/NLT providers for configured installs.
const esvToken = import.meta.env.VITE_ESV_API_TOKEN ?? ''
const nltKey = import.meta.env.VITE_NLT_API_KEY ?? ''
export const LEGACY_BIBLES = [
  ...(esvToken ? [{ id: 'esv', abbreviation: 'ESV', name: 'English Standard Version', description: '© Crossway' }] : []),
  ...(nltKey ? [{ id: 'nlt', abbreviation: 'NLT', name: 'New Living Translation', description: '© Tyndale' }] : []),
]

export async function getLegacyChapter(book, chapter, translation) {
  let verses = []
  if (translation === 'esv') {
    const params = new URLSearchParams({
      q: `${book} ${chapter}`, 'include-passage-references': 'false', 'include-verse-numbers': 'true',
      'include-first-verse-numbers': 'true', 'include-footnotes': 'false', 'include-headings': 'true',
      'include-short-copyright': 'true', 'include-passage-horizontal-lines': 'false',
      'include-heading-horizontal-lines': 'false', 'indent-poetry': 'false',
    })
    const response = await fetch(`https://api.esv.org/v3/passage/text/?${params}`, { headers: { Authorization: `Token ${esvToken}` }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Could not load the ESV chapter.')
    const text = (await response.json()).passages?.[0] ?? ''
    const parts = text.replace(/\(ESV\)\s*$/, '').split(/\[(\d+)\]/)
    // The ESV text endpoint puts a section heading on its own line, separated
    // by a blank line, inside whichever chunk precedes it. So a chunk is
    // "<verse text>\n\n<heading for the NEXT verse>", and parts[0] — the text
    // before verse 1 — is the chapter's opening heading, if it has one.
    // parts[0] is everything before verse 1, which is heading and nothing
    // else — there is no verse text for a trailing segment to trail. Treating
    // it like the other chunks loses the chapter's opening heading, which is
    // the one most chapters have.
    let pendingHeading = leadingHeading(parts[0])
    for (let i = 1; i < parts.length; i += 2) {
      const { body, heading } = splitTrailingHeading(parts[i + 1])
      verses.push({ verse: Number(parts[i]), text: body, heading: pendingHeading })
      pendingHeading = heading
    }
  } else {
    const response = await fetch(`https://api.nlt.to/api/passages?ref=${encodeURIComponent(`${book} ${chapter}`)}&version=NLT&key=${encodeURIComponent(nltKey)}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Could not load the NLT chapter.')
    // verse_export is an unknown HTML element, so the parser cannot be relied
    // on to keep each one a separate node when its content starts with <p>.
    // Split on the tags first, then clean each verse's markup individually.
    const html = await response.text()
    const blocks = [...html.matchAll(/<verse_export[^>]*\bvn="(\d+)"[^>]*>([\s\S]*?)<\/verse_export>/g)]
    for (const [, vn, innerHtml] of blocks) {
      const verse = Number(vn)
      const el = new DOMParser().parseFromString(innerHtml, 'text/html').body
      // NLT puts a subhead inside the verse_export of the verse it introduces,
      // so read it BEFORE stripping — it used to be discarded with the
      // footnotes. Headings are editorial, so they are kept out of the verse
      // text and returned alongside it.
      const heading = [...el.querySelectorAll('h1, h2, h3, .subhead')]
        .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' \u2014 ') || null
      el.querySelectorAll('.vn, .tn, .tn-ref, .a-tn, .sn, .sn-ref, h1, h2, h3, .subhead, .chapter-number').forEach((node) => node.remove())
      const text = el.textContent.replace(/\s+/g, ' ').trim()
      if (verse && text) verses.push({ verse, text, heading })
    }
  }
  if (!verses.length) throw new Error('No verses were returned for this chapter.')
  const version = LEGACY_BIBLES.find((v) => v.id === translation)
  return { translation, translationName: version.name, copyright: `${version.name} — ${version.description}`, verses: verses.map((v) => ({ ...v, heading: v.heading ?? null, label: String(v.verse), endVerse: v.verse, paragraph: Math.floor((v.verse - 1) / 5) })) }
}

/**
 * Splits an ESV chunk into its verse text and any heading trailing it.
 *
 * Headings are the only thing the endpoint separates with a blank line, which
 * is what makes this safe: verse text itself is never broken that way, so a
 * segment after a blank line is a heading for whatever verse comes next.
 */
function leadingHeading(chunk) {
  const segments = String(chunk ?? '').split(/\n\s*\n/).map((part) => part.replace(/\s+/g, ' ').trim())
  return segments.filter(Boolean).join(' \u2014 ') || null
}

function splitTrailingHeading(chunk) {
  const segments = String(chunk ?? '').split(/\n\s*\n/).map((part) => part.replace(/\s+/g, ' ').trim())
  const body = segments.shift() ?? ''
  const heading = segments.filter(Boolean).join(' \u2014 ') || null
  return { body, heading }
}
