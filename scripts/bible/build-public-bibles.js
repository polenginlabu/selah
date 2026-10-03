#!/usr/bin/env node
/**
 * Builds the bundled public-domain Bibles in src/data/publicBibles/ from
 * eBible.org's verse-per-line (VPL) downloads.
 *
 *   node scripts/bible/build-public-bibles.js              download, then build
 *   node scripts/bible/build-public-bibles.js --from DIR   use DIR/<source>_vpl.zip
 *
 * Run by hand when a source edition changes; it is deliberately not part of
 * `npm run build`. Output is one JSON file per book: an array of chapters,
 * each an array of verse strings, where verse number = index + 1. Update the
 * retrieval date in src/data/publicBibles/README.md when re-running.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { BOOK_IDS } from '../../supabase/functions/_shared/bible.js'
import { BIBLE_BOOKS } from '../../src/data/books.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'src/data/publicBibles')

// Only translations whose eBible.org copyright page states public domain.
// The verbatim statements are quoted in src/data/publicBibles/README.md.
export const SOURCES = [
  { id: 'web', source: 'eng-web' },
  { id: 'kjv', source: 'eng-kjv' },
  { id: 'bbe', source: 'engBBE' },
]

// eBible's VPL files use older book codes where USFM's differ.
const VPL_CODES = {
  SOL: 'SNG', EZE: 'EZK', JOE: 'JOL', NAH: 'NAM', MAR: 'MRK', JOH: 'JHN',
  PHI: 'PHP', JAM: 'JAS', '1JO': '1JN', '2JO': '2JN', '3JO': '3JN',
}

const zipUrl =(source) => `https://ebible.org/Scriptures/${source}_vpl.zip`

/** Minimal reader for the zip's central directory; returns { name: Buffer }. */
function unzip(buffer) {
  let eocd = buffer.length - 22
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('Not a zip file')
  const count = buffer.readUInt16LE(eocd + 10)
  let at = buffer.readUInt32LE(eocd + 16)
  const files = {}
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Corrupt zip directory')
    const method = buffer.readUInt16LE(at + 10)
    const size = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const local = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength)
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const data = buffer.subarray(start, start + size)
    if (method === 0) files[name] = data
    else if (method === 8) files[name] = zlib.inflateRawSync(data)
    else throw new Error(`Unsupported zip compression ${method} for ${name}`)
    at += 46 + nameLength + extraLength + commentLength
  }
  return files
}

/** VPL line: "JHN 3:16 For God so loved the world, ..." */
export function parseVpl(text) {
  const books = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([0-9A-Z]{3}) (\d+):(\d+) (.*)$/)
    if (!match) continue
    const [, code, chapter, verse, raw] = match
    const bookId = VPL_CODES[code] ?? code
    if (!BOOK_IDS.includes(bookId)) continue // Apocrypha / deuterocanon
    const chapters = books.get(bookId) ?? []
    const verses = (chapters[Number(chapter) - 1] ??= [])
    // KJV marks paragraphs with ¶ and the translators' supplied words with
    // [brackets] (italics in print). The reader shows plain verse text.
    verses[Number(verse) - 1] = raw.replace(/[¶[\]]/g, '').replace(/\s+/g, ' ').trim()
    books.set(bookId, chapters)
  }
  return books
}

// Verses a translation leaves out of its main text (textual variants it
// relegates to footnotes). They are stored as null so verse number = index + 1
// still holds, and the reader skips them. Any other gap fails the build.
export const KNOWN_OMISSIONS = {
  web: ['LUK 17:36', 'ACT 8:37', 'ACT 15:34', 'ACT 24:7', 'ROM 16:25'],
  kjv: [],
  // BBE keeps these verse numbers with no text, only an empty bracket marker.
  bbe: [
    'MAT 17:21', 'MAT 18:11', 'MAT 23:14', 'MRK 7:16', 'MRK 9:44', 'MRK 9:46', 'MRK 11:26', 'MRK 15:28',
    'LUK 17:36', 'LUK 23:17', 'JHN 5:4', 'ACT 8:37', 'ACT 15:34', 'ACT 24:7', 'ACT 28:29', 'ROM 16:24',
  ],
}

/** Throws with every problem found, so a bad source never ships. */
export function verify(id, books) {
  const problems = []
  const omitted = new Set(KNOWN_OMISSIONS[id])
  BOOK_IDS.forEach((bookId, index) => {
    const chapters = books.get(bookId)
    if (!chapters) return problems.push(`${id} ${bookId}: missing book`)
    if (chapters.length !== BIBLE_BOOKS[index].chapters) {
      problems.push(`${id} ${bookId}: ${chapters.length} chapters, expected ${BIBLE_BOOKS[index].chapters}`)
    }
    for (let c = 0; c < chapters.length; c++) {
      const verses = chapters[c]
      if (!verses?.length) { problems.push(`${id} ${bookId} ${c + 1}: no verses`); continue }
      for (let v = 0; v < verses.length; v++) {
        const ref = `${bookId} ${c + 1}:${v + 1}`
        if (verses[v] && omitted.has(ref)) problems.push(`${id} ${ref}: listed as omitted but present`)
        else if (!verses[v] && omitted.has(ref)) verses[v] = null
        else if (!verses[v]) problems.push(`${id} ${ref}: empty or missing`)
      }
    }
  })
  if (problems.length) throw new Error(`${problems.length} problem(s):\n${problems.slice(0, 50).join('\n')}`)
}

async function readZip(source, from) {
  if (from) return fs.readFileSync(path.join(from, `${source}_vpl.zip`))
  const response = await fetch(zipUrl(source))
  if (!response.ok) throw new Error(`${zipUrl(source)}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function main() {
  const fromIndex = process.argv.indexOf('--from')
  const from = fromIndex > 0 ? process.argv[fromIndex + 1] : null
  for (const { id, source } of SOURCES) {
    const files = unzip(await readZip(source, from))
    const txt = Object.keys(files).find((name) => name.endsWith('_vpl.txt'))
    if (!txt) throw new Error(`${source}: no _vpl.txt in zip`)
    const books = parseVpl(files[txt].toString('utf8').replace(/^﻿/, ''))
    verify(id, books)
    fs.mkdirSync(path.join(OUT, id), { recursive: true })
    let verseCount = 0
    for (const bookId of BOOK_IDS) {
      const chapters = books.get(bookId)
      verseCount += chapters.reduce((sum, verses) => sum + verses.filter(Boolean).length, 0)
      fs.writeFileSync(path.join(OUT, id, `${bookId}.json`), JSON.stringify(chapters))
    }
    console.log(`${id}: ${verseCount} verses from ${zipUrl(source)} (retrieved ${new Date().toISOString().slice(0, 10)})`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
