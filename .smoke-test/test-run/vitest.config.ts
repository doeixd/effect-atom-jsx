import { defineConfig } from "vitest/config";
import babel from "vite-plugin-babel";

export default defineConfig({
  plugins: [
    babel(),
  ],
  test: {
    environment: "jsdom",
  },
});
