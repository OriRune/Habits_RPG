/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Stat color accents, reused across stat bars / badges
        stat: {
          DX: '#f59e0b', // dexterity - amber
          AG: '#22d3ee', // agility - cyan
          ST: '#ef4444', // strength - red
          EN: '#84cc16', // endurance - lime
          WI: '#a78bfa', // wisdom - violet
          CH: '#ec4899', // charisma - pink
          KN: '#3b82f6', // knowledge - blue
          HP: '#10b981', // hit points - emerald
        },
      },
    },
  },
  plugins: [],
};
