import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          400: "#7dd3fc",
          500: "#38bdf8",
          600: "#0ea5e9"
        }
      }
    }
  },
  plugins: [require("@tailwindcss/forms")]
};

export default config;
