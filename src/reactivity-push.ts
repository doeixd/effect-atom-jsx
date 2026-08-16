/**
 * Server-push Reactivity (AN-2, `AGENT_NATIVE_NOTES.md` §3) — closing the
 * live-sync loop for agent-initiated mutations.
 *
 * When the agent invalidates `["todos"]` server-side, connected browsers hear
 * it, and the *dependent* queries refresh — nothing else. The negative half is
 * the load-bearing one: a push that invalidates everything is
 * indistinguishable from a page reload and defeats the point of keys.
 *
 * Design points:
 * - There is exactly ONE reactivity key vocabulary (`Reactivity.Key`). A
 *   pushed key is the same plain string an in-process invalidation uses:
 *   witnesses expand (ancestors + self) at {@link ReactivityBroadcastBus.publish},
 *   travel as their normalized strings, and land in the client's
 *   `ReactivityService` unchanged via {@link applyPushedInvalidation}. Push
 *   never invents a key dialect.
 * - The success/failure gate lives at the DISPATCH seam, not here:
 *   `Agent.dispatch` publishes the response's `invalidated` keys only on the
 *   `ok: true` arm (the ratified DQ-080 envelope), so a failed mutation
 *   broadcasts nothing by construction.
 * - Transport is deliberately abstracted (SSE/WebSocket is a delivery detail).
 *   {@link ReactivityBroadcastBus.flush} is the transport's delivery tick;
 *   published keys batch (deduplicated, order-preserving) until it runs.
 */
import { Context, Effect, Layer } from "effect";
import { ReactivityTag, type ReactivityService } from "./Reactivity.js";
import {
  normalizeReactivityKeys,
  normalizeReactivityKeysDerived,
  type NormalizedReactivityKey,
  type ReactivityKeysInput,
} from "./reactivity-runtime.js";

/** A connected client's receiver: called once per flush with the batched keys. */
export type ReactivityPushListener = (
  keys: ReadonlyArray<NormalizedReactivityKey>,
) => void;

/**
 * The server-side publishing facade `Agent.dispatch` (and any other mutation
 * seam) consumes. Provided by {@link ReactivityBroadcastBus.serverLayer};
 * absent means "no live sync installed", which every publisher treats as a
 * no-op via `Effect.serviceOption`.
 */
export interface ReactivityBroadcastPublisher {
  readonly publish: (keys: ReactivityKeysInput) => Effect.Effect<void>;
}

export const ReactivityBroadcast = Context.Service<ReactivityBroadcastPublisher>(
  "effect-atom-jsx/ReactivityPush/Broadcast",
);

export interface ReactivityBroadcastBus {
  /**
   * Subscribe a client. Returns the disconnect Effect-factory; running it
   * removes the subscription exactly once and leaves nothing behind.
   */
  readonly connect: (
    listener: ReactivityPushListener,
  ) => Effect.Effect<() => Effect.Effect<void>>;
  /**
   * Publish invalidation keys to every connected client. Authored seam: keys
   * normalize through the one choke point (witnesses expand to ancestors +
   * self; the reserved `af:` namespace is rejected, DQ-089).
   */
  readonly publish: (keys: ReactivityKeysInput) => Effect.Effect<void>;
  /** Deliver the batched pending keys — the transport's send tick. */
  readonly flush: () => Effect.Effect<void>;
  /** How many clients are currently connected. */
  readonly connectionCount: () => Effect.Effect<number>;
  /**
   * Provides {@link ReactivityBroadcast} backed by this bus, for the server
   * dispatch stack.
   */
  readonly serverLayer: Layer.Layer<ReactivityBroadcastPublisher>;
}

/** Construct an in-process broadcast bus (the transport-neutral core). */
export function makeReactivityBroadcast(): Effect.Effect<ReactivityBroadcastBus> {
  return Effect.sync(() => {
    const listeners = new Set<ReactivityPushListener>();
    const pending = new Set<NormalizedReactivityKey>();

    const publish = (keys: ReactivityKeysInput): Effect.Effect<void> =>
      Effect.sync(() => {
        for (const key of normalizeReactivityKeys(keys)) {
          pending.add(key);
        }
      });

    const bus: ReactivityBroadcastBus = {
      connect: (listener) =>
        Effect.sync(() => {
          listeners.add(listener);
          return () =>
            Effect.sync(() => {
              listeners.delete(listener);
            });
        }),
      publish,
      flush: () =>
        Effect.sync(() => {
          if (pending.size === 0) return;
          const keys = [...pending];
          pending.clear();
          // Snapshot the audience: a listener connecting or disconnecting
          // inside a delivery callback affects the next flush, not this one.
          for (const listener of [...listeners]) {
            listener(keys);
          }
        }),
      connectionCount: () => Effect.sync(() => listeners.size),
      serverLayer: Layer.succeed(ReactivityBroadcast, { publish }),
    };
    return bus;
  });
}

/**
 * The client half of AN-2: invalidate exactly the keys the server sent,
 * through the ambient `ReactivityService` — so dependent queries refresh and
 * nothing else does.
 *
 * Pushed keys are already-normalized wire strings (the server expanded
 * witnesses at publish), so this is derivation-exempt normalization
 * (`DQ-089`): applying a push is observation of a server decision, not
 * authorship of a key.
 */
export function applyPushedInvalidation(
  keys: ReactivityKeysInput,
): Effect.Effect<void, never, ReactivityService> {
  return Effect.gen(function* () {
    const reactivity = yield* ReactivityTag;
    yield* reactivity.invalidate(normalizeReactivityKeysDerived(keys));
  });
}
