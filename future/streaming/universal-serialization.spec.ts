/**
 * M10 items 2, 3 and 6 — the universal value codec and its reference plugins.
 *
 * A `Serialization` layer backed by seroval's `toJSON`/`fromJSON` **tree** form,
 * under two hard constraints:
 *   - eval-string output mode is prohibited by default — the manifest stays
 *     inert JSON per the security rules;
 *   - the manifest records the serializer identity, so a client configured with
 *     a different codec rejects the payload instead of misdecoding it (the same
 *     discipline as the build-ID gate).
 *
 * Plus the reference plugins: framework-managed values serialize as
 * *references* (state by hydration key, `Portable.BoundCode` as a descriptor,
 * reactivity keys by canonical key, `SafeHtml` under its branding rules), while
 * live resources stay non-serializable.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { unbuilt } from "../harness.js";
import { StreamBuildId, resumeKit, srcModule } from "./support.js";

describe("universal value codec (M10.2)", () => {
  it("[M10.2] round-trips cycles, Map/Set/Date and typed arrays as a JSON tree", async () => {
    const Serialization = await srcModule("Serialization");
    if (Serialization.serovalLayer === undefined) {
      unbuilt("Serialization.serovalLayer (seroval JSON-tree codec)", "M10 item 2");
    }

    const value: Record<string, unknown> = {
      when: new Date(0),
      map: new Map<string, unknown>([["k", 1]]),
      set: new Set([1, 2]),
      re: /ab+c/g,
      bytes: new Uint8Array([1, 2, 3]),
    };
    value.self = value;

    const wire = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec: any) =>
        codec.serialize(Schema.Unknown, value),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        string,
        any,
        never
      >,
    );

    // Inert data only: no eval payload, and HTML-safe for `<script>` embedding.
    expect(wire).not.toContain("</script");
    expect(wire).not.toMatch(/\bfunction\b|=>/);
    expect(() => JSON.parse(wire)).not.toThrow();

    const back: any = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec: any) =>
        codec.deserialize(Schema.Unknown, wire),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        any,
        any,
        never
      >,
    );

    expect(back.when instanceof Date).toBe(true);
    expect(back.when.getTime()).toBe(0);
    expect(back.map.get("k")).toBe(1);
    expect(back.set.has(2)).toBe(true);
    expect(back.re.source).toBe("ab+c");
    expect(back.bytes instanceof Uint8Array).toBe(true);
    expect([...back.bytes]).toEqual([1, 2, 3]);
    // The cycle is restored as a cycle, not as a duplicated subtree.
    expect(back.self).toBe(back);
  });

  it("[M10.2] refuses eval output mode unless an adapter opts in explicitly", async () => {
    const Serialization = await srcModule("Serialization");
    if (Serialization.serovalLayer === undefined || Serialization.seroval === undefined) {
      unbuilt(
        "Serialization.seroval({ mode }) (configurable seroval codec)",
        "M10 item 2",
      );
    }

    // Asking for eval mode through the default construction path fails closed.
    expect(() => Serialization.seroval({ mode: "eval" })).toThrow(/eval/i);
    // Ratified DQ-012: the opt-in exists but is a different, explicitly-named
    // door — `serovalUnsafeEval`, whose CSP cost is documented at the export
    // site. The name carries the warning; a `{ unsafe: true }` flag would not.
    const unsafe = Serialization.serovalUnsafeEval;
    if (unsafe === undefined) {
      unbuilt(
        "Serialization.serovalUnsafeEval (documented CSP-unsafe opt-in)",
        "M10 item 2",
      );
    }
    expect(unsafe).not.toBe(Serialization.serovalLayer);
    // Identity discriminates the two, so a manifest produced under the eval
    // codec cannot be decoded by the safe one by accident (DQ-012's gate).
    const idOf = (layer: unknown) =>
      Effect.runPromise(
        Effect.map(Serialization.Tag, (codec: any) => codec.id).pipe(
          Effect.provide(layer as any),
        ) as Effect.Effect<any, never, never>,
      );
    expect(await idOf(unsafe)).not.toBe(await idOf(Serialization.serovalLayer));
  });

  it("[M10.2] gates the serializer identity like the build id", async () => {
    // Ratified DQ-012 (`RESUMABILITY_IMPLEMENTATION_PLAN.md` §Ratified
    // DQ-005–DQ-012): serializer identity is a property of the **layer**, via
    // `readonly id: string` on `SerializationService`. The client's own id is
    // then simply the id of the layer it provided — no new mechanism, and no
    // heuristic derivation (an unreliable identity is worse than none, because
    // it produces false rejections that look like data corruption).
    const { Resume, Serialization, dom } = await resumeKit();
    if (Serialization.serovalLayer === undefined) {
      unbuilt("Serialization.serovalLayer (seroval JSON-tree codec)", "M10 item 2");
    }

    const idOf = (layer: unknown) =>
      Effect.runPromise(
        Effect.map(Serialization.Tag, (codec: any) => codec.id).pipe(
          Effect.provide(layer as any),
        ) as Effect.Effect<any, never, never>,
      );
    const serovalId = await idOf(Serialization.serovalLayer);
    const defaultId = await idOf(Serialization.layer);

    // Both layers name themselves, and the names discriminate — an id that was
    // absent, or shared between codecs, would make the gate below vacuous.
    expect(typeof serovalId).toBe("string");
    expect(serovalId.length).toBeGreaterThan(0);
    expect(typeof defaultId).toBe("string");
    expect(defaultId).not.toBe(serovalId);

    const collected = await Effect.runPromise(
      Resume.collect(() => dom.renderToString(() => "inert"), {
        buildId: StreamBuildId,
      }).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );

    // Stamped beside `buildId`, and it names the codec that produced it.
    expect(collected.manifest.serializer).toBe(serovalId);
    expect(collected.manifest.buildId).toBe(StreamBuildId);

    // A client configured with the default schema codec rejects it *before*
    // decoding any value — misdecoding is worse than not decoding.
    let decodeAttempts = 0;
    const observing = Serialization.observing?.(Serialization.layer, () => {
      decodeAttempts += 1;
    }) ?? Serialization.layer;
    const failure = await Effect.runPromise(
      Resume.decodeManifest(collected.serializedManifest, StreamBuildId).pipe(
        Effect.flip,
        Effect.provide(observing),
      ) as Effect.Effect<any, never, never>,
    );
    expect(String(failure._tag)).toMatch(/Serializer|Mismatch/);
    // …and it is a *different* failure from a build mismatch, its nearest
    // neighbour, since both are gated in the same place.
    expect(String(failure._tag)).not.toMatch(/BuildId/);
    expect(decodeAttempts).toBe(0);

    // NEGATIVE CONTROL. The matching codec decodes the identical payload
    // cleanly, so "reject every manifest carrying a serializer stamp" cannot
    // satisfy the assertions above.
    const decoded = await Effect.runPromise(
      Resume.decodeManifest(collected.serializedManifest, StreamBuildId).pipe(
        Effect.provide(Serialization.serovalLayer),
      ) as Effect.Effect<any, never, never>,
    );
    expect(decoded.serializer).toBe(serovalId);
  });
});

describe("reference plugins for framework values (M10.3)", () => {
  it("[M10.3] serializes state handles by hydration key and restores a live handle", async () => {
    const Serialization = await srcModule("Serialization");
    if (Serialization.serovalLayer === undefined) {
      unbuilt("Serialization.serovalLayer + reference plugins", "M10 item 3");
    }
    const Component = await srcModule("Component");
    const Atom = await srcModule("Atom");

    const atom = Atom.make(1).pipe?.(Atom.keepAlive) ?? Atom.make(1);
    const wire = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec: any) =>
        codec.serialize(Schema.Unknown, { handle: atom }),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        string,
        any,
        never
      >,
    );

    // A reference, not a structural copy: the atom's internals never hit the
    // wire, only its hydration identity.
    expect(wire).not.toContain("subscribers");
    expect(wire).toMatch(/hydration|key/i);

    const back: any = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec: any) =>
        codec.deserialize(Schema.Unknown, wire),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        any,
        any,
        never
      >,
    );
    // Restored as something live and writable, addressed by the same key.
    expect(typeof back.handle).not.toBe("string");
    // `Component.isStateHandle?.(...) ?? true` used to stand here, which passes
    // whenever the predicate does not exist — i.e. exactly when the guarantee
    // is missing. If the predicate is what proves restoration, its absence is a
    // reason to fail, not to default to `true`.
    if (Component.isStateHandle === undefined) {
      unbuilt(
        "Component.isStateHandle — the predicate that distinguishes a restored "
          + "live state handle from a look-alike object",
        "M10 item 3",
      );
    }
    expect(Component.isStateHandle(back.handle)).toBe(true);
    // Negative control on the predicate itself: it must not answer `true` for
    // the wire form the reference plugin replaced.
    expect(Component.isStateHandle("state:key")).toBe(false);
  });

  it("[M10.3] serializes portable code as a descriptor and SafeHtml under its branding", async () => {
    const Serialization = await srcModule("Serialization");
    if (Serialization.serovalLayer === undefined) {
      unbuilt("Serialization.serovalLayer + reference plugins", "M10 item 3");
    }
    const Portable = await srcModule("Portable");
    const SafeHtml = await srcModule("SafeHtml");

    const code = Portable.code({
      id: "future.m10.reference.code",
      buildId: StreamBuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures: any) => Effect.succeed(captures.label),
    });
    const bound = Portable.bind(code, { label: "ref" });
    // SPEC CORRECTION (2026-08-11): the branded constructor is
    // `SafeHtml.make` (it has existed all along); the invented
    // `unsafeFromString` fell back to a bare string, which no codec could
    // legitimately re-brand — the assertion below was unsatisfiable.
    const safe = SafeHtml.make("<b>ok</b>");

    const wire = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec: any) =>
        codec.serialize(Schema.Unknown, { bound, safe }),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        string,
        any,
        never
      >,
    );

    // The bound code arrives as its descriptor — id + buildId + captures —
    // which is what makes it resolvable rather than merely inspectable.
    expect(wire).toContain(code.id);
    expect(wire).toContain(StreamBuildId);
    expect(wire).not.toMatch(/=>|\bfunction\b/);

    const back: any = await Effect.runPromise(
      Effect.flatMap(Serialization.Tag, (codec: any) =>
        codec.deserialize(Schema.Unknown, wire),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        any,
        any,
        never
      >,
    );
    const resolved: any = await Effect.runPromise(
      Portable.resolve(back.bound).pipe(
        Effect.provide(Portable.resolverLayer({ [code.id]: code })),
      ) as any,
    );
    expect(await Effect.runPromise(resolved.run() as any)).toBe("ref");
    // SafeHtml keeps its branding across the boundary — it does not decay to a
    // bare string that later gets escaped or, worse, trusted by accident.
    expect(SafeHtml.isSafeHtml?.(back.safe) ?? false).toBe(true);
  });

  it("[M10.3] refuses to serialize live resources", async () => {
    const Serialization = await srcModule("Serialization");
    if (Serialization.serovalLayer === undefined) {
      unbuilt("Serialization.serovalLayer + reference plugins", "M10 item 3");
    }
    const { Scope } = await import("effect");

    // Scope, Fiber, Layer, service instances and DOM nodes are not values.
    // Service access crosses the boundary as a typed `R` requirement instead.
    const scope = Scope.makeUnsafe();
    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Serialization.Tag, (codec: any) =>
          codec.serialize(Schema.Unknown, { scope }),
        ),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    expect(exit._tag).toBe("Failure");

    // NEGATIVE CONTROL. An ordinary value goes through the same codec cleanly,
    // so "refuse everything" cannot satisfy the assertion above.
    const ok = await Effect.runPromise(
      Effect.exit(
        Effect.flatMap(Serialization.Tag, (codec: any) =>
          codec.serialize(Schema.Unknown, { plain: [1, "two"] }),
        ),
      ).pipe(Effect.provide(Serialization.serovalLayer)) as Effect.Effect<
        any,
        never,
        never
      >,
    );
    expect(ok._tag).toBe("Success");
  });
});

describe("async captures (M10.6)", () => {
  it("[M10.6] promise/stream captures wait on async SSR", async () => {
    // Unconditionally unbuilt: the trailing
    // `expect(Serialization.serovalAsyncLayer).toBeDefined()` would have turned
    // this spec green the day the export appeared, while asserting nothing
    // about the claim in its name. When it lands, the claim to assert is that a
    // captured promise resolves on the client exactly once, and that an
    // in-flight Effect is still refused.
    unbuilt(
      "Serialization.serovalAsyncLayer (seroval async forms) — deliberately "
        + "deferred until async/streaming SSR lands; no serialization of "
        + "in-flight Effects before then",
      "M10 item 6, blocked on M11 item 2",
    );
  });
});
