import { defineConfig } from "vite";
import { resumeExtract } from "effect-atom-jsx/compiler/resume-extract-vite";
import { BuildId } from "./shared/build.js";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    {
      name: "af-ui-jsx-runtime-probe",
      enforce: "pre",
      async transform(code, id) {
        const [filename] = id.split("?");
        if (filename === undefined || !filename.endsWith(".tsx")) return null;
        const babel = await import("@babel/core");
        const result = await babel.transformAsync(code, {
          filename,
          babelrc: false,
          configFile: false,
          sourceMaps: true,
          presets: [
            [
              "@babel/preset-typescript",
              { allExtensions: true, isTSX: true },
            ],
          ],
          plugins: [
            [
              "babel-plugin-jsx-dom-expressions",
              {
                moduleName: "effect-atom-jsx/runtime",
                generate: "dom",
                hydratable: false,
                delegateEvents: true,
                builtIns: [],
                requireStatic: false,
              },
            ],
          ],
        });
        return result?.code == null
          ? null
          : { code: result.code, map: result.map ?? null };
      },
    },
    resumeExtract({
      buildId: BuildId,
      root: import.meta.dirname,
      // Root-relative specifiers keep the generated dynamic imports valid in
      // both the SSR dev server and the client bundle.
      importPath: (entry) => `/${entry.moduleId}`,
      sourceModules: ["/app/note-button.ts"],
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
  },
});
