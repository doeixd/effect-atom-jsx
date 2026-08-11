import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

/**
 * Retained-heap budgets. Named and exported so they are greppable: these
 * were inline `1.1` and `200_000` literals, and a search for "slope" or
 * "1.10" found nothing -- which led to a written claim that the gate was
 * not automated at all. It always was, and `run.mjs` enforces it on every
 * run.
 */
export const SLOPE_CEILING = 1.1;
export const FIXED_GAP_CEILING_BYTES = 200_000;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(`Resumability benchmark invariant failed: ${message}`);
  }
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function javascriptRequests(requests) {
  return requests.filter((request) =>
    request.resourceType === "Script"
    || new URL(request.url).pathname.endsWith(".js")
  );
}

function isEagerMode(mode) {
  return mode === "eager-rerender"
    || mode === "eager-rerender-shared-runtime";
}

function verifyOwnership(ownership, density, phase, fixtureName) {
  invariant(
    ownership !== undefined,
    `${fixtureName} has no ${phase} ownership snapshot`,
  );
  if (phase === "before-use") {
    invariant(
      ownership.boundaryControllers === 1,
      `${fixtureName} must own one boundary controller before use`,
    );
    invariant(
      ownership.expressionControllers === density,
      `${fixtureName} must own ${density} expression controllers before use`,
    );
    invariant(
      ownership.expressionDependencyKeys === (density === 1 ? 1 : 13),
      `${fixtureName} dependency-key cardinality drifted`,
    );
    invariant(
      ownership.expressionSubscriptions === density,
      `${fixtureName} must own one subscription per expression`,
    );
  } else {
    invariant(
      ownership.boundaryControllers === 0
      && ownership.expressionControllers === 0
      && ownership.expressionDependencyKeys === 0
      && ownership.expressionSubscriptions === 0
      && ownership.pendingFibers === 0,
      `${fixtureName} retained controllers, subscriptions, or fibers after disposal`,
    );
  }
}

function verifyLifecycle(fixture, sample) {
  const name = `${fixture.mode}/${fixture.density}/run-${sample.runIndex}`;
  const before = sample.lifecycle.beforeUse;
  const afterCold = sample.lifecycle.afterCold;
  const afterDispose = sample.lifecycle.afterDispose;
  invariant(before.diagnostics.length === 0, `${name} emitted startup diagnostics`);
  invariant(
    afterCold.diagnostics.length === 0,
    `${name} emitted cold-interaction diagnostics`,
  );
  invariant(
    afterDispose.diagnostics.length === 0,
    `${name} emitted disposal diagnostics`,
  );
  invariant(
    before.componentResources === (isEagerMode(fixture.mode) ? 1 : 0),
    `${name} has the wrong startup resource ownership`,
  );
  invariant(
    afterDispose.componentResources === 0,
    `${name} retained a component resource after disposal`,
  );

  if (fixture.mode === "dormant-resume") {
    invariant(
      before.startupNodeReused === true,
      `${name} changed the SSR root during dormant installation`,
    );
    invariant(before.appImports === 0, `${name} eagerly imported expression code`);
    invariant(before.loaderCalls === 0, `${name} eagerly invoked a code loader`);
    invariant(
      before.setupRuns === 0 && before.viewRuns === 0,
      `${name} ran component setup or view while dormant`,
    );
    invariant(
      afterCold.appImports === 1 && afterCold.loaderCalls === 1,
      `${name} did not resolve exactly one expression module`,
    );
    invariant(
      afterCold.setupRuns === 0 && afterCold.viewRuns === 0,
      `${name} activated component setup or view for a text patch`,
    );
    invariant(
      afterDispose.componentDisposals === 0,
      `${name} disposed a component resource that was never activated`,
    );
  } else {
    invariant(
      before.startupNodeReused === false,
      `${name} eager comparator unexpectedly reused the SSR root`,
    );
    invariant(
      before.appImports === 1
      && before.loaderCalls === 0
      && before.setupRuns === 1
      && before.viewRuns === 1,
      `${name} eager startup lifecycle drifted`,
    );
    invariant(
      afterDispose.componentDisposals === 1,
      `${name} did not release its eager component resource exactly once`,
    );
  }
}

function verifyNetwork(fixture, sample) {
  const name = `${fixture.mode}/${fixture.density}/run-${sample.runIndex}`;
  const beforeScripts = javascriptRequests(
    sample.network.beforeInteraction,
  );
  const coldScripts = javascriptRequests(
    sample.network.atFirstInteraction,
  );
  const warmScripts = javascriptRequests(
    sample.network.duringWarmWrites,
  );
  invariant(
    warmScripts.length === 0,
    `${name} requested JavaScript during warm writes`,
  );
  if (fixture.mode === "dormant-resume") {
    invariant(
      beforeScripts.every((request) =>
        !new URL(request.url).pathname.includes("/benchmark-")
      ),
      `${name} loaded the expression module before interaction`,
    );
    invariant(
      coldScripts.length === 1
      && new URL(coldScripts[0].url).pathname.includes("/benchmark-"),
      `${name} must request exactly one expression chunk on first interaction`,
    );
  } else {
    invariant(
      beforeScripts.some((request) =>
        new URL(request.url).pathname.includes("/benchmark-")
      ),
      `${name} eager startup did not request the application chunk`,
    );
    invariant(
      coldScripts.length === 0,
      `${name} eager first interaction unexpectedly requested JavaScript`,
    );
  }
}

export function verifyBenchmarkResult(result) {
  invariant(result?.schemaVersion === 2, "unsupported result schema version");
  invariant(
    result?.benchmark === "effect-atom-jsx/resumability-m8c1",
    "unexpected benchmark identity",
  );
  invariant(
    result?.buildId === "resumability-m8c1-benchmark-v1",
    "unexpected benchmark build identity",
  );
  invariant(
    Array.isArray(result.fixtures) && result.fixtures.length === 4,
    "result must contain both modes at densities 1 and 24",
  );

  const identities = new Set(
    result.fixtures.map((fixture) => `${fixture.mode}:${fixture.density}`),
  );
  for (const identity of [
    "eager-rerender:1",
    "dormant-resume:1",
    "eager-rerender:24",
    "dormant-resume:24",
  ]) {
    invariant(identities.has(identity), `missing fixture ${identity}`);
  }

  for (const fixture of result.fixtures) {
    const fixtureName = `${fixture.mode}/${fixture.density}`;
    invariant(
      fixture.samples.length === result.config.coldRuns,
      `${fixtureName} run count does not match configuration`,
    );
    invariant(
      fixture.payload.mode === fixture.mode
      && fixture.payload.density === fixture.density,
      `${fixtureName} payload metadata belongs to another fixture`,
    );
    invariant(
      fixture.payload.combinedRawBytes
      === fixture.payload.manifestUtf8Bytes
        + fixture.payload.markerUtf8Bytes,
      `${fixtureName} combined payload accounting is inconsistent`,
    );
    if (fixture.mode === "eager-rerender") {
      invariant(
        fixture.payload.manifestUtf8Bytes === 0
        && fixture.payload.markerUtf8Bytes === 0,
        `${fixtureName} eager HTML contains resumability payload`,
      );
    } else {
      invariant(
        fixture.payload.manifestUtf8Bytes > 0
        && fixture.payload.markerUtf8Bytes > 0,
        `${fixtureName} resumable payload is missing`,
      );
    }

    for (const sample of fixture.samples) {
      invariant(
        isFiniteNonNegative(sample.navigationToReadyMs)
        && isFiniteNonNegative(sample.coldInteractionToPatchMs),
        `${fixtureName}/run-${sample.runIndex} has invalid timing data`,
      );
      invariant(
        sample.coldTextNodesReused === true,
        `${fixtureName}/run-${sample.runIndex} replaced a patched text node`,
      );
      invariant(
        fixture.mode === "dormant-resume"
          ? isFiniteNonNegative(sample.coldModuleResolutionMs)
          : sample.coldModuleResolutionMs === null,
        `${fixtureName}/run-${sample.runIndex} has invalid module-resolution timing`,
      );
      invariant(
        sample.warmSharedMs.length === result.config.warmWritesPerKind,
        `${fixtureName}/run-${sample.runIndex} shared warm sample count drifted`,
      );
      invariant(
        sample.warmSharedMs.every(isFiniteNonNegative)
        && sample.warmIndependentMs.every(isFiniteNonNegative),
        `${fixtureName}/run-${sample.runIndex} has invalid warm timing data`,
      );
      invariant(
        sample.warmIndependentMs.length
        === (fixture.density === 24
          ? result.config.warmWritesPerKind
          : 0),
        `${fixtureName}/run-${sample.runIndex} independent warm sample count drifted`,
      );
      verifyOwnership(
        sample.ownership.beforeUse,
        fixture.density,
        "before-use",
        fixtureName,
      );
      verifyOwnership(
        sample.ownership.afterDispose,
        fixture.density,
        "after-dispose",
        fixtureName,
      );
      verifyLifecycle(fixture, sample);
      verifyNetwork(fixture, sample);
    }
  }

  invariant(
    Array.isArray(result.alignedComparators)
    && result.alignedComparators.length === 2,
    "result must contain shared-runtime eager comparators at densities 1 and 24",
  );
  const alignedIdentities = new Set(
    result.alignedComparators.map((fixture) =>
      `${fixture.mode}:${fixture.density}`
    ),
  );
  for (const identity of [
    "eager-rerender-shared-runtime:1",
    "eager-rerender-shared-runtime:24",
  ]) {
    invariant(
      alignedIdentities.has(identity),
      `missing aligned comparator ${identity}`,
    );
  }
  for (const fixture of result.alignedComparators) {
    const fixtureName = `${fixture.mode}/${fixture.density}`;
    invariant(
      fixture.mode === "eager-rerender-shared-runtime"
      && (fixture.density === 1 || fixture.density === 24),
      `${fixtureName} is not a valid aligned comparator`,
    );
    invariant(
      fixture.samples.length === result.config.coldRuns,
      `${fixtureName} run count does not match configuration`,
    );
    invariant(
      fixture.payload.mode === fixture.mode
      && fixture.payload.density === fixture.density
      && fixture.payload.manifestUtf8Bytes === 0
      && fixture.payload.markerUtf8Bytes === 0,
      `${fixtureName} payload accounting is inconsistent`,
    );
    for (const sample of fixture.samples) {
      invariant(
        isFiniteNonNegative(sample.navigationToReadyMs)
        && isFiniteNonNegative(sample.coldInteractionToPatchMs)
        && sample.coldTextNodesReused === true
        && sample.coldModuleResolutionMs === null,
        `${fixtureName}/run-${sample.runIndex} has invalid timing or DOM identity data`,
      );
      invariant(
        sample.warmSharedMs.length === result.config.warmWritesPerKind
        && sample.warmIndependentMs.length
          === (fixture.density === 24
            ? result.config.warmWritesPerKind
            : 0),
        `${fixtureName}/run-${sample.runIndex} warm sample count drifted`,
      );
      verifyOwnership(
        sample.ownership.beforeUse,
        fixture.density,
        "before-use",
        fixtureName,
      );
      verifyOwnership(
        sample.ownership.afterDispose,
        fixture.density,
        "after-dispose",
        fixtureName,
      );
      verifyLifecycle(fixture, sample);
      verifyNetwork(fixture, sample);
    }
  }

  invariant(
    Array.isArray(result.attribution) && result.attribution.length === 3,
    "result must contain attribution matrices at densities 0, 1, and 24",
  );
  const expectedStages = [
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
  const attributionDensities = new Set(
    result.attribution.map((entry) => entry.density),
  );
  for (const density of [0, 1, 24]) {
    invariant(
      attributionDensities.has(density),
      `missing attribution density ${density}`,
    );
  }
  for (const densityResult of result.attribution) {
    const { density } = densityResult;
    invariant(
      density === 0 || density === 1 || density === 24,
      `unexpected attribution density ${density}`,
    );
    invariant(
      densityResult.stages.length === expectedStages.length,
      `density ${density} attribution stage count drifted`,
    );
    const stageNames = new Set(
      densityResult.stages.map((entry) => entry.stage),
    );
    for (const expected of expectedStages) {
      invariant(
        stageNames.has(expected),
        `density ${density} is missing attribution stage ${expected}`,
      );
    }
    const modules = densityResult.stages.find(
      (entry) => entry.stage === "modules",
    );
    invariant(
      modules.deltaFromModulesMedianBytes === 0,
      `density ${density} module baseline must have a zero delta`,
    );
    for (const stageResult of densityResult.stages) {
      invariant(
        stageResult.samples.length === result.config.coldRuns,
        `density ${density}/${stageResult.stage} run count drifted`,
      );
      invariant(
        stageResult.deltaFromModulesMedianBytes === null
        || Number.isFinite(stageResult.deltaFromModulesMedianBytes),
        `density ${density}/${stageResult.stage} has an invalid heap delta`,
      );
      for (const sample of stageResult.samples) {
        invariant(
          isFiniteNonNegative(sample.readyAtMs)
          && (
            sample.readyHeapBytes === null
            || isFiniteNonNegative(sample.readyHeapBytes)
          )
          && (
            sample.afterDisposeHeapBytes === null
            || isFiniteNonNegative(sample.afterDisposeHeapBytes)
          ),
          `density ${density}/${stageResult.stage}/run-${sample.runIndex} has invalid measurements`,
        );
        invariant(
          sample.diagnostics.length === 0,
          `density ${density}/${stageResult.stage}/run-${sample.runIndex} emitted diagnostics`,
        );
        if (stageResult.stage === "scans") {
          invariant(
            sample.boundaryCount === 1
            && sample.expressionCount === density,
            `density ${density} scan counts drifted`,
          );
        }
        if (stageResult.stage === "installed") {
          invariant(
            sample.installation?.boundaryControllers === 1
            && sample.installation?.expressionControllers === density
            && sample.installation?.expressionSubscriptions === density,
            `density ${density} installation ownership drifted`,
          );
          invariant(
            sample.afterDispose?.boundaryControllers === 0
            && sample.afterDispose?.expressionControllers === 0
            && sample.afterDispose?.expressionSubscriptions === 0
            && sample.afterDispose?.pendingFibers === 0,
            `density ${density} attribution installation retained ownership after disposal`,
          );
        }
      }
    }
  }

  const resumedOne = result.fixtures.find((fixture) =>
    fixture.mode === "dormant-resume" && fixture.density === 1
  );
  const resumedTwentyFour = result.fixtures.find((fixture) =>
    fixture.mode === "dormant-resume" && fixture.density === 24
  );
  const eagerOne = result.fixtures.find((fixture) =>
    fixture.mode === "eager-rerender" && fixture.density === 1
  );
  const eagerTwentyFour = result.fixtures.find((fixture) =>
    fixture.mode === "eager-rerender" && fixture.density === 24
  );
  invariant(
    resumedTwentyFour.payload.manifestUtf8Bytes
    <= resumedOne.payload.manifestUtf8Bytes * 30,
    "manifest growth is worse than the allowed linear envelope",
  );
  invariant(
    resumedTwentyFour.payload.markerUtf8Bytes
    <= resumedOne.payload.markerUtf8Bytes * 30,
    "marker growth is worse than the allowed linear envelope",
  );
  const resumedOneHeap = resumedOne.summary.heapReadyBytes.median;
  const resumedTwentyFourHeap =
    resumedTwentyFour.summary.heapReadyBytes.median;
  const eagerOneHeap = eagerOne.summary.heapReadyBytes.median;
  const eagerTwentyFourHeap = eagerTwentyFour.summary.heapReadyBytes.median;
  const heapIsMeasured = [
    resumedOneHeap,
    resumedTwentyFourHeap,
    eagerOneHeap,
    eagerTwentyFourHeap,
  ].every(Number.isFinite);

  if (heapIsMeasured) {
    const resumedGrowth = resumedTwentyFourHeap - resumedOneHeap;
    const eagerGrowth = eagerTwentyFourHeap - eagerOneHeap;
    const fixedGapBytes = resumedTwentyFourHeap - eagerTwentyFourHeap;
    // Report the ratio as null rather than Infinity/NaN when the denominator
    // is degenerate, so a broken run reads as unmeasured instead of as a
    // suspiciously perfect score.
    const slope = eagerGrowth > 0 ? resumedGrowth / eagerGrowth : null;

    result.gates = {
      slope: {
        name: "dormant-vs-eager density-1-to-24 heap growth ratio",
        value: slope,
        ceiling: SLOPE_CEILING,
        resumedGrowthBytes: resumedGrowth,
        eagerGrowthBytes: eagerGrowth,
        headroom: slope === null ? null : SLOPE_CEILING - slope,
        status: "enforced",
      },
      fixedGap: {
        name: "density-24 dormant-over-eager retained heap",
        valueBytes: fixedGapBytes,
        ceilingBytes: FIXED_GAP_CEILING_BYTES,
        status: "pending",
      },
    };

    invariant(
      resumedGrowth >= 0
      && eagerGrowth > 0
      && resumedGrowth <= eagerGrowth * SLOPE_CEILING,
      "dormant per-expression heap growth exceeded "
      + Math.round(SLOPE_CEILING * 100)
      + "% of eager growth (ratio "
      + (slope === null ? "undefined" : slope.toFixed(4))
      + ", dormant " + resumedGrowth + "B, eager " + eagerGrowth + "B)",
    );

    const isCalibratedEnvironment =
      result.environment.platform === "win32"
      && result.environment.architecture === "x64"
      && result.browser.name === "chromium"
      && result.browser.version.startsWith("151.");
    if (isCalibratedEnvironment) {
      result.gates.fixedGap.status = "enforced";
      invariant(
        fixedGapBytes <= FIXED_GAP_CEILING_BYTES,
        "density-24 dormant heap exceeded the calibrated "
        + FIXED_GAP_CEILING_BYTES + "-byte fixed-cost budget (measured "
        + fixedGapBytes + "B)",
      );
    } else {
      // Report-only off the calibrated environment, because the budget was
      // calibrated there. Say so out loud: a threshold that quietly does not
      // apply reads exactly like a threshold that passed.
      result.gates.fixedGap.status = "skipped-uncalibrated-environment";
      result.gates.fixedGap.reason = "calibrated for win32/x64/chromium 151.x; ran on "
        + result.environment.platform + "/" + result.environment.architecture
        + "/" + result.browser.name + " " + result.browser.version;
    }
  } else {
    // Both heap gates depend on CDP measurements that can be absent. Skipping
    // them silently is how a run with no heap data passes as cleanly as a run
    // that met every budget.
    result.gates = {
      slope: {
        name: "dormant-vs-eager density-1-to-24 heap growth ratio",
        value: null,
        ceiling: SLOPE_CEILING,
        status: "skipped-no-heap-measurement",
      },
      fixedGap: {
        name: "density-24 dormant-over-eager retained heap",
        valueBytes: null,
        ceilingBytes: FIXED_GAP_CEILING_BYTES,
        status: "skipped-no-heap-measurement",
      },
    };
  }
  return result;
}

/**
 * Render the heap gates for humans.
 *
 * The slope gate decided DQ-030 (per-row markers vs `data-af-key`), and that
 * decision was made by recomputing the ratio by hand out of the result JSON,
 * because the gate threw on failure but never reported its value on success.
 * A gate you cannot read is a gate someone will recompute by hand.
 */
export function formatGateReport(gates) {
  if (gates === undefined) return "heap gates: not evaluated\n";
  const lines = [];
  const slope = gates.slope;
  if (slope.status === "enforced" && slope.value !== null) {
    lines.push(
      "  slope     " + slope.value.toFixed(4) + " / "
      + slope.ceiling.toFixed(2) + " ceiling  (headroom "
      + slope.headroom.toFixed(4) + "; dormant +"
      + slope.resumedGrowthBytes + "B, eager +"
      + slope.eagerGrowthBytes + "B)",
    );
  } else {
    lines.push("  slope     SKIPPED - " + slope.status);
  }
  const gap = gates.fixedGap;
  if (gap.status === "enforced") {
    lines.push(
      "  fixed gap " + gap.valueBytes + "B / " + gap.ceilingBytes
      + "B ceiling",
    );
  } else if (gap.valueBytes !== null && gap.valueBytes !== undefined) {
    lines.push(
      "  fixed gap " + gap.valueBytes + "B (report-only) - " + gap.status
      + (gap.reason === undefined ? "" : ": " + gap.reason),
    );
  } else {
    lines.push("  fixed gap SKIPPED - " + gap.status);
  }
  return "heap gates:\n" + lines.join("\n") + "\n";
}

async function main() {
  const filename = process.argv[2];
  if (filename === undefined) {
    throw new Error("Usage: node verify.mjs <benchmark-result.json>");
  }
  const result = JSON.parse(
    await readFile(path.resolve(process.cwd(), filename), "utf8"),
  );
  verifyBenchmarkResult(result);
  process.stdout.write(`Verified ${filename}\n`);
  process.stdout.write(formatGateReport(result.gates));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
