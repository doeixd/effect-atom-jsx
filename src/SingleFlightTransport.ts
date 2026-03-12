import { Effect, ServiceMap } from "effect";

/**
 * Pluggable transport contract for transparent single-flight mutations.
 *
 * The transport is responsible only for moving a mutation request/response
 * envelope across a boundary. Loader selection, invalidation capture, payload
 * hydration, and direct seeding remain part of the route/runtime orchestration
 * layer.
 */
export interface SingleFlightTransportService {
  readonly execute: <Args extends ReadonlyArray<unknown>, A, E = unknown>(
    request: { readonly name?: string; readonly args: Args; readonly url: string },
    options?: {
      readonly endpoint?: string;
      readonly fetch?: (input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) => Promise<{ readonly json: () => Promise<unknown> }>;
    },
  ) => Effect.Effect<{ readonly ok: true; readonly payload: { readonly mutation: A; readonly url: string; readonly loaders: ReadonlyArray<{ readonly routeId: string; readonly result: unknown }> } } | { readonly ok: false; readonly error: E }, { readonly _tag: "SingleFlightTransportError"; readonly message: string; readonly cause?: unknown }>;
}

/** Runtime service tag used by mutation handles to discover single-flight support. */
export const SingleFlightTransportTag = ServiceMap.Service<SingleFlightTransportService>("SingleFlightTransport");
