const PHOTO_PROVIDERS = { pixabay: 'Pixabay', openverse: 'Openverse' }

/** "Photo: Jane Doe · Pixabay" — matches creditLine() in scripts/selah/stockBackground.js.
 *  Empty for a background without attribution (generated or uploaded art). */
export function photoCredit(attribution) {
  if (!attribution) return ''
  const provider = PHOTO_PROVIDERS[attribution.provider] ?? attribution.provider
  return `Photo: ${attribution.creator || 'Unknown'} · ${provider}`
}

/** The credit's source link, only when it is https — the URL comes from a
 *  third-party API and must not become a javascript: or plain-http link. */
export function photoCreditHref(attribution) {
  const url = attribution?.sourceUrl ?? ''
  return /^https:\/\//.test(url) ? url : null
}
