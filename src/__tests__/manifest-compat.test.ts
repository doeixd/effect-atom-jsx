/**
 * manifest-compat.test.ts — cross-version resume manifest wire contracts.
 *
 * Every string literal in this file is a FROZEN WIRE FIXTURE: a byte-for-byte
 * serialized resume manifest that some already-deployed build could have
 * embedded in its HTML. A client running a newer library version must still be
 * able to decode it.
 *
 * THESE FIXTURES ARE CONTRACTS, NOT TEST DATA.
 *
 * - Never edit a fixture to make a failing test pass. A fixture that stops
 *   decoding means the manifest schema changed incompatibly, and the fix is a
 *   new manifest version (plus a new fixture below), never a rewrite of an old
 *   one.
 * - Never regenerate a fixture from `Resume.collect`. The whole point is that
 *   these strings are independent of the current schema-built shapes, so schema
 *   drift that silently breaks old payloads shows up here.
 * - Adding a manifest version means adding a fixture and leaving all the
 *   earlier ones untouched.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";

/**
 * The build identity baked into every fixture below. Fixtures are pinned to
 * this value, so it must never change either.
 */
const FixtureBuildId = "resume-test-build";

// ─── Frozen wire fixtures ───────────────────────────────────────────────────

/** v1: events-only, one deferred-no-args portable event. */
const MANIFEST_V1 =
  '{"version":1,"buildId":"resume-test-build","events":{"e0":{"type":"click","invocation":"deferred-no-args","code":{"version":1,"kind":"portable.code","id":"test.resume.save","buildId":"resume-test-build","captures":{"label":"Save"}}}}}';

/** v1: events-only, one activation-projection event. */
const MANIFEST_V1_ACTIVATION =
  '{"version":1,"buildId":"resume-test-build","events":{"e0":{"type":"click","invocation":"activation-projection","projection":"mouse-v1","targetKey":"save"}}}';

/**
 * v2: one component region with a state binding, a settled query binding, and
 * an activation descriptor.
 */
const MANIFEST_V2 =
  '{"version":2,"buildId":"resume-test-build","events":{"e0":{"type":"click","invocation":"deferred-no-args","code":{"version":1,"kind":"portable.code","id":"test.resume.save","buildId":"resume-test-build","captures":{"label":"Save"}}}},"components":{"c0":{"definitionName":"Counter","region":{"kind":"comment-pair"},"activation":{"version":1,"kind":"portable.code","id":"test.resume.counter","buildId":"resume-test-build","captures":{"start":1}},"bindings":{"count":{"kind":"state","key":"count","value":3,"dehydratedAt":1700000000000},"items":{"kind":"query","key":"items","value":["a","b"],"dehydratedAt":1700000000000,"executor":{"version":1,"kind":"portable.code","id":"test.resume.items","buildId":"resume-test-build","captures":{}},"reactivityKeys":["items"]}}}}}';

/** v3: expression entries keyed by comment-pair region. */
const MANIFEST_V3 =
  '{"version":3,"buildId":"resume-test-build","events":{},"components":{"c0":{"region":{"kind":"comment-pair"},"bindings":{"count":{"kind":"state","key":"count","value":0,"dehydratedAt":1700000000000}}}},"expressions":{"x0":{"region":{"kind":"comment-pair"},"code":{"version":1,"kind":"portable.code","id":"test.resume.label","buildId":"resume-test-build","captures":{}},"deps":["binding:c0:count"],"inputs":["count"],"component":"c0"}}}';

/** v4 (newest): expression entries keyed by explicit target. */
const MANIFEST_V4 =
  '{"version":4,"buildId":"resume-test-build","events":{"e0":{"type":"click","invocation":"deferred-no-args","code":{"version":1,"kind":"portable.code","id":"test.resume.save","buildId":"resume-test-build","captures":{"label":"Save"}}}},"components":{"c0":{"definitionName":"Counter","region":{"kind":"comment-pair"},"bindings":{"count":{"kind":"state","key":"count","value":0,"dehydratedAt":1700000000000}}}},"expressions":{"x0":{"target":{"kind":"text"},"code":{"version":1,"kind":"portable.code","id":"test.resume.label","buildId":"resume-test-build","captures":{}},"deps":["binding:c0:count"],"inputs":["count"],"component":"c0"},"x1":{"target":{"kind":"attribute","name":"aria-label"},"code":{"version":1,"kind":"portable.code","id":"test.resume.aria","buildId":"resume-test-build","captures":{}},"deps":["binding:c0:count"]},"x2":{"target":{"kind":"style-property","name":"--af-progress"},"code":{"version":1,"kind":"portable.code","id":"test.resume.progress","buildId":"resume-test-build","captures":{}},"deps":[]},"x3":{"target":{"kind":"class"},"code":{"version":1,"kind":"portable.code","id":"test.resume.class","buildId":"resume-test-build","captures":{}},"deps":[]}}}';

/**
 * A manifest claiming a version this library does not know. Kept alongside the
 * real fixtures because "an old client meets a new payload" must fail closed
 * with a decode error rather than crash or partially install.
 */
const MANIFEST_FUTURE_VERSION =
  '{"version":99,"buildId":"resume-test-build","events":{},"components":{},"expressions":{},"regions":{}}';

const fixtures = [
  ["v1 portable event", MANIFEST_V1, 1],
  ["v1 activation event", MANIFEST_V1_ACTIVATION, 1],
  ["v2 component bindings", MANIFEST_V2, 2],
  ["v3 region expressions", MANIFEST_V3, 3],
  ["v4 target expressions", MANIFEST_V4, 4],
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function decode(
  serialized: string,
  buildId: string = FixtureBuildId,
  options: Parameters<typeof Resume.decodeManifest>[2] = {},
) {
  return Effect.runSync(
    Resume.decodeManifest(serialized, buildId, options).pipe(
      Effect.provide(Serialization.layer),
    ),
  );
}

function decodeFailure(
  serialized: string,
  buildId: string = FixtureBuildId,
  options: Parameters<typeof Resume.decodeManifest>[2] = {},
) {
  return Effect.runSync(
    Resume.decodeManifest(serialized, buildId, options).pipe(
      Effect.flip,
      Effect.provide(Serialization.layer),
    ),
  );
}

function reserialize(manifest: Resume.Manifest): string {
  return Effect.runSync(
    Effect.gen(function* () {
      const serialization = yield* Serialization.Tag;
      return yield* serialization.serialize(Resume.ManifestSchema, manifest);
    }).pipe(Effect.provide(Serialization.layer)),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("resume manifest cross-version compatibility", () => {
  it.each(fixtures)(
    "decodes the frozen %s fixture",
    (_name, serialized, version) => {
      const manifest = decode(serialized);

      expect(manifest.version).toBe(version);
      expect(manifest.buildId).toBe(FixtureBuildId);
      expect(Object.isFrozen(manifest)).toBe(true);
    },
  );

  it("preserves the v1 portable event entry", () => {
    const manifest = decode(MANIFEST_V1);
    const entry = manifest.events["e0" as Resume.EventId];

    expect(entry?.invocation).toBe("deferred-no-args");
    if (entry?.invocation === "deferred-no-args") {
      expect(entry.type).toBe("click");
      expect(entry.code.id).toBe("test.resume.save");
      expect(entry.code.captures).toEqual({ label: "Save" });
    }
  });

  it("preserves v2 component state, query, and activation snapshots", () => {
    const manifest = decode(MANIFEST_V2);
    expect(manifest.version).toBe(2);
    if (manifest.version !== 2) return;

    const component = manifest.components["c0" as Resume.ComponentId];
    expect(component?.definitionName).toBe("Counter");
    expect(component?.region.kind).toBe("comment-pair");
    expect(component?.activation?.id).toBe("test.resume.counter");

    const state = component?.bindings["count" as Resume.BindingName];
    expect(state?.kind).toBe("state");
    if (state?.kind === "state") expect(state.value).toBe(3);

    const query = component?.bindings["items" as Resume.BindingName];
    expect(query?.kind).toBe("query");
    if (query?.kind === "query") {
      expect(query.value).toEqual(["a", "b"]);
      expect(query.executor.id).toBe("test.resume.items");
      expect(query.reactivityKeys).toEqual(["items"]);
    }
  });

  it("still accepts v3 region-keyed expression entries", () => {
    const manifest = decode(MANIFEST_V3);
    expect(manifest.version).toBe(3);
    if (manifest.version !== 3) return;

    const entry = manifest.expressions["x0" as Resume.ExpressionId];
    expect(entry?.region.kind).toBe("comment-pair");
    expect(entry?.deps).toEqual(["binding:c0:count"]);
    expect(entry?.inputs).toEqual(["count"]);
    expect(entry?.component).toBe("c0");
  });

  it("decodes every v4 expression target kind", () => {
    const manifest = decode(MANIFEST_V4);
    expect(manifest.version).toBe(4);
    if (manifest.version !== 4) return;

    const targets = Object.values(manifest.expressions).map(
      (entry) => entry.target,
    );
    expect(targets).toEqual([
      { kind: "text" },
      { kind: "attribute", name: "aria-label" },
      { kind: "style-property", name: "--af-progress" },
      { kind: "class" },
    ]);
  });

  it.each(fixtures)(
    "round-trips the frozen %s fixture without wire drift",
    (_name, serialized) => {
      const roundTripped = reserialize(decode(serialized));

      expect(JSON.parse(roundTripped)).toEqual(JSON.parse(serialized));
    },
  );

  it.each(fixtures)(
    "fails closed on a build mismatch for the %s fixture",
    (_name, serialized) => {
      const failure = decodeFailure(serialized, "some-other-build");

      expect(failure._tag).toBe("ResumeClientBuildMismatchError");
    },
  );

  it("fails closed on an unknown future manifest version", () => {
    const failure = decodeFailure(MANIFEST_FUTURE_VERSION);

    expect(failure._tag).toBe("ResumeManifestDecodeError");
  });

  it("fails closed on a structurally invalid manifest", () => {
    // Right shape of JSON, wrong protocol structure: `events` is an array.
    const failure = decodeFailure(
      '{"version":1,"buildId":"resume-test-build","events":[]}',
    );

    expect(failure._tag).toBe("ResumeManifestDecodeError");
  });

  it("fails closed on syntactically malformed manifest JSON", () => {
    // `Serialization.deserialize` parses inside `Effect.try`, mapping a syntax
    // error to a `Schema.SchemaError`, so `decodeManifest` converts it to a
    // typed `ResumeManifestDecodeError` rather than dying with a defect.
    const failure = decodeFailure('{"version":1,"buildId":');

    expect(failure._tag).toBe("ResumeManifestDecodeError");
  });

  it.each(fixtures)(
    "enforces the byte ceiling for the %s fixture",
    (_name, serialized) => {
      const bytes = new TextEncoder().encode(serialized).byteLength;

      expect(
        decodeFailure(serialized, FixtureBuildId, {
          maxPayloadBytes: bytes - 1,
        })._tag,
      ).toBe("ResumePayloadTooLargeError");
      expect(
        decode(serialized, FixtureBuildId, { maxPayloadBytes: bytes }).version,
      ).toBe(JSON.parse(serialized).version);
      expect(
        decodeFailure(serialized, FixtureBuildId, { maxPayloadBytes: 0 })._tag,
      ).toBe("ResumeConfigurationError");
    },
  );
});
