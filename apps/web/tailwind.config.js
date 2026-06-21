/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Dark terminal aesthetic — matches existing Stock Page design
        bg: { DEFAULT: "#0a0e14", panel: "#11161f" },
        up: "#22c55e",
        down: "#ef4444",
        // Admin panel additions
        warn: "#eab308",
        border: "#1f2733",
        muted: "#6b7785",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
