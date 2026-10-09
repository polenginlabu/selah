// Checks that a spoken reading matches the text it was asked to read, by
// comparing the speech transcript with the text word by word. Used on Live API
// audio, which is a conversational model and may add or drop words: only a
// near-exact reading is played or cached. Pure JS so node tests import it.

export const VERBATIM_THRESHOLD = 0.95

/** Lowercase words with punctuation removed; dashes separate words, apostrophes do not. */
export function normalizeWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-‐-―/]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
}

/** Longest common subsequence of two word lists over the longer length: 1 is identical, 0 is nothing shared. */
export function wordSimilarity(a, b) {
  const x = normalizeWords(a)
  const y = normalizeWords(b)
  if (!x.length || !y.length) return 0
  // ponytail: O(n*m) LCS, fine for one ~200-word chunk.
  let prev = new Array(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i += 1) {
    const row = new Array(y.length + 1).fill(0)
    for (let j = 1; j <= y.length; j += 1) {
      row[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1])
    }
    prev = row
  }
  return prev[y.length] / Math.max(x.length, y.length)
}

/** True when the transcript reads the text word for word, within the threshold. */
export function isVerbatim(transcript, text, threshold = VERBATIM_THRESHOLD) {
  return wordSimilarity(transcript, text) >= threshold
}
