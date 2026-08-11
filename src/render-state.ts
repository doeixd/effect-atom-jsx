/**
 * render-state.ts — per-render server render state (M11.1, ratifying `DQ-001`).
 *
 * A server render's mutable state — its resume session and its server
 * document — must be **per request**: two interleaved renders sharing either
 * one leaks markers, diagnostics, and rendered content across requests. This
 * Effect v4 beta has no `FiberRef`, and `Effect.runSync` inside
 * `renderToString` starts a fresh fiber, so Effect context alone cannot reach
 * the synchronous renderer. The bridge is this module's pairing:
 *
 * - the state is an ordinary Effect **service** (`ServerRenderStateTag`),
 *   provided by `Resume.collectAsync` for the duration of one render effect,
 *   so it survives suspension and is inherited by forked child fibers; and
 * - `currentServerRenderState()` reads it **synchronously** off the running
 *   fiber (`Fiber.getCurrent().context`), which is what lets
 *   `renderToString` — plain sync code — install the right session and
 *   document for exactly its own synchronous slice, restoring the ambient
 *   globals afterwards.
 *
 * Between synchronous slices nothing is installed globally, so a concurrent
 * render can run its own slices without ever observing another request's
 * state.
 */
import { Context, Fiber } from "effect";
import type { ResumeSession } from "./resume-session.js";

export interface ServerRenderState {
  readonly session: ResumeSession;
  /** The render's own server document, stable across its render passes. */
  readonly document: unknown;
}

export const ServerRenderStateTag =
  Context.Service<ServerRenderState>("ServerRenderState");

/**
 * The current fiber's render state, or `undefined` outside a
 * `Resume.collectAsync` render (including on the client and in the
 * synchronous `Resume.collect` path, which carries its session through the
 * ambient dynamic scope instead).
 *
 * @internal
 */
export function currentServerRenderState(): ServerRenderState | undefined {
  const fiber = Fiber.getCurrent() as
    | { readonly context?: unknown }
    | undefined
    | null;
  const context = fiber?.context;
  if (context === undefined || context === null) return undefined;
  const value = Context.getOption(
    context as Context.Context<never>,
    ServerRenderStateTag,
  );
  return value._tag === "Some" ? value.value : undefined;
}
