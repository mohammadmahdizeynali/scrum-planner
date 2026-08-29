/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Vazirmatn", "Tahoma", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        surface: {
          light: "#f8fafc",
          dark: "#0f172a",
        },
      },
    },
  },
  plugins: [],
};
