/**
 * Milestone 8d item 6 — the real-rows measurement (report-only, not gated).
 *
 * The 2026-08-11 marker measurement priced the per-row marker COMMENTS at
 * 35 B retained heap per row; the per-row `Scope` cancelled out of that
 * paired delta because both identity options needed it. This lane measures a
 * real structural region — one authored `structuralExpressionCode` list whose
 * rows each own a marker pair, a map entry, a text node, and (after the first
 * patch) a live child `Scope` — at densities 1 and 24, in the same
 * jitless-forced-gc configuration the gated lane uses.
 *
 * Two heap points per page:
 *  - `ready`: installed, dormant. Rows exist as DOM only; no Scopes yet.
 *  - `afterPatch`: one shared write has run, so the region recovered its rows
 *    and every row's Scope is open. This is the number the plan asks for —
 *    the linear per-row cost of a LIVE structural row.
 *
 * The paired `resume-{1,24}` pages (24 independent scalar expressions) run in
 * the same session for context: they are the shape this lane would replace.
 *
 * Usage: npm run build && npm run build:resumability-benchmark
 *        && node benchmarks/resumability/structural.mjs
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const fixtureRoot = path.join(
  repositoryRoot,
  "examples",
  "resumability-benchmark",
);
const baseUrl = "http://127.0.0.1:4179";
const RUNS = 3;

function startPreview() {
  const viteCli = path.join(
    repositoryRoot,
    "node_modules",
    "vite",
    "bin",
    "vite.js",
  );
  const child = spawn(
    process.execPath,
    [viteCli, "preview", "--config", path.join(fixtureRoot, "vite.config.ts")],
    {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !child.killed) {
      process.stderr.write(output);
    }
  });
  return child;
}

async function waitForPreview() {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/structural-1.html`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Benchmark preview did not start: ${String(lastError)}`);
}

async function collectHeap(page, session) {
  await page.evaluate(() => {
    const forceGc = globalThis.gc;
    if (typeof forceGc === "function") forceGc();
  });
  await session.send("HeapProfiler.collectGarbage");
  const { metrics } = await session.send("Performance.getMetrics");
  const value = metrics.find(
    (metric) => metric.name === "JSHeapUsedSize",
  )?.value;
  if (typeof value !== "number") {
    throw new Error("JSHeapUsedSize was not measured.");
  }
  return value;
}

async function measurePage(browser, file, expectedRowText) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("HeapProfiler.enable");
  try {
    await page.goto(`${baseUrl}/${file}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__AF_BENCHMARK__.ready);
    await page.waitForTimeout(20);
    const readyBytes = await collectHeap(page, session);

    // One shared write opens every row Scope (structural) or fires every
    // dormant subscriber (scalar baseline), so afterPatch compares live rows
    // to live text regions.
    await page.evaluate(async ({ expected }) => {
      await window.__AF_BENCHMARK_WRITE_SHARED__?.(2);
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        if (document.body.textContent?.includes(expected) === true) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(
        `"${expected}" did not appear before timeout; diagnostics: ${
          JSON.stringify(window.__AF_BENCHMARK__.diagnostics)
        }`,
      );
    }, { expected: expectedRowText });
    await page.waitForTimeout(20);
    const afterPatchBytes = await collectHeap(page, session);

    const diagnostics = await page.evaluate(
      () => window.__AF_BENCHMARK__.diagnostics,
    );
    if (diagnostics.length > 0) {
      throw new Error(
        `${file} reported client diagnostics: ${JSON.stringify(diagnostics)}`,
      );
    }
    return { readyBytes, afterPatchBytes };
  } finally {
    await context.close();
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function main() {
  const preview = startPreview();
  let browser;
  try {
    await waitForPreview();
    // Same interpreter-only configuration as the gated lane's retention
    // measurements: JIT code generation would otherwise be attributed to
    // density.
    browser = await chromium.launch({
      headless: true,
      args: ["--js-flags=--expose-gc --jitless"],
    });

    const pages = [
      ["structural-1.html", "shared-0: 2"],
      ["structural-24.html", "shared-23: 2"],
      ["resume-1.html", "shared-0: 2"],
      ["resume-24.html", "shared-11: 2"],
    ];
    const samples = Object.fromEntries(pages.map(([file]) => [file, []]));
    for (let run = 0; run < RUNS; run += 1) {
      for (const [file, expected] of pages) {
        process.stdout.write(`run ${run + 1}/${RUNS}: ${file}\n`);
        samples[file].push(await measurePage(browser, file, expected));
      }
    }

    const summary = Object.fromEntries(
      pages.map(([file]) => [
        file,
        {
          readyBytes: median(samples[file].map((sample) => sample.readyBytes)),
          afterPatchBytes: median(
            samples[file].map((sample) => sample.afterPatchBytes),
          ),
        },
      ]),
    );

    const metadata = JSON.parse(
      await readFile(
        path.join(fixtureRoot, "dist", "fixture-metadata.json"),
        "utf8",
      ),
    );
    const structuralGrowth = {
      readyBytes: summary["structural-24.html"].readyBytes
        - summary["structural-1.html"].readyBytes,
      afterPatchBytes: summary["structural-24.html"].afterPatchBytes
        - summary["structural-1.html"].afterPatchBytes,
      documentRawBytes: metadata["structural-24.html"].documentRawBytes
        - metadata["structural-1.html"].documentRawBytes,
      documentGzipBytes: metadata["structural-24.html"].documentGzipBytes
        - metadata["structural-1.html"].documentGzipBytes,
      manifestUtf8Bytes: metadata["structural-24.html"].manifestUtf8Bytes
        - metadata["structural-1.html"].manifestUtf8Bytes,
    };
    const scalarGrowth = {
      readyBytes: summary["resume-24.html"].readyBytes
        - summary["resume-1.html"].readyBytes,
      afterPatchBytes: summary["resume-24.html"].afterPatchBytes
        - summary["resume-1.html"].afterPatchBytes,
      documentRawBytes: metadata["resume-24.html"].documentRawBytes
        - metadata["resume-1.html"].documentRawBytes,
      documentGzipBytes: metadata["resume-24.html"].documentGzipBytes
        - metadata["resume-1.html"].documentGzipBytes,
      manifestUtf8Bytes: metadata["resume-24.html"].manifestUtf8Bytes
        - metadata["resume-1.html"].manifestUtf8Bytes,
    };
    const perRow = (bytes) => Math.round((bytes / 23) * 10) / 10;

    const result = {
      version: 1,
      measuredAt: new Date().toISOString(),
      heapMeasurementMode: "jitless-forced-gc",
      runs: RUNS,
      summary,
      growth1to24: { structural: structuralGrowth, scalar: scalarGrowth },
      perRow: {
        structural: {
          liveHeapBytes: perRow(structuralGrowth.afterPatchBytes),
          dormantHeapBytes: perRow(structuralGrowth.readyBytes),
          documentRawBytes: perRow(structuralGrowth.documentRawBytes),
          documentGzipBytes: perRow(structuralGrowth.documentGzipBytes),
          manifestBytes: perRow(structuralGrowth.manifestUtf8Bytes),
        },
        scalarExpression: {
          liveHeapBytes: perRow(scalarGrowth.afterPatchBytes),
          dormantHeapBytes: perRow(scalarGrowth.readyBytes),
          documentRawBytes: perRow(scalarGrowth.documentRawBytes),
          documentGzipBytes: perRow(scalarGrowth.documentGzipBytes),
          manifestBytes: perRow(scalarGrowth.manifestUtf8Bytes),
        },
      },
    };

    const outDir = path.join(
      repositoryRoot,
      "bench-results",
      "resumability",
    );
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, "structural-latest.json");
    await writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);

    process.stdout.write("\nper-row cost, density 1 -> 24 (/23):\n");
    process.stdout.write(
      "                     structural   scalar-expr\n",
    );
    for (
      const [label, key] of [
        ["live heap (B)     ", "liveHeapBytes"],
        ["dormant heap (B)  ", "dormantHeapBytes"],
        ["document raw (B)  ", "documentRawBytes"],
        ["document gzip (B) ", "documentGzipBytes"],
        ["manifest (B)      ", "manifestBytes"],
      ]
    ) {
      process.stdout.write(
        `  ${label} ${String(result.perRow.structural[key]).padStart(10)}`
        + ` ${String(result.perRow.scalarExpression[key]).padStart(12)}\n`,
      );
    }
    process.stdout.write(`\nresult written to ${outFile}\n`);
  } finally {
    await browser?.close();
    preview.kill();
  }
}

await main();
