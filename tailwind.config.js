/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ezequielito brand tokens
        bg: "var(--color-ez-bg)",
        surface: "var(--color-ez-surface)",
        accent: "var(--color-ez-accent)",
        warm: "var(--color-ez-warm)",
        blue: "var(--color-ez-blue)",
        "ez-text": "var(--color-ez-text)",
        "ez-text-muted": "var(--color-ez-text-muted)",
        "ez-border": "var(--color-ez-border)",
        "ez-border-hover": "var(--color-ez-border-hover)",

        // Legacy aliases used throughout the existing Handy codebase
        text: "var(--color-text)",
        background: "var(--color-background)",
        "logo-primary": "var(--color-logo-primary)",
        "logo-stroke": "var(--color-logo-stroke)",
        "text-stroke": "var(--color-text-stroke)",
      },
      fontFamily: {
        serif: ['"Instrument Serif"', "Georgia", "serif"],
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
