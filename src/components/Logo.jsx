// Selah brand marks, per the Figma brand guidelines.
// The "pause mark" — two rounded bars, one navy/foreground, one electric blue —
// is the core symbol: a visual pause, which is what "selah" means.

export function PauseMark({ size = 24, color = 'currentColor', accent = '#4F6EF7', ...props }) {
  const barW = size * 0.11
  const barH = size * 0.44
  const gap = size * 0.09
  const c = size / 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x={c - gap / 2 - barW} y={c - barH / 2} width={barW} height={barH} rx={barW / 2} fill={color} />
      <rect x={c + gap / 2} y={c - barH / 2} width={barW} height={barH} rx={barW / 2} fill={accent} />
    </svg>
  )
}

/**
 * Full lockup: pause mark + "selah." wordmark.
 * Colours come from the theme tokens so it inverts automatically in dark mode.
 */
export function Logo({ size = 24, className = '', ...props }) {
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: size * 0.32 }} {...props}>
      <PauseMark size={size} color="oklch(var(--ink))" accent="oklch(var(--brand))" />
      {/* 0.65 keeps the mark-to-wordmark proportion of the Figma lockup. */}
      <span
        className="font-display font-extrabold leading-none tracking-[-0.03em] text-ink"
        style={{ fontSize: size * 0.65 }}
      >
        selah<span className="text-brand">.</span>
      </span>
    </span>
  )
}
