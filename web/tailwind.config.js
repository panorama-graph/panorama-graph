/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // O reset fica com o CssBaseline do MUI.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
