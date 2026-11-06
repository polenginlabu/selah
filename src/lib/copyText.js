// Copy text to the clipboard: Clipboard API first, textarea + execCommand fallback.
// Never throws; resolves to true on success, false otherwise.
export async function copyText(
  text,
  env = { navigator: globalThis.navigator, document: globalThis.document },
) {
  if (typeof text !== 'string' || !text.trim()) return false

  try {
    if (env?.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  const doc = env?.document
  if (!doc?.createElement || !doc.body || !doc.execCommand) return false
  let area = null
  try {
    area = doc.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    doc.body.appendChild(area)
    area.select()
    return Boolean(doc.execCommand('copy'))
  } catch {
    return false
  } finally {
    try { area?.remove() } catch { /* ignore */ }
  }
}
