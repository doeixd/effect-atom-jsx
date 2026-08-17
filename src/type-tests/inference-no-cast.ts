/**
 * Pins the inference guarantees fixed in the 2026-08-11 no-cast sweep: end
 * users must never need `as` to use these surfaces. Each block would have
 * required a cast before its fix; if one regresses, this file stops
 * compiling.
 */
import { Effect, Layer, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Route from "../Route.js";
import {
  RouteLoaderTimeoutError,
  runCachedLoader,
} from "../router-runtime.js";
import { SingleFlightTransportTag } from "../SingleFlightTransport.js";

// ─── Atom.value keeps class instances intact (DeepWiden fix) ────────────────
// `Atom.value(new URL(...))` used to widen `URL` into a mangled mapped type,
// forcing `as unknown as WritableAtom<URL>` at every call site.
const urlAtom: Atom.WritableAtom<URL> = Atom.value(new URL("http://a/"));
urlAtom.set(new URL("http://b/"));
const dateAtom: Atom.WritableAtom<Date> = Atom.value(new Date(0));
dateAtom.set(new Date(1));
const mapAtom: Atom.WritableAtom<Map<string, number>> = Atom.value(
  new Map<string, number>(),
);
mapAtom.set(new Map());
// Nested inside plain data, too.
const nested = Atom.value({ at: new Date(0), tags: ["a"] });
const _nestedAt: Date = nested().at;

// ─── Route.link optional segments stay optional (MergeParams fix) ───────────
const LinkPage = Route.path("/l/:userId/:tab?")(Component.from(() => null));
const href = Route.link(LinkPage);
// Optional param omitted: allowed.
const _noTab: string = href({ userId: "alice" });
// Optional param present: allowed.
const _withTab: string = href({ userId: "alice", tab: "settings" });

// ─── Route.guard exposes its component call signature ───────────────────────
// The component form is identity-typed, so a decorated component keeps its
// full intersection type through a guard in a pipe.
const guardedComponent = Route.guard(Effect.void)(Component.from<{}>(() => null));
const _stillComponent: Component.Component<{}, never, never, {}, {}> =
  guardedComponent;

// ─── Transport doubles implement the service without casts ──────────────────
// `execute` moves an `unknown` envelope (validated downstream), so a literal
// test double satisfies the interface as written.
const _transportLayer = Layer.succeed(SingleFlightTransportTag, {
  execute: () =>
    Effect.succeed({
      version: 1,
      ok: true,
      payload: { mutation: "x", url: "http://localhost/", loaders: [] },
    }),
});

// ─── runCachedLoader's type carries the timeout error (DQ-036) ──────────────
const timedLoad = runCachedLoader(
  "/pin/:id",
  { id: 1 },
  Effect.fail({ _tag: "Boom" } as const),
  { timeout: 20 },
);
const _timedResult: Effect.Effect<
  import("../effect-ts.js").Result<
    never,
    { readonly _tag: "Boom" } | RouteLoaderTimeoutError
  >,
  never
> = timedLoad;

// ─── The single-flight wire payload is an exported, constructible type ───────
const _wirePayload: typeof Route.SingleFlightWirePayloadSchema.Type = {
  mutation: { ok: "alice" },
  url: "http://localhost/",
  loaders: [
    {
      routeId: "/r/:id",
      result: { _tag: "Success", value: { name: "a" }, waiting: false, timestamp: 0 },
    },
  ],
};

// ─── Component.route sugar is typed as a unified route (R3) ─────────────────
// Direct application carries the route facet. (KNOWN GAP: building the sugar
// through `.pipe(Component.route(...))` drops the facet in contextual
// inference — part of the deferred ADR-006 dispatcher collapse.)
const Sugar = Component.route("/sugar/:id", {
  params: Schema.Struct({ id: Schema.String }),
})(Component.from<{}>(() => null));
// Direct enhancer application selects the unified signature…
const SugarWithLoader = Route.loader((params: { readonly id: string }) =>
  Effect.succeed({ id: params.id })
)(Sugar);
// …and the result is a unified route usable as a route source, castlessly.
const _entries = Route.collectAll(SugarWithLoader);
const _meta = SugarWithLoader[Route.UnifiedRouteSymbol].meta;
void _entries;
void _meta;

void _noTab;
void _withTab;
void _stillComponent;
void _transportLayer;
void _timedResult;
void _wirePayload;
void _nestedAt;
