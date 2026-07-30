import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
    strictPort: true,
  },
});
