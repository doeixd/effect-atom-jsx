/**
 * M10.2/M10.3 — the universal value codec and its reference plugins. Typed
 * unit coverage for the six green specs in
 * `future/streaming/universal-serialization.spec.ts`; that file stays in
 * `future/` because its seventh spec (M10.6 async captures) is deliberately
 * unbuilt until its real assertions are authored.
 *
 * Ratified `DQ-012`: eval output is prohibited by default (the opt-in is the
 * separately NAMED `serovalUnsafeEval`); every layer names itself
 * (`SerializationService.id`); the manifest stamps the id beside `buildId`
 * and `decodeManifest` gates it BEFORE any value decodes. Framework values
 * serialize as references (state handles by hydration key, `BoundCode` as
 * its resolvable descriptor, `SafeHtml` under its branding); live resources
 * are refused.
 */
import { Effect, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as SafeHtml from "../SafeHtml.js";
import * as Serialization from "../Serialization.js";
import { renderToString } from "../dom.js";

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
