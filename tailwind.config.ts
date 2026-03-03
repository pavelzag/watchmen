import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    // Override default border-radius to 0 everywhere
    borderRadius: {
      none: "0",
      sm: "0",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      "3xl": "0",
      full: "0",
    },
    extend: {
      colors: {
        terminal: {
          green: "#00ff41",
          dim: "#00aa2b",
          red: "#ff3333",
          amber: "#ffaa00",
          bg: "#090909",
          card: "#0d0d0d",
          border: "#005c16",
        },
      },
      fontFamily: {
        sans: ["JetBrains Mono", "Fira Code", "monospace"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        shimmer: "shimmer 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
