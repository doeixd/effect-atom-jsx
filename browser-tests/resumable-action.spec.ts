import { expect, test } from "@playwright/test";
import type { ResumableActionBrowserState } from "../examples/resumable-action/shared/browser-state.js";

test("loads only the portable action chunk and resumes without the component", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  let releaseAction!: () => void;
  const actionGate = new Promise<void>((resolve) => {
    releaseAction = resolve;
  });
  let actionRequests = 0;
  await page.route(/\/assets\/save-action-[^/]+\.js$/, async (route) => {
    actionRequests += 1;
    await actionGate;
    await route.continue();
  });

  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.ready))
    .toBe(true);

  const button = page.getByTestId("resumable-save");
  await expect(button).toBeVisible();
  expect(requests.some((url) => url.includes("save-action"))).toBe(false);
  expect(requests.some((url) => url.includes("save-button"))).toBe(false);

  await button.click();
  await button.click();
  await expect.poll(() => actionRequests).toBe(1);

  const whileLoading = await page.evaluate(() => window.__RESUME_TEST__);
  expect(whileLoading).toMatchObject({
    actionImports: 0,
    componentImports: 0,
    loaderCalls: 1,
    componentLoaderCalls: 0,
    setupRuns: 0,
    viewRuns: 0,
    saves: [],
    diagnostics: [],
  });

  releaseAction();
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.saves))
    .toEqual(["saved-from-browser", "saved-from-browser"]);

  const resumed = await page.evaluate(() => window.__RESUME_TEST__);
  expect(resumed).toMatchObject({
    actionImports: 1,
    componentImports: 0,
    loaderCalls: 1,
    componentLoaderCalls: 0,
    setupRuns: 0,
    viewRuns: 0,
    diagnostics: [],
  });

  await page.evaluate(() => window.__RESUME_DISPOSE__?.());
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.disposed))
    .toBe(true);
  await button.click();
  await page.waitForTimeout(25);
  expect(await page.evaluate(() => window.__RESUME_TEST__.saves)).toEqual([
    "saved-from-browser",
    "saved-from-browser",
  ]);
});

test("activates an addressable component into its SSR boundary exactly once", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.ready))
    .toBe(true);

  expect(await page.evaluate(() => window.__RESUME_TEST__)).toMatchObject({
    componentImports: 0,
    componentLoaderCalls: 0,
    setupRuns: 0,
    viewRuns: 0,
  });
  expect(
    await page.evaluate(() => window.__RESUME_BOUNDARY_STATE__?.()),
  ).toEqual({ status: "dormant" });

  await page.evaluate(() =>
    Promise.all([
      window.__RESUME_ACTIVATE__?.(),
      window.__RESUME_ACTIVATE__?.(),
    ]),
  );

  const committed = await page.evaluate(() => ({
    state: window.__RESUME_BOUNDARY_STATE__?.(),
    hasButton:
      document.querySelector('[data-testid="resumable-save"]') !== null,
    counters: window.__RESUME_TEST__,
  }));
  expect(committed).toMatchObject({
    state: { status: "active" },
    hasButton: true,
    counters: {
      componentImports: 1,
      componentLoaderCalls: 1,
      setupRuns: 1,
      viewRuns: 1,
      diagnostics: [],
    },
  });

  await page.evaluate(() => window.__RESUME_ACTIVATE__?.());
  expect(await page.evaluate(() => window.__RESUME_TEST__)).toMatchObject({
    componentImports: 1,
    componentLoaderCalls: 1,
    setupRuns: 1,
    viewRuns: 1,
  });

  await page.evaluate(() => window.__RESUME_DISPOSE__?.());
  expect(
    await page.evaluate(() => window.__RESUME_BOUNDARY_STATE__?.()),
  ).toEqual({ status: "disposed" });
});

test("falls back from incomplete boundary restoration to one activation", async ({
  page,
}) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.ready))
    .toBe(true);

  await page.evaluate(() =>
    Promise.all([
      window.__RESUME_RESUME__?.(),
      window.__RESUME_RESUME__?.(),
    ]),
  );

  const committed = await page.evaluate(() => ({
    state: window.__RESUME_BOUNDARY_STATE__?.(),
    counters: window.__RESUME_TEST__,
  }));
  expect(committed).toMatchObject({
    state: { status: "active" },
    counters: {
      componentImports: 1,
      componentLoaderCalls: 1,
      setupRuns: 1,
      viewRuns: 1,
      diagnostics: [
        {
          code: "component-resumption-fallback",
          componentId: "c0",
        },
      ],
    },
  });

  await page.evaluate(() => window.__RESUME_DISPOSE__?.());
});

test("hands a dormant interaction to activation exactly once", async ({
  page,
}) => {
  let releaseComponent!: () => void;
  const componentGate = new Promise<void>((resolve) => {
    releaseComponent = resolve;
  });
  let componentRequests = 0;
  await page.route(/\/assets\/save-button-[^/]+\.js$/, async (route) => {
    componentRequests += 1;
    await componentGate;
    await route.continue();
  });

  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.ready))
    .toBe(true);

  const button = page.getByTestId("activation-save");
  await button.click();
  await expect.poll(() => componentRequests).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_BOUNDARY_STATE__?.()))
    .toEqual({ status: "resuming" });

  expect(await page.evaluate(() => window.__RESUME_TEST__)).toMatchObject({
    componentImports: 0,
    componentLoaderCalls: 1,
    setupRuns: 0,
    viewRuns: 0,
    saves: [],
  });

  releaseComponent();
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.saves))
    .toEqual(["saved-from-browser"]);

  expect(await page.evaluate(() => window.__RESUME_TEST__)).toMatchObject({
    componentImports: 1,
    componentLoaderCalls: 1,
    setupRuns: 1,
    viewRuns: 1,
    componentResources: 1,
    componentDisposals: 0,
  });
  expect(
    await page.evaluate(() => window.__RESUME_BOUNDARY_STATE__?.()),
  ).toEqual({ status: "active" });

  await button.click();
  await expect
    .poll(() => page.evaluate(() => window.__RESUME_TEST__.saves))
    .toEqual(["saved-from-browser", "saved-from-browser"]);
  expect(componentRequests).toBe(1);

  await page.evaluate(() => window.__RESUME_DISPOSE__?.());
  await expect
    .poll(() =>
      page.evaluate(() => ({
        disposed: window.__RESUME_TEST__.disposed,
        componentDisposals: window.__RESUME_TEST__.componentDisposals,
      }))
    )
    .toEqual({ disposed: true, componentDisposals: 1 });
});

declare global {
  interface Window {
    __RESUME_TEST__: ResumableActionBrowserState;
    __RESUME_DISPOSE__?: () => Promise<void>;
    __RESUME_RESUME__?: (componentId?: string) => Promise<void>;
  }
}
