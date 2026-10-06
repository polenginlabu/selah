/**
 * The daily devotional's backdrop: the day's photo over a navy gradient.
 *
 * The gradient is always painted, so a missing row, a failed fetch or a broken
 * image all land on the same designed state rather than an empty box. The
 * photo only arrives once useDailyBackground has preloaded it, and fades in
 * over the gradient. Fills its positioned parent; callers add their own scrim
 * because the card and the full-screen reader need different amounts.
 *
 * `fallbackSrc` is an optional bundled image shown (dimmed) when there is no
 * daily photo — the reader uses its offline-safe hero so it never opens on a
 * flat colour without a connection.
 */
export function StoryBackdrop({ background, fallbackSrc = null, className = '' }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 80% 0%, oklch(var(--brand) / 0.28) 0%, transparent 60%), linear-gradient(160deg, oklch(var(--panel)) 0%, oklch(0.32 0.07 262) 100%)',
        }}
      />
      {!background && fallbackSrc && (
        <img src={fallbackSrc} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
      )}
      {background && (
        <img
          key={background.imageUrl}
          src={background.imageUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full animate-fade-in object-cover"
          style={{ animationDuration: '700ms' }}
        />
      )}
    </div>
  )
}
