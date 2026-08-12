/**
 * S3 (`docs/PERMISSIVE_PACKAGE_PLAN.md`) — the `permissive()` preset.
 *
 * Everything here goes through public subpaths (enforced by
 * `spi-consumer.test.ts`): the preset must be constructible and useful by an
 * app that has never seen the core's source tree.
 */

import { Effect, Schema } from "effect";
import * as Serialization from "effect-atom-jsx/Serialization";
import { describe, expect, it } from "vitest";
import { permissive } from "../index.js";
import { spiVersion } from "../index.js";

describe("permissive()", () => {
  it("returns the wired pieces: vite plugin, both codec layers, spiVersion", () => {
    const preset = permissive({ buildId: "permissive-test-build" });

    expect(preset.spiVersion).toBe(spiVersion);
    expect(preset.vitePlugins).toHaveLength(1);
    expect(preset.vitePlugins[0]?.name).toBe("af-ui-resume-extract");
    // The pairing is explicit and identical: the manifest's serializer stamp
    // (DQ-012) means a client on a different codec fails closed, so shipping
    // different layers on the two fields would be a footgun, not flexibility.
    expect(preset.serverLayer).toBe(preset.clientLayer);
  });

  it("requires a buildId — the compiler plugin refuses to run unstamped", () => {
    expect(() => permissive({ buildId: "" })).toThrowError(/buildId/);
  });

  it("round-trips a rich capture (Map) through the preset's layers", async () => {
    const preset = permissive({ buildId: "permissive-test-build" });
    const roundTripped = await Effect.runPromise(
      Effect.gen(function* () {
        const serialization = yield* Serialization.Tag;
        // The async seroval codec is the point of permissive mode: the id is
        // the async one, and a Map survives the wire as a Map.
        expect(serialization.id).toBe(Serialization.serovalAsyncSerializerId);
        const wire = yield* serialization.serialize(
          Schema.Unknown,
          new Map([["answer", 42]]),
        );
        // Not silently JSON: a plain-JSON codec would have dropped the Map.
        expect(wire).not.toContain('{"answer":42}');
        return yield* serialization.deserialize(Schema.Unknown, wire);
      }).pipe(Effect.provide(preset.serverLayer)),
    );
    expect(roundTripped).toBeInstanceOf(Map);
    expect(roundTripped).toEqual(new Map([["answer", 42]]));
  });

  it("awaits an in-flight Promise capture once, server-side", async () => {
    const preset = permissive({ buildId: "permissive-test-build" });
    const restored = await Effect.runPromise(
      Effect.gen(function* () {
        const serialization = yield* Serialization.Tag;
        const wire = yield* serialization.serialize(
          Schema.Unknown,
          { pending: Promise.resolve("settled-on-the-server") },
        );
        return yield* serialization.deserialize(Schema.Unknown, wire);
      }).pipe(Effect.provide(preset.serverLayer)),
    );
    const value = restored as { readonly pending: Promise<string> };
    await expect(value.pending).resolves.toBe("settled-on-the-server");
  });
});
