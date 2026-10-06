// Pure helpers for the story-style daily devotional reader (DailyDevotion.jsx).
//
// DOM-free so the section layout and keyboard rules can be tested under
// `node --test` without a browser.

/**
 * Roughly one phone screen of body text at the reader's type size. "The
 * thought" runs 500-800 words, so it is paged rather than left as one section
 * the reader has to scroll through inside a story built from full screens.
 */
export const THOUGHT_PAGE_WORDS = 110

/**
 * The agent writes multi-paragraph prose. Rendering that into a single <p>
 * collapses every blank line into an unreadable wall, so split on blank lines
 * and keep the shape the agent wrote.
 */
export function splitProse(text) {
  if (!text) return []
  return String(text)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function wordCount(text) {
  return String(text).split(/\s+/).filter(Boolean).length
}

/**
 * Groups paragraphs into pages of at most `maxWords`. A paragraph is never
 * split, so one longer than the limit gets a page to itself (and that section
 * simply grows taller than the screen).
 */
export function paginateParagraphs(paragraphs, maxWords = THOUGHT_PAGE_WORDS) {
  const pages = []
  let page = []
  let words = 0
  for (const para of paragraphs ?? []) {
    const count = wordCount(para)
    if (page.length > 0 && words + count > maxWords) {
      pages.push(page)
      page = []
      words = 0
    }
    page.push(para)
    words += count
  }
  if (page.length > 0) pages.push(page)
  return pages
}

/**
 * The ordered list of full-screen sections for a devotion. Sections with no
 * content are left out; the opening scripture and the closing Selah/complete
 * screen are always present.
 *
 * Each entry: { id, kind, label, paragraphs?, page?, pages?, note? }. `label`
 * names the section for the progress rail's screen-reader labels; `note` marks
 * the section that carries the research note.
 */
export function buildStorySections(devotion, { maxWords = THOUGHT_PAGE_WORDS } = {}) {
  if (!devotion) return []

  const sections = [{ id: 'scripture', kind: 'scripture', label: 'Scripture' }]

  const pages = paginateParagraphs(splitProse(devotion.thought), maxWords)
  pages.forEach((paragraphs, i) => {
    sections.push({
      id: `thought-${i + 1}`,
      kind: 'thought',
      label: pages.length > 1 ? `The Thought (${i + 1} of ${pages.length})` : 'The Thought',
      paragraphs,
      page: i + 1,
      pages: pages.length,
    })
  })

  const teaches = splitProse(devotion.teaches)
  if (teaches.length > 0) {
    sections.push({ id: 'teaches', kind: 'teaches', label: 'What Scripture teaches', paragraphs: teaches })
  }

  // Not filtered: the reader's ticks are stored by index into this array.
  if (Array.isArray(devotion.questions) && devotion.questions.length > 0) {
    sections.push({ id: 'reflect', kind: 'reflect', label: 'Pause & Reflect' })
  }

  const application = splitProse(devotion.application)
  if (application.length > 0) {
    sections.push({ id: 'apply', kind: 'apply', label: "Today's Application", paragraphs: application })
  }

  const prayer = splitProse(devotion.prayer)
  if (prayer.length > 0) {
    sections.push({ id: 'pray', kind: 'pray', label: 'Pray', paragraphs: prayer })
  }

  const selah = splitProse(devotion.selah)
  sections.push({ id: 'selah', kind: 'selah', label: selah.length > 0 ? 'Selah' : 'Finish', paragraphs: selah })

  // The research note sits with the teaching it qualifies, as it did when the
  // page was one long scroll.
  if (devotion.researchNote) {
    const host =
      sections.find((s) => s.kind === 'teaches') ??
      [...sections].reverse().find((s) => s.kind === 'thought') ??
      sections[0]
    host.note = true
  }

  return sections
}

/**
 * The section a navigation key should move to, or null for keys the reader
 * does not handle (so the browser keeps its default). Clamped at both ends.
 */
export function nextSectionIndex(key, current, count) {
  if (!(count > 0)) return null
  const last = count - 1
  const from = Math.min(Math.max(0, current), last)
  switch (key) {
    case 'ArrowDown':
    case 'PageDown':
      return Math.min(last, from + 1)
    case 'ArrowUp':
    case 'PageUp':
      return Math.max(0, from - 1)
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}
