import { defineConfig } from "vite";
import { resumeExtract } from "effect-atom-jsx/compiler/resume-extract-vite";
import { BuildId } from "./shared/build.js";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    resumeExtract({
      buildId: BuildId,
      root: import.meta.dirname,
      importPath: (entry) => `/${entry.moduleId}`,
      sourceModules: ["/app/benchmark.ts"],
    }),
  ],
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

