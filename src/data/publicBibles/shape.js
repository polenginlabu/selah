// Pure (no Vite or Supabase imports) so scripts/bible/publicBibles.test.js can
// run it under plain node.

export const NO_VERSES = 'No verses were returned for this chapter.'

/**
 * One bundled book (array of chapters, each an array of verse strings where
 * verse number = index + 1) to the reader's chapter shape. A null entry is a
 * verse the translation omits from its main text, so it is skipped.
 */
export function toChapterResult({ id, name }, bookChapters, chapter) {
  const verses = Array.isArray(bookChapters) ? bookChapters[chapter - 1] : null
  if (!Array.isArray(verses) || !verses.some(Boolean)) throw new Error(NO_VERSES)
  return {
    translation: id, translationName: name, abbreviation: id.toUpperCase(),
    // Bundled public-domain text is bare verse text — these translations have
    // no section headings to show. heading: null keeps one shape for the reader.
    verses: verses.flatMap((text, i) => (text
      ? [{ verse: i + 1, endVerse: i + 1, label: String(i + 1), text, heading: null, paragraph: Math.floor(i / 5) }]
      : [])),
  }
}
