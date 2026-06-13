/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Aged parchment — panel fills (light surfaces)
        parchment: {
          DEFAULT: '#f3e7c9',
          100: '#f8f0db',
          200: '#f3e7c9',
          300: '#e9d9b2',
          400: '#dcc79a',
        },
        // Ink — text on parchment
        ink: {
          DEFAULT: '#3a2a16',
          muted: '#6b5538',
          light: '#8a7350',
        },
        // Dark wood — app background / dark panels
        wood: {
          DEFAULT: '#241710',
          900: '#140c06',
          800: '#1a0f09',
          700: '#241710',
          600: '#33210f',
          500: '#4a3320',
        },
        // Aged gold — trim & accents
        gold: {
          DEFAULT: '#c9a227',
          bright: '#e8c860',
          deep: '#8a6d1f',
          dim: '#6b541a',
        },
        // Ember — primary actions / alerts
        ember: {
          DEFAULT: '#9c3a25',
          bright: '#c25a3a',
        },
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
        // Double gold frame + drop shadow for panels/frames
        gold: '0 0 0 2px #8a6d1f, 0 0 0 4px #c9a227, 0 6px 16px rgba(0,0,0,0.55)',
        'gold-sm': '0 0 0 1px #8a6d1f, 0 0 0 2px #c9a227',
        // Soft emboss for parchment surfaces
        parchment: 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -3px 8px rgba(120,86,40,0.18)',
        // Carved wood
        wood: 'inset 0 1px 0 rgba(255,200,120,0.08), 0 4px 14px rgba(0,0,0,0.6)',
        glow: '0 0 12px rgba(232,200,96,0.55)',
      },
    },
  },
  plugins: [],
};
