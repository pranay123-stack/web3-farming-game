/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './providers/**/*.{js,ts,jsx,tsx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        soil: {
          950: '#100e0b',
          900: '#17140f',
          850: '#1e1a14',
          800: '#262019',
          700: '#352c22',
          600: '#4a3d2f',
        },
        leaf: {
          500: '#6aa84f',
          400: '#86c06a',
          300: '#a8d68f',
        },
        gold: {
          500: '#d9a441',
          400: '#e8bd68',
        },
        sky: {
          500: '#4a9ede',
        },
        rose: {
          500: '#d9534f',
        },
        text: {
          primary: '#f2ede4',
          secondary: '#b8ae9d',
          muted: '#7d7365',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      boxShadow: {
        glow: '0 0 24px -6px rgba(106, 168, 79, 0.5)',
        'glow-gold': '0 0 24px -6px rgba(217, 164, 65, 0.5)',
      },
    },
  },
  plugins: [],
}
