/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      zIndex: {
        dropdown: '20',
        sticky: '30',
        toast: '60',
      },
      boxShadow: {
        soft: '0 1px 2px oklch(var(--ink) / 0.04), 0 4px 16px -6px oklch(var(--ink) / 0.1)',
        lift: '0 2px 4px oklch(var(--ink) / 0.05), 0 12px 28px -10px oklch(var(--ink) / 0.18)',
        glow: '0 6px 20px -6px oklch(var(--brand) / 0.45)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
      colors: {
        canvas: 'oklch(var(--canvas) / <alpha-value>)',
        surface: 'oklch(var(--surface) / <alpha-value>)',
        raised: 'oklch(var(--raised) / <alpha-value>)',
        line: 'oklch(var(--line) / <alpha-value>)',
        ink: 'oklch(var(--ink) / <alpha-value>)',
        muted: 'oklch(var(--muted) / <alpha-value>)',
        brand: 'oklch(var(--brand) / <alpha-value>)',
        'brand-strong': 'oklch(var(--brand-strong) / <alpha-value>)',
        'brand-wash': 'oklch(var(--brand-wash) / <alpha-value>)',
        accent: 'oklch(var(--accent) / <alpha-value>)',
        'accent-wash': 'oklch(var(--accent-wash) / <alpha-value>)',
        'accent-ink': 'oklch(var(--accent-ink) / <alpha-value>)',
        'on-brand': 'oklch(var(--on-brand) / <alpha-value>)',
        'on-accent': 'oklch(var(--on-accent) / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
