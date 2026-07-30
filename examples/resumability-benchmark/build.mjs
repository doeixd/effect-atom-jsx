import { gzipSync } from "node:zlib";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { build, createServer } from "vite";

const root = import.meta.dirname;
const pages = [
  { file: "eager-1.html", mode: "eager-rerender", density: 1 },
  { file: "eager-24.html", mode: "eager-rerender", density: 24 },
  {
    file: "eager-runtime-1.html",
    mode: "eager-rerender-shared-runtime",
    density: 1,
  },
  {
    file: "eager-runtime-24.html",
    mode: "eager-rerender-shared-runtime",
    density: 24,
  },
  { file: "resume-1.html", mode: "dormant-resume", density: 1 },
  { file: "resume-24.html", mode: "dormant-resume", density: 24 },
  { file: "attribution-0.html", mode: "attribution", density: 0 },
  { file: "attribution-1.html", mode: "attribution", density: 1 },
  { file: "attribution-24.html", mode: "attribution", density: 24 },
];

const ssr = await createServer({
  root,
  appType: "custom",
  logLevel: "error",
  server: {
    middlewareMode: true,
  },
});

const fixtures = new Map();
try {
  const app = await ssr.ssrLoadModule("/app/benchmark.ts");
  const boundaryOnly = app.renderBoundaryOnlyServer();
  fixtures.set("attribution:0", {
    html: boundaryOnly.html,
    script: boundaryOnly.script,
  });
  for (const density of [1, 24]) {
    const collection = app.renderResumableServer(density);
    fixtures.set(`dormant-resume:${density}`, {
      html: collection.html,
      script: collection.script,
    });
    fixtures.set(`eager-rerender:${density}`, {
      html: app.renderEagerServer(density),
      script: "",
    });
    fixtures.set(`eager-rerender-shared-runtime:${density}`, {
      html: app.renderEagerServer(density),
      script: "",
    });
    fixtures.set(`attribution:${density}`, {
      html: collection.html,
      script: collection.script,
    });
  }
} finally {
  await ssr.close();
}

function payloadFor(fixture) {
  const manifest =
    fixture.script.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const markers = [...fixture.html.matchAll(/<!--af:expr:[\s\S]*?-->/g)]
    .map((match) => match[0])
    .join("");
  const combined = `${manifest}${markers}`;
  const combinedBytes = Buffer.from(combined);
  return {
    manifestUtf8Bytes: Buffer.byteLength(manifest),
    markerUtf8Bytes: Buffer.byteLength(markers),
    combinedRawBytes: combinedBytes.byteLength,
    combinedGzipBytes: combinedBytes.byteLength === 0
      ? 0
      : gzipSync(combinedBytes).byteLength,
  };
}

await build({
  root,
  logLevel: "info",
  plugins: [
    {
      name: "inject-resumability-benchmark-ssr",
      transformIndexHtml(html, context) {
        const filename = path.basename(context.path);
        const page = pages.find((candidate) => candidate.file === filename);
        if (page === undefined) return html;
        const fixture = fixtures.get(`${page.mode}:${page.density}`);
        if (fixture === undefined) {
          throw new Error(`Missing benchmark fixture for ${filename}.`);
        }
        return html
          // Function replacements are required: serialized portable ids may
          // contain `$$`, which String.replace interprets in replacement
          // strings and would silently corrupt.
          .replace("<!--__SSR_HTML__-->", () => fixture.html)
          .replace("<!--__RESUME_MANIFEST__-->", () => fixture.script)
          .replace(
            "/*__PAYLOAD__*/",
            () => JSON.stringify(payloadFor(fixture)),
          );
      },
    },
  ],
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((page) => [
          path.basename(page.file, ".html"),
          path.join(root, page.file),
        ]),
      ),
    },
  },
});

const fixtureMetadata = {};
for (const page of pages) {
  const fixture = fixtures.get(`${page.mode}:${page.density}`);
  const builtHtml = await readFile(path.join(root, "dist", page.file));
  fixtureMetadata[page.file] = {
    mode: page.mode,
    density: page.density,
    ...payloadFor(fixture),
    documentRawBytes: builtHtml.byteLength,
    documentGzipBytes: gzipSync(builtHtml).byteLength,
  };
}
await writeFile(
  path.join(root, "dist", "fixture-metadata.json"),
  `${JSON.stringify(fixtureMetadata, null, 2)}\n`,
);
