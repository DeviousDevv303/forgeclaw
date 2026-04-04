/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forge: {
          bg: '#0f0f0f',
          surface: '#1a1a1a',
          border: '#2a2a2a',
          accent: '#f97316',
          ember: '#7c3316',
          text: '#e5e5e5',
          muted: '#6b6b6b',
        },
      },
    },
  },
  plugins: [],
}
