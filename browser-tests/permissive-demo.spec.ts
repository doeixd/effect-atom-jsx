/**
 * S5 (`docs/PERMISSIVE_PACKAGE_PLAN.md`) — the Qwik-parity acceptance run.
 *
 * The page was built entirely through the `@affe/permissive` preset: the
 * `extract.auto` one-liner handler (captures inferred, no schema at the call
 * site), the async seroval codec on both sides, and the client entry that
 * ships no compiler code. The proof is the Qwik property itself: nothing
 * about the component executes on load, and the first click runs the handler
 * with its Map capture alive.
 */

import { expect, test } from "@playwright/test";
import type { PermissiveDemoBrowserState } from "../examples/permissive-demo/shared/browser-state.js";

const baseUrl = "http://127.0.0.1:4179";

declare global {
  interface Window {
    __PERMISSIVE_TEST__: PermissiveDemoBrowserState;
    __PERMISSIVE_DISPOSE__?: () => Promise<void>;
  }
}

test("resumes through the permissive preset: zero setup on load, live Map on click", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  const assetSizes = new Map<string, number>();
  page.on("response", async (response) => {
    const url = response.url();
    if (/\/assets\/.*\.js$/.test(url)) {
      assetSizes.set(url, (await response.body()).byteLength);
    }
  });

  await page.goto(`${baseUrl}/`);
  await expect
    .poll(() => page.evaluate(() => window.__PERMISSIVE_TEST__.ready))
    .toBe(true);

  // The Qwik-parity claim: the SSR'd button is live, but NOTHING about the
  // component has executed client-side — no setup, no view, no loader.
  expect(
    await page.evaluate(() => ({
      setupRuns: window.__PERMISSIVE_TEST__.setupRuns,
      viewRuns: window.__PERMISSIVE_TEST__.viewRuns,
      loaderCalls: window.__PERMISSIVE_TEST__.loaderCalls,
      clicks: window.__PERMISSIVE_TEST__.clicks.length,
    })),
  ).toEqual({ setupRuns: 0, viewRuns: 0, loaderCalls: 0, clicks: 0 });

  // The manifest was stamped by the preset's async seroval codec (DQ-012) —
  // proof the permissive layers, not the default JSON codec, produced it.
  expect(
    await page.evaluate(() => window.__PERMISSIVE_TEST__.serializerId),
  ).toBe("af.seroval-async-json.v1");

  // First interaction: the generated module loads lazily and the handler runs
  // with its inferred captures — the Map arrives as a LIVE Map.
  await page.getByTestId("permissive-pin").click();
  await expect
    .poll(() => page.evaluate(() => window.__PERMISSIVE_TEST__.clicks.length))
    .toBe(1);
  expect(
    await page.evaluate(() => window.__PERMISSIVE_TEST__),
  ).toMatchObject({
    setupRuns: 0,
    viewRuns: 0,
    loaderCalls: 1,
    clicks: [
      {
        label: "permissive-map-capture",
        isMap: true,
        size: 3,
        sum: 42,
      },
    ],
    diagnostics: [],
  });

  // Second click reuses the loaded module: no second loader call.
  await page.getByTestId("permissive-pin").click();
  await expect
    .poll(() => page.evaluate(() => window.__PERMISSIVE_TEST__.clicks.length))
    .toBe(2);
  expect(
    await page.evaluate(() => window.__PERMISSIVE_TEST__.loaderCalls),
  ).toBe(1);

  // The compiler stays out of the client: the lazy-loaded handler chunk is a
  // few hundred bytes, and no bundle the page fetched is compiler-sized. When
  // this fired during development it was `pin-board.ts` importing the preset
  // (and through it babel) — a 1.3 MB chunk.
  const pinBoardEntry = [...assetSizes.entries()].find(([url]) =>
    /pin-board/.test(url)
  );
  expect(pinBoardEntry).toBeDefined();
  expect(pinBoardEntry![1]).toBeLessThan(10_000);
  for (const [url, size] of assetSizes) {
    expect(size, url).toBeLessThan(600_000);
  }

  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__PERMISSIVE_DISPOSE__?.());
  expect(
    await page.evaluate(() => window.__PERMISSIVE_TEST__.disposed),
  ).toBe(true);
});
