import { defineConfig } from "vite";
import { permissive } from "@affe/permissive";
import { BuildId } from "./shared/build.js";

// The preset supplies the compiler plugins; this config only adds app wiring.
const preset = permissive({
  buildId: BuildId,
  vite: {
    root: import.meta.dirname,
    // Root-relative specifiers keep the generated dynamic imports valid in
    // both the SSR dev server and the client bundle.
    importPath: (entry) => `/${entry.moduleId}`,
    sourceModules: ["/app/pin-board.ts"],
  },
});

export default defineConfig({
  root: import.meta.dirname,
  plugins: [...preset.vitePlugins],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4179,
    strictPort: true,
  },
});
