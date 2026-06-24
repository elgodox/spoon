/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Trello-inspired + dark modern
        kanban: {
          bg: '#1f1f1f',
          card: '#2c2c2c',
          list: '#262626',
        }
      }
    },
  },
  plugins: [],
}
