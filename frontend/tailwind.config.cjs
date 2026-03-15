/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0c1029',
          deep: '#06091a',
        },
      },
      boxShadow: {
        'glow-sm': '0 0 20px -5px rgba(139, 92, 246, 0.3)',
        'glow-md': '0 0 40px -10px rgba(139, 92, 246, 0.4)',
        'glow-lg': '0 0 60px -15px rgba(139, 92, 246, 0.5)',
      },
    },
  },
  plugins: [],
};
