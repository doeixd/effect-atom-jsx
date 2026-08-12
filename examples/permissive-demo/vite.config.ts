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
    // M10 item 5: glob discovery — every module under app/ with extract
    // markers is force-loaded, no hand-maintained list. The Chromium suite
    // proves the discovered entry resolves at first click.
    sourceModules: ["/app/**/*.ts"],
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
    // M9 item 5: the resumable page runs under an ENFORCED CSP with no
    // unsafe-inline and no nonce — the manifest is inert application/json,
    // handlers attach from module code, and nothing needs eval. The
    // Playwright spec proves both halves: the page resumes, and an injected
    // inline script is actually blocked (so the header is really enforced).
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'",
    },
  },
});
