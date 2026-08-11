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
let streaming;
try {
  const serverModule = await ssr.ssrLoadModule("/server/save-button.ts");
  collection = serverModule.renderSaveButton();
  const streamingModule = await ssr.ssrLoadModule("/server/streaming-page.ts");
  streaming = await streamingModule.renderStreamingPage();
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
          .replace("<!--__RESUME_MANIFEST__-->", collection.script)
          .replace("<!--__STREAMED_HTML__-->", () => streaming.streamedHtml)
          .replace("<!--__HOST_HTML__-->", () => streaming.hostHtml)
          .replace("<!--__HOST_MANIFEST__-->", () => streaming.hostManifestScript)
          .replace("<!--__FRAGMENT_JSON__-->", () => streaming.fragmentJson);
      },
    },
  ],
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: {
        main: path.join(root, "index.html"),
        streaming: path.join(root, "streaming.html"),
      },
    },
  },
});
