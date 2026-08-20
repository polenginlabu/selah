import { todayISO } from '../lib/date'

const VOTD_REFERENCES = [
  'Lamentations 3:22-23', 'Psalm 143:8', 'John 15:4-5', 'Isaiah 40:31', 'Matthew 11:28-29',
  'Psalm 46:10', 'Philippians 4:6-7', 'Zephaniah 3:17', 'Psalm 118:24', 'Proverbs 3:5-6',
  'John 3:16', 'Romans 8:28', 'Joshua 1:9', 'Psalm 23:1-3', '2 Corinthians 5:17',
  'Jeremiah 29:11-13', 'Psalm 121:1-2', 'Isaiah 41:10', 'Matthew 6:33-34', 'Colossians 3:1-2',
  'Psalm 37:4-5', 'John 14:27', '1 Peter 5:6-7', 'Hebrews 12:1-2', 'Psalm 27:1',
  'Micah 6:8', 'Galatians 2:20', 'Psalm 139:23-24', 'Romans 5:8', 'Galatians 5:22-23',
  'Philippians 4:13', 'Psalm 34:8', 'Isaiah 26:3', 'Matthew 5:14-16', 'John 10:10',
  'Romans 15:13', '2 Timothy 1:7', 'Psalm 19:14', 'Proverbs 16:3', 'James 1:5',
  '1 John 4:18-19', 'Psalm 90:14', 'Hosea 6:3', 'Matthew 7:7-8', 'Deuteronomy 31:8',
  'Ephesians 3:16-19', 'John 8:12', 'Psalm 62:1-2', 'Isaiah 43:18-19', 'Romans 8:38-39',
  '1 Thessalonians 5:16-18', 'Psalm 100:4-5', 'Proverbs 18:10', 'John 16:33', 'Psalm 30:5',
  'Titus 3:4-5', 'Ephesians 2:8-10', 'Psalm 63:1', 'Colossians 3:23-24', 'Revelation 21:5',
]

const CACHE_PREFIX = 'votd:'

function pruneOldCache(dateISO) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (key != null && key.startsWith(CACHE_PREFIX) && key !== CACHE_PREFIX + dateISO) {
      localStorage.removeItem(key)
    }
  }
}

export async function getVerseOfTheDay() {
  const date = todayISO()
  const cacheKey = CACHE_PREFIX + date
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached)
  } catch {}

  const dayIndex = Math.floor(new Date(date + 'T00:00:00').getTime() / 86_400_000)
  const reference = VOTD_REFERENCES[dayIndex % VOTD_REFERENCES.length]

  try {
    const response = await fetch(
      `https://bible-api.com/${encodeURIComponent(reference)}?translation=web`
    )
    if (!response.ok) return null
    const json = await response.json()
    const text = (json.verses ?? [])
      .map((v) => (v.text ?? '').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
    if (!text) return null

    const verse = {
      reference,
      text,
      translation: json.translation_name ?? 'World English Bible',
    }
    try {
      pruneOldCache(date)
      localStorage.setItem(cacheKey, JSON.stringify(verse))
    } catch {}
    return verse
  } catch {
    return null
  }
}
