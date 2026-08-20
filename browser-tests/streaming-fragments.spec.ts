/**
 * Chromium proof for the streaming install lane (M11.5/M11.6) and the
 * fragment door (M11b items 1-3, item 5's acceptance): a page whose streamed
 * output — placeholder regions, out-of-order swap scripts, per-region record
 * scripts, region-scoped markers — installs through
 * `Resume.installClientStreamed` in a real browser, next to a statically
 * collected host area that receives an out-of-band fragment through
 * `Resume.mountFragment`.
 */
import { expect, test } from "@playwright/test";

test("streamed page installs from record scripts and resumes on first touch", async ({ page }) => {
  await page.goto("/streaming.html");
  await page.waitForFunction(() => window.__STREAM_TEST__?.ready === true);

  // The out-of-order swap already ran as the document parsed: the slow
  // region's content is in the DOM, not stuck in a template.
  await expect(page.locator("#stream-root")).toContainText(
    "streamed-region-content",
  );

  // The streamed shell button resumes on first touch through the record
  // scripts — no component code, no hydration pass.
  await page.getByTestId("stream-save").click();
  await page.waitForFunction(
    () => window.__STREAM_TEST__.saves.includes("stream-save"),
  );

  // Exact-once per interaction, still live afterwards.
  await page.getByTestId("stream-save").click();
  await page.waitForFunction(
    () =>
      window.__STREAM_TEST__.saves.filter((save) => save === "stream-save")
        .length === 2,
  );

  const diagnostics = await page.evaluate(
    () => window.__STREAM_TEST__.diagnostics,
  );
  expect(diagnostics).toEqual([]);
});

test("an out-of-band fragment mounts into a live page and resumes, page untouched", async ({ page }) => {
  await page.goto("/streaming.html");
  await page.waitForFunction(() => window.__STREAM_TEST__?.ready === true);

  // The fragment's button was injected between the slot's region markers and
  // resumes through the HOST installation's dispatch (zero extra listeners).
  await page.getByTestId("fragment-save").click();
  await page.waitForFunction(
    () => window.__STREAM_TEST__.saves.includes("fragment-save"),
  );

  // The host page's own button still works — fragment ids (both are `e0`)
  // cannot collide with the page's under DQ-015 scoping.
  await page.getByTestId("page-save").click();
  await page.waitForFunction(
    () => window.__STREAM_TEST__.saves.includes("page-save"),
  );

  // Remounting the region replaces the fragment and disposes the previous
  // handle exactly once; the replacement resumes as the original did.
  await page.evaluate(() => window.__STREAM_REMOUNT__?.());
  expect(
    await page.evaluate(() => window.__STREAM_TEST__.firstFragmentDisposed),
  ).toBe(true);
  await page.getByTestId("fragment-save").click();
  await page.waitForFunction(
    () =>
      window.__STREAM_TEST__.saves.filter((save) => save === "fragment-save")
        .length === 2,
  );

  const diagnostics = await page.evaluate(
    () => window.__STREAM_TEST__.diagnostics,
  );
  expect(diagnostics).toEqual([]);

  // Teardown leaves no listeners behind and nothing dispatches afterwards.
  await page.evaluate(() => window.__STREAM_END__?.());
  await page.getByTestId("fragment-save").click();
  await page.getByTestId("page-save").click();
  await page.waitForTimeout(100);
  const saves = await page.evaluate(() => window.__STREAM_TEST__.saves);
  expect(saves.filter((save) => save === "fragment-save")).toHaveLength(2);
  expect(saves.filter((save) => save === "page-save")).toHaveLength(1);
});

/** Mirrors `examples/resumable-action/shared/stream-state.ts`. */
interface StreamingBrowserState {
  saves: string[];
  diagnostics: unknown[];
  loaderCalls: number;
  ready: boolean;
  firstFragmentDisposed: boolean;
}

declare global {
  interface Window {
    __STREAM_TEST__: StreamingBrowserState;
    __STREAM_REMOUNT__?: () => Promise<void>;
    __STREAM_END__?: () => Promise<void>;
  }
}
