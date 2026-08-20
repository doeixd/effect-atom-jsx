/**
 * S6 (`docs/PERMISSIVE_PACKAGE_PLAN.md`) — the strict-mode byte-unaffected
 * proof.
 *
 * The claim being pinned: an app that never opts into the permissive preset
 * pays zero bytes for it. The precise form matters — rollup EMITS a seroval
 * chunk on disk for every build (the codec's lazy `import("seroval")` sits
 * inside the public `Serialization` module), so "no chunk on disk" would be
 * the wrong assertion. Byte-unaffected means the strict page never FETCHES
 * it: the dynamic import only executes when a seroval layer is constructed.
 *
 * The exact boundary, measured: the framework's `serialization-seroval`
 * module (serializer-id constants, layer constructors — needed for the
 * DQ-012 identity gate) rides in the core bundle and costs a few hundred
 * bytes; the seroval LIBRARY is what the lazy import defers, and its text
 * ("Seroval caught an error", its own error prefix) must never appear in
 * anything a strict page fetches. The permissive demo is the positive
 * control proving the scan detects that text.
 */

import { expect, test, type Page } from "@playwright/test";
import type { PermissiveDemoBrowserState } from "../examples/permissive-demo/shared/browser-state.js";
import type {} from "../examples/resumable-extract/shared/browser-state.js";

declare global {
  interface Window {
    __PERMISSIVE_TEST__: PermissiveDemoBrowserState;
  }
}

const SEROVAL_LIBRARY_MARKER = /Seroval caught an error/;

function watchScripts(page: Page): { bodies: Map<string, string> } {
  const bodies = new Map<string, string>();
  page.on("response", async (response) => {
    const url = response.url();
    if (/\.js(\?|$)/.test(url)) {
      try {
        bodies.set(url, (await response.body()).toString("utf8"));
      } catch {
        // Response bodies of cancelled requests are unavailable; a page that
        // cancelled the fetch did not execute it either.
      }
    }
  });
  return { bodies };
}

test("a strict-mode page resumes and interacts without fetching a byte of seroval", async ({
  page,
}) => {
  const watched = watchScripts(page);

  // The extract example: default codec, compiler-extracted action, real
  // interaction so lazy handler chunks load too.
  await page.goto("http://127.0.0.1:4178/");
  await expect
    .poll(() => page.evaluate(() => window.__EXTRACT_TEST__?.ready ?? false))
    .toBe(true);
  await page.getByTestId("extract-note").click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__EXTRACT_TEST__?.notes.length ?? 0)
    )
    .toBeGreaterThan(0);

  expect(watched.bodies.size).toBeGreaterThan(0);
  for (const [url, body] of watched.bodies) {
    expect(SEROVAL_LIBRARY_MARKER.test(body), url).toBe(false);
  }
});

test("the permissive page DOES fetch seroval — the positive control for the scan", async ({
  page,
}) => {
  const watched = watchScripts(page);

  await page.goto("http://127.0.0.1:4179/");
  await expect
    .poll(() => page.evaluate(() => window.__PERMISSIVE_TEST__?.ready ?? false))
    .toBe(true);

  const hit = [...watched.bodies.entries()].find(([, body]) =>
    SEROVAL_LIBRARY_MARKER.test(body)
  );
  expect(hit, "the permissive page must load the codec").toBeDefined();
});
