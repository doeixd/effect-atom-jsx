/**
 * M10.2/M10.3/M10.6 — the universal value codec, its reference plugins, and
 * the async forms. Promoted from
 * `future/streaming/universal-serialization.spec.ts` (all green 2026-08-12).
 *
 * Ratified `DQ-012`: eval output is prohibited by default (the opt-in is the
 * separately NAMED `serovalUnsafeEval`); every layer names itself
 * (`SerializationService.id`); the manifest stamps the id beside `buildId`
 * and `decodeManifest` gates it BEFORE any value decodes. Framework values
 * serialize as references (state handles by hydration key, `BoundCode` as
 * its resolvable descriptor, `SafeHtml` under its branding); live resources
 * are refused.
 */
import { Context, Effect, Layer, ManagedRuntime, Schema, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as SafeHtml from "../SafeHtml.js";
import * as Serialization from "../Serialization.js";
import { addEventListener, renderToString, template } from "../dom.js";
import { asDocument, elementWith, fakeDocument } from "./streaming-fake-dom.js";

const TestBuildId = "universal-serialization-test-build";

const serialize = (value: unknown) =>
  Effect.runPromise(
    Effect.flatMap(Serialization.Tag, (codec) =>
      codec.serialize(Schema.Unknown, value)
    ).pipe(Effect.provide(Serialization.serovalLayer)),
  );

const deserialize = (wire: string) =>
  Effect.runPromise(
    Effect.flatMap(Serialization.Tag, (codec) =>
      codec.deserialize(Schema.Unknown, wire)
    ).pipe(Effect.provide(Serialization.serovalLayer)),
  );

const idOf = (layer: typeof Serialization.layer) =>
  Effect.runPromise(
    Effect.map(Serialization.Tag, (codec) => codec.id).pipe(
      Effect.provide(layer),
    ),
  );

describe("universal value codec (M10.2)", () => {
  it("round-trips cycles, Map/Set/Date and typed arrays as a JSON tree", async () => {
    const value: Record<string, unknown> = {
      when: new Date(0),
      map: new Map<string, unknown>([["k", 1]]),
      set: new Set([1, 2]),
      re: /ab+c/g,
      bytes: new Uint8Array([1, 2, 3]),
    };
    value["self"] = value;

    const wire = await serialize(value);
    // Inert data only: no eval payload, HTML-safe for <script> embedding.
    expect(wire).not.toContain("</script");
    expect(wire).not.toMatch(/\bfunction\b|=>/);
    expect(() => JSON.parse(wire)).not.toThrow();

    const back = (await deserialize(wire)) as {
      readonly when: Date;
      readonly map: Map<string, unknown>;
      readonly set: Set<number>;
      readonly re: RegExp;
      readonly bytes: Uint8Array;
      readonly self: unknown;
    };
    expect(back.when instanceof Date).toBe(true);
    expect(back.when.getTime()).toBe(0);
    expect(back.map.get("k")).toBe(1);
    expect(back.set.has(2)).toBe(true);
    expect(back.re.source).toBe("ab+c");
    expect([...back.bytes]).toEqual([1, 2, 3]);
    // The cycle is restored as a cycle, not a duplicated subtree.
    expect(back.self).toBe(back);
  });

  it("refuses eval output mode unless an adapter opts in explicitly", async () => {
    // Asking for eval mode through the default construction path fails
    // closed; the opt-in is a different, explicitly named door whose name
    // carries the warning (DQ-012).
    expect(() => Serialization.seroval({ mode: "eval" })).toThrow(/eval/i);
    expect(Serialization.serovalUnsafeEval).not.toBe(Serialization.serovalLayer);
    // Identity discriminates the two, so a manifest produced under the eval
    // codec can never be decoded by the safe one by accident.
    expect(await idOf(Serialization.serovalUnsafeEval)).not.toBe(
      await idOf(Serialization.serovalLayer),
    );
  });

  it("gates the serializer identity like the build id", async () => {
    const serovalId = await idOf(Serialization.serovalLayer);
    const defaultId = await idOf(Serialization.layer);
    expect(serovalId.length).toBeGreaterThan(0);
    expect(defaultId).not.toBe(serovalId);

    const collected = await Effect.runPromise(
      Resume.collect(() => renderToString(() => "inert"), {
        buildId: TestBuildId,
      }).pipe(Effect.provide(Serialization.serovalLayer)),
    );

    // Stamped beside buildId, naming the codec that produced it.
    expect(collected.manifest.serializer).toBe(serovalId);
    expect(collected.manifest.buildId).toBe(TestBuildId);

    // A client configured with the default schema codec rejects it before
    // decoding any value — misdecoding is worse than not decoding — and the
    // failure is DISTINCT from a build mismatch, its nearest neighbour.
    const failure = await Effect.runPromise(
      Resume.decodeManifest(collected.serializedManifest, TestBuildId).pipe(
        Effect.flip,
        Effect.provide(Serialization.layer),
      ),
    );
    expect(failure._tag).toBe("ResumeSerializerMismatchError");

    // NEGATIVE CONTROL: the matching codec decodes the identical payload.
    const decoded = await Effect.runPromise(
      Resume.decodeManifest(collected.serializedManifest, TestBuildId).pipe(
        Effect.provide(Serialization.serovalLayer),
      ),
    );
    expect(decoded.serializer).toBe(serovalId);
  });
});

describe("rich captures through a REAL manifest round trip (M10.1+M10.2 integration)", () => {
  // Promotion-expansion (2026-08-12): the envelope path and the manifest path
  // were only tested separately — the codec specs serialize loose values and
  // the capture specs call describe/resolve directly. This walks the actual
  // product path: collect a page whose EVENT captures a Map under the seroval
  // layer, decode the manifest, install, dispatch — and pins the fail-closed
  // half (a client runtime WITHOUT the codec refuses to misdecode instead of
  // running with garbage).
  it("dispatches an event whose captures rode the codec envelope, and fails closed without it", async () => {
    interface RichRecorder {
      readonly record: (labels: ReadonlyArray<string>) => Effect.Effect<void>;
    }
    const Recorder = Context.Service<RichRecorder>(
      "effect-atom-jsx/test/RichCaptureRecorder",
    );
    const code = Portable.code<
      { readonly tags: unknown },
      { readonly tags: unknown },
      readonly [],
      void,
      never,
      RichRecorder
    >({
      id: "test.m10.rich-capture.save",
      buildId: TestBuildId,
      captures: Schema.Struct({ tags: Schema.Unknown }),
      run: (captures) =>
        Effect.gen(function* () {
          const recorder = yield* Recorder;
          // The capture must arrive as a LIVE Map, not a JSON-shaped copy.
          const tags = captures.tags;
          if (!(tags instanceof Map)) {
            return yield* Effect.die("captures.tags did not survive as a Map");
          }
          yield* recorder.record([...tags.keys()].sort());
        }),
    });

    const action = Effect.runSync(
      Component.action(
        Portable.bind(code, { tags: new Map([["a", 1], ["b", 2]]) }),
      ).pipe(
        Effect.provideService(Recorder, {
          record: () => Effect.die("the server must never run the action"),
        }),
      ),
    );
    const collected = await Effect.runPromise(
      Resume.collect(
        () =>
          renderToString(() => {
            const button = template("<button>Rich")();
            addEventListener(button, "click", Resume.event(action), true);
            return button;
          }),
        { buildId: TestBuildId, installationId: "page0" },
      ).pipe(Effect.provide(Serialization.serovalLayer)),
    );

    // The manifest entry carries the codec envelope, not a mangled Map.
    expect(collected.serializedManifest).toContain("$afCapturesCodec");

    const manifest = await Effect.runPromise(
      Resume.decodeManifest(collected.serializedManifest, TestBuildId).pipe(
        Effect.provide(Serialization.serovalLayer),
      ),
    );

    // FAIL-CLOSED HALF: a client runtime without the codec layer must refuse
    // to resolve the captures (a dispatch-resolution diagnostic), never run
    // the action with misdecoded data.
    const bareCalls: Array<ReadonlyArray<string>> = [];
    const bareRuntime = ManagedRuntime.make(
      Layer.succeed(Recorder, {
        record: (labels) =>
          Effect.sync(() => {
            bareCalls.push(labels);
          }),
      }),
    );
    const bareDiagnostics: Resume.ClientDiagnostic[] = [];
    const doc = fakeDocument([
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "page0:e0" },
      },
    ]);
    const bareInstallation = await Effect.runPromise(
      Resume.installClient({
        root: asDocument(doc),
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [code.id]: code },
        runtime: bareRuntime,
        onDiagnostic: (diagnostic) => bareDiagnostics.push(diagnostic),
      }),
    );
    doc.dispatch("click", elementWith(doc, "data-af-event-click"));
    await vi.waitFor(() => {
      expect(bareInstallation.pending()).toBe(0);
    });
    expect(bareCalls).toEqual([]);
    expect(
      bareDiagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("dispatch-resolution-failure");
    // M9 item 3: "missing codec" is machine-classified, not buried in prose —
    // the diagnostic names the typed refusal an adapter can switch on.
    expect(
      bareDiagnostics.find(
        (diagnostic) => diagnostic.code === "dispatch-resolution-failure",
      )?.errorTag,
    ).toBe("PortableCaptureDecodeError");
    await Effect.runPromise(bareInstallation.dispose);
    await bareRuntime.dispose();

    // HAPPY HALF: the same install with the codec in the client runtime's
    // layer dispatches, and the Map is live inside the handler.
    const calls: Array<ReadonlyArray<string>> = [];
    const runtime = ManagedRuntime.make(
      Layer.merge(
        Layer.succeed(Recorder, {
          record: (labels) =>
            Effect.sync(() => {
              calls.push(labels);
            }),
        }),
        Serialization.serovalLayer,
      ),
    );
    const doc2 = fakeDocument([
      {
        kind: "element",
        tag: "button",
        attributes: { "data-af-event-click": "page0:e0" },
      },
    ]);
    const installation = await Effect.runPromise(
      Resume.installClient({
        root: asDocument(doc2),
        manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [code.id]: code },
        runtime,
      }),
    );
    doc2.dispatch("click", elementWith(doc2, "data-af-event-click"));
    await vi.waitFor(() => {
      expect(calls).toEqual([["a", "b"]]);
    });
    await Effect.runPromise(installation.dispose);
    await runtime.dispose();
  });
});

describe("reference plugins for framework values (M10.3)", () => {
  it("serializes state handles by hydration key and restores a live handle", async () => {
    const atom = Atom.make(1);
    const wire = await serialize({ handle: atom });

    // A reference, not a structural copy: internals never hit the wire, only
    // the hydration identity.
    expect(wire).not.toContain("subscribers");
    expect(wire).toMatch(/hydration|key/i);

    const back = (await deserialize(wire)) as { readonly handle: unknown };
    // Restored as something live, addressed by the same key: the predicate
    // distinguishes a real handle from a look-alike, and never answers true
    // for the wire form the reference plugin replaced.
    expect(Component.isStateHandle(back.handle)).toBe(true);
    expect(back.handle).toBe(atom);
    expect(Component.isStateHandle("state:key")).toBe(false);
  });

  it("resolves state-handle keys through a pluggable resolver (S4, cross-process restore)", async () => {
    // Server side: an app-owned resolver mints a stable, deployment-known key
    // instead of the process-local ordinal.
    const serverAtom = Atom.make(10);
    const serverLayer = Serialization.seroval({
      stateHandles: {
        keyOf: (handle) => (handle === serverAtom ? "app:counter" : undefined),
      },
    });
    const wire = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec) =>
        codec.serialize(Schema.Unknown, { handle: serverAtom })
      ).pipe(Effect.provide(serverLayer)),
    );
    expect(wire).toContain("app:counter");

    // "Client" side: a DIFFERENT live handle registered under the same key.
    // The process-local registry knows nothing about "app:counter", so a
    // resolve hit here proves the pluggable path, not the fallback.
    const clientAtom = Atom.make(0);
    const clientLayer = Serialization.seroval({
      stateHandles: {
        resolve: (key) => (key === "app:counter" ? clientAtom : undefined),
      },
    });
    const restored = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec) =>
        codec.deserialize(Schema.Unknown, wire)
      ).pipe(Effect.provide(clientLayer)),
    ) as { readonly handle: unknown };
    expect(restored.handle).toBe(clientAtom);

    // A partial resolver falls back to the reference registry, so in-process
    // round-trips keep working…
    const untracked = Atom.make(2);
    const partialWire = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec) =>
        codec.serialize(Schema.Unknown, { handle: untracked })
      ).pipe(Effect.provide(serverLayer)),
    );
    expect(partialWire).not.toContain("app:counter");
    const partialBack = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec) =>
        codec.deserialize(Schema.Unknown, partialWire)
      ).pipe(Effect.provide(serverLayer)),
    ) as { readonly handle: unknown };
    expect(partialBack.handle).toBe(untracked);

    // …and a key neither side knows still fails closed, never a fabricated
    // handle.
    const unknownExit = await Effect.runPromiseExit(
      Effect.flatMap(Serialization.Tag, (codec) =>
        codec.deserialize(
          Schema.Unknown,
          wire.replace("app:counter", "app:nobody"),
        )
      ).pipe(Effect.provide(clientLayer)),
    );
    expect(unknownExit._tag).toBe("Failure");
  });

  it("serializes portable code as a descriptor and SafeHtml under its branding", async () => {
    const code = Portable.code({
      id: "test.m10.reference.code",
      buildId: TestBuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) => Effect.succeed(captures.label),
    });
    const bound = Portable.bind(code, { label: "ref" });
    const safe = SafeHtml.make("<b>ok</b>");

    const wire = await serialize({ bound, safe });
    // The bound code arrives as its descriptor — id + buildId + captures —
    // which is what makes it resolvable rather than merely inspectable.
    expect(wire).toContain(code.id);
    expect(wire).toContain(TestBuildId);
    expect(wire).not.toMatch(/=>|\bfunction\b/);

    const back = (await deserialize(wire)) as {
      readonly bound: Portable.Descriptor;
      readonly safe: unknown;
    };
    const resolved = await Effect.runPromise(
      Portable.resolve<readonly [], unknown, unknown, never>(back.bound as Portable.Descriptor<readonly [], unknown, unknown, never>).pipe(
        Effect.provide(Portable.resolverLayer({ [code.id]: code })),
      ),
    );
    expect(await Effect.runPromise(resolved.run())).toBe("ref");
    // Branding survives the boundary: neither a bare string that later gets
    // escaped, nor one that gets trusted by accident.
    expect(SafeHtml.isSafeHtml(back.safe)).toBe(true);
  });

  it("refuses to serialize live resources", async () => {
    // Scope, Fiber, Layer, services and DOM nodes are not values; service
    // access crosses the boundary as a typed R requirement instead.
    const scope = Scope.makeUnsafe();
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Serialization.Tag, (codec) =>
          codec.serialize(Schema.Unknown, { scope })
        ).pipe(Effect.provide(Serialization.serovalLayer)),
      ),
    );
    expect(exit._tag).toBe("Failure");

    // NEGATIVE CONTROL: an ordinary value goes through the same codec.
    const ok = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Serialization.Tag, (codec) =>
          codec.serialize(Schema.Unknown, { plain: [1, "two"] })
        ).pipe(Effect.provide(Serialization.serovalLayer)),
      ),
    );
    expect(ok._tag).toBe("Success");
  });
});

describe("async captures (M10.6)", () => {
  it("a captured promise resolves on the client exactly once, and an in-flight Effect is still refused", async () => {
    let settlements = 0;
    const wire = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec) =>
        codec.serialize(Schema.Unknown, {
          eventual: Promise.resolve("later").then((value) => {
            settlements += 1;
            return value;
          }),
        })
      ).pipe(Effect.provide(Serialization.serovalAsyncLayer)),
    );
    // Awaited ON THE SERVER, exactly once, into inert JSON.
    expect(settlements).toBe(1);
    expect(() => JSON.parse(wire)).not.toThrow();
    expect(wire).not.toMatch(/function|=>/);

    const back = (await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec) =>
        codec.deserialize(Schema.Unknown, wire)
      ).pipe(Effect.provide(Serialization.serovalAsyncLayer)),
    )) as { readonly eventual: Promise<string> };
    // Restored as a LIVE promise with stable identity: awaiting twice is one
    // resolution observed twice, never a re-execution.
    expect(back.eventual instanceof Promise).toBe(true);
    expect(back.eventual).toBe(back.eventual);
    expect(await back.eventual).toBe("later");
    expect(await back.eventual).toBe("later");
    expect(settlements).toBe(1);

    // An in-flight Effect is still refused: an Effect is a computation with
    // requirements, not a settleable value — same guard as the sync codec.
    const refused = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Serialization.Tag, (codec) =>
          codec.serialize(Schema.Unknown, { work: Effect.succeed(1) })
        ).pipe(Effect.provide(Serialization.serovalAsyncLayer)),
      ),
    );
    expect(refused._tag).toBe("Failure");

    // Identity discriminates the async codec from the sync one (DQ-012), so
    // a promise-bearing payload can never be misdecoded by the sync layer.
    expect(await idOf(Serialization.serovalAsyncLayer)).not.toBe(
      await idOf(Serialization.serovalLayer),
    );
  });
});
