/**
 * Identity-family unification — `docs/DESIGN_IMPROVEMENT_NOTES.md` item 2.
 * Promoted from `future/result/identity-families.spec.ts` (all green
 * 2026-08-12), retyped.
 *
 * Four string identity families grew up independently: hydration keys,
 * reactivity keys, portable code ids, and query `cacheKey`. What these pin
 * (ratified `DQ-089`):
 *
 *  (a) the `af:` prefix is FORMALLY reserved, named by one exported
 *      predicate (`isReservedIdentityKey` / `ReservedIdentityPrefix`);
 *  (b) enforcement lives at the normalization choke point every authoring
 *      seam shares — and at witness construction, so hierarchical derivation
 *      cannot smuggle a reserved key in;
 *  (c) query `cacheKey` is an ALIAS of portable identity (a pure function of
 *      descriptor axes + canonical reactivity keys), and DERIVATION IS
 *      EXEMPT from the reservation: it constrains what an author may NAME,
 *      never what the library may COMPUTE.
 */
import { describe, expect, it } from "vitest";
import * as Portable from "../Portable.js";
import { Key } from "../Reactivity.js";
import {
  ReservedIdentityPrefix,
  isReservedIdentityKey,
  normalizeReactivityKeys,
  type ReactivityKeysInput,
} from "../reactivity-runtime.js";
import { isBindingReactivityKey } from "../resume-handle.js";

const RESERVED = ["af:", "af:binding:", "af:expr:", "af:component:"] as const;

/** A descriptor fixture; branded id/buildId make this a boundary literal. */
const descriptor = {
  version: 1,
  kind: "portable.code",
  id: "app/users.ts#loadUsers",
  buildId: "build-1",
  captures: { page: 1 },
  // boundary: hand-built descriptor literal (branded ids)
} as unknown as Portable.Descriptor;

describe("the `af:` prefix is reserved", () => {
  it("[DIN-2a] one exported predicate names the reserved namespace", () => {
    // The vocabulary must live in exactly one place, or every seam invents
    // its own subset — which is the bug `af:expr:` slipping through was.
    expect(ReservedIdentityPrefix).toBe("af:");
    for (const key of RESERVED) {
      expect(isReservedIdentityKey(`${key}anything`)).toBe(true);
    }
    // Authored keys, including ones that merely look similar, stay usable.
    for (const key of ["users", "users:42", "affe:users", "AF:users", "x-af:users"]) {
      expect(isReservedIdentityKey(key)).toBe(false);
    }
  });

  it("[DIN-2a] authored reactivity keys cannot enter the reserved namespace", () => {
    // Constructing a witness in the reserved namespace must fail closed: a
    // silently-accepted `af:binding:c0/count` witness lets authored code
    // invalidate — or masquerade as — an installation-owned identity.
    expect(() => Key.make("af:binding:c0/count")).toThrow(/reserved/i);
    expect(() => Key.make("af:expr:x0")).toThrow(/reserved/i);
    expect(() => Key.make("af:anything")).toThrow(/reserved/i);
    // Hierarchical derivation cannot smuggle one in either.
    expect(() => Key.family("af")("binding")).toThrow(/reserved/i);
    expect(() => Key.make("af").child("binding")).toThrow(/reserved/i);
    // And ordinary keys still work, expansion included.
    expect(Key.make("users").child(42).keys).toEqual(["users", "users:42"]);
  });

  it("[DIN-2b] normalization is the single choke point every seam shares", () => {
    // Loader `reactivityKeys`, query keys, action keys and expression deps
    // all funnel through normalization. Rejecting here is what makes the
    // reservation true by construction instead of by four separate audits.
    expect(() => normalizeReactivityKeys(["af:binding:c0/count"])).toThrow(/reserved/i);
    expect(() => normalizeReactivityKeys(["af:expr:x0"])).toThrow(/reserved/i);
    expect(() =>
      normalizeReactivityKeys({ "af:binding": ["c0"] })
    ).toThrow(/reserved/i);
    // Non-reserved input is unchanged — the guard adds no quirks. The array
    // form tolerates loose record entries at runtime.
    expect(
      normalizeReactivityKeys(
        [{ users: ["alice"] }] as unknown as ReactivityKeysInput,
      ),
    ).not.toContain("af:");
    expect(normalizeReactivityKeys({ users: ["alice"] })).toEqual([
      "users",
      "users:alice",
    ]);
  });

  it("[DIN-2b] a reserved authored expression dependency is diagnosed for the whole `af:` namespace", () => {
    // `af:binding:` detection must be a SPECIAL CASE of the general
    // predicate, not a parallel implementation: everything the binding check
    // rejects, the general check must reject too, strictly broader.
    for (const key of ["af:binding:c0/count", "af:binding:"]) {
      expect(isBindingReactivityKey(key)).toBe(true);
      expect(isReservedIdentityKey(key)).toBe(true);
    }
    expect(isBindingReactivityKey("af:expr:x0")).toBe(false);
    expect(isReservedIdentityKey("af:expr:x0")).toBe(true);
  });
});

describe("query `cacheKey` is an alias of portable identity, not a fourth family", () => {
  it("[DIN-2c] cacheKey is a pure function of descriptor identity + canonical reactivity keys", () => {
    // Deterministic, identical for an independently-constructed equal
    // descriptor: no hidden per-instance identity.
    expect(Portable.cacheKey(descriptor, ["users"])).toBe(
      Portable.cacheKey({ ...descriptor }, ["users"]),
    );

    // Reactivity keys are canonicalized (deduped + sorted), so key order at
    // the authoring site cannot fork the cache.
    expect(Portable.cacheKey(descriptor, ["b", "a", "a"])).toBe(
      Portable.cacheKey(descriptor, ["a", "b"]),
    );

    // Every identity axis of the portable family participates.
    const base = Portable.cacheKey(descriptor, ["users"]);
    expect(
      Portable.cacheKey({ ...descriptor, id: "app/users.ts#other" } as Portable.Descriptor, ["users"]),
    ).not.toBe(base);
    expect(
      Portable.cacheKey({ ...descriptor, buildId: "build-2" } as Portable.Descriptor, ["users"]),
    ).not.toBe(base);
    expect(
      Portable.cacheKey({ ...descriptor, captures: { page: 2 } }, ["users"]),
    ).not.toBe(base);
    expect(Portable.cacheKey(descriptor, ["users:42"])).not.toBe(base);
  });

  it("[DIN-2c] cacheKey is derived, never authored, and never reserved-shadowing", () => {
    const key = Portable.cacheKey(descriptor, []);
    // A derived cache identity is installation-owned, so it must not be
    // mistakable for an authored reactivity key…
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
    // …and it must not itself land in the reserved AUTHORING namespace, or
    // the two vocabularies collide in the opposite direction.
    expect(isReservedIdentityKey(key)).toBe(false);
  });

  it("[DIN-2c/DQ-089] DERIVATION IS EXEMPT: cacheKey legitimately consumes af:binding keys", () => {
    // Ratified: the `af:` reservation is broad and enforced at
    // NORMALIZATION, but derivation stays exempt — a restored query's
    // implicit `af:binding:<componentId>/<binding>` key genuinely
    // participates in its cache identity. Reservation constrains what an
    // AUTHOR may NAME, never what the library may COMPUTE.

    // The authoring seam rejects it…
    expect(() => normalizeReactivityKeys(["af:binding:c0/count"])).toThrow(/reserved/i);
    // …and the derivation seam accepts the very same key.
    const derived = Portable.cacheKey(descriptor, ["af:binding:c0/count"]);
    expect(derived).toBeTypeOf("string");
    expect(derived.length).toBeGreaterThan(0);

    // Genuinely CONSUMED, not silently dropped: a binding key must change
    // the cache identity, or restored queries would collide.
    expect(derived).not.toBe(Portable.cacheKey(descriptor, []));
    expect(derived).not.toBe(Portable.cacheKey(descriptor, ["af:binding:c0/other"]));
    // Canonicalization still applies to reserved inputs — they are ordinary
    // strings to the derivation, which is exactly the point.
    expect(Portable.cacheKey(descriptor, ["af:binding:c0/count", "users"])).toBe(
      Portable.cacheKey(descriptor, ["users", "af:binding:c0/count"]),
    );

    // NEGATIVE CONTROL: the exemption is scoped to derivation; an ordinary
    // authored key behaves identically through both seams.
    expect(normalizeReactivityKeys(["users"])).toEqual(["users"]);
    expect(Portable.cacheKey(descriptor, ["users"])).not.toBe(
      Portable.cacheKey(descriptor, []),
    );
  });
});
