/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 25, 23, 0.04), 0 8px 24px -18px rgba(16, 25, 23, 0.35)',
        lift: '0 2px 6px rgba(16, 25, 23, 0.06), 0 18px 40px -24px rgba(16, 25, 23, 0.4)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        rise: 'rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both',
        fade: 'fade 260ms ease both',
        pulseSoft: 'pulseSoft 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
