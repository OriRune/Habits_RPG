/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Themeable tokens resolve through CSS variables (channel form) so color
        // palettes can be swapped at runtime — see src/engine/palettes.ts and the
        // :root defaults in src/index.css. The `<alpha-value>` placeholder keeps
        // opacity modifiers like `bg-gold/40` working.
        // Aged parchment — panel fills (light surfaces)
        parchment: {
          DEFAULT: 'rgb(var(--c-parchment) / <alpha-value>)',
          100: 'rgb(var(--c-parchment-100) / <alpha-value>)',
          200: 'rgb(var(--c-parchment-200) / <alpha-value>)',
          300: 'rgb(var(--c-parchment-300) / <alpha-value>)',
          400: 'rgb(var(--c-parchment-400) / <alpha-value>)',
        },
        // Ink — text on parchment
        ink: {
          DEFAULT: 'rgb(var(--c-ink) / <alpha-value>)',
          muted: 'rgb(var(--c-ink-muted) / <alpha-value>)',
          light: 'rgb(var(--c-ink-light) / <alpha-value>)',
        },
        // Dark wood — app background / dark panels
        wood: {
          DEFAULT: 'rgb(var(--c-wood) / <alpha-value>)',
          900: 'rgb(var(--c-wood-900) / <alpha-value>)',
          800: 'rgb(var(--c-wood-800) / <alpha-value>)',
          700: 'rgb(var(--c-wood-700) / <alpha-value>)',
          600: 'rgb(var(--c-wood-600) / <alpha-value>)',
          500: 'rgb(var(--c-wood-500) / <alpha-value>)',
        },
        // Aged gold — trim & accents
        gold: {
          DEFAULT: 'rgb(var(--c-gold) / <alpha-value>)',
          bright: 'rgb(var(--c-gold-bright) / <alpha-value>)',
          deep: 'rgb(var(--c-gold-deep) / <alpha-value>)',
          dim: 'rgb(var(--c-gold-dim) / <alpha-value>)',
        },
        // Ember — primary actions / alerts
        ember: {
          DEFAULT: 'rgb(var(--c-ember) / <alpha-value>)',
          bright: 'rgb(var(--c-ember-bright) / <alpha-value>)',
        },
        // Jewel tones — decorative, intentionally NOT themed (fixed identity).
        jewel: {
          green: '#3f6b4a',
          blue: '#35506b',
          purple: '#5b3f6b',
        },
        // Stat accent colors (reused as bar fills + crest tints)
        stat: {
          DX: '#b8860b',
          AG: '#2a8a9e',
          ST: '#b23b2e',
          EN: '#5e8a2e',
          WI: '#6a4fb0',
          CH: '#b8487f',
          KN: '#2f5fa6',
          HP: '#2e8a5e',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'Georgia', 'serif'],
        serif: ['"EB Garamond"', 'Georgia', 'serif'],
      },
      boxShadow: {
        // Double gold frame + drop shadow for panels/frames (gold trim follows the palette)
        gold: '0 0 0 2px rgb(var(--c-gold-deep)), 0 0 0 4px rgb(var(--c-gold)), 0 6px 16px rgba(0,0,0,0.55)',
        'gold-sm': '0 0 0 1px rgb(var(--c-gold-deep)), 0 0 0 2px rgb(var(--c-gold))',
        // Soft emboss for parchment surfaces
        parchment: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -3px 8px rgba(120,86,40,0.18)',
        // Carved wood
        wood: 'inset 0 1px 0 rgba(255,200,120,0.08), 0 4px 14px rgba(0,0,0,0.6)',
        glow: '0 0 12px rgb(var(--c-gold-bright) / 0.55)',
      },
    },
  },
  plugins: [],
};
