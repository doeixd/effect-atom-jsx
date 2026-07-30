import path from "node:path";
import { build, createServer } from "vite";

const root = import.meta.dirname;
const ssr = await createServer({
  root,
  appType: "custom",
  logLevel: "error",
  server: {
    middlewareMode: true,
  },
});

let collection;
try {
  const serverModule = await ssr.ssrLoadModule("/server/save-button.ts");
  collection = serverModule.renderSaveButton();
} finally {
  await ssr.close();
}

await build({
  root,
  logLevel: "info",
  plugins: [
    {
      name: "inject-resume-ssr",
      transformIndexHtml(html) {
        return html
          .replace("<!--__SSR_HTML__-->", collection.html)
          .replace("<!--__RESUME_MANIFEST__-->", collection.script);
      },
    },
  ],
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    manifest: true,
  },
});
