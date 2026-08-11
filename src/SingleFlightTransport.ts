import { Effect, Context, Schema } from "effect";

/** The transport failed to move the envelope at all (network, endpoint). */
export class SingleFlightTransportError extends Schema.TaggedErrorClass<SingleFlightTransportError>(
  "@effect-atom-jsx/SingleFlightTransportError",
)("SingleFlightTransportError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Pluggable transport contract for transparent single-flight mutations.
 *
 * The transport is responsible only for moving a mutation request/response
 * envelope across a boundary, and its result is deliberately `unknown`: the
 * envelope is schema-validated by `Route.decodeSingleFlightResponse` at the
 * trust boundary (R5.1), so typing the payload here would claim a guarantee
 * the transport cannot give — and would force every implementation (including
 * test doubles) through casts. Loader selection, invalidation capture, payload
 * hydration, and direct seeding remain part of the route/runtime orchestration
 * layer.
 */
export interface SingleFlightTransportService {
  readonly execute: (
    request: {
      readonly name?: string;
      readonly args: ReadonlyArray<unknown>;
      readonly url: string;
    },
    options?: {
      readonly endpoint?: string;
      readonly fetch?: (
        input: string,
        init?: {
          readonly method?: string;
          readonly headers?: Record<string, string>;
          readonly body?: string;
        },
      ) => Promise<{ readonly json: () => Promise<unknown> }>;
    },
  ) => Effect.Effect<unknown, SingleFlightTransportError>;
}

/** Runtime service tag used by mutation handles to discover single-flight support. */
export const SingleFlightTransportTag = Context.Service<SingleFlightTransportService>("SingleFlightTransport");
