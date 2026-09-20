import { useEffect, useRef, useState, useCallback } from 'react'
import { BibleReaderSheet } from './BibleReaderSheet'
import { useToast } from '../context/ToastContext'
import { listBackgrounds } from '../data/dailyBackgrounds'
import { DownloadIcon, ShareIcon } from '../icons'
import { CARD_WIDTH, CARD_HEIGHT, MARGIN_X, layoutCard, quoteVerse } from '../lib/verseCardLayout'

// The shareable Scripture card.
//
// AI GENERATES THE BACKGROUND. SELAH GENERATES THE SCRIPTURE CARD.
// Everything below the background — the verse, the reference, the translation,
// the wordmark — is drawn here from the Bible API's own text. No model is ever
// asked for Scripture, so what ships is the same text the reader just selected,
// spelled and punctuated the way the translation publishes it.
//
// The card is drawn ONCE into a 1080x1920 canvas which is then displayed
// CSS-scaled. The preview is therefore not a mock-up of the export — it is the
// export, shown smaller. There is no second code path to drift.

// The card reads as a dark panel in both themes, like the devotional hero and
// the Selah blocks. A light card would need a different scrim, different text
// colours and a different wordmark, i.e. a second design, for no gain.
const NAVY = '#0D1B36'
const BRAND = '#4F6EF7'
const SCRIPTURE_FONT = 'Georgia, "Times New Roman", ui-serif, serif'
const DISPLAY_FONT = '"Plus Jakarta Sans", Inter, ui-sans-serif, system-ui, sans-serif'

/**
 * Loads the background so it can be drawn into a canvas that stays exportable.
 *
 * crossOrigin='anonymous' matters more than it looks. Drawing a cross-origin
 * image without it taints the canvas, and toBlob() then throws a SecurityError
 * at the moment the user taps Share — a failure at the worst possible time.
 * With it, an image served without CORS headers simply fails to LOAD, which
 * this treats as "no background" and falls back to the gradient. The card is
 * always exportable; at worst it is plainer.
 *
 * (Which is why the bucket needs a CORS rule — see README > Firebase Storage.)
 */
function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** The fallback background: SELAH's own palette, drawn rather than fetched. */
function paintGradient(ctx) {
  const base = ctx.createLinearGradient(0, 0, CARD_WIDTH * 0.4, CARD_HEIGHT)
  base.addColorStop(0, '#16264A')
  base.addColorStop(0.55, NAVY)
  base.addColorStop(1, '#0A1226')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  // A single soft light source high in the frame, so the fallback still has
  // the "one quiet light" quality the generated backgrounds are prompted for.
  const glow = ctx.createRadialGradient(
    CARD_WIDTH * 0.72, CARD_HEIGHT * 0.16, 0,
    CARD_WIDTH * 0.72, CARD_HEIGHT * 0.16, CARD_HEIGHT * 0.62
  )
  glow.addColorStop(0, 'rgba(79, 110, 247, 0.42)')
  glow.addColorStop(0.5, 'rgba(79, 110, 247, 0.10)')
  glow.addColorStop(1, 'rgba(79, 110, 247, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
}

/** Covers the frame without distorting, the canvas equivalent of object-fit. */
function paintCover(ctx, img) {
  const scale = Math.max(CARD_WIDTH / img.width, CARD_HEIGHT / img.height)
  const w = img.width * scale
  const h = img.height * scale
  ctx.drawImage(img, (CARD_WIDTH - w) / 2, (CARD_HEIGHT - h) / 2, w, h)
}

/**
 * The contrast scrim.
 *
 * A generated background is unpredictable — one morning it is a dark forest,
 * the next a white sky — and white Scripture has to stay readable on both. So
 * the card never trusts the image: it always lays a vertical darkening
 * gradient over it, weighted to the band where the text sits.
 */
function paintScrim(ctx, layout) {
  const scrim = ctx.createLinearGradient(0, 0, 0, CARD_HEIGHT)
  scrim.addColorStop(0, 'rgba(6, 12, 28, 0.55)')
  scrim.addColorStop(Math.max(0, layout.contentTop / CARD_HEIGHT), 'rgba(6, 12, 28, 0.62)')
  scrim.addColorStop(Math.min(1, layout.contentBottom / CARD_HEIGHT), 'rgba(6, 12, 28, 0.72)')
  scrim.addColorStop(1, 'rgba(6, 12, 28, 0.82)')
  ctx.fillStyle = scrim
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
}

/** The pause mark from Logo.jsx, drawn at canvas scale. */
function paintPauseMark(ctx, x, y, height) {
  const barW = height * 0.25
  const gap = height * 0.2
  const r = barW / 2
  const rounded = (bx, fill) => {
    ctx.fillStyle = fill
    ctx.beginPath()
    // roundRect is missing on iOS Safari before 16.4. Without the guard the
    // whole card throws while drawing the wordmark — the last thing painted —
    // so the user would watch it render and then get nothing.
    if (ctx.roundRect) ctx.roundRect(bx, y - height, barW, height, r)
    else ctx.rect(bx, y - height, barW, height)
    ctx.fill()
  }
  rounded(x, '#FFFFFF')
  rounded(x + barW + gap, BRAND)
  return barW * 2 + gap
}

function drawCard(canvas, { verse, reference, translation }, backgroundImage) {
  const ctx = canvas.getContext('2d')
  const measure = (text, fontSize) => {
    ctx.font = `${fontSize}px ${SCRIPTURE_FONT}`
    return ctx.measureText(text).width
  }

  const quoted = quoteVerse(verse)
  const layout = layoutCard({ verse: quoted, reference, translation }, measure)

  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  if (backgroundImage) paintCover(ctx, backgroundImage)
  else paintGradient(ctx)
  paintScrim(ctx, layout)

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // Scripture.
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `${layout.verse.fontSize}px ${SCRIPTURE_FONT}`
  for (const line of layout.verse.lines) ctx.fillText(line.text, line.x, line.y)

  // A short brand rule between the verse and its reference.
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  ctx.fillRect(MARGIN_X, layout.reference.y - layout.reference.fontSize - 34, 64, 2)

  // Reference.
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `600 ${layout.reference.fontSize}px ${DISPLAY_FONT}`
  ctx.fillText(layout.reference.text, layout.reference.x, layout.reference.y)

  if (layout.translation) {
    ctx.fillStyle = 'rgba(255,255,255,0.68)'
    ctx.font = `500 ${layout.translation.fontSize}px ${DISPLAY_FONT}`
    ctx.fillText(layout.translation.text, layout.translation.x, layout.translation.y)
  }

  // Wordmark.
  const markWidth = paintPauseMark(ctx, layout.brand.x, layout.brand.y, layout.brand.fontSize)
  ctx.font = `800 ${layout.brand.fontSize}px ${DISPLAY_FONT}`
  ctx.fillStyle = '#FFFFFF'
  const wordX = layout.brand.x + markWidth + layout.brand.fontSize * 0.34
  ctx.fillText('selah', wordX, layout.brand.y)
  ctx.fillStyle = BRAND
  ctx.fillText('.', wordX + ctx.measureText('selah').width, layout.brand.y)
}

const canvasToBlob = (canvas) =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))

export function VerseCardSheet({ selection, translation, onClose }) {
  const toast = useToast()
  const canvasRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [backgrounds, setBackgrounds] = useState([])
  const [selectedBackground, setSelectedBackground] = useState(null)
  const [bgResolved, setBgResolved] = useState(false)
  const imageCache = useRef(new Map())

  // An image picked once is reused for later redraws, so switching between
  // tiles is instant instead of re-fetching it over the network each time.
  const getCachedImage = useCallback(async (background) => {
    if (!background) return null
    if (imageCache.current.has(background.id)) return imageCache.current.get(background.id)
    const img = await loadImage(background.imageUrl)
    imageCache.current.set(background.id, img)
    return img
  }, [])

  // Load every generated background once. The newest is pre-selected so the
  // card starts the way it did before; the user can then switch to any other
  // image. A failed fetch keeps today's behaviour: the gradient.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const list = await listBackgrounds({ limit: 100 }).catch(() => [])
      if (cancelled) return
      setBackgrounds(list)
      setSelectedBackground((current) => current ?? list[0] ?? null)
      setBgResolved(true)
    })()

    return () => { cancelled = true }
  }, [])

  // Redraw whenever the verse, the translation or the chosen background
  // changes. Drawing waits for bgResolved so the card never flashes the
  // gradient before the selection is known.
  useEffect(() => {
    if (!bgResolved) return
    let cancelled = false

    ;(async () => {
      // Fonts first. Canvas silently substitutes a default face for one that
      // has not finished loading, and the card would ship in Times.
      await document.fonts?.ready?.catch?.(() => {})

      const image = await getCachedImage(selectedBackground)
      if (cancelled || !canvasRef.current) return

      drawCard(canvasRef.current, {
        verse: selection.text,
        reference: selection.reference,
        translation,
      }, image)
      setReady(true)
    })()

    return () => { cancelled = true }
  }, [bgResolved, selection, translation, selectedBackground, getCachedImage])

  const withCardFile = useCallback(async (use) => {
    const canvas = canvasRef.current
    if (!canvas) return
    setBusy(true)
    try {
      const blob = await canvasToBlob(canvas)
      if (!blob) throw new Error('The card could not be rendered.')
      const name = `selah-${selection.reference.replace(/[^\w]+/g, '-').toLowerCase()}.png`
      await use(new File([blob], name, { type: 'image/png' }), blob, name)
    } catch (err) {
      if (err.name !== 'AbortError') toast.error('Could not create the image. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [selection, toast])

  const shareImage = () => withCardFile(async (file, blob, name) => {
    // canShare({files}) is the only reliable test: navigator.share exists on
    // desktop Chrome and on iOS, but file sharing does not, and a share that
    // silently drops the image is worse than an honest download.
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: selection.reference })
    } else {
      download(blob, name)
      toast.success('Card saved. Sharing images isn’t supported in this browser.')
    }
  })

  const saveImage = () => withCardFile(async (file, blob, name) => {
    download(blob, name)
    toast.success('Card saved to your downloads.')
  })

  const shareText = async () => {
    const text = `${selection.text}\n\n${selection.reference} (${translation})`
    try {
      if (navigator.share) await navigator.share({ title: selection.reference, text })
      else { await navigator.clipboard.writeText(text); toast.success('Verse copied.') }
    } catch (err) { if (err.name !== 'AbortError') toast.error('Could not share. Please try again.') }
  }

  return (
    <BibleReaderSheet title="Verse card" onClose={onClose}>
      <div className="space-y-5">
        <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl border border-line shadow-lift">
          {/* Fixed 9:16 box so the sheet does not jump as the canvas paints. */}
          <canvas
            ref={canvasRef}
            width={CARD_WIDTH}
            height={CARD_HEIGHT}
            aria-label={`Verse card for ${selection.reference}`}
            className={`block h-auto w-full transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`}
            style={{ aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}` }}
          />
        </div>

        {bgResolved && backgrounds.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-muted">Background</p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <button
                onClick={() => setSelectedBackground(null)}
                aria-pressed={selectedBackground === null}
                aria-label="Plain background"
                className={`flex h-16 w-12 shrink-0 items-center justify-center rounded-lg border-2 ${selectedBackground === null ? 'border-brand' : 'border-line'}`}
                style={{ background: 'linear-gradient(180deg,#16264A,#0A1226)' }}
              >
                <span className="text-[8px] font-bold uppercase tracking-wider text-white/70">Plain</span>
              </button>
              {backgrounds.map((bg) => {
                const active = selectedBackground?.id === bg.id
                return (
                  <button
                    key={bg.id}
                    onClick={() => setSelectedBackground(bg)}
                    aria-pressed={active}
                    aria-label={bg.theme ? `Background: ${bg.theme}` : 'Background'}
                    className={`h-16 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${active ? 'border-brand' : 'border-line'}`}
                  >
                    <img src={bg.imageUrl} alt={bg.theme ?? ''} loading="lazy" draggable={false} className="block h-full w-full object-cover" />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={shareImage} disabled={!ready || busy} className="btn-primary min-h-12 disabled:opacity-40">
            <ShareIcon width={16} height={16} /> Share
          </button>
          <button onClick={saveImage} disabled={!ready || busy} className="btn-outline min-h-12 disabled:opacity-40">
            <DownloadIcon width={16} height={16} /> Save
          </button>
        </div>
        <button onClick={shareText} className="btn-ghost min-h-11 w-full text-sm">Share as text instead</button>
      </div>
    </BibleReaderSheet>
  )
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoking immediately can cancel the download in Safari; one frame is enough.
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}
