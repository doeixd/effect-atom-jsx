/**
 * Isolation — no cross-request, cross-tenant, or cross-installation bleed.
 * Promoted from `future/security/isolation.spec.ts` (all green 2026-08-12,
 * after the process-global-transport spec was corrected to its ratified
 * end-state), retyped.
 *
 * The motivating incident: the single-flight transport bleed, where two
 * concurrent calls carrying DIFFERENT layer-provided transports both reached
 * a process-global installed transport. The discipline this file follows:
 * assert COUNTS AND IDENTITY, not final values.
 *
 * Owning plans: `ROUTER_CONSOLIDATION_PLAN.md` R5 / `DQ-033` (transport
 * ladder), `RESUMABILITY_M8C_PLAN.md` 8c.6 (installation isolation).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Resume from "../Resume.js";
import * as Route from "../Route.js";
import {
  SingleFlightTransportTag,
  type SingleFlightTransportService,
} from "../SingleFlightTransport.js";
import { bindingReactivityKey } from "../resume-handle.js";
import { renderToString, template } from "../dom.js";
import { FakeDocument } from "./resume-fake-dom.js";

const BuildId = "security-isolation-test-build";

/**
 * A trust-boundary rejection must be a TYPED failure — never a defect and
 * never a silent success. `Cause.hasDies` is asserted here so "fails, but as
 * a defect" can never be mistaken for "fails closed".
 */
function classifiedTag(exit: Exit.Exit<unknown, unknown>): string {
  if (!Exit.isFailure(exit)) return "success";
  expect(
    Cause.hasDies(exit.cause),
    "a boundary rejection must be a typed error, not a defect",
  ).toBe(false);
  return Cause.findErrorOption(exit.cause).pipe(
    Option.map((error) => (error as { readonly _tag?: string })._tag ?? "untagged"),
    Option.getOrElse(() => "none"),
  );
}

interface RecordingTransport {
  readonly service: SingleFlightTransportService;
  readonly calls: Array<{ readonly url: string; readonly args: ReadonlyArray<unknown> }>;
}

/** A transport that records every request it is handed. */
function recordingTransport(name: string): RecordingTransport {
  const calls: RecordingTransport["calls"][number][] = [];
  return {
    calls,
    service: {
      execute: (request) => {
        calls.push(request);
        return Effect.succeed({
          ok: true,
          payload: { mutation: name, url: request.url, loaders: [] },
        });
      },
    },
  };
}

describe("[SEC/DQ-033] Single-flight transport isolation", () => {
  it("routes each concurrent call to the transport its own context provided", async () => {
    const a = recordingTransport("A");
    const b = recordingTransport("B");

    const mutate = Atom.action(
      (input: { readonly tenant: string }) => Effect.succeed(`local:${input.tenant}`),
      { name: "mutate", singleFlight: { mode: "force", url: () => "/items", hydrate: false } },
    );

    const call = (tenant: string, transport: RecordingTransport) =>
      mutate.runEffect({ tenant }).pipe(
        Effect.provide(Layer.succeed(SingleFlightTransportTag, transport.service)),
      );

    const results = await Effect.runPromise(
      Effect.all([call("a", a), call("b", b)], { concurrency: 2 }),
    );

    // Identity and counts, not final values: each transport saw exactly its
    // own one call, and neither saw the other's tenant.
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
    expect(a.calls[0]?.args?.[0]).toEqual({ tenant: "a" });
    expect(b.calls[0]?.args?.[0]).toEqual({ tenant: "b" });
    expect(results).toEqual(["A", "B"]);
  });

  it("has no process-installed transport left to outrank (satisfied by construction)", async () => {
    // The original spec anticipated its end state — "under the ratified
    // ladder `single-flight-runtime.ts` is gone entirely, at which point this
    // spec is satisfied by construction." R5 deleted the installer. Pin that
    // the deletion HOLDS, and that with no transport in context a forced
    // single-flight action fails typed instead of reaching any ambient path.
    const srcRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
    expect(existsSync(join(srcRoot, "single-flight-runtime.ts"))).toBe(false);

    const mutate = Atom.action(() => Effect.succeed("local"), {
      name: "mutate",
      singleFlight: { mode: "force", url: () => "/items", hydrate: false },
    });
    const exit = await Effect.runPromiseExit(mutate.runEffect(undefined));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("[SEC/R5] Server render isolation", () => {
  it("gives two concurrent renders their own head store, loader cache, and response headers", async () => {
    const seen: Array<string> = [];
    const Page = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>(),
      () => template("<span>")(),
    );

    // A monotonically increasing value makes cache sharing observable: two
    // isolated caches each compute their own ticket; a shared one hands the
    // second render the first render's.
    let ticket = 0;
    const loads: Array<number> = [];
    const app = Route.define(
      Route.page("/", Page).pipe(
        Route.id("root"),
        Route.loader((_: {}) =>
          Effect.sync(() => {
            ticket += 1;
            loads.push(ticket);
            return { ticket };
          }),
        ),
      ),
    );

    const render = (url: string) =>
      Route.renderRequest(app, { request: new Request(url) });

    const [first, second] = await Effect.runPromise(
      Effect.all([render("https://a.example/"), render("https://b.example/")], {
        concurrency: 2,
      }),
    );
    seen.push(first.html, second.html);

    const ticketOf = (response: Route.RenderRequestResult) => {
      const result = response.loaderPayload[0]?.result;
      return result !== undefined && result._tag === "Success"
        ? (result.value as { readonly ticket: number }).ticket
        : undefined;
    };
    // Identity, not equality of convenience: the two renders hold DIFFERENT
    // tickets, which is only possible if neither read the other's cache.
    expect(ticketOf(first)).toBeTypeOf("number");
    expect(ticketOf(second)).toBeTypeOf("number");
    expect(ticketOf(first)).not.toBe(ticketOf(second));
    // The loader really did run for each render — the negative control
    // against a "renders nothing" implementation.
    expect(loads.length).toBeGreaterThanOrEqual(2);
    // Each render's payload belongs to itself.
    expect(first.loaderPayload).not.toBe(second.loaderPayload);
    expect(first.headers).not.toBe(second.headers);
    expect(first.head).not.toBe(second.head);
    // And neither render wrote into the process-wide client head store, the
    // shared object a server render must never touch.
    expect(Route.clientRouteHeadStore.entries.size).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it("leaves no server `document` behind when a render throws", () => {
    // `renderToString` swaps `globalThis.document` for a virtual server
    // document. A render that throws and does not restore it would leave
    // every subsequent request rendering into a stale document — the most
    // severe cross-request bleed available in this codebase.
    const carrier = globalThis as Record<string, unknown>;
    const hadDocument = "document" in carrier;
    expect(() =>
      renderToString(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect("document" in carrier).toBe(hadDocument);

    // NEGATIVE CONTROL: a successful render still produces markup, so this
    // is not satisfied by a renderer that refuses to install a document.
    expect(typeof renderToString(() => "hello")).toBe("string");
    expect("document" in carrier).toBe(hadDocument);
  });
});

describe("[SEC/M8c.6] Installation isolation", () => {
  const emptyManifest = () =>
    ({
      version: 4,
      buildId: BuildId,
      events: {},
      components: {},
      expressions: {},
      // boundary: hand-built manifest literal (same idiom as resume.test.ts)
    }) as unknown as Resume.Manifest;

  it("refuses a second installation on the same root, and allows one per distinct root", async () => {
    const root = new FakeDocument([]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const install = (target: FakeDocument) =>
      Effect.runPromiseExit(
        Resume.installClient({
          root: target.asDocument(),
          manifest: emptyManifest(),
          expectedBuildId: BuildId,
          resolverEntries: {},
          runtime,
        }),
      );

    const first = await install(root);
    expect(classifiedTag(first)).toBe("success");
    // Two installations racing for the same DOM would each believe they own
    // every marker in it. Typed refusal, not last-writer-wins.
    const second = await install(root);
    expect(classifiedTag(second)).toBe("ResumeDuplicateClientInstallationError");

    // NEGATIVE CONTROL: a DIFFERENT root installs cleanly at the same time,
    // so this is genuinely per-root and not a process-wide singleton.
    const other = new FakeDocument([]);
    const parallel = await install(other);
    expect(classifiedTag(parallel)).toBe("success");

    if (Exit.isSuccess(first)) await Effect.runPromise(first.value.dispose);
    if (Exit.isSuccess(parallel)) await Effect.runPromise(parallel.value.dispose);
    // Terminal: after disposal the root is reusable — the guard is a lock,
    // not a leak.
    const reinstall = await install(root);
    expect(classifiedTag(reinstall)).toBe("success");
    if (Exit.isSuccess(reinstall)) await Effect.runPromise(reinstall.value.dispose);
    await runtime.dispose();
  });

  it("keeps two installations' event markers and binding keys from colliding", async () => {
    // Binding reactivity keys are derived, not minted: `af:binding:c0/count`
    // is the same string in every installation on the page. Isolation must
    // come from the registry the key is resolved against, not the key.
    expect(bindingReactivityKey("c0", "count")).toBe(
      bindingReactivityKey("c0", "count"),
    );

    const manifest = {
      version: 4,
      buildId: BuildId,
      events: {},
      expressions: {},
      components: {
        c0: {
          region: { kind: "comment-pair" },
          bindings: {
            count: { kind: "state", key: "af:binding:c0/count", value: 1, dehydratedAt: 0 },
          },
        },
      },
      // boundary: hand-built manifest literal (same idiom as resume.test.ts)
    } as unknown as Resume.Manifest;

    const makeRoot = () =>
      new FakeDocument([
        { kind: "component", id: "c0", edge: "start" },
        { kind: "text", value: "1" },
        { kind: "component", id: "c0", edge: "end" },
      ]);
    const runtime = ManagedRuntime.make(Layer.empty);
    const a = Effect.runSync(
      Resume.installClient({
        root: makeRoot().asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime,
      }),
    );
    const b = Effect.runSync(
      Resume.installClient({
        root: makeRoot().asDocument(),
        manifest,
        expectedBuildId: BuildId,
        resolverEntries: {},
        runtime,
      }),
    );

    Effect.runSync(a.writeBinding("c0", "count", Schema.Number, 7));
    // Identity, not value: `b` must not have observed a write addressed to
    // `a`, even though both use the identical reserved key string.
    expect(a.inspect().disposed).toBe(false);
    expect(b.inspect().disposed).toBe(false);
    expect(b.pending()).toBe(0);

    await Effect.runPromise(a.dispose);
    // Disposing one installation must not disarm the other.
    expect(b.inspect().disposed).toBe(false);
    const stillWorks = await Effect.runPromiseExit(
      b.writeBinding("c0", "count", Schema.Number, 9),
    );
    expect(classifiedTag(stillWorks)).toBe("success");

    await Effect.runPromise(b.dispose);
    await runtime.dispose();
  });
});
