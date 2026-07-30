/**
 * Identity-family unification — `docs/DESIGN_IMPROVEMENT_NOTES.md` item 2.
 *
 * Four string identity families grew up independently: hydration keys
 * (value continuity), reactivity keys (invalidation), portable code ids
 * (executable addressing), and query `cacheKey`. The M8 design ratified the
 * first unification — binding hydration keys double as implicit reactivity keys
 * (`af:binding:<componentId>/<binding>`). Item 2's remaining work is:
 *
 *   (a) reserve the `af:` prefix *formally* — today only `af:binding:` is
 *       diagnosed, and only inside expression dependency collection, so
 *       `af:expr:…`, `af:component:…`, and anything else under `af:` can be
 *       authored freely and shadow installation-owned identities;
 *   (b) apply one predicate at every authoring seam (actions, loaders, queries,
 *       expressions) rather than one check in one collector;
 *   (c) decide whether query `cacheKey` is a fourth family or an alias of
 *       portable identity. **Decision recorded by these specs: an alias.**
 *       `Portable.cacheKey` derives entirely from descriptor identity axes plus
 *       canonical reactivity keys; it introduces no identity of its own, is
 *       never carried in a wire manifest, and must therefore be a pure function
 *       of the other two families.
 */

import { describe, expect, it } from "vitest";
import { fromSrc } from "../harness.js";

const RESERVED = ["af:", "af:binding:", "af:expr:", "af:component:"] as const;

describe("the `af:` prefix is reserved", () => {
  it("[DIN-2a] one exported predicate names the reserved namespace", async () => {
    // The vocabulary must live in exactly one place, or every seam invents its
    // own subset — which is the bug that `af:expr:` slipping through is.
    const { isReservedIdentityKey, ReservedIdentityPrefix } = await fromSrc(
      "reactivity-runtime",
      "isReservedIdentityKey",
      "ReservedIdentityPrefix",
    );
    expect(ReservedIdentityPrefix).toBe("af:");
    for (const key of RESERVED) {
      expect(isReservedIdentityKey(`${key}anything`)).toBe(true);
    }
    // Authored keys, including ones that merely look similar, stay usable.
    for (const key of ["users", "users:42", "affe:users", "AF:users", "x-af:users"]) {
      expect(isReservedIdentityKey(key)).toBe(false);
    }
  });

  it("[DIN-2a] authored reactivity keys cannot enter the reserved namespace", async () => {
    const { Key } = await fromSrc("Reactivity", "Key");
    // Constructing a witness in the reserved namespace must fail closed: a
    // silently-accepted `af:binding:c0/count` witness lets authored code
    // invalidate — or masquerade as — an installation-owned binding identity.
    expect(() => Key.make("af:binding:c0/count")).toThrow(/reserved/i);
    expect(() => Key.make("af:expr:x0")).toThrow(/reserved/i);
    expect(() => Key.make("af:anything")).toThrow(/reserved/i);
    // Hierarchical derivation cannot smuggle one in either.
    expect(() => Key.family("af")("binding")).toThrow(/reserved/i);
    expect(() => Key.make("af").child("binding")).toThrow(/reserved/i);
    // And ordinary keys still work, expansion included.
    expect(Key.make("users").child(42).keys).toEqual(["users", "users:42"]);
  });

  it("[DIN-2b] normalization is the single choke point every seam shares", async () => {
    const { normalizeReactivityKeys } = await fromSrc(
      "reactivity-runtime",
      "normalizeReactivityKeys",
    );
    // Loader `reactivityKeys`, query keys, action keys and expression deps all
    // funnel through normalization. Rejecting here is what makes (b) true by
    // construction instead of by four separate audits.
    expect(() => normalizeReactivityKeys(["af:binding:c0/count"])).toThrow(/reserved/i);
    expect(() => normalizeReactivityKeys(["af:expr:x0"])).toThrow(/reserved/i);
    expect(() => normalizeReactivityKeys({ "af:binding": ["c0"] } as never)).toThrow(/reserved/i);
    // Non-reserved input is unchanged — the guard adds no normalization quirks.
    expect(normalizeReactivityKeys([{ users: ["alice"] }] as never)).not.toContain("af:");
    expect(normalizeReactivityKeys({ users: ["alice"] } as never)).toEqual(["users", "users:alice"]);
  });

  it("[DIN-2b] a reserved authored expression dependency is diagnosed for the whole `af:` namespace", async () => {
    const { isBindingReactivityKey } = await fromSrc(
      "resume-handle",
      "isBindingReactivityKey",
    );
    const { isReservedIdentityKey } = await fromSrc(
      "reactivity-runtime",
      "isReservedIdentityKey",
    );
    // `af:binding:` detection must become a *special case* of the general
    // predicate, not a parallel implementation: everything the binding check
    // rejects, the general check must reject too, and the general check must be
    // strictly broader.
    for (const key of ["af:binding:c0/count", "af:binding:"]) {
      expect(isBindingReactivityKey(key)).toBe(true);
      expect(isReservedIdentityKey(key)).toBe(true);
    }
    expect(isBindingReactivityKey("af:expr:x0")).toBe(false);
    expect(isReservedIdentityKey("af:expr:x0")).toBe(true);
  });
});

describe("query `cacheKey` is an alias of portable identity, not a fourth family", () => {
  it("[DIN-2c] cacheKey is a pure function of descriptor identity + canonical reactivity keys", async () => {
    const { cacheKey } = await fromSrc("Portable", "cacheKey");

    const descriptor = {
      version: 1,
      kind: "portable.code",
      id: "app/users.ts#loadUsers",
      buildId: "build-1",
      captures: { page: 1 },
    } as any;

    // Deterministic, and identical for an independently-constructed equal
    // descriptor: no hidden per-instance identity.
    expect(cacheKey(descriptor, ["users"])).toBe(cacheKey({ ...descriptor }, ["users"]));

    // Reactivity keys are canonicalized (deduped + sorted), so key order at the
    // authoring site cannot fork the cache.
    expect(cacheKey(descriptor, ["b", "a", "a"])).toBe(cacheKey(descriptor, ["a", "b"]));

    // Every identity axis of the *portable* family participates — change any
    // one and the cache identity must change.
    const base = cacheKey(descriptor, ["users"]);
    expect(cacheKey({ ...descriptor, id: "app/users.ts#other" }, ["users"])).not.toBe(base);
    expect(cacheKey({ ...descriptor, buildId: "build-2" }, ["users"])).not.toBe(base);
    expect(cacheKey({ ...descriptor, captures: { page: 2 } }, ["users"])).not.toBe(base);
    expect(cacheKey(descriptor, ["users:42"])).not.toBe(base);
  });

  it("[DIN-2c] cacheKey is derived, never authored, and never reserved-shadowing", async () => {
    const { cacheKey } = await fromSrc("Portable", "cacheKey");
    const { isReservedIdentityKey } = await fromSrc(
      "reactivity-runtime",
      "isReservedIdentityKey",
    );
    const key = cacheKey(
      {
        version: 1,
        kind: "portable.code",
        id: "app/users.ts#loadUsers",
        buildId: "build-1",
        captures: {},
      } as any,
      [],
    );
    // A derived cache identity is installation-owned, so it must not be
    // mistakable for an authored reactivity key…
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
    // …and it must not itself land in the reserved authoring namespace, or the
    // two vocabularies collide in the opposite direction.
    expect(isReservedIdentityKey(key)).toBe(false);
  });

  it("[DIN-2c/DQ-089] DERIVATION IS EXEMPT: `cacheKey` legitimately consumes `af:binding:*` keys", async () => {
    // Ratified (`AGENT_NATIVE_NOTES.md` §10, DQ-089): the `af:` reservation is
    // broad and enforced at *normalization*, but "derivation stays exempt" is
    // explicitly and deliberately part of that decision.
    //
    // This spec exists as a REGRESSION FENCE in the opposite direction from the
    // reservation specs above. The obvious way to "harden" DQ-089 is to push the
    // reserved-key rejection down into everything that touches a reactivity key
    // — which would break a correct derivation: a restored query's implicit
    // `af:binding:<componentId>/<binding>` key genuinely participates in its
    // cache identity (see `src/__tests__/resume.test.ts:2457`). Reservation is a
    // constraint on what an AUTHOR may NAME, never on what the library may
    // COMPUTE, and the two must not be conflated.
    const { cacheKey } = await fromSrc("Portable", "cacheKey");
    const { normalizeReactivityKeys } = await fromSrc(
      "reactivity-runtime",
      "normalizeReactivityKeys",
    );

    const descriptor = {
      version: 1,
      kind: "portable.code",
      id: "app/users.ts#loadUsers",
      buildId: "build-1",
      captures: {},
    } as any;

    // The authoring seam rejects it…
    expect(() => normalizeReactivityKeys(["af:binding:c0/count"])).toThrow(/reserved/i);
    // …and the derivation seam accepts the very same key, without throwing.
    const derived = cacheKey(descriptor, ["af:binding:c0/count"]);
    expect(derived).toBeTypeOf("string");
    expect(derived.length).toBeGreaterThan(0);

    // And it is genuinely *consumed*, not silently dropped: a binding key must
    // change the cache identity, or "participates in its cache identity" is
    // false and restored queries would collide.
    expect(derived).not.toBe(cacheKey(descriptor, []));
    expect(derived).not.toBe(cacheKey(descriptor, ["af:binding:c0/other"]));
    // Canonicalization still applies to reserved inputs — they are ordinary
    // strings to the derivation, which is exactly the point of "opaquely".
    expect(cacheKey(descriptor, ["af:binding:c0/count", "users"])).toBe(
      cacheKey(descriptor, ["users", "af:binding:c0/count"]),
    );

    // NEGATIVE CONTROL: the exemption is scoped to derivation, so an ordinary
    // authored key behaves identically through both seams — the exemption is not
    // "cacheKey ignores its keys".
    expect(normalizeReactivityKeys(["users"])).toEqual(["users"]);
    expect(cacheKey(descriptor, ["users"])).not.toBe(cacheKey(descriptor, []));
  });
});
