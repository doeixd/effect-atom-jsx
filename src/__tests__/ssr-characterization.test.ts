/**
 * Milestone 0 characterization tests.
 *
 * These pin the *observed* SSR lifecycle, nested-render/exception semantics,
 * and resume fallback behavior of the current implementation. They are
 * deliberately written as sequence assertions (push to a log, compare the whole
 * array) so that a future change to ordering or to execution counts fails
 * loudly rather than silently passing a final-state check.
 *
 * Do not "fix" a failure here by relaxing an assertion. Either the change was
 * intended — in which case update the pinned sequence and
 * `docs/RESUMABILITY_SSR_CONTRACT.md` together — or it is a regression.
 */
import { Effect, Exit, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Route from "../Route.js";
import * as Serialization from "../Serialization.js";
import { onCleanup } from "../api.js";
import {
  addEventListener,
  getRequestEvent,
  renderToString,
  template,
  type RuntimeEventHandler,
} from "../dom.js";

const TestBuildId = "ssr-characterization-build";

const NoopCode = Portable.code({
  id: "test.ssr-characterization.noop",
  buildId: TestBuildId,
  captures: Schema.Struct({ label: Schema.String }),
  run: () => Effect.void,
});

function collect(
  render: () => string,
  options: Partial<Resume.CollectOptions> = {},
) {
  return Effect.runSync(
    Resume.collect(render, { buildId: TestBuildId, ...options }).pipe(
      Effect.provide(Serialization.layer),
    ),
  );
}

function makeButton(handler: RuntimeEventHandler): Element {
  const button = template("<button>Save")();
  addEventListener(button, "click", handler, true);
  return button;
}

describe("SSR lifecycle order (Milestone 0, item 3)", () => {
  it("runs setup, commits bindings, executes the view, attaches events, serializes, then disposes the root", () => {
    const log: Array<string> = [];

    const Card = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>()
        .pipe(
          Component.doEffect(() =>
            Effect.sync(() => {
              log.push("setup:step-1");
            }),
          ),
        )
        .pipe(
          Component.value("label", () => {
            log.push("setup:step-2");
            return "Save";
          }),
        ),
      (_props, bindings) => {
        log.push(`view:enter label=${String(bindings.label)}`);
        onCleanup(() => log.push("root:dispose"));
        const button = template("<button>Save")();
        addEventListener(button, "click", () => log.push("handler:invoked"));
        log.push("event:attached");
        const node = button as unknown as { toHTML: () => string };
        const originalToHTML = node.toHTML;
        node.toHTML = () => {
          log.push("serialize");
          return originalToHTML.call(node);
        };
        log.push("view:exit");
        return button;
      },
    );

    const html = renderToString(() =>
      Effect.runSync(Component.renderEffect(Card, {})),
    );

    expect(html).toBe("<button>Save</button>");
    // The full, ordered SSR lifecycle. Note in particular:
    //  - bindings are fully committed before the view is entered;
    //  - the view runs to completion before anything is serialized;
    //  - serialization happens *before* the reactive root is disposed;
    //  - handlers are registered but never invoked during SSR.
    expect(log).toEqual([
      "setup:step-1",
      "setup:step-2",
      "view:enter label=Save",
      "event:attached",
      "view:exit",
      "serialize",
      "root:dispose",
    ]);
  });

  it("runs each setup step and the view exactly once per render", () => {
    let setups = 0;
    let views = 0;
    const Card = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().pipe(
        Component.doEffect(() =>
          Effect.sync(() => {
            setups += 1;
          }),
        ),
      ),
      () => {
        views += 1;
        return "x";
      },
    );

    renderToString(() => Effect.runSync(Component.renderEffect(Card, {})));

    expect(setups).toBe(1);
    expect(views).toBe(1);
  });

  it("does not provide an ambient Effect Scope to component setup", () => {
    // Characterization, not endorsement: `renderToString` runs the render
    // effect on a fresh `Effect.runSync` fiber with no Scope in context, so
    // `Effect.serviceOption(Scope.Scope)` is `None` unless the caller provides
    // one explicitly (as the resume query tests do).
    let observed: string | undefined;
    const Card = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.gen(function* () {
          const scope = yield* Effect.serviceOption(Scope.Scope);
          observed = scope._tag;
          return {};
        }),
      () => "x",
    );

    renderToString(() => Effect.runSync(Component.renderEffect(Card, {})));

    expect(observed).toBe("None");
  });

  it("closes a caller-provided Scope only when the caller closes it, after serialization and root disposal", () => {
    const log: Array<string> = [];
    const scope = Scope.makeUnsafe();

    const Card = Component.make(
      Component.props<{}>(),
      Component.require<Scope.Scope>(),
      () =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => log.push("scope:finalizer")),
          );
          log.push("setup");
          return {};
        }),
      () => {
        onCleanup(() => log.push("root:dispose"));
        log.push("view");
        return "x";
      },
    );

    const html = renderToString(() =>
      Effect.runSync(
        Component.renderEffect(Card, {}).pipe(Scope.provide(scope)),
      ),
    );
    log.push(`serialized:${html}`);
    Effect.runSync(Scope.close(scope, Exit.void));

    expect(log).toEqual([
      "setup",
      "view",
      "root:dispose",
      "serialized:x",
      "scope:finalizer",
    ]);
  });

  it("orders Route.renderRequest as request context, setup, view, restore", () => {
    const log: Array<string> = [];
    const App = Route.path("/characterize")(
      Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        () =>
          Effect.sync(() => {
            log.push(
              `setup:request=${getRequestEvent() === undefined ? "absent" : "present"}`,
            );
            return {};
          }),
        () => {
          log.push("view");
          return "hi";
        },
      ),
    );

    const before = getRequestEvent();
    const result = Effect.runSync(
      Route.renderRequest(App, {
        request: new Request("http://example.com/characterize"),
      }),
    );
    log.push(
      `after:request=${getRequestEvent() === before ? "restored" : "leaked"}`,
    );

    expect(result.html).toBe("hi");
    expect(result.status).toBe(200);
    expect(log).toEqual([
      "setup:request=present",
      "view",
      "after:request=restored",
    ]);
  });
});

describe("Nested renders, exceptions, and request context (Milestone 0, item 4)", () => {
  it("nests renderToString and restores the outer server document afterwards", () => {
    const log: Array<string> = [];
    let innerHtml = "";

    const outerHtml = renderToString(() => {
      log.push("outer:enter");
      const outerDocument = globalThis.document;
      innerHtml = renderToString(() => {
        log.push("inner:enter");
        onCleanup(() => log.push("inner:dispose"));
        log.push("inner:exit");
        return "inner";
      });
      log.push(
        `outer:document=${globalThis.document === outerDocument ? "restored" : "clobbered"}`,
      );
      onCleanup(() => log.push("outer:dispose"));
      log.push("outer:exit");
      return `outer(${innerHtml})`;
    });

    expect(innerHtml).toBe("inner");
    expect(outerHtml).toBe("outer(inner)");
    // The inner render completes and disposes its own root before the outer
    // render finishes; the outer render's server document is *not* the inner
    // one, so nesting is safe but each render owns a distinct virtual document.
    expect(log).toEqual([
      "outer:enter",
      "inner:enter",
      "inner:exit",
      "inner:dispose",
      "outer:document=restored",
      "outer:exit",
      "outer:dispose",
    ]);
  });

  it("propagates a setup failure as a defect and still disposes and restores", () => {
    const globals = globalThis as Record<string, unknown>;
    const hadDocument = Object.prototype.hasOwnProperty.call(
      globals,
      "document",
    );
    const log: Array<string> = [];

    const Failing = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.sync(() => {
          log.push("setup");
          throw new Error("setup exploded");
        }),
      () => {
        log.push("view");
        return "unreachable";
      },
    );

    expect(() =>
      renderToString(() => {
        onCleanup(() => log.push("root:dispose"));
        return Effect.runSync(Component.renderEffect(Failing, {}));
      }),
    ).toThrow(/setup exploded/);

    // The view never runs, the root is still disposed, and the ambient
    // document is restored even on the throwing path.
    expect(log).toEqual(["setup", "root:dispose"]);
    expect(Object.prototype.hasOwnProperty.call(globals, "document")).toBe(
      hadDocument,
    );
  });

  it("propagates a view exception and still disposes and restores", () => {
    const globals = globalThis as Record<string, unknown>;
    const hadDocument = Object.prototype.hasOwnProperty.call(
      globals,
      "document",
    );
    const hadNode = Object.prototype.hasOwnProperty.call(globals, "Node");
    const log: Array<string> = [];

    const Failing = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () =>
        Effect.sync(() => {
          log.push("setup");
          return {};
        }),
      () => {
        log.push("view");
        throw new Error("view exploded");
      },
    );

    expect(() =>
      renderToString(() => {
        onCleanup(() => log.push("root:dispose"));
        return Effect.runSync(Component.renderEffect(Failing, {}));
      }),
    ).toThrow(/view exploded/);

    expect(log).toEqual(["setup", "view", "root:dispose"]);
    expect(Object.prototype.hasOwnProperty.call(globals, "document")).toBe(
      hadDocument,
    );
    expect(Object.prototype.hasOwnProperty.call(globals, "Node")).toBe(hadNode);
  });

  it("restores the previous request event when a nested render throws", () => {
    const before = getRequestEvent();

    expect(() =>
      renderToString(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(getRequestEvent()).toBe(before);
  });

  it("keeps concurrent-in-sequence renderRequest calls independent", () => {
    const App = (label: string) =>
      Route.path("/r")(Component.from<{}>(() => label));

    const first = Effect.runSync(
      Route.renderRequest(App("first"), {
        request: new Request("http://example.com/r"),
      }),
    );
    const second = Effect.runSync(
      Route.renderRequest(App("second"), {
        request: new Request("http://example.com/r"),
      }),
    );

    expect([first.html, second.html]).toEqual(["first", "second"]);
    expect(getRequestEvent()).toBeUndefined();
  });
});

describe("Resume fallback contract (Milestone 0, item 5)", () => {
  it("emits no manifest entry but does diagnose opaque setup", () => {
    // CHANGED DELIBERATELY (M9 hardening). This test used to pin
    // `diagnostics == []` and describe opaque setup as "a *silent* fall back
    // to activation". That silence was the defect this characterization pass
    // found, not a contract worth keeping: opaque setup was the only fallback
    // case that announced nothing, so "why is my component not resumable?"
    // could not be answered from the diagnostics alone. It now emits
    // `opaque-component-setup`, consistent with `opaque-event-handler` and
    // `opaque-query-executor`. The manifest half of the contract — v1, no
    // component snapshot — is unchanged and still pinned below.
    const Card = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.succeed({ label: "Save" }),
      (_props, bindings) => String(bindings.label),
    ).pipe(Component.withDefinition({ name: "OpaqueSetupCard" }));

    expect(Component.inspect(Card).definition.setupPlan.kind).toBe("opaque");

    const result = collect(() =>
      renderToString(() => Effect.runSync(Component.renderEffect(Card, {}))),
    );

    expect(result.html).toBe("Save");
    expect(result.manifest.version).toBe(1);
    expect(result.diagnostics).toEqual([
      {
        code: "opaque-component-setup",
        phase: "collect",
        severity: "warning",
        disposition: "fallback-required",
        reason:
          'Component "OpaqueSetupCard" has opaque setup, contributes no resume snapshot, and requires fallback activation.',
      },
    ]);
    expect((result.manifest as { components?: unknown }).components).toBe(
      undefined,
    );
  });

  it("diagnoses an opaque event handler and emits unmarked HTML", () => {
    const opaque = Effect.runSync(Component.action(() => Effect.void));
    const result = collect(() => renderToString(() => makeButton(opaque)));

    // The button still renders and still carries no resume marker: the client
    // must hydrate/activate it the ordinary way.
    expect(result.html).toBe("<button>Save</button>");
    expect(result.manifest.events).toEqual({});
    expect(result.diagnostics).toMatchObject([
      { code: "opaque-event-handler", eventType: "click", element: "button" },
    ]);
  });

  it("marks a portable handler and keeps SSR bytes clean when no collector is active", () => {
    const action = Effect.runSync(
      Component.action(Portable.bind(NoopCode, { label: "Save" })),
    );

    const collected = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );
    const plain = renderToString(() => makeButton(Resume.event(action)));

    expect(collected.html).toBe(
      '<button data-af-event-click="e0">Save</button>',
    );
    expect(collected.diagnostics).toEqual([]);
    // Without an active collector the resume path is byte-invisible.
    expect(plain).toBe("<button>Save</button>");
  });

  it("fails a build-mismatched manifest closed at decode time", () => {
    const action = Effect.runSync(
      Component.action(Portable.bind(NoopCode, { label: "Save" })),
    );
    const result = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );

    const ok = Effect.runSync(
      Resume.decodeManifest(result.serializedManifest, TestBuildId).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
    const mismatch = Effect.runSync(
      Resume.decodeManifest(result.serializedManifest, "other-build").pipe(
        Effect.flip,
        Effect.provide(Serialization.layer),
      ),
    );

    expect(ok.buildId).toBe(TestBuildId);
    expect(mismatch._tag).toBe("ResumeClientBuildMismatchError");
  });

  it("accepts an unknown code ID at decode time and defers resolution to the client", () => {
    const action = Effect.runSync(
      Component.action(Portable.bind(NoopCode, { label: "Save" })),
    );
    const result = collect(() =>
      renderToString(() => makeButton(Resume.event(action))),
    );
    const tampered = JSON.parse(result.serializedManifest) as {
      events: Record<string, { code: { id: string } }>;
    };
    tampered.events.e0!.code.id = "test.ssr-characterization.does-not-exist";

    const decoded = Effect.runSync(
      Resume.decodeManifest(JSON.stringify(tampered), TestBuildId).pipe(
        Effect.provide(Serialization.layer),
      ),
    );
    const entry = Object.values(decoded.events)[0]!;

    // Observed: decode validates *shape*, not resolvability. An unknown code
    // ID sails through `decodeManifest` and only surfaces on the client as a
    // `dispatch-resolution-failure` diagnostic when the event actually fires
    // (pinned in `resume.test.ts` >
    // "reports resolution failures without leaving failed fibers unobserved").
    // The page keeps working; that one interaction is lost.
    expect(entry.invocation).toBe("deferred-no-args");
    if (entry.invocation !== "deferred-no-args") throw new Error("unreachable");
    expect(entry.code.id).toBe("test.ssr-characterization.does-not-exist");
  });
});
