/**
 * The permissive hydration-handle registry (`PERMISSIVE_PACKAGE_PLAN.md` S4):
 * the client-side owner of the state-handle key space.
 *
 * The core codec's reference resolver is process-local, so a server-minted
 * handle key means nothing to a browser. This registry closes that gap by
 * making the KEYS the app's: register each resumable handle under a stable,
 * deployment-known key (a binding path, a route-scoped name) on BOTH sides,
 * and a payload serialized on the server resolves to the client's live
 * handle — the same identity discipline as `af:binding:` reactivity keys.
 *
 * Unknown keys still fail closed in the codec; this registry never invents a
 * handle.
 */

import type * as Serialization from "effect-atom-jsx/Serialization";

export interface HandleRegistry {
  /** Bind a stable key to a live handle. Re-registering a key replaces it. */
  readonly register: (key: string, handle: object) => void;
  /** Remove a key (e.g. on component disposal). */
  readonly unregister: (key: string) => void;
  /** The resolver to pass to `permissive({ stateHandles })`. */
  readonly resolver: Serialization.StateHandleResolver;
}

export function createHandleRegistry(): HandleRegistry {
  const byKey = new Map<string, object>();
  const byHandle = new Map<object, string>();
  return {
    register: (key, handle) => {
      const previous = byKey.get(key);
      if (previous !== undefined) byHandle.delete(previous);
      byKey.set(key, handle);
      byHandle.set(handle, key);
    },
    unregister: (key) => {
      const handle = byKey.get(key);
      if (handle !== undefined) byHandle.delete(handle);
      byKey.delete(key);
    },
    resolver: {
      keyOf: (handle) => byHandle.get(handle),
      resolve: (key) => byKey.get(key),
    },
  };
}
