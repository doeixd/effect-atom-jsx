import { expect, test } from "@playwright/test";
import type { ResumableExtractBrowserState } from "../examples/resumable-extract/shared/browser-state.js";

const extractBaseUrl = "http://127.0.0.1:4178";

test("names the current eager comparator from observed SSR node reuse", async ({
  page,
}) => {
  await page.goto(`${extractBaseUrl}/`);
  await expect
    .poll(() => page.evaluate(() => window.__EXTRACT_TEST__.ready))
    .toBe(true);

  expect(await page.evaluate(() => window.__EXTRACT_TEST__)).toMatchObject({
    eagerSetupRuns: 1,
    eagerViewRuns: 1,
    eagerNodeReused: false,
    eagerRenderedText: "Client baseline",
    eagerComparator: "eager-rerender",
  });
  await expect(page.getByTestId("eager-baseline")).toHaveAttribute(
    "data-rendered-by",
    "client",
  );

  await page.evaluate(() => window.__EXTRACT_DISPOSE__?.());
});

test("compiler-extracted action resumes lazily with a generated identity", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  let releaseChunk!: () => void;
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  let chunkRequests = 0;
  await page.route(/\/assets\/note-button-[^/]+\.js$/, async (route) => {
    chunkRequests += 1;
    await chunkGate;
    await route.continue();
  });

  await page.goto(`${extractBaseUrl}/`);
  await expect
    .poll(() => page.evaluate(() => window.__EXTRACT_TEST__.ready))
    .toBe(true);

  // The manifest carries the compiler-generated identity, not a hand-written
  // one, and it survived the build/decode round trip.
  const manifestIds = await page.evaluate(() => {
    const script = document.querySelector("script[data-af-resume]");
    const parsed = JSON.parse(script?.textContent ?? "{}") as {
      readonly events?: Record<string, { readonly code: { readonly id: string } }>;
    };
    return Object.values(parsed.events ?? {}).map((entry) => entry.code.id);
  });
  // The identity is content-hashed, not positional: the old `#$0` ordinal
  // renumbered every later unassigned call as soon as an earlier one was added.
  // Assert the shape and the owning module, not the digest — pinning the digest
  // would make any edit to the marker's body a failing browser test.
  expect(manifestIds).toHaveLength(1);
  expect(manifestIds[0]).toMatch(/^app\/note-button\.ts#\$[0-9a-z]+$/);

  const button = page.getByTestId("extract-note");
  await expect(button).toBeVisible();
  expect(requests.some((url) => url.includes("note-button"))).toBe(false);

  await button.click();
  await button.click();
  await expect.poll(() => chunkRequests).toBe(1);

  const whileLoading = await page.evaluate(() => window.__EXTRACT_TEST__);
  expect(whileLoading).toMatchObject({
    appImports: 0,
    setupRuns: 0,
    viewRuns: 0,
    notes: [],
    diagnostics: [],
  });

  releaseChunk();
  await expect
    .poll(() => page.evaluate(() => window.__EXTRACT_TEST__.notes))
    .toEqual(["extracted-from-browser", "extracted-from-browser"]);

  const resumed = await page.evaluate(() => window.__EXTRACT_TEST__);
  expect(resumed).toMatchObject({
    appImports: 1,
    setupRuns: 0,
    viewRuns: 0,
    diagnostics: [],
  });

  await page.evaluate(() => window.__EXTRACT_DISPOSE__?.());
  await expect
    .poll(() => page.evaluate(() => window.__EXTRACT_TEST__.disposed))
    .toBe(true);
  await button.click();
  await page.waitForTimeout(25);
  expect(await page.evaluate(() => window.__EXTRACT_TEST__.notes)).toEqual([
    "extracted-from-browser",
    "extracted-from-browser",
  ]);
});

test("compiler-extracted expression patches one dormant region on first write", async ({
  page,
}) => {
  let releaseChunk!: () => void;
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  let chunkRequests = 0;
  await page.route(/\/assets\/note-button-[^/]+\.js$/, async (route) => {
    chunkRequests += 1;
    await chunkGate;
    await route.continue();
  });

  await page.goto(`${extractBaseUrl}/`);
  await expect
    .poll(() => page.evaluate(() => window.__EXTRACT_TEST__.ready))
    .toBe(true);

  const count = page.getByTestId("extract-count");
  await expect(count).toHaveText("Count: 1");
  expect(chunkRequests).toBe(0);

  const write = page.evaluate(() => window.__EXTRACT_WRITE__?.(2));
  await expect.poll(() => chunkRequests).toBe(1);

  const whileLoading = await page.evaluate(() => window.__EXTRACT_TEST__);
  expect(whileLoading).toMatchObject({
    appImports: 0,
    loaderCalls: 1,
    setupRuns: 0,
    viewRuns: 0,
    parentSetupRuns: 0,
    parentViewRuns: 0,
    siblingSetupRuns: 0,
    siblingViewRuns: 0,
    diagnostics: [],
  });

  releaseChunk();
  await write;
  await expect(count).toHaveText("Count: 2");

  await page.evaluate(() => window.__EXTRACT_WRITE__?.(3));
  await expect(count).toHaveText("Count: 3");
  expect(chunkRequests).toBe(1);
  expect(await page.evaluate(() => window.__EXTRACT_TEST__)).toMatchObject({
    appImports: 1,
    loaderCalls: 1,
    setupRuns: 0,
    viewRuns: 0,
    parentSetupRuns: 0,
    parentViewRuns: 0,
    siblingSetupRuns: 0,
    siblingViewRuns: 0,
    diagnostics: [],
  });

  await page.evaluate(() => window.__EXTRACT_DISPOSE__?.());
  await page.evaluate(() => window.__EXTRACT_WRITE__?.(4).catch(() => {}));
  await page.waitForTimeout(25);
  await expect(count).toHaveText("Count: 3");
});

declare global {
  interface Window {
    __EXTRACT_TEST__: ResumableExtractBrowserState;
    __EXTRACT_DISPOSE__?: () => Promise<void>;
    __EXTRACT_WRITE__?: (count: number) => Promise<void>;
  }
}
