import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { verifyBenchmarkResult } from "./verify.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const fixtureRoot = path.join(
  repositoryRoot,
  "examples",
  "resumability-benchmark",
);
const defaultOutput = path.join(
  repositoryRoot,
  "bench-results",
  "resumability",
  "latest.json",
);
const baseUrl = "http://127.0.0.1:4179";

function integerArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function stringArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1
    ? fallback
    : path.resolve(repositoryRoot, process.argv[index + 1]);
}

const coldRuns = integerArgument("--runs", 5);
const warmWrites = integerArgument("--warm", 30);
const outputPath = stringArgument("--output", defaultOutput);

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * ordered.length) - 1,
  );
  return ordered[index];
}

function distribution(values) {
  return {
    count: values.length,
    median: percentile(values, 50),
    p95: percentile(values, 95),
    min: values.length === 0 ? null : Math.min(...values),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

function ownershipFromState(state) {
  return {
    appImports: state.appImports,
    loaderCalls: state.loaderCalls,
    setupRuns: state.setupRuns,
    viewRuns: state.viewRuns,
    componentResources: state.componentResources,
    componentDisposals: state.componentDisposals,
    startupNodeReused: state.startupNodeReused,
    patches: state.patches,
    diagnostics: [...state.diagnostics],
  };
}

async function waitForPreview() {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/eager-1.html`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Benchmark preview did not start: ${String(lastError)}`);
}

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
    [
      viteCli,
      "preview",
      "--config",
      path.join(fixtureRoot, "vite.config.ts"),
    ],
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

async function collectHeap(page, session) {
  try {
    await page.evaluate(() => {
      const forceGc = globalThis.gc;
      if (typeof forceGc === "function") forceGc();
    });
    await session.send("HeapProfiler.collectGarbage");
    const { metrics } = await session.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value
      ?? null;
  } catch {
    return null;
  }
}

async function measureWrite(page, kind, index, value) {
  return page.evaluate(
    async ({ writeKind, writeIndex, nextValue }) => {
      const state = window.__AF_BENCHMARK__;
      const expected = `: ${nextValue}`;
      const selector = writeKind === "shared"
        ? '[data-expression-key="shared"]'
        : `[data-expression-index="${writeIndex + 12}"]`;
      const originalTargets = [...document.querySelectorAll(selector)];
      const originalTextNodes = originalTargets.map(
        (target) => target.firstChild,
      );
      state.lastPatchAt = undefined;
      const startedAt = performance.now();
      if (writeKind === "shared") {
        await window.__AF_BENCHMARK_WRITE_SHARED__?.(nextValue);
      } else {
        await window.__AF_BENCHMARK_WRITE_INDEPENDENT__?.(
          writeIndex,
          nextValue,
        );
      }
      const deadline = startedAt + 10_000;
      while (performance.now() < deadline) {
        const targets = [...document.querySelectorAll(selector)];
        if (
          targets.length > 0
          && targets.every((target) =>
            target.textContent?.endsWith(expected) === true
          )
          && state.lastPatchAt !== undefined
        ) {
          return {
            latencyMs: state.lastPatchAt - startedAt,
            textNodesReused: targets.every(
              (target, index) =>
                target.firstChild === originalTextNodes[index],
            ),
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const targets = [...document.querySelectorAll(selector)];
      throw new Error(JSON.stringify({
        message: `${writeKind} write ${nextValue} did not patch before timeout.`,
        texts: targets.map((target) => target.textContent),
        state,
        ownership: window.__AF_BENCHMARK_INSPECT__?.(),
      }));
    },
    { writeKind: kind, writeIndex: index, nextValue: value },
  );
}

async function measureSample(
  browser,
  fixture,
  runIndex,
  collectHeapMeasurements = true,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Performance.enable");
  if (collectHeapMeasurements) {
    await session.send("HeapProfiler.enable");
  }

  const requests = new Map();
  const completed = [];
  session.on("Network.requestWillBeSent", (event) => {
    requests.set(event.requestId, {
      url: event.request.url,
      resourceType: event.type,
    });
  });
  session.on("Network.loadingFinished", (event) => {
    const request = requests.get(event.requestId);
    if (request === undefined) return;
    completed.push({
      url: request.url,
      resourceType: request.resourceType,
      encodedDataLength: event.encodedDataLength,
    });
  });

  try {
    await page.goto(`${baseUrl}/${fixture.file}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => window.__AF_BENCHMARK__.ready);
    await page.waitForTimeout(20);

    const beforeState = await page.evaluate(() => window.__AF_BENCHMARK__);
    const beforeNetworkEnd = completed.length;
    const readyHeapBytes = collectHeapMeasurements
      ? await collectHeap(page, session)
      : null;

    const coldWrite = await measureWrite(
      page,
      "shared",
      0,
      1_000 + runIndex,
    );
    await page.waitForTimeout(20);
    const afterColdNetworkEnd = completed.length;
    const afterColdState = await page.evaluate(
      () => window.__AF_BENCHMARK__,
    );
    const afterColdHeapBytes = collectHeapMeasurements
      ? await collectHeap(page, session)
      : null;

    const warmSharedMs = [];
    const warmIndependentMs = [];
    for (let index = 0; index < warmWrites; index += 1) {
      warmSharedMs.push(
        (await measureWrite(
          page,
          "shared",
          0,
          2_000 + runIndex * warmWrites + index,
        )).latencyMs,
      );
      if (fixture.density === 24) {
        warmIndependentMs.push(
          (await measureWrite(
            page,
            "independent",
            index % 12,
            3_000 + runIndex * warmWrites + index,
          )).latencyMs,
        );
      }
    }
    await page.waitForTimeout(20);
    const afterWarmNetworkEnd = completed.length;
    const afterWarmState = await page.evaluate(
      () => window.__AF_BENCHMARK__,
    );
    const afterWarmHeapBytes = collectHeapMeasurements
      ? await collectHeap(page, session)
      : null;

    await page.evaluate(() => window.__AF_BENCHMARK_DISPOSE__?.());
    await page.waitForTimeout(10);
    const afterDisposeState = await page.evaluate(
      () => window.__AF_BENCHMARK__,
    );
    const afterDisposeHeapBytes = collectHeapMeasurements
      ? await collectHeap(page, session)
      : null;

    return {
      runIndex,
      navigationToReadyMs: beforeState.readyAt,
      coldInteractionToPatchMs: coldWrite.latencyMs,
      coldTextNodesReused: coldWrite.textNodesReused,
      coldModuleResolutionMs:
        afterColdState.loaderStartedAt === undefined
          || afterColdState.loaderResolvedAt === undefined
          ? null
          : afterColdState.loaderResolvedAt
            - afterColdState.loaderStartedAt,
      warmSharedMs,
      warmIndependentMs,
      network: {
        beforeInteraction: completed.slice(0, beforeNetworkEnd),
        atFirstInteraction: completed.slice(
          beforeNetworkEnd,
          afterColdNetworkEnd,
        ),
        duringWarmWrites: completed.slice(
          afterColdNetworkEnd,
          afterWarmNetworkEnd,
        ),
      },
      ownership: {
        beforeUse: beforeState.ownershipBeforeUse,
        afterDispose: afterDisposeState.ownershipAfterDispose,
      },
      lifecycle: {
        beforeUse: ownershipFromState(beforeState),
        afterCold: ownershipFromState(afterColdState),
        afterWarm: ownershipFromState(afterWarmState),
        afterDispose: ownershipFromState(afterDisposeState),
      },
      heap: {
        readyBytes: readyHeapBytes,
        afterColdBytes: afterColdHeapBytes,
        afterWarmBytes: afterWarmHeapBytes,
        afterDisposeBytes: afterDisposeHeapBytes,
      },
    };
  } finally {
    await context.close();
  }
}

async function measureAttributionSample(
  browser,
  density,
  stage,
  runIndex,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Performance.enable");
  await session.send("HeapProfiler.enable");
  try {
    await page.goto(
      `${baseUrl}/attribution-${density}.html?stage=${
        encodeURIComponent(stage)
      }`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForFunction(() => window.__AF_ATTRIBUTION__.ready);
    await page.waitForTimeout(20);
    const state = await page.evaluate(() => window.__AF_ATTRIBUTION__);
    const readyHeapBytes = await collectHeap(page, session);
    await page.evaluate(() => window.__AF_ATTRIBUTION_DISPOSE__?.());
    await page.waitForTimeout(10);
    const disposedState = await page.evaluate(
      () => window.__AF_ATTRIBUTION__,
    );
    const afterDisposeHeapBytes = await collectHeap(page, session);
    return {
      runIndex,
      readyAtMs: state.readyAt,
      readyHeapBytes,
      afterDisposeHeapBytes,
      boundaryCount: state.boundaryCount,
      expressionCount: state.expressionCount,
      installation: state.installation,
      afterDispose: disposedState.afterDispose,
      diagnostics: [...state.diagnostics],
    };
  } finally {
    await context.close();
  }
}

function summarize(samples) {
  return {
    navigationToReady: distribution(
      samples.map((sample) => sample.navigationToReadyMs),
    ),
    coldInteractionToPatch: distribution(
      samples.map((sample) => sample.coldInteractionToPatchMs),
    ),
    coldModuleResolution: distribution(
      samples
        .map((sample) => sample.coldModuleResolutionMs)
        .filter((value) => value !== null),
    ),
    warmShared: distribution(
      samples.flatMap((sample) => sample.warmSharedMs),
    ),
    warmIndependent: distribution(
      samples.flatMap((sample) => sample.warmIndependentMs),
    ),
    heapReadyBytes: distribution(
      samples
        .map((sample) => sample.heap.readyBytes)
        .filter((value) => value !== null),
    ),
    heapAfterWarmBytes: distribution(
      samples
        .map((sample) => sample.heap.afterWarmBytes)
        .filter((value) => value !== null),
    ),
    heapAfterDisposeBytes: distribution(
      samples
        .map((sample) => sample.heap.afterDisposeBytes)
        .filter((value) => value !== null),
    ),
  };
}

function summarizeAttribution(samples) {
  return {
    ready: distribution(samples.map((sample) => sample.readyAtMs)),
    heapReadyBytes: distribution(
      samples
        .map((sample) => sample.readyHeapBytes)
        .filter((value) => value !== null),
    ),
    heapAfterDisposeBytes: distribution(
      samples
        .map((sample) => sample.afterDisposeHeapBytes)
        .filter((value) => value !== null),
    ),
  };
}

const metadata = JSON.parse(
  await readFile(
    path.join(fixtureRoot, "dist", "fixture-metadata.json"),
    "utf8",
  ),
);
const fixtures = [
  { file: "eager-1.html", mode: "eager-rerender", density: 1 },
  { file: "resume-1.html", mode: "dormant-resume", density: 1 },
  { file: "eager-24.html", mode: "eager-rerender", density: 24 },
  { file: "resume-24.html", mode: "dormant-resume", density: 24 },
];
const alignedComparators = [
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
];
const attributionStages = [
  "modules",
  "runtime",
  "serialization",
  "json",
  "guard",
  "schema",
  "manifest",
  "runtime-manifest",
  "resolver",
  "scans",
  "installed",
];
const attributionDensities = [0, 1, 24];

const preview = startPreview();
let browser;
let heapBrowser;
try {
  await waitForPreview();
  browser = await chromium.launch({
    headless: true,
    args: ["--js-flags=--expose-gc"],
  });
  // JSHeapUsedSize includes density-triggered baseline/JIT code generation.
  // That code is neither retained expression ownership nor linear payload
  // growth, and V8 may compile it only after the density-24 scan. Use a
  // separate interpreter-only lane for forced-GC heap measurements while the
  // ordinary browser above remains authoritative for timings and behavior.
  heapBrowser = await chromium.launch({
    headless: true,
    args: ["--js-flags=--expose-gc --jitless"],
  });
  const results = [];
  for (const fixture of fixtures) {
    process.stdout.write(
      `Measuring ${fixture.mode} density ${fixture.density}...\n`,
    );
    const samples = [];
    for (let runIndex = 0; runIndex < coldRuns; runIndex += 1) {
      const timingSample = await measureSample(
        browser,
        fixture,
        runIndex,
        false,
      );
      const heapSample = await measureSample(
        heapBrowser,
        fixture,
        runIndex,
      );
      samples.push({
        ...timingSample,
        heap: heapSample.heap,
      });
    }
    results.push({
      ...fixture,
      payload: metadata[fixture.file],
      samples,
      summary: summarize(samples),
    });
  }
  const alignedResults = [];
  for (const fixture of alignedComparators) {
    process.stdout.write(
      `Measuring ${fixture.mode} density ${fixture.density}...\n`,
    );
    const samples = [];
    for (let runIndex = 0; runIndex < coldRuns; runIndex += 1) {
      const timingSample = await measureSample(
        browser,
        fixture,
        runIndex,
        false,
      );
      const heapSample = await measureSample(
        heapBrowser,
        fixture,
        runIndex,
      );
      samples.push({
        ...timingSample,
        heap: heapSample.heap,
      });
    }
    alignedResults.push({
      ...fixture,
      payload: metadata[fixture.file],
      samples,
      summary: summarize(samples),
    });
  }
  const attributionResults = [];
  for (const density of attributionDensities) {
    const stageResults = [];
    for (const stage of attributionStages) {
      process.stdout.write(
        `Attributing ${stage} at density ${density}...\n`,
      );
      const samples = [];
      for (let runIndex = 0; runIndex < coldRuns; runIndex += 1) {
        samples.push(
          await measureAttributionSample(
            heapBrowser,
            density,
            stage,
            runIndex,
          ),
        );
      }
      stageResults.push({
        stage,
        samples,
        summary: summarizeAttribution(samples),
      });
    }
    const moduleMedian = stageResults.find(
      (entry) => entry.stage === "modules",
    ).summary.heapReadyBytes.median;
    attributionResults.push({
      density,
      stages: stageResults.map((entry) => ({
        ...entry,
        deltaFromModulesMedianBytes:
          entry.summary.heapReadyBytes.median === null
            || moduleMedian === null
            ? null
            : entry.summary.heapReadyBytes.median - moduleMedian,
      })),
    });
  }

  const result = {
    schemaVersion: 2,
    benchmark: "effect-atom-jsx/resumability-m8c1",
    generatedAt: new Date().toISOString(),
    buildId: "resumability-m8c1-benchmark-v1",
    browser: {
      name: "chromium",
      version: browser.version(),
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      headless: true,
      cacheDisabledForColdRuns: true,
      forcedGcRequested: true,
      timingMeasurementMode: "ordinary",
      heapMeasurementMode: "jitless-forced-gc",
    },
    config: {
      coldRuns,
      warmWritesPerKind: warmWrites,
    },
    fixtures: results,
    alignedComparators: alignedResults,
    attribution: attributionResults,
  };

  try {
    verifyBenchmarkResult(result);
  } catch (error) {
    const failedOutputPath = outputPath.endsWith(".json")
      ? `${outputPath.slice(0, -5)}.failed.json`
      : `${outputPath}.failed.json`;
    await mkdir(path.dirname(failedOutputPath), { recursive: true });
    await writeFile(
      failedOutputPath,
      `${JSON.stringify(result, null, 2)}\n`,
    );
    process.stderr.write(
      `Unverified result written to ${failedOutputPath}\n`,
    );
    throw error;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Verified result written to ${outputPath}\n`);
} finally {
  await heapBrowser?.close();
  await browser?.close();
  preview.kill();
}
