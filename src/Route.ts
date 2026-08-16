import { Cause, Context, Effect, Fiber, Layer, Option, Schema, Stream } from "effect";
import * as Atom from "./Atom.js";
import { createComponent } from "./dom.js";
import { getRequestEvent, renderToString, setRequestEvent } from "./dom.js";
import { createSignal, useContext, type Accessor } from "./api.js";
import {
  ManagedRuntimeContext,
  defineMutation,
  Result as CoreResult,
  type Result as MutationResult,
  type Result as CoreResultType,
  type BridgeError,
  type MutationSupersededError,
} from "./effect-ts.js";
import * as Serialization from "./Serialization.js";
import { SingleFlightTransportError, SingleFlightTransportTag, type SingleFlightTransportService } from "./SingleFlightTransport.js";
import * as ComponentRuntime from "./Component.js";
import {
  LoaderCacheTag,
  collectLoaderReactivityKeys,
  currentLoaderCacheStore,
  invalidateLoaderReactivity,
  makeLoaderCacheStore,
  matchesLoaderReactivity,
  runCachedLoader,
  runInLoaderCacheStore,
  setLoaderCacheEntry,
} from "./router-runtime.js";
import { beginReactivityInvalidationCapture, normalizeReactivityKeys, type ReactivityKeysInput } from "./reactivity-runtime.js";
import {
  extractPatternParams,
  matchPatternSegments,
  substitutePattern,
} from "./route-pattern.js";
import type { Component as ComponentType } from "./Component.js";

export interface NavigateOptions {
  readonly replace?: boolean;
}

export interface RouterService {
  readonly url: Atom.ReadonlyAtom<URL>;
  readonly navigate: (to: string, options?: NavigateOptions) => Effect.Effect<void, unknown>;
  readonly back: () => Effect.Effect<void>;
  readonly forward: () => Effect.Effect<void>;
  readonly preload?: (to: string) => Effect.Effect<void>;
  /**
   * Optional navigation error channel (DQ-031(b)): an optimistic write that
   * fails its forked navigation reports here after rolling back — never
   * swallowed. Optional so loader-less layers stay trivially implementable.
   */
  readonly onNavigationError?: (error: unknown) => Effect.Effect<void>;
}

export const RouterTag = Context.Service<RouterService>("Router");

export interface RouteContext<P = unknown, Q = unknown, H = unknown> {
  readonly prefix: Atom.ReadonlyAtom<string>;
  readonly params: Atom.ReadonlyAtom<P>;
  readonly query: Atom.ReadonlyAtom<Q>;
  readonly hash: Atom.ReadonlyAtom<H | undefined>;
  readonly matched: Atom.ReadonlyAtom<boolean>;
  readonly pattern: string;
  readonly routeId?: string;
  readonly loaderData?: Atom.ReadonlyAtom<unknown>;
  readonly loaderResult?: Atom.ReadonlyAtom<CoreResultType<unknown, unknown>>;
}

export const RouteContextTag = Context.Service<RouteContext<any, any, any>>("RouteContext");
export const ServerRequestTag = Context.Service<{ readonly request: Request; readonly url: URL }>("ServerRequest");
export const ServerResponseTag = Context.Service<{
  readonly setStatus: (status: number) => void;
  readonly setHeader: (name: string, value: string) => void;
  readonly appendHeader: (name: string, value: string) => void;
  readonly redirect: (location: string, status?: number) => void;
  readonly notFound: () => void;
  readonly snapshot: () => { readonly status: number; readonly headers: ReadonlyMap<string, ReadonlyArray<string>> };
}>("ServerResponse");

export const RouteMetaSymbol: unique symbol = Symbol.for("effect-atom-jsx/RouteMeta");
export const RouteLoaderMetaSymbol: unique symbol = Symbol.for("effect-atom-jsx/RouteLoaderMeta");
export const RouteNodeSymbol: unique symbol = Symbol.for("effect-atom-jsx/RouteNode");
export const RouteRegistrySymbol: unique symbol = Symbol.for("effect-atom-jsx/RouteRegistry");

export interface RouteMeta<P, Q, H> {
  readonly pattern: string;
  readonly fullPattern: string;
  readonly paramsSchema?: Schema.Schema<P>;
  readonly querySchema?: Schema.Schema<Q>;
  readonly hashSchema?: Schema.Schema<H>;
  readonly exact?: boolean;
  readonly id?: string;
}

export const UnifiedRouteSymbol: unique symbol = Symbol.for("effect-atom-jsx/UnifiedRoute");

type Pipeable<Self> = {
  pipe(): Self;
  pipe<A>(ab: (self: Self) => A): A;
  pipe<A, B>(ab: (self: Self) => A, bc: (a: A) => B): B;
  pipe<A, B, C>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C): C;
  pipe<A, B, C, D>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D): D;
};

type UnifiedRouteKind = "path" | "layout" | "index";
type UnknownRouteResult = CoreResultType<unknown, unknown>;
// Head callbacks receive the unified Result model (matching loaderResult()).
type RouteTitleValue<P, LD, LE> = string | ((params: P, loaderData: LD | undefined, loaderResult: CoreResultType<LD, LE> | undefined) => string);
type RouteMetaExtraValue<P, LD, LE> = RouteMetaRecord | ((params: P, loaderData: LD | undefined, loaderResult: CoreResultType<LD, LE> | undefined) => RouteMetaRecord);
type NonNodeRouteTitleValue<P, LD, LE> = P extends AnyAppRouteNode ? never : RouteTitleValue<P, LD, LE>;
type NonNodeRouteMetaExtraValue<P, LD, LE> = P extends AnyAppRouteNode ? never : RouteMetaExtraValue<P, LD, LE>;
type StoredRouteTitle = string | ((params: unknown, loaderData: unknown, loaderResult: CoreResultType<unknown, unknown> | undefined) => string);
type StoredRouteMetaExtra = RouteMetaRecord | ((params: unknown, loaderData: unknown, loaderResult: CoreResultType<unknown, unknown> | undefined) => RouteMetaRecord);

interface UnifiedRouteInternals<P, Q, H, LD, LE> {
  readonly kind: UnifiedRouteKind;
  readonly meta: RouteMeta<P, Q, H>;
  readonly children: ReadonlyArray<AnyRoute>;
  readonly loaderFn?: LoaderFn;
  readonly loaderOptions?: LoaderOptions;
  readonly loaderErrorCases?: LoaderErrorCases<unknown, unknown>;
  readonly title?: StoredRouteTitle;
  readonly metaExtra?: StoredRouteMetaExtra;
  readonly guards: ReadonlyArray<Effect.Effect<unknown, any, any>>;
  readonly loader?: {
    readonly data: LD;
    readonly error: LE;
  };
}

/**
 * First-class unified route value.
 *
 * Routes are created by piping `Route.path(...)` onto a component, then refined
 * with route helpers like `Route.paramsSchema(...)`, `Route.loader(...)`, and
 * `Route.title(...)`.
 */
export interface Route<C, P, Q, H, LD = void, LE = never> extends Pipeable<Route<C, P, Q, H, LD, LE>> {
  readonly [UnifiedRouteSymbol]: UnifiedRouteInternals<P, Q, H, LD, LE>;
  readonly component: C;
  readonly kind: UnifiedRouteKind;
  readonly path: string;
  readonly children: ReadonlyArray<AnyRoute>;
}

/**
 * Unified route value marked as a layout route.
 *
 * Only layout routes can accept `Route.children(...)`.
 */
export interface LayoutRoute<C, P, Q, H, LD = void, LE = never> extends Route<C, P, Q, H, LD, LE> {
  readonly kind: "layout";
  pipe(): LayoutRoute<C, P, Q, H, LD, LE>;
  pipe<A>(ab: (self: LayoutRoute<C, P, Q, H, LD, LE>) => A): A;
  pipe<A, B>(ab: (self: LayoutRoute<C, P, Q, H, LD, LE>) => A, bc: (a: A) => B): B;
  pipe<A, B, C2>(ab: (self: LayoutRoute<C, P, Q, H, LD, LE>) => A, bc: (a: A) => B, cd: (b: B) => C2): C2;
  pipe<A, B, C2, D>(ab: (self: LayoutRoute<C, P, Q, H, LD, LE>) => A, bc: (a: A) => B, cd: (b: B) => C2, de: (c: C2) => D): D;
}

export type AnyRoute = Route<any, any, any, any, any, any>;
export type AnyLayoutRoute = LayoutRoute<any, any, any, any, any, any>;

type SegmentPart<S extends string> =
  S extends `:${infer Name}?` ? { readonly [K in Name]?: string }
  : S extends `:${infer Name}` ? { readonly [K in Name]: string }
  : {};

// `Omit`-based so property modifiers survive: an optional segment (`:tab?`)
// must stay OPTIONAL in the link params type — a mapped union of keys would
// silently strip `?` and force callers to pass every optional param.
type MergeParams<A, B> = Omit<A, keyof B> & B;

export type ExtractParams<Path extends string> =
  string extends Path ? Record<string, string>
  : Path extends `${infer Head}/${infer Tail}` ? MergeParams<SegmentPart<Head>, ExtractParams<Tail>>
  : SegmentPart<Path>;

export interface RenderRequestResult {
  readonly status: number;
  readonly headers: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly head: RouteHead;
  readonly html: string;
  readonly loaderPayload: ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>;
  readonly deferred: ReadonlyArray<string>;
}

type AnyAppRouteNode = AppRouteNode<any, any, any, any, any, any>;

type RouteNodeEnhancer<I extends AnyAppRouteNode = AnyAppRouteNode, O extends AnyAppRouteNode = AnyAppRouteNode> = (node: I) => O;
type UnifiedRouteEnhancer<I extends AnyRoute = AnyRoute, O extends AnyRoute = AnyRoute> = (route: I) => O;
declare const RouteNodePipeSymbol: unique symbol;
type RouteNodePipeOp<Kind extends string, Value = never> = {
  readonly [RouteNodePipeSymbol]: {
    readonly kind: Kind;
    readonly value: Value;
  };
};

type RouteNodeComponentOf<T extends AnyAppRouteNode> = T extends AppRouteNode<any, any, any, infer C, any, any> ? C : never;
type WithNodeParams<T extends AnyAppRouteNode, P> = AppRouteNode<P, RouteNodeQueryOf<T>, RouteNodeHashOf<T>, RouteNodeComponentOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>>;
type WithNodeQuery<T extends AnyAppRouteNode, Q> = AppRouteNode<RouteNodeParamsOf<T>, Q, RouteNodeHashOf<T>, RouteNodeComponentOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>>;
type WithNodeHash<T extends AnyAppRouteNode, H> = AppRouteNode<RouteNodeParamsOf<T>, RouteNodeQueryOf<T>, H, RouteNodeComponentOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>>;
type WithNodeLoader<T extends AnyAppRouteNode, A, E> = AppRouteNode<RouteNodeParamsOf<T>, RouteNodeQueryOf<T>, RouteNodeHashOf<T>, RouteNodeComponentOf<T>, A, E>;
type ApplyRouteNodePipeOp<T extends AnyAppRouteNode, Op> =
  Op extends RouteNodePipeOp<"params", infer P> ? WithNodeParams<T, P>
  : Op extends RouteNodePipeOp<"query", infer Q> ? WithNodeQuery<T, Q>
  : Op extends RouteNodePipeOp<"hash", infer H> ? WithNodeHash<T, H>
  : Op extends RouteNodePipeOp<"loader", infer Loader>
    ? Loader extends { readonly data: infer A; readonly error: infer E }
      ? WithNodeLoader<T, A, E>
      : T
  : Op extends RouteNodePipeOp<"identity", any> ? T
  : Op extends (route: T) => infer Out
    ? Out extends AnyAppRouteNode ? Out : T
  : T;
type PipeRouteNode<T extends AnyAppRouteNode, Ops extends readonly unknown[]> =
  Ops extends readonly [infer Head, ...infer Tail]
    ? PipeRouteNode<ApplyRouteNodePipeOp<T, Head>, Tail>
    : T;
type AnyRouteAttachTarget = AnyAppRouteNode | ComponentType<any, any, any, any, any>;
type RouteIdEnhancer =
  & (<C, P, Q, H, LD, LE>(route: LayoutRoute<C, P, Q, H, LD, LE>) => LayoutRoute<C, P, Q, H, LD, LE>)
  & (<P, Q, H, C extends ComponentType<any, any, any, any, any>, A, LE>(route: AppRouteNode<P, Q, H, C, A, LE>) => AppRouteNode<P, Q, H, C, A, LE>)
  & (<C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>)
  & RouteNodePipeOp<"identity">;
type RouteParamsSchemaEnhancer<P> =
  & (<Q, H, C extends ComponentType<any, any, any, any, any>, A, LE>(route: AppRouteNode<any, Q, H, C, A, LE>) => AppRouteNode<P, Q, H, C, A, LE>)
  & (<C, Q, H, LD, LE>(route: Route<C, any, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>)
  & RouteNodePipeOp<"params", P>;
type RouteQuerySchemaEnhancer<Q> =
  & (<P, H, C extends ComponentType<any, any, any, any, any>, A, LE>(route: AppRouteNode<P, any, H, C, A, LE>) => AppRouteNode<P, Q, H, C, A, LE>)
  & (<C, P, H, LD, LE>(route: Route<C, P, any, H, LD, LE>) => Route<C, P, Q, H, LD, LE>)
  & RouteNodePipeOp<"query", Q>;
type RouteHashSchemaEnhancer<H> =
  & (<P, Q, C extends ComponentType<any, any, any, any, any>, A, LE>(route: AppRouteNode<P, Q, any, C, A, LE>) => AppRouteNode<P, Q, H, C, A, LE>)
  & (<C, P, Q, LD, LE>(route: Route<C, P, Q, any, LD, LE>) => Route<C, P, Q, H, LD, LE>)
  & RouteNodePipeOp<"hash", H>;
type RouteChildrenEnhancer =
  & (<T extends AnyLayoutRoute | AnyAppRouteNode>(route: T) => T)
  & RouteNodePipeOp<"identity">;
type RouteTarget = AnyAppRouteNode | AnyRoute;
type RouteTargetComponent = ComponentType<any, any, any, any, any> | AnyRoute;
// The component form is identity-typed: the legacy branch mutates and returns
// the same object, so preserving the caller's full intersection type (routed
// metadata, loader tags) matters more than reflecting Req/E enrichment, which
// the unified form carries.
type GuardEnhancer<Req, E> = UnifiedGuardEnhancer<Req, E>
  & (<C extends ComponentType<any, any, any, any, any>>(component: C) => C);
type TitleRouteEnhancer<P, A, E> = (<T extends Route<any, P, any, any, A, E>>(route: T) => T)
  & NodeTitleEnhancer<AnyAppRouteNode>
  & TitleEnhancer<P, A, E>;
type MetaRouteEnhancer<P, A, E> = (<T extends Route<any, P, any, any, A, E>>(route: T) => T)
  & NodeMetaEnhancer<AnyAppRouteNode>
  & MetaEnhancer<P, A, E>;
// Signature order is load-bearing (TypeScript resolves intersection overloads
// in declaration order):
// 1. Self-stamped `Component.route` sugar is Component AND Route; the runtime
//    returns the same object, so the type preserves the component facet and
//    refreshes the route facet — `renderEffect(loaderified sugar)` and
//    `runMatchedLoaders(loaderified sugar)` both infer without casts.
// 2. Detached unified routes take the pure route signature.
// 3. Legacy routed components / nodes fall through to the historical shapes.
// The unified signature comes FIRST: a self-stamped `Component.route` sugar
// value matches both the route and component call signatures, and TypeScript
// resolves intersection overloads in declaration order — unified typing must
// win for the value the runtime treats as unified (R3).
//
// KNOWN INFERENCE GAP (ADR-006 collapse): `.pipe(Component.route, Route.loader)`
// chains contextually infer through a different signature than direct calls,
// so `renderEffect` on a pipe-built sugar route still needs a cast at the call
// site. Fixing this properly means collapsing the three-way dispatcher types,
// which is the remaining R3 workstream — not another signature reorder.
type LoaderRouteEnhancer<P, A, E, R> =
  (<C, Q, H>(route: Route<C, P, Q, H, void, never>) => Route<ComponentWithAddedReqE<C, R, E>, P, Q, H, A, E>)
  & LoaderEnhancer<P, A, E, R>
  & NodeLoaderEnhancer<AnyAppRouteNode, A, E, R>
  & RouteNodePipeOp<"loader", { readonly data: A; readonly error: E }>;

export type MaterializedAppRoute<P, Q, H, C extends ComponentType<any, any, any, any, any>, A, LE> =
  C extends ComponentType<infer Props, infer Req, infer Err, infer B, infer SlotContract>
    ? ComponentType<Props, Exclude<Req, RouteContext<any, any, any>>, Err, B, SlotContract>
      & Omit<C, keyof ComponentType<any, any, any, any, any>>
      & RoutedComponent<P, Q, H>
      & LoaderTaggedComponent<A, LE>
    : RoutedComponent<P, Q, H> & LoaderTaggedComponent<A, LE> & C;

export interface AppRouteNodeDef<P = unknown, Q = unknown, H = unknown, C extends ComponentType<any, any, any, any, any> = ComponentType<any, any, any, any, any>, A = unknown, LE = unknown> {
  readonly kind: "page" | "layout" | "index";
  readonly path: string;
  readonly component: C;
  readonly options: {
    readonly params?: Schema.Schema<P>;
    readonly query?: Schema.Schema<Q>;
    readonly hash?: Schema.Schema<H>;
    readonly exact?: boolean;
    readonly id?: string;
  };
  readonly children: ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>;
  readonly enhancers: ReadonlyArray<(component: ComponentType<any, any, any, any, any>) => ComponentType<any, any, any, any, any>>;
}

export interface AppRouteNodeState<P = unknown, Q = unknown, H = unknown, C extends ComponentType<any, any, any, any, any> = ComponentType<any, any, any, any, any>, A = unknown, LE = unknown> {
  readonly materialized?: MaterializedAppRoute<P, Q, H, C, A, LE>;
  /** Joined path the cached materialization was produced under. */
  readonly materializedPath?: string;
}

export interface AppRouteNode<P = unknown, Q = unknown, H = unknown, C extends ComponentType<any, any, any, any, any> = ComponentType<any, any, any, any, any>, A = unknown, LE = unknown> {
  readonly [RouteNodeSymbol]: true;
  readonly definition: AppRouteNodeDef<P, Q, H, C, A, LE>;
  readonly state: AppRouteNodeState<P, Q, H, C, A, LE>;
  readonly kind: "page" | "layout" | "index";
  readonly path: string;
  readonly component: C;
  readonly options: {
    readonly params?: Schema.Schema<P>;
    readonly query?: Schema.Schema<Q>;
    readonly hash?: Schema.Schema<H>;
    readonly exact?: boolean;
    readonly id?: string;
  };
  readonly children: ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>;
  readonly enhancers: ReadonlyArray<(component: ComponentType<any, any, any, any, any>) => ComponentType<any, any, any, any, any>>;
  pipe<Ops extends readonly RouteNodePipeOp<string, any>[]>(...enhancers: Ops): PipeRouteNode<this, Ops>;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>): R1;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>, R2 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>, op2: RouteNodeEnhancer<R1, R2>): R2;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>, R2 extends AppRouteNode<any, any, any, any, any, any>, R3 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>, op2: RouteNodeEnhancer<R1, R2>, op3: RouteNodeEnhancer<R2, R3>): R3;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>, R2 extends AppRouteNode<any, any, any, any, any, any>, R3 extends AppRouteNode<any, any, any, any, any, any>, R4 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>, op2: RouteNodeEnhancer<R1, R2>, op3: RouteNodeEnhancer<R2, R3>, op4: RouteNodeEnhancer<R3, R4>): R4;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>, R2 extends AppRouteNode<any, any, any, any, any, any>, R3 extends AppRouteNode<any, any, any, any, any, any>, R4 extends AppRouteNode<any, any, any, any, any, any>, R5 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>, op2: RouteNodeEnhancer<R1, R2>, op3: RouteNodeEnhancer<R2, R3>, op4: RouteNodeEnhancer<R3, R4>, op5: RouteNodeEnhancer<R4, R5>): R5;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>, R2 extends AppRouteNode<any, any, any, any, any, any>, R3 extends AppRouteNode<any, any, any, any, any, any>, R4 extends AppRouteNode<any, any, any, any, any, any>, R5 extends AppRouteNode<any, any, any, any, any, any>, R6 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>, op2: RouteNodeEnhancer<R1, R2>, op3: RouteNodeEnhancer<R2, R3>, op4: RouteNodeEnhancer<R3, R4>, op5: RouteNodeEnhancer<R4, R5>, op6: RouteNodeEnhancer<R5, R6>): R6;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>, R2 extends AppRouteNode<any, any, any, any, any, any>, R3 extends AppRouteNode<any, any, any, any, any, any>, R4 extends AppRouteNode<any, any, any, any, any, any>, R5 extends AppRouteNode<any, any, any, any, any, any>, R6 extends AppRouteNode<any, any, any, any, any, any>, R7 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>, op2: RouteNodeEnhancer<R1, R2>, op3: RouteNodeEnhancer<R2, R3>, op4: RouteNodeEnhancer<R3, R4>, op5: RouteNodeEnhancer<R4, R5>, op6: RouteNodeEnhancer<R5, R6>, op7: RouteNodeEnhancer<R6, R7>): R7;
  pipe<R1 extends AppRouteNode<any, any, any, any, any, any>, R2 extends AppRouteNode<any, any, any, any, any, any>, R3 extends AppRouteNode<any, any, any, any, any, any>, R4 extends AppRouteNode<any, any, any, any, any, any>, R5 extends AppRouteNode<any, any, any, any, any, any>, R6 extends AppRouteNode<any, any, any, any, any, any>, R7 extends AppRouteNode<any, any, any, any, any, any>, R8 extends AppRouteNode<any, any, any, any, any, any>>(op1: RouteNodeEnhancer<this, R1>, op2: RouteNodeEnhancer<R1, R2>, op3: RouteNodeEnhancer<R2, R3>, op4: RouteNodeEnhancer<R3, R4>, op5: RouteNodeEnhancer<R4, R5>, op6: RouteNodeEnhancer<R5, R6>, op7: RouteNodeEnhancer<R6, R7>, op8: RouteNodeEnhancer<R7, R8>): R8;
  pipe(...enhancers: ReadonlyArray<RouteNodeEnhancer>): AppRouteNode<P, Q, H, C, A, LE>;
}

export interface LoaderOptions {
  readonly dependsOnParent?: boolean;
  readonly streaming?: boolean;
  readonly priority?: "critical" | "deferred";
  readonly staleTime?: number | string;
  readonly cacheTime?: number | string;
  readonly staleWhileRevalidate?: boolean;
  readonly reactivityKeys?: ReactivityKeysInput;
  readonly timeout?: number | string;
}

/**
 * Serializable single-flight response payload.
 *
 * `mutation` is the mutation return value, while `loaders` contains any route
 * loader snapshots that should be hydrated on the client in the same round trip.
 */
export interface SingleFlightPayload<A> {
  readonly mutation: A;
  readonly url: string;
  readonly loaders: ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>;
}

/** A single loader snapshot carried inside a single-flight payload. */
export type SingleFlightLoaderEntry = {
  readonly routeId: string;
  readonly result: UnknownRouteResult;
};

/**
 * Request shape posted by a single-flight client.
 *
 * `url` identifies the current or target route branch whose loaders should be
 * considered for revalidation / hydration.
 */
export interface SingleFlightRequest<Args extends ReadonlyArray<unknown>> {
  readonly name?: string;
  readonly args: Args;
  readonly url: string;
}

/** Success/failure envelope returned by single-flight handlers. */
export type SingleFlightResponse<A, E = unknown> =
  | { readonly ok: true; readonly payload: SingleFlightPayload<A> }
  | { readonly ok: false; readonly error: E };

// ─── Single-flight wire contract (R5.1) ─────────────────────────────────────
//
// The response envelope is schema-validated at the trust boundary, and loader
// results cross the wire through the canonical `Serialization.ResultWire` projection — the
// same encoding the SSR loader handoff uses — instead of `JSON.stringify` on a
// core `Result`. Values travel through the sparse rich-value tree, so a `Date`
// a loader produced on the server is a `Date` again in the client cache.

/** The transport failed: network, endpoint, or the action itself. */
export class SingleFlightInvokeError extends Schema.TaggedErrorClass<SingleFlightInvokeError>(
  "@effect-atom-jsx/SingleFlightInvokeError",
)("SingleFlightInvokeError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * The transport succeeded but the response failed schema validation.
 *
 * Distinct from {@link SingleFlightInvokeError} because the remedies differ:
 * a malformed payload is deploy skew or tampering, a failed transport is a
 * retry.
 */
export class SingleFlightDecodeError extends Schema.TaggedErrorClass<SingleFlightDecodeError>(
  "@effect-atom-jsx/SingleFlightDecodeError",
)("SingleFlightDecodeError", {
  message: Schema.String,
}) {}

export const SingleFlightWireLoaderEntrySchema = Schema.Struct({
  routeId: Schema.String,
  result: Serialization.ResultWire,
});

export const SingleFlightWirePayloadSchema = Schema.Struct({
  // `undefined` mutation values (void actions) are dropped by JSON, so the
  // field is optional on the wire.
  mutation: Schema.optional(Schema.Unknown),
  url: Schema.String,
  loaders: Schema.Array(SingleFlightWireLoaderEntrySchema),
});

export const SingleFlightResponseSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    payload: SingleFlightWirePayloadSchema,
  }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.Unknown }),
]);

/** The schema-validated response shape a single-flight handler emits. */
export type SingleFlightWireResponse = typeof SingleFlightResponseSchema.Type;

/** Project one in-memory payload onto the validated wire envelope. */
export function encodeSingleFlightPayload(
  payload: SingleFlightPayload<unknown>,
): typeof SingleFlightWirePayloadSchema.Type {
  return {
    mutation: Serialization.encodeWireValue(payload.mutation),
    url: payload.url,
    loaders: payload.loaders.map((entry) => ({
      routeId: entry.routeId,
      result: Serialization.resultToWire(entry.result),
    })),
  };
}

/**
 * Validate one raw single-flight response at the trust boundary and rehydrate
 * its payload.
 *
 * Validation goes through the injected `Serialization` service when present
 * (falling back to the schema codec), so a transport with a richer wire format
 * can swap the decoder without touching call sites. A structurally invalid
 * response is a typed {@link SingleFlightDecodeError} — never a defect — and
 * nothing is hydrated from it.
 */
export function decodeSingleFlightResponse<A>(
  raw: unknown,
): Effect.Effect<
  SingleFlightPayload<A>,
  SingleFlightInvokeError | SingleFlightDecodeError
> {
  return Effect.gen(function* () {
    const serialization = yield* Effect.serviceOption(Serialization.Tag);
    const decoded = yield* (serialization._tag === "Some"
      ? serialization.value.deserialize(
          SingleFlightResponseSchema,
          JSON.stringify(raw),
        )
      : Schema.decodeUnknownEffect(SingleFlightResponseSchema)(raw)
    ).pipe(
      Effect.catchTag("SchemaError", (error) =>
        Effect.fail(
          new SingleFlightDecodeError({
            message: `Single-flight response failed wire validation: ${String(error)}`,
          }),
        ),
      ),
    );
    if (!decoded.ok) {
      return yield* new SingleFlightInvokeError({
        message: "Single-flight action failed",
        cause: decoded.error,
      });
    }
    return {
      mutation: Serialization.decodeWireValue(decoded.payload.mutation) as A,
      url: decoded.payload.url,
      loaders: decoded.payload.loaders.map((entry) => ({
        routeId: entry.routeId,
        result: Serialization.resultFromWire(entry.result),
      })),
    };
  });
}

/** Runtime integration point for transparent single-flight transport support. */
export { SingleFlightTransportError, SingleFlightTransportTag, type SingleFlightTransportService };

/**
 * Mutation-handle facade for single-flight route mutations.
 *
 * Mirrors the library's existing mutation ergonomics (`run`, `runEffect`,
 * `result`, `pending`) while preserving the richer single-flight payload.
 */
export interface SingleFlightMutationHandle<Args extends ReadonlyArray<unknown>, A, E, R = never> {
  (...args: Args): void;
  run(...args: Args): void;
  runEffect(...args: Args): Effect.Effect<SingleFlightPayload<A>, E | BridgeError | MutationSupersededError, R>;
  effect(...args: Args): Effect.Effect<void, E | BridgeError | MutationSupersededError, R>;
  result: Accessor<MutationResult<void, E>>;
  pending: Accessor<boolean>;
}

/**
 * Shared options for single-flight execution.
 *
 * - `reactivityKeys` emits invalidations explicitly from the mutation
 * - `target` switches the revalidation/hydration branch to another URL
 * - `setLoaders` seeds canonical loader payloads directly and can skip reruns
 */
export interface SingleFlightOptions<Args extends ReadonlyArray<unknown>, A> {
  readonly app?: RouteSource;
  readonly reactivityKeys?: ReactivityKeysInput;
  readonly onSuccess?: (result: A, args: Args) => Effect.Effect<void>;
  readonly target?: string | URL | ((result: A, args: Args, currentUrl: URL) => string | URL | undefined);
  readonly revalidate?: "reactivity" | "matched" | "none" | ReadonlyArray<string>;
  readonly includeDeferred?: boolean;
  readonly setLoaders?: (result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
}

// Loaders are stored after their requirements are erased; the runtime provides
// services before running, so the stored shape carries `R = never`. Typing it
// this way lets loader call sites feed `runCachedLoader` without re-casting.
type LoaderFn = (params: unknown, deps?: { readonly parent: <A>() => A }) => Effect.Effect<unknown, unknown>;
type ErrorTag<E> = E extends { readonly _tag: infer K extends string }
  ? K
  : E extends { _tag: infer K extends string }
    ? K
    : never;
type ErrorByTag<E, K extends string> = Extract<E, { readonly _tag: K } | { _tag: K }>;

export type LoaderErrorCases<P = unknown, E = unknown> = {
  readonly [K in ErrorTag<E>]?: (error: ErrorByTag<E, K>, params: P) => unknown;
} & {
  readonly _?: (error: E, params: P) => unknown;
};

/** A route paired with its resolved metadata (registry / tree projection). */
export type RegisteredRoute = {
  readonly component: ComponentType<any, any, any, any, any>;
  readonly meta: RouteMeta<any, any, any>;
};

type RouteLoaderMeta<A = unknown, E = unknown> = {
  readonly data: A;
  readonly error: E;
};

type RoutedMetadataCarrier<P = unknown, Q = unknown, H = unknown, A = unknown, E = unknown> = {
  readonly [RouteMetaSymbol]?: RouteMeta<P, Q, H>;
  readonly [RouteLoaderMetaSymbol]?: RouteLoaderMeta<A, E>;
};

/**
 * The route decorations stamped directly onto a component value.
 *
 * This is the single declaration site for the string-keyed route decoration
 * fields. `RouteDecorationFields` below must list every key of this type, and
 * component wrappers copy the decorations by iterating that list — so adding a
 * field here cannot silently be dropped by a wrapper.
 */
type RouteDecorationRecord<P = unknown, A = unknown, E = unknown> = {
  __routeLoader?: LoaderFn;
  __routeLoaderOptions?: LoaderOptions;
  __routeLoaderError?: LoaderErrorCases<any, any>;
  __routeTitle?: string | ((params: P, loaderData: A | undefined, loaderResult: CoreResultType<A, E> | undefined) => string);
  __routeMetaExtra?: RouteMetaRecord | ((params: P, loaderData: A | undefined, loaderResult: CoreResultType<A, E> | undefined) => RouteMetaRecord);
  __routeSitemapParams?: () => Effect.Effect<ReadonlyArray<any>>;
  __routeGuards?: ReadonlyArray<Effect.Effect<unknown, any, any>>;
};

/** Canonical, exhaustive list of the string-keyed route decoration fields. */
export const RouteDecorationFields = [
  "__routeLoader",
  "__routeLoaderOptions",
  "__routeLoaderError",
  "__routeTitle",
  "__routeMetaExtra",
  "__routeSitemapParams",
  "__routeGuards",
] as const satisfies ReadonlyArray<keyof RouteDecorationRecord>;

/** Compile-time proof that `RouteDecorationFields` misses no decoration. */
type _MissingRouteDecorationField = Exclude<
  keyof RouteDecorationRecord,
  typeof RouteDecorationFields[number]
>;
type _AssertNoMissingRouteDecorationField = [_MissingRouteDecorationField] extends [never] ? true
  : { readonly __missingRouteDecorationFields: _MissingRouteDecorationField };
const _assertRouteDecorationFieldsExhaustive: _AssertNoMissingRouteDecorationField = true;
void _assertRouteDecorationFieldsExhaustive;

/** Canonical, exhaustive list of the symbol-keyed route metadata carriers. */
export const RouteDecorationSymbols = [
  RouteMetaSymbol,
  RouteLoaderMetaSymbol,
] as const;

type RouteDecoratedComponent<P = unknown, Q = unknown, H = unknown, A = unknown, E = unknown> =
  & ComponentType<any, any, any, any, any>
  & RoutedMetadataCarrier<P, Q, H, A, E>
  & RouteDecorationRecord<P, A, E>;

function pipeSelf<T>(self: T, fns: ReadonlyArray<(value: unknown) => unknown>): unknown {
  return fns.reduce<unknown>((acc, fn) => fn(acc), self);
}

function isUnifiedRoute(value: unknown): value is AnyRoute {
  return (typeof value === "object" || typeof value === "function") && value !== null && UnifiedRouteSymbol in value;
}

function makeUnifiedRoute<C, P, Q, H, LD = void, LE = never>(
  component: C,
  internals: UnifiedRouteInternals<P, Q, H, LD, LE>,
): Route<C, P, Q, H, LD, LE> {
  const route = {
    [UnifiedRouteSymbol]: internals,
    component,
    kind: internals.kind,
    path: internals.meta.pattern,
    children: internals.children,
  } as Route<C, P, Q, H, LD, LE>;
  // R2: constructing a route is side-effect free — no global registration.
  route.pipe = ((...fns: ReadonlyArray<(value: unknown) => unknown>) => pipeSelf(route, fns)) as Route<C, P, Q, H, LD, LE>["pipe"];
  return route;
}

function copyUnifiedRoute<C, P, Q, H, LD, LE, P2 = P, Q2 = Q, H2 = H, LD2 = LD, LE2 = LE>(
  route: Route<C, P, Q, H, LD, LE>,
  patch: Partial<UnifiedRouteInternals<P2, Q2, H2, LD2, LE2>>,
): Route<C, P2, Q2, H2, LD2, LE2> {
  const current = route[UnifiedRouteSymbol];
  const next: UnifiedRouteInternals<P2, Q2, H2, LD2, LE2> = {
    kind: (patch.kind ?? current.kind) as UnifiedRouteKind,
    meta: (patch.meta ?? current.meta) as RouteMeta<P2, Q2, H2>,
    children: (patch.children ?? current.children) as ReadonlyArray<AnyRoute>,
    loaderFn: patch.loaderFn ?? current.loaderFn,
    loaderOptions: patch.loaderOptions ?? current.loaderOptions,
    loaderErrorCases: (patch.loaderErrorCases ?? current.loaderErrorCases) as LoaderErrorCases<unknown, unknown> | undefined,
    title: (patch.title ?? current.title) as StoredRouteTitle | undefined,
    metaExtra: (patch.metaExtra ?? current.metaExtra) as StoredRouteMetaExtra | undefined,
    guards: (patch.guards ?? current.guards) as ReadonlyArray<Effect.Effect<unknown, any, any>>,
    loader: (patch.loader ?? current.loader) as UnifiedRouteInternals<P2, Q2, H2, LD2, LE2>["loader"],
  };
  if ((route as { readonly component?: unknown }).component === route) {
    // Self-stamped sugar (`Component.route`, R3): the route IS the component,
    // so enhancers evolve the stamp in place — the legacy branch has always
    // mutated the component — and mirror into the legacy `__route*`
    // projection the sugar's own setup path reads. Returning the same object
    // keeps the value usable directly in JSX.
    const routed = route as unknown as RouteDecoratedComponent<any, any, any, any, any> & Record<PropertyKey, unknown>;
    routed[UnifiedRouteSymbol] = next;
    routed["kind"] = next.kind;
    routed["path"] = next.meta.pattern;
    routed["children"] = next.children;
    if (next.loaderFn !== undefined) routed.__routeLoader = next.loaderFn as never;
    if (next.loaderOptions !== undefined) routed.__routeLoaderOptions = next.loaderOptions;
    if (next.loaderErrorCases !== undefined) routed.__routeLoaderError = next.loaderErrorCases;
    if (next.title !== undefined) routed.__routeTitle = next.title as never;
    if (next.metaExtra !== undefined) routed.__routeMetaExtra = next.metaExtra as never;
    routed.__routeGuards = next.guards;
    return route as unknown as Route<C, P2, Q2, H2, LD2, LE2>;
  }
  return makeUnifiedRoute(route.component, next);
}

/**
 * Stamp a `Component.route(...)` result as a self-routed unified value: the
 * route's `component` is the routed component itself (R3, `DQ-030`). This is
 * what makes the sugar produce the same identity `Route.path` would — it is
 * visible to `collectAll`, `runMatchedLoaders`, and the runtime — while
 * remaining a component.
 *
 * @internal
 */
export function stampSelfRoute(
  component: object,
  meta: RouteMeta<any, any, any>,
): void {
  const routed = component as RouteDecoratedComponent<any, any, any, any, any> & Record<PropertyKey, unknown>;
  routed[UnifiedRouteSymbol] = {
    kind: "path",
    meta,
    children: [],
    guards: routed.__routeGuards ?? [],
  } satisfies UnifiedRouteInternals<any, any, any, any, any>;
  routed["component"] = component;
  routed["kind"] = "path";
  routed["path"] = meta.pattern;
  routed["children"] = [];
}

function isRouteNode(value: unknown): value is AppRouteNode<any, any, any, any, any, any> {
  return typeof value === "object" && value !== null && RouteNodeSymbol in value;
}

function asRouteComponent<P = unknown, Q = unknown, H = unknown, A = unknown, E = unknown>(
  component: ComponentType<any, any, any, any, any>,
): RouteDecoratedComponent<P, Q, H, A, E> {
  return component as RouteDecoratedComponent<P, Q, H, A, E>;
}

function hasDocumentHead(doc: Document): doc is Document & { readonly head: HTMLHeadElement } {
  return "head" in doc && doc.head !== null;
}

function identityEncoder<A>(value: A): A {
  return value;
}

function encodeWithSchema<A>(schema: Schema.Schema<A> | undefined): (value: A) => unknown {
  if (!schema) return identityEncoder;
  return Schema.encodeSync(schema as any);
}

function decodeWithSchemaOption<A>(schema: Schema.Schema<A>) {
  return Schema.decodeUnknownOption(schema as any);
}

function makeWritableUrlAtom(initial: URL): Atom.WritableAtom<URL> {
  return Atom.value(initial) as unknown as Atom.WritableAtom<URL>;
}

function hasTag(error: unknown, tag: string): error is { readonly _tag: string } {
  return typeof error === "object" && error !== null && "_tag" in error && (error as { readonly _tag: string })._tag === tag;
}

/**
 * Last-known-good loader data, if any.
 *
 * `Stale` is a *failure* carrying the data from the last success, which is
 * precisely the case where a route should keep rendering what the user already
 * has. Reading only `Success` here meant a failed loader refresh rendered as
 * *no data* — the keep-stale-on-failure gap recorded in
 * `RESULT_UNIFICATION_PLAN.md` finding 3.
 */
function loaderSuccess(result: UnknownRouteResult | undefined): { readonly value: unknown } | undefined {
  if (!result) return undefined;
  if (result._tag === "Success") return { value: result.value };
  if (result._tag === "Stale") return { value: result.data };
  // `Refreshing.previous` is typed to exclude `Stale`, so a refresh of stale
  // data is represented as `Refreshing(Success(data))` and is covered here.
  if (result._tag === "Refreshing" && result.previous._tag === "Success") return { value: result.previous.value };
  return undefined;
}

function toComponentRouteOptions<P, Q, H>(node: AppRouteNode<P, Q, H, any, any, any>) {
  return {
    params: node.options.params,
    query: node.options.query,
    hash: node.options.hash,
    exact: node.options.exact,
  };
}

function setLoaderInternals<P, A, E>(
  component: ComponentType<any, any, any, any, any>,
  fn: (params: P, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, any>,
  options?: LoaderOptions,
): void {
  const routed = asRouteComponent<P, any, any, A, E>(component);
  routed.__routeLoader = fn as LoaderFn;
  routed.__routeLoaderOptions = options ?? {};
  setRouteLoaderMeta<A, E>(routed);
}

function setTitleInternal(component: ComponentType<any, any, any, any, any>, value: string | ((params: unknown, loaderData: unknown, loaderResult: CoreResultType<unknown, unknown> | undefined) => string)): void {
  asRouteComponent(component).__routeTitle = value;
}

function setMetaInternal(component: ComponentType<any, any, any, any, any>, value: RouteMetaRecord | ((params: unknown, loaderData: unknown, loaderResult: CoreResultType<unknown, unknown> | undefined) => RouteMetaRecord)): void {
  asRouteComponent(component).__routeMetaExtra = value;
}

function appendNodeEnhancer<P, Q, H, C extends ComponentType<any, any, any, any, any>, A, LE>(
  node: AppRouteNode<P, Q, H, C, A, LE>,
  enhancer: (component: C) => C,
): AppRouteNode<P, Q, H, C, A, LE> {
  return withComponentEnhancer(node, enhancer);
}

function getRouteMeta<P, Q, H>(component: RoutedMetadataCarrier<P, Q, H>): RouteMeta<P, Q, H> | undefined {
  return component[RouteMetaSymbol];
}

export function routeMetaOf<C extends ComponentType<any, any, any, any, any>>(
  component: C,
): RouteMeta<RouteParamsOf<C>, RouteQueryOf<C>, RouteHashOf<C>> | undefined {
  return getRouteMeta(asRouteComponent(component));
}

function setRouteMeta<P, Q, H>(component: RoutedMetadataCarrier<P, Q, H>, meta: RouteMeta<P, Q, H>): void {
  (component as RoutedMetadataCarrier<P, Q, H> & { [RouteMetaSymbol]: RouteMeta<P, Q, H> })[RouteMetaSymbol] = meta;
  // A self-stamped `Component.route` sugar value carries the same meta in its
  // unified stamp; the two projections must never disagree (R3).
  const stamped = component as unknown as {
    readonly component?: unknown;
    [UnifiedRouteSymbol]?: UnifiedRouteInternals<any, any, any, any, any>;
  };
  if (
    stamped[UnifiedRouteSymbol] !== undefined
    && stamped.component === component
  ) {
    stamped[UnifiedRouteSymbol] = {
      ...stamped[UnifiedRouteSymbol],
      meta: meta as RouteMeta<any, any, any>,
    };
  }
}

function setRouteLoaderMeta<A, E>(component: RoutedMetadataCarrier<any, any, any, A, E>): void {
  (component as RoutedMetadataCarrier<any, any, any, A, E> & { [RouteLoaderMetaSymbol]: RouteLoaderMeta<A, E> })[RouteLoaderMetaSymbol] = {} as RouteLoaderMeta<A, E>;
}

function makeRouteNode<P, Q, H, C extends ComponentType<any, any, any, any, any>, A = unknown, LE = unknown>(
  kind: AppRouteNode["kind"],
  path: string,
  component: C,
  options?: AppRouteNode<P, Q, H, C, A, LE>["options"],
  children?: ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>,
  enhancers?: ReadonlyArray<(component: ComponentType<any, any, any, any, any>) => ComponentType<any, any, any, any, any>>,
): AppRouteNode<P, Q, H, C, A, LE> {
  const definition: AppRouteNodeDef<P, Q, H, C, A, LE> = {
    kind,
    path,
    component,
    options: options ?? {},
    children: children ?? [],
    enhancers: enhancers ?? [],
  };
  const node: AppRouteNode<P, Q, H, C, A, LE> = {
    [RouteNodeSymbol]: true,
    definition,
    state: {},
    kind: definition.kind,
    path: definition.path,
    component: definition.component,
    options: definition.options,
    children: definition.children,
    enhancers: definition.enhancers,
    pipe: ((...ops: ReadonlyArray<RouteNodeEnhancer>) =>
      ops.reduce<AnyAppRouteNode>((current, op) => op(current), node)) as AppRouteNode<P, Q, H, C, A, LE>["pipe"],
  };
  return node;
}

function withComponentEnhancer<P, Q, H, C extends ComponentType<any, any, any, any, any>, A, LE>(
  node: AppRouteNode<P, Q, H, C, A, LE>,
  enhancer: (component: C) => C,
): AppRouteNode<P, Q, H, C, A, LE> {
  const definition: AppRouteNodeDef<P, Q, H, C, A, LE> = {
    ...node.definition,
    enhancers: [...node.enhancers, enhancer as any],
  };
  return {
    ...node,
    definition,
    enhancers: definition.enhancers,
    state: {},
  };
}

function withNodeOptions<P, Q, H, C extends ComponentType<any, any, any, any, any>, A, LE>(
  node: AppRouteNode<P, Q, H, C, A, LE>,
  options: Partial<AppRouteNode<P, Q, H, C, A, LE>["options"]>,
): AppRouteNode<P, Q, H, C, A, LE> {
  const definition: AppRouteNodeDef<P, Q, H, C, A, LE> = {
    ...node.definition,
    options: { ...node.options, ...options },
  };
  return {
    ...node,
    definition,
    options: definition.options,
    state: {},
  };
}

function withNodeChildren<P, Q, H, C extends ComponentType<any, any, any, any, any>, A, LE>(
  node: AppRouteNode<P, Q, H, C, A, LE>,
  children: ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>,
): AppRouteNode<P, Q, H, C, A, LE> {
  const definition: AppRouteNodeDef<P, Q, H, C, A, LE> = {
    ...node.definition,
    children,
  };
  return {
    ...node,
    definition,
    children: definition.children,
  };
}

function materializeNode<P, Q, H, C extends ComponentType<any, any, any, any, any>, A, LE>(
  node: AppRouteNode<P, Q, H, C, A, LE>,
  parentFullPath = "",
): MaterializedAppRoute<P, Q, H, C, A, LE> {
  // Bind the component to the joined path so render/match identity matches the
  // tree/loader identity. joinRoutePath is the same per-segment join
  // routePathOfTarget performs, so both identities stay byte-identical.
  const fullPath = joinRoutePath(parentFullPath, node.path, node.kind);
  // Tree materialization (a real parent path) is authoritative for the cached
  // identity. Standalone calls (componentOf/link, parent "") defer to any
  // existing cache, so a standalone materialization before Route.define is
  // replaced by the tree's joined identity — and never replaces it back.
  if (node.state.materialized) {
    const cachedPath = node.state.materializedPath;
    if (cachedPath === fullPath || parentFullPath === "") {
      return node.state.materialized as MaterializedAppRoute<P, Q, H, C, A, LE>;
    }
  }
  const routed = node.component.pipe(ComponentRuntime.route(fullPath, toComponentRouteOptions(node)));
  let current = asRouteComponent<P, Q, H, A, LE>(routed);
  for (const enhancer of node.enhancers) {
    current = asRouteComponent<P, Q, H, A, LE>(enhancer(current));
  }
  if (node.options.id) {
    const meta = getRouteMeta(current);
    if (meta) {
      setRouteMeta(current, { ...meta, id: node.options.id });
    }
  }
  const materialized = current as MaterializedAppRoute<P, Q, H, C, A, LE>;
  const state = node.state as {
    materialized?: MaterializedAppRoute<P, Q, H, C, A, LE>;
    materializedPath?: string;
  };
  state.materialized = materialized;
  state.materializedPath = fullPath;
  return materialized;
}

type WithLoaderComponent<C, RAdd, EAdd, A, E> = C extends ComponentType<infer Props, infer Req, infer Err, infer B, infer SlotContract>
  ? (ComponentType<Props, Req | RAdd, Err | EAdd, B, SlotContract>
    & Omit<C, keyof ComponentType<any, any, any, any, any>>
    & RoutedComponent<RouteParamsOf<C>, RouteQueryOf<C>, RouteHashOf<C>>
    & LoaderTaggedComponent<A, E>)
  : (C & LoaderTaggedComponent<A, E>);

type RouteComponentEnhancer<I extends ComponentType<any, any, any, any, any>, O extends ComponentType<any, any, any, any, any>> = (component: I) => O;

type LoaderEnhancer<P, A, E, R> =
  & (<Q, H, C extends ComponentType<any, any, any, any, any>>(route: AppRouteNode<P, Q, H, C, any, any>) => AppRouteNode<P, Q, H, C, A, E>)
  & (<C extends RoutedComponent<P, any, any> & ComponentType<any, any, any, any, any>>(route: C) => WithLoaderComponent<C, R, E, A, E>)
  & (<C extends ComponentType<any, any, any, any, any>>(route: C) => WithLoaderComponent<C, R, E, A, E>);

type NodeLoaderEnhancer<T extends AnyAppRouteNode, A, E, R> =
  & LoaderEnhancer<RouteNodeParamsOf<T>, A, E, R>
  & (<RouteNode extends T>(route: RouteNode) => WithNodeLoader<RouteNode, A, E>)
  & RouteNodePipeOp<"loader", { readonly data: A; readonly error: E }>;

type TitleEnhancer<P, A, E> =
  & (<Q, H, C extends ComponentType<any, any, any, any, any>>(route: AppRouteNode<P, Q, H, C, A, E>) => AppRouteNode<P, Q, H, C, A, E>)
  & (<C extends RoutedComponent<P, any, any> & LoaderTaggedComponent<A, E> & ComponentType<any, any, any, any, any>>(component: C) => C)
  & (<C extends RoutedComponent<P, any, any> & ComponentType<any, any, any, any, any>>(component: C) => C)
  & (<C extends ComponentType<any, any, any, any, any>>(component: C) => C);

type NodeTitleEnhancer<T extends AnyAppRouteNode> = TitleEnhancer<RouteNodeParamsOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> & ((route: T) => T);

type MetaEnhancer<P, A, E> =
  & (<Q, H, C extends ComponentType<any, any, any, any, any>>(route: AppRouteNode<P, Q, H, C, A, E>) => AppRouteNode<P, Q, H, C, A, E>)
  & (<C extends RoutedComponent<P, any, any> & LoaderTaggedComponent<A, E> & ComponentType<any, any, any, any, any>>(component: C) => C)
  & (<C extends RoutedComponent<P, any, any> & ComponentType<any, any, any, any, any>>(component: C) => C)
  & (<C extends ComponentType<any, any, any, any, any>>(component: C) => C);

type NodeMetaEnhancer<T extends AnyAppRouteNode> = MetaEnhancer<RouteNodeParamsOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> & ((route: T) => T);

type LoaderAttachResult<T, P, A, E, R> =
  T extends AppRouteNode<P, any, any, any, any, any> ? WithNodeLoader<T, A, E>
  : T extends ComponentType<any, any, any, any, any> ? WithLoaderComponent<T, R, E, A, E>
  : never;

type UnifiedRouteWithLoader<T extends AnyRoute, A, E, R = never> = T extends Route<infer C, infer P, infer Q, infer H, any, any>
  ? Route<ComponentWithAddedReqE<C, R, E>, P, Q, H, A, E>
  : never;

type ComponentWithAddedReqE<C, R, E> =
  C extends ComponentType<infer Props, infer R0, infer E0, infer B, infer SlotContract>
    ? ComponentType<Props, R0 | R, E0 | E, B, SlotContract>
    : C;

type UnifiedLoaderEnhancer<A, E, R> =
  <C, P, Q, H>(route: Route<C, P, Q, H, void, never>) => Route<ComponentWithAddedReqE<C, R, E>, P, Q, H, A, E>;

type UnifiedGuardEnhancer<Req, E> =
  <C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<ComponentWithAddedReqE<C, Req, E>, P, Q, H, LD, LE>;

type UnifiedTitleEnhancer<P, A, E> =
  <C, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>;

type UnifiedMetaEnhancer<P, A, E> =
  <C, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>;

/**
 * An explicit registry of component-first routes.
 *
 * R2 removed the module-global route registry: constructing a route has no side
 * effects, and every loader/sitemap/hydration entry point takes its routes from
 * a **route source** — either a route tree root or one of these explicitly
 * constructed registry values.
 */
export interface RouteRegistry {
  readonly [RouteRegistrySymbol]: true;
  readonly entries: ReadonlyArray<RegisteredRoute>;
}

/** Anything loader/sitemap/hydration entry points can read routes from. */
export type RouteSource = AnyAppRouteNode | AnyRoute | RouteRegistry;

/** Carries the app's route source for context-driven paths (e.g. `preload`). */
export interface RouteSourceService {
  readonly source: RouteSource;
}

/** Injectable route source, consumed by `RouterService.preload`. */
export const RouteSourceTag = Context.Service<RouteSourceService>("RouteSource");

/** Provide the app's route source to router layers and preloads. */
export function routeSourceLayer(source: RouteSource): Layer.Layer<RouteSourceService> {
  return Layer.succeed(RouteSourceTag, { source });
}

/**
 * Resolve a route source: the explicit one wins, else the injected
 * `RouteSourceTag`, else `undefined` (there is no global fallback).
 */
export function resolveRouteSource(
  explicit?: RouteSource,
): Effect.Effect<RouteSource | undefined> {
  if (explicit !== undefined) return Effect.succeed(explicit);
  return Effect.serviceOption(RouteSourceTag).pipe(
    Effect.map((option) => (option._tag === "Some" ? option.value.source : undefined)),
  );
}

export function isRouteRegistry(value: unknown): value is RouteRegistry {
  return typeof value === "object" && value !== null && RouteRegistrySymbol in value;
}

/**
 * Build an explicit registry from route-decorated components
 * (`Component.route(...)`), replacing the deleted global registry.
 */
export function registry(
  components: Iterable<ComponentType<any, any, any, any, any>>,
): RouteRegistry {
  const entries: Array<RegisteredRoute> = [];
  for (const component of components) {
    const meta = getRouteMeta(asRouteComponent(component));
    if (!meta) continue;
    entries.push({ component, meta });
  }
  return { [RouteRegistrySymbol]: true, entries };
}

/** Collect every route in a route source as `{ component, meta }` pairs. */
export function collectAll(source: RouteSource): ReadonlyArray<RegisteredRoute> {
  if (isRouteRegistry(source)) return source.entries;
  return registeredRoutesFromTree(source);
}

/**
 * Route head metadata.
 *
 * Merge semantics (root -> leaf):
 * - scalars: deepest wins
 * - objects: shallow-merged, deepest keys win
 * - keywords: concatenated + deduped
 * - tags: merged by key (name/property/rel/httpEquiv/charset)
 */
export interface RouteMetaRecord {
  readonly description?: string | null;
  readonly canonical?: string | null;
  readonly robots?: string | null;
  readonly keywords?: ReadonlyArray<string>;
  readonly og?: Readonly<Record<string, string | null | undefined>>;
  readonly twitter?: Readonly<Record<string, string | null | undefined>>;
  readonly tags?: ReadonlyArray<Readonly<Record<string, string | null | undefined>>>;
}

export interface RouteHead {
  readonly title?: string;
  readonly meta?: RouteMetaRecord;
}

export type ResolvedHeadEntry = {
  readonly id: string;
  readonly depth: number;
  readonly title?: string;
  readonly meta?: RouteMetaRecord;
};

// ─── Head state: per-request on the server, per-owner on the client ──────────
//
// R2: head entries used to live in one module-global map that SSR `clear()`ed on
// every render, so a server render wiped client head state and two concurrent
// server renders raced. Head state is now a *store value*:
//
// - the server creates one store per request and provides it as `RouteHeadTag`
//   (fiber-local: Effect context is per-fiber) plus installs it as the ambient
//   store for the synchronous render, so nested `Component.route` setups and
//   their later atom-subscription callbacks all write to that request's store;
// - the client resolves the store once during setup and closes over it, which
//   scopes head writes to the rendering owner;
// - nothing ever clears another render's store.

/** A head-entry store: one per server request, one per client document. */
export interface RouteHeadStore {
  readonly entries: Map<string, ResolvedHeadEntry>;
  /** Client stores flush to `document.head`; server stores never touch it. */
  readonly applyToDocument: boolean;
  seq: number;
}

export function makeRouteHeadStore(options?: { readonly applyToDocument?: boolean }): RouteHeadStore {
  return {
    entries: new Map(),
    applyToDocument: options?.applyToDocument ?? false,
    seq: 0,
  };
}

/** Injectable per-request head store. */
export const RouteHeadTag = Context.Service<RouteHeadStore>("RouteHead");

/** The client/document head store, used when nothing scopes it. */
export const clientRouteHeadStore: RouteHeadStore = makeRouteHeadStore({ applyToDocument: true });

let ambientRouteHeadStore: RouteHeadStore | undefined;

/** Install `store` as the ambient head store for a synchronous render. */
export function runInRouteHeadStore<A>(store: RouteHeadStore, evaluate: () => A): A {
  const previous = ambientRouteHeadStore;
  ambientRouteHeadStore = store;
  try {
    return evaluate();
  } finally {
    ambientRouteHeadStore = previous;
  }
}

/** Resolve the head store for synchronous call sites. */
export function resolveRouteHeadStore(store?: RouteHeadStore): RouteHeadStore {
  return store ?? ambientRouteHeadStore ?? clientRouteHeadStore;
}

/**
 * Resolve the head store inside an Effect: provided service, then ambient, then
 * the client store. Adds no requirement.
 */
export const currentRouteHeadStore: Effect.Effect<RouteHeadStore> = Effect.serviceOption(RouteHeadTag).pipe(
  Effect.map((option) => (option._tag === "Some" ? option.value : resolveRouteHeadStore())),
);

function tagIdentity(tag: Readonly<Record<string, string | null | undefined>>): string {
  return String(tag.name ?? tag.property ?? tag.rel ?? tag.httpEquiv ?? tag.charset ?? JSON.stringify(tag));
}

export function mergeRouteMetaChain(chain: ReadonlyArray<RouteMetaRecord | undefined>): RouteMetaRecord | undefined {
  let description: string | null | undefined;
  let canonical: string | null | undefined;
  let robots: string | null | undefined;
  const keywords: Array<string> = [];
  const og: Record<string, string | null | undefined> = {};
  const twitter: Record<string, string | null | undefined> = {};
  const tagMap = new Map<string, Readonly<Record<string, string | null | undefined>>>();

  for (const meta of chain) {
    if (!meta) continue;
    if (meta.description !== undefined) description = meta.description;
    if (meta.canonical !== undefined) canonical = meta.canonical;
    if (meta.robots !== undefined) robots = meta.robots;
    if (meta.keywords) {
      for (const keyword of meta.keywords) {
        if (!keywords.includes(keyword)) keywords.push(keyword);
      }
    }
    if (meta.og) {
      Object.assign(og, meta.og);
    }
    if (meta.twitter) {
      Object.assign(twitter, meta.twitter);
    }
    if (meta.tags) {
      for (const tag of meta.tags) {
        tagMap.set(tagIdentity(tag), tag);
      }
    }
  }

  const out: Record<string, unknown> = {};
  if (description !== undefined) out.description = description;
  if (canonical !== undefined) out.canonical = canonical;
  if (robots !== undefined) out.robots = robots;
  if (keywords.length > 0) out.keywords = keywords;
  if (Object.keys(og).length > 0) out.og = og;
  if (Object.keys(twitter).length > 0) out.twitter = twitter;
  if (tagMap.size > 0) out.tags = [...tagMap.values()];
  return Object.keys(out).length > 0 ? (out as RouteMetaRecord) : undefined;
}

export function resolveRouteHead(entries: ReadonlyArray<ResolvedHeadEntry>): RouteHead {
  const sorted = [...entries].sort((a, b) => a.depth - b.depth);
  let title: string | undefined;
  const metas: Array<RouteMetaRecord | undefined> = [];
  for (const entry of sorted) {
    if (entry.title !== undefined) {
      title = entry.title;
    }
    metas.push(entry.meta);
  }
  return {
    title,
    meta: mergeRouteMetaChain(metas),
  };
}

export function applyRouteHeadToDocument(head: RouteHead): void {
  if (typeof document === "undefined") return;
  if (!hasDocumentHead(document)) return;
  if (head.title !== undefined) {
    document.title = head.title;
  }

  const managed = document.head.querySelectorAll("meta[data-route-head='1'], link[data-route-head='1']");
  for (const node of Array.from(managed)) {
    node.parentElement?.removeChild(node);
  }

  const meta = head.meta;
  if (!meta) return;
  const addMeta = (attrs: Record<string, string>) => {
    const el = document.createElement("meta");
    el.setAttribute("data-route-head", "1");
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
    document.head.appendChild(el);
  };

  if (meta.description) addMeta({ name: "description", content: meta.description });
  if (meta.robots) addMeta({ name: "robots", content: meta.robots });
  if (meta.keywords && meta.keywords.length > 0) addMeta({ name: "keywords", content: meta.keywords.join(",") });

  if (meta.canonical) {
    const link = document.createElement("link");
    link.setAttribute("data-route-head", "1");
    link.setAttribute("rel", "canonical");
    link.setAttribute("href", meta.canonical);
    document.head.appendChild(link);
  }

  for (const [k, v] of Object.entries(meta.og ?? {})) {
    if (v == null) continue;
    addMeta({ property: `og:${k}`, content: String(v) });
  }
  for (const [k, v] of Object.entries(meta.twitter ?? {})) {
    if (v == null) continue;
    addMeta({ name: `twitter:${k}`, content: String(v) });
  }
  for (const tag of meta.tags ?? []) {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(tag)) {
      if (v != null) attrs[k] = String(v);
    }
    if (Object.keys(attrs).length > 0) addMeta(attrs);
  }
}

function flushRouteHead(store: RouteHeadStore): void {
  if (!store.applyToDocument) return;
  applyRouteHeadToDocument(resolveRouteHeadOf(store));
}

/** Resolve the merged head for one store. */
export function resolveRouteHeadOf(store: RouteHeadStore): RouteHead {
  return resolveRouteHead([...store.entries.values()]);
}

/** Mint a head-entry id inside a store. */
export function createRouteHeadId(store: RouteHeadStore): string {
  store.seq += 1;
  return `route-head-${store.seq}`;
}

export function setRouteHead(store: RouteHeadStore, entry: ResolvedHeadEntry): void {
  store.entries.set(entry.id, entry);
  flushRouteHead(store);
}

export function removeRouteHead(store: RouteHeadStore, id: string): void {
  store.entries.delete(id);
  flushRouteHead(store);
}

export type RoutedComponent<P, Q, H> = {
  readonly [RouteMetaSymbol]: RouteMeta<P, Q, H>;
};

export type LoaderTaggedComponent<A, E> = {
  readonly [RouteLoaderMetaSymbol]: {
    readonly data: A;
    readonly error: E;
  };
};

export type RouteParamsOf<T> = T extends { readonly [RouteMetaSymbol]: RouteMeta<infer P, any, any> } ? P : never;
export type RouteQueryOf<T> = T extends { readonly [RouteMetaSymbol]: RouteMeta<any, infer Q, any> } ? Q : never;
export type RouteHashOf<T> = T extends { readonly [RouteMetaSymbol]: RouteMeta<any, any, infer H> } ? H : never;
export type RouteLoaderDataOf<T> = T extends { readonly [RouteLoaderMetaSymbol]: { readonly data: infer A } } ? A : unknown;
export type RouteLoaderErrorOf<T> = T extends { readonly [RouteLoaderMetaSymbol]: { readonly error: infer E } } ? E : unknown;

export type RouteNodeParamsOf<T> = T extends AppRouteNode<infer P, any, any, any, any, any>
  ? P
  : T extends Route<any, infer P, any, any, any, any>
    ? P
    : RouteParamsOf<T>;
export type RouteNodeQueryOf<T> = T extends AppRouteNode<any, infer Q, any, any, any, any>
  ? Q
  : T extends Route<any, any, infer Q, any, any, any>
    ? Q
    : RouteQueryOf<T>;
export type RouteNodeHashOf<T> = T extends AppRouteNode<any, any, infer H, any, any, any>
  ? H
  : T extends Route<any, any, any, infer H, any, any>
    ? H
    : RouteHashOf<T>;
export type RouteNodeLoaderDataOf<T> = T extends AppRouteNode<any, any, any, any, infer A, any>
  ? A
  : T extends Route<any, any, any, any, infer A, any>
    ? A
    : RouteLoaderDataOf<T>;
export type RouteNodeLoaderErrorOf<T> = T extends AppRouteNode<any, any, any, any, any, infer E>
  ? E
  : T extends Route<any, any, any, any, any, infer E>
    ? E
    : RouteLoaderErrorOf<T>;

export type ParamsOf<T> = RouteNodeParamsOf<T>;
export type QueryOf<T> = RouteNodeQueryOf<T>;
export type HashOf<T> = RouteNodeHashOf<T>;
export type LoaderDataOf<T> = RouteNodeLoaderDataOf<T>;
export type LoaderErrorOf<T> = RouteNodeLoaderErrorOf<T>;

type LoaderTarget = string | (ComponentType<any, any, any, any, any> & LoaderTaggedComponent<any, any>) | AnyRoute;

/**
 * Create a first-class unified route by attaching a path pattern to a component.
 *
 * Path params are inferred from `:param` segments and flow into typed links,
 * loaders, and route context. Use `Route.paramsSchema(...)` when you want
 * decoded params with richer types than the raw string-based inference.
 */
export function path<Pattern extends string>(
  pattern: Pattern,
): <C extends ComponentType<any, any, any, any, any>>(
  component: C,
) => Route<C, ExtractParams<Pattern>, {}, undefined, void, never> {
  return <C extends ComponentType<any, any, any, any, any>>(component: C) =>
    makeUnifiedRoute(component, {
      kind: "path",
      // No generated id: route identity is the resolved pattern unless
      // `Route.id(...)` assigns an explicit, stable one. A module-eval counter
      // cannot be trusted to agree across server and client.
      meta: {
        pattern,
        fullPattern: pattern,
      },
      children: [],
      guards: [],
    });
}

/** Create a page route node from a path and component. */
export function page<C extends ComponentType<any, any, any, any, any>>(path: string, component: C): AppRouteNode<unknown, unknown, unknown, C, unknown, unknown> {
  return makeRouteNode("page", path, component);
}

/**
 * Mark a route as a layout route.
 *
 * Two forms coexist by design (see the 3-tier routing model): the no-arg
 * `Route.layout()` is the unified-route enhancer used in a pipe chain, while
 * `Route.layout(component)` is the route-first constructor that builds an
 * `AppRouteNode` tree. Both are supported first-class; neither is transitional.
 */
export function layout(): <C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => LayoutRoute<C, P, Q, H, LD, LE>;
export function layout<C extends ComponentType<any, any, any, any, any>>(component: C): AppRouteNode<unknown, unknown, unknown, C, unknown, unknown>;
export function layout(component?: ComponentType<any, any, any, any, any>) {
  if (arguments.length === 0) {
    return (<C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) =>
      copyUnifiedRoute(route, {
        kind: "layout",
      }) as LayoutRoute<C, P, Q, H, LD, LE>);
  }
  return makeRouteNode("layout", "", component!);
}

/**
 * Mark a route as an index route.
 *
 * Index routes resolve to their parent path and are matched exactly.
 */
export function index(): <C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>;
export function index<C extends ComponentType<any, any, any, any, any>>(component: C): AppRouteNode<unknown, unknown, unknown, C, unknown, unknown>;
export function index(component?: ComponentType<any, any, any, any, any>) {
  if (arguments.length === 0) {
    return (<C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) =>
      copyUnifiedRoute(route, {
        kind: "index",
        meta: {
          ...route[UnifiedRouteSymbol].meta,
          exact: true,
        },
      }));
  }
  return makeRouteNode("index", "", component!, { exact: true });
}

/**
 * Mark a route tree root as an application route definition and materialize it.
 *
 * The returned value is unchanged at runtime; the helper communicates intent
 * to tooling and keeps inference stable around the root.
 */
export function define<T extends AppRouteNode<any, any, any, any, any, any>>(root: T): T {
  materializeTree(root);
  return root;
}

/** Reference an existing route node without altering it. */
export function ref<T extends AppRouteNode<any, any, any, any, any, any>>(route: T): T {
  return route;
}

/** Attach child route nodes to an existing route node. */
export function mount<T extends AppRouteNode<any, any, any, any, any, any>>(
  route: T,
  children: ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>,
): T {
  return withNodeChildren(route, children) as T;
}

/**
 * Attach child routes to a layout/route node.
 *
 * In the unified route model this should be used after `Route.layout()`.
 */
export function children(nodes: ReadonlyArray<AnyAppRouteNode> | ReadonlyArray<AnyRoute>): RouteChildrenEnhancer {
  const out = (route: RouteTarget): RouteTarget => {
    if (isUnifiedRoute(route)) {
      return copyUnifiedRoute(route, {
        children: nodes as ReadonlyArray<AnyRoute>,
      });
    }
    return withNodeChildren(route, nodes as ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>);
  };
  return out as unknown as RouteChildrenEnhancer;
}

/** Assign a stable route id for loaders, hydration, diagnostics, and links. */
export function id(value: string): RouteIdEnhancer {
  const out = (route: AnyAppRouteNode | AnyRoute): AnyAppRouteNode | AnyRoute => {
    if (isUnifiedRoute(route)) {
      return copyUnifiedRoute(route, {
        meta: {
          ...route[UnifiedRouteSymbol].meta,
          id: value,
        },
      });
    }
    return withNodeOptions(route, { id: value });
  };
  return out as unknown as RouteIdEnhancer;
}

/**
 * Replace raw inferred path params with decoded schema output.
 *
 * This is the main escape hatch when path-string inference is not rich enough.
 */
export function paramsSchema<P>(schema: Schema.Schema<P>): RouteParamsSchemaEnhancer<P> {
  const out = (route: AnyAppRouteNode | AnyRoute): AnyAppRouteNode | AnyRoute => {
    if (isUnifiedRoute(route)) {
      return copyUnifiedRoute(route, {
        meta: {
          ...route[UnifiedRouteSymbol].meta,
          paramsSchema: schema,
        },
      });
    }
    return withNodeOptions(route, { params: schema });
  };
  return out as unknown as RouteParamsSchemaEnhancer<P>;
}

/** Replace raw query-string values with decoded schema output. */
export function querySchema<Q>(schema: Schema.Schema<Q>): RouteQuerySchemaEnhancer<Q> {
  const out = (route: AnyAppRouteNode | AnyRoute): AnyAppRouteNode | AnyRoute => {
    if (isUnifiedRoute(route)) {
      return copyUnifiedRoute(route, {
        meta: {
          ...route[UnifiedRouteSymbol].meta,
          querySchema: schema,
        },
      });
    }
    return withNodeOptions(route, { query: schema });
  };
  return out as unknown as RouteQuerySchemaEnhancer<Q>;
}

/** Replace the raw hash fragment with decoded schema output. */
export function hashSchema<H>(schema: Schema.Schema<H>): RouteHashSchemaEnhancer<H> {
  const out = (route: AnyAppRouteNode | AnyRoute): AnyAppRouteNode | AnyRoute => {
    if (isUnifiedRoute(route)) {
      return copyUnifiedRoute(route, {
        meta: {
          ...route[UnifiedRouteSymbol].meta,
          hashSchema: schema,
        },
      });
    }
    return withNodeOptions(route, { hash: schema });
  };
  return out as unknown as RouteHashSchemaEnhancer<H>;
}

/** Materialize and extract the routed component behind a route node. */
export function componentOf<T extends AppRouteNode<any, any, any, any, any, any>>(route: T): MaterializedAppRoute<
  RouteNodeParamsOf<T>,
  RouteNodeQueryOf<T>,
  RouteNodeHashOf<T>,
  T["component"],
  RouteNodeLoaderDataOf<T>,
  RouteNodeLoaderErrorOf<T>
> {
  return materializeNode(route);
}

function materializeTree(route: AppRouteNode<any, any, any, any, any, any>, parentFullPath = ""): void {
  materializeNode(route, parentFullPath);
  const fullPath = joinRoutePath(parentFullPath, route.path, route.kind);
  for (const child of route.children) {
    materializeTree(child, fullPath);
  }
}

function joinRoutePath(parentPath: string, childPath: string, kind: AppRouteNode["kind"]): string {
  if (kind === "index") return parentPath || "/";
  if (!childPath) return parentPath || "/";
  if (childPath.startsWith("/")) return childPath;
  const base = parentPath === "/" ? "" : parentPath.replace(/\/$/, "");
  return `${base}/${childPath}` || "/";
}

function normalizeRoutePattern(path: string, kind: AppRouteNode["kind"]): string {
  if (kind === "index") return "<index>";
  const normalized = path
    .split("/")
    .filter(Boolean)
    .map((part) => part.startsWith(":") ? ":param" : part)
    .join("/");
  return normalized || "/";
}

function unifiedJoinRoutePath(parentPath: string, route: AnyRoute): string {
  if (route.kind === "index") return parentPath || "/";
  if (!route.path) return parentPath || "/";
  if (route.path.startsWith("/")) return route.path;
  const base = parentPath === "/" ? "" : parentPath.replace(/\/$/, "");
  return `${base}/${route.path}` || "/";
}

function normalizedUnifiedRoutePattern(route: AnyRoute): string {
  if (route.kind === "index") return "<index>";
  const normalized = route.path
    .split("/")
    .filter(Boolean)
    .map((part) => part.startsWith(":") ? ":param" : part)
    .join("/");
  return normalized || "/";
}

function parentOfInternal(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): AnyAppRouteNode | AnyRoute | null {
  let found: AnyAppRouteNode | AnyRoute | null = null;
  const walk = (node: AnyAppRouteNode | AnyRoute) => {
    for (const child of node.children) {
      const typedChild = child as AnyAppRouteNode | AnyRoute;
      if (typedChild === target) {
        found = node;
        return;
      }
      walk(typedChild);
      if (found) return;
    }
  };
  if (root !== target) walk(root);
  return found;
}

function ancestorsOfInternal(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): ReadonlyArray<AnyAppRouteNode | AnyRoute> {
  const out: Array<AnyAppRouteNode | AnyRoute> = [];
  let current = parentOfInternal(root, target);
  while (current) {
    out.unshift(current);
    current = parentOfInternal(root, current);
  }
  return out;
}

function routeChainOfInternal(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): ReadonlyArray<AnyAppRouteNode | AnyRoute> {
  return [...ancestorsOfInternal(root, target), target];
}

function nodesInternal(root: AnyAppRouteNode | AnyRoute): ReadonlyArray<AnyAppRouteNode | AnyRoute> {
  const out: Array<AnyAppRouteNode | AnyRoute> = [];
  const walk = (node: AnyAppRouteNode | AnyRoute) => {
    out.push(node);
    for (const child of node.children) {
      walk(child as AnyAppRouteNode | AnyRoute);
    }
  };
  walk(root);
  return out;
}

function routePathOfTarget(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): string {
  return routeChainOfInternal(root, target).reduce((acc, node) =>
    isUnifiedRoute(node)
      ? unifiedJoinRoutePath(acc, node)
      : joinRoutePath(acc, node.path, node.kind), "") || "/";
}

function routeExactOfTarget(target: AnyAppRouteNode | AnyRoute): boolean | undefined {
  return isUnifiedRoute(target)
    ? target[UnifiedRouteSymbol].meta.exact ?? (target.kind === "index" ? true : undefined)
    : target.kind === "index" ? true : target.options.exact;
}

function routeIdOfTarget(target: AnyAppRouteNode | AnyRoute, fullPattern: string): string {
  return isUnifiedRoute(target)
    ? target[UnifiedRouteSymbol].meta.id ?? fullPattern
    : target.options.id ?? fullPattern;
}

function routeGuardsOfTarget(
  target: AnyAppRouteNode | AnyRoute,
): ReadonlyArray<Effect.Effect<unknown, any, any>> {
  if (isUnifiedRoute(target)) return target[UnifiedRouteSymbol].guards;
  // Guards live in two places on the legacy tier: piped onto the route NODE
  // (`Route.page(...).pipe(Route.guard(...))`) or stamped on the component
  // itself. Both must gate — reading only the component is how node-piped
  // guards were silently inert.
  const nodeGuards = isRouteNode(target)
    ? (target as { readonly __routeGuards?: ReadonlyArray<Effect.Effect<unknown, any, any>> })
      .__routeGuards ?? []
    : [];
  const component = routeComponentOfTarget(target);
  const componentGuards = component
    ? asRouteComponent(component).__routeGuards ?? []
    : [];
  return nodeGuards.length === 0
    ? componentGuards
    : [...nodeGuards, ...componentGuards];
}

function routeLoaderErrorCasesOfTarget(
  target: AnyAppRouteNode | AnyRoute,
): LoaderErrorCases<unknown, unknown> | undefined {
  if (isUnifiedRoute(target)) return target[UnifiedRouteSymbol].loaderErrorCases;
  const component = routeComponentOfTarget(target);
  return component
    ? asRouteComponent(component).__routeLoaderError as LoaderErrorCases<unknown, unknown> | undefined
    : undefined;
}

function routeLoaderOptionsOfTarget(target: AnyAppRouteNode | AnyRoute): LoaderOptions | undefined {
  if (isUnifiedRoute(target)) return target[UnifiedRouteSymbol].loaderOptions;
  const component = routeComponentOfTarget(target);
  return component ? asRouteComponent(component).__routeLoaderOptions : undefined;
}

function routeTitleOfTarget(target: AnyAppRouteNode | AnyRoute): StoredRouteTitle | undefined {
  if (isUnifiedRoute(target)) return target[UnifiedRouteSymbol].title;
  const component = routeComponentOfTarget(target);
  return component ? asRouteComponent(component).__routeTitle as StoredRouteTitle | undefined : undefined;
}

function routeMetaExtraOfTarget(target: AnyAppRouteNode | AnyRoute): StoredRouteMetaExtra | undefined {
  if (isUnifiedRoute(target)) return target[UnifiedRouteSymbol].metaExtra;
  const component = routeComponentOfTarget(target);
  return component ? asRouteComponent(component).__routeMetaExtra as StoredRouteMetaExtra | undefined : undefined;
}

function routeSitemapParamsOfTarget(target: AnyAppRouteNode | AnyRoute): (() => Effect.Effect<ReadonlyArray<unknown>>) | undefined {
  if (isUnifiedRoute(target)) {
    const component = target.component;
    return typeof component === "function"
      ? asRouteComponent(component as ComponentType<any, any, any, any, any>).__routeSitemapParams as (() => Effect.Effect<ReadonlyArray<unknown>>) | undefined
      : undefined;
  }
  const component = routeComponentOfTarget(target);
  return component ? asRouteComponent(component).__routeSitemapParams as (() => Effect.Effect<ReadonlyArray<unknown>>) | undefined : undefined;
}

function routeComponentOfTarget(target: AnyAppRouteNode | AnyRoute): ComponentType<any, any, any, any, any> | undefined {
  if (isUnifiedRoute(target)) {
    return typeof target.component === "function"
      ? target.component as ComponentType<any, any, any, any, any>
      : undefined;
  }
  return componentOf(target);
}

function targetHasLoader(target: AnyAppRouteNode | AnyRoute): boolean {
  if (isUnifiedRoute(target)) {
    return target[UnifiedRouteSymbol].loaderFn !== undefined;
  }
  const component = routeComponentOfTarget(target);
  return component ? asRouteComponent(component).__routeLoader !== undefined : false;
}

// ─── One normalized route-entry model ────────────────────────────────────────
//
// R2: `runMatchedLoaders`, `runStreamingNavigation`, `prefetch`,
// `collectSitemapEntries` and single-flight hydration used to each carry two
// near-identical bodies — one walking the route tree, one walking the global
// registry. Both are now projections onto this one entry shape, so there is a
// single implementation of each operation.

type RouteEntry = {
  readonly routeId: string;
  readonly fullPattern: string;
  readonly exact?: boolean;
  readonly hasLoader: boolean;
  readonly guards: ReadonlyArray<Effect.Effect<unknown, any, any>>;
  readonly loaderErrorCases?: LoaderErrorCases<unknown, unknown>;
  readonly loaderOptions?: LoaderOptions;
  readonly title?: StoredRouteTitle;
  readonly metaExtra?: StoredRouteMetaExtra;
  readonly sitemapParams?: () => Effect.Effect<ReadonlyArray<unknown>>;
  readonly meta: RouteMeta<any, any, any>;
  readonly component?: ComponentType<any, any, any, any, any>;
  /**
   * The parent loader's full pattern, given the patterns eligible to be a
   * parent. Tree sources answer from the tree (candidates ignored); registry
   * sources derive it by longest-prefix match, as the registry path always did.
   */
  readonly parentPattern: (candidates: ReadonlyArray<string>) => string | undefined;
  readonly linkOf: () => (params: unknown) => string;
  readonly runLoader: (url: URL, parentData: unknown) => Effect.Effect<UnknownRouteResult, never>;
};

function routeEntryOfTarget(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): RouteEntry {
  const fullPattern = routePathOfTarget(root, target);
  const routeId = routeIdOfTarget(target, fullPattern);
  const component = routeComponentOfTarget(target);
  const meta = isUnifiedRoute(target)
    ? { ...target[UnifiedRouteSymbol].meta, fullPattern }
    : { ...(component ? routeMetaOf(component) : undefined), pattern: target.path, fullPattern } as RouteMeta<any, any, any>;
  const parent = parentOfInternal(root, target);
  const parentFullPattern = parent ? routePathOfTarget(root, parent) : undefined;
  return {
    routeId,
    fullPattern,
    exact: routeExactOfTarget(target),
    hasLoader: targetHasLoader(target),
    guards: routeGuardsOfTarget(target),
    loaderErrorCases: routeLoaderErrorCasesOfTarget(target),
    loaderOptions: routeLoaderOptionsOfTarget(target),
    title: routeTitleOfTarget(target),
    metaExtra: routeMetaExtraOfTarget(target),
    sitemapParams: routeSitemapParamsOfTarget(target),
    meta,
    component,
    parentPattern: () => (parentFullPattern === undefined || parentFullPattern === fullPattern ? undefined : parentFullPattern),
    linkOf: () => (isUnifiedRoute(target) ? link(target) : link(componentOf(target))) as (params: unknown) => string,
    runLoader: (url, parentData) => {
      if (isUnifiedRoute(target)) return runRouteLoader(target, url, parentData);
      if (!component) return Effect.succeed(CoreResult.loading);
      const componentMeta = routeMetaOf(component);
      if (!componentMeta) return Effect.succeed(CoreResult.loading);
      // Cache identity comes from the ENTRY, not from the raw component's
      // meta: a node-piped `Route.id` lands on the component only at
      // materialization, and a diverging id here would cache the same
      // loader under two keys — running it once per key.
      return runRouteLoader(
        component,
        { ...componentMeta, id: routeId, fullPattern },
        url,
        parentData,
      );
    },
  };
}

function routeEntryOfRegistered(entry: RegisteredRoute): RouteEntry {
  const routed = asRouteComponent(entry.component);
  const fullPattern = entry.meta.fullPattern;
  return {
    routeId: entry.meta.id ?? fullPattern,
    fullPattern,
    exact: entry.meta.exact,
    hasLoader: routed.__routeLoader !== undefined,
    guards: routed.__routeGuards ?? [],
    loaderErrorCases: routed.__routeLoaderError as LoaderErrorCases<unknown, unknown> | undefined,
    loaderOptions: routed.__routeLoaderOptions,
    title: routed.__routeTitle as StoredRouteTitle | undefined,
    metaExtra: routed.__routeMetaExtra as StoredRouteMetaExtra | undefined,
    sitemapParams: routed.__routeSitemapParams as (() => Effect.Effect<ReadonlyArray<unknown>>) | undefined,
    meta: entry.meta,
    component: entry.component,
    parentPattern: (candidates) => findParentPattern(fullPattern, candidates),
    linkOf: () => link(entry.component) as (params: unknown) => string,
    runLoader: (url, parentData) => runRouteLoader(entry.component, entry.meta, url, parentData),
  };
}

/** Project any route source onto the normalized entry list. */
function routeEntriesOf(source: RouteSource): ReadonlyArray<RouteEntry> {
  if (isRouteRegistry(source)) {
    return source.entries.map(routeEntryOfRegistered);
  }
  return nodesInternal(source).map((target) => routeEntryOfTarget(source, target));
}

function registeredRoutesFromTree(root: AnyAppRouteNode | AnyRoute): ReadonlyArray<RegisteredRoute> {
  const out: Array<RegisteredRoute> = [];
  for (const entry of routeEntriesOf(root)) {
    if (!entry.component) continue;
    out.push({ component: entry.component, meta: entry.meta });
  }
  return out;
}

/**
 * Matched entries for a pathname, ordered root-first.
 *
 * Ranking is by resolved-pattern length, which R1 documented as the intended
 * (if crude) ordering; R5 owns specificity ranking.
 */
function matchedRouteEntries(entries: ReadonlyArray<RouteEntry>, pathname: string): ReadonlyArray<RouteEntry> {
  return entries
    .filter((entry) => entry.fullPattern.length > 0 && matchPattern(entry.fullPattern, pathname, entry.exact))
    .sort((a, b) => a.fullPattern.length - b.fullPattern.length);
}

function collectSitemapEntriesInternal(
  entries: ReadonlyArray<RouteEntry>,
  baseUrl: string,
): Effect.Effect<ReadonlyArray<{ readonly loc: string }>, never> {
  return Effect.gen(function* () {
    const out: Array<{ readonly loc: string }> = [];
    for (const entry of entries) {
      if (!entry.fullPattern || entry.fullPattern.includes(":")) {
        const enumerate = entry.sitemapParams;
        if (!enumerate) continue;
        const paramsList = yield* enumerate().pipe(
          Effect.match({
            onFailure: () => [] as ReadonlyArray<unknown>,
            onSuccess: (value) => value,
          }),
        );
        const linkFn = entry.linkOf();
        for (const paramsValue of paramsList) {
          out.push({ loc: new URL(linkFn(paramsValue), baseUrl).toString() });
        }
        continue;
      }
      out.push({ loc: new URL(entry.fullPattern, baseUrl).toString() });
    }
    return out;
  });
}

function runMatchedLoadersInternal(
  entries: ReadonlyArray<RouteEntry>,
  url: URL,
  options?: { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReactivityKeysInput },
): Effect.Effect<ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>, never> {
  return Effect.gen(function* () {
    const matched = matchedRouteEntries(entries, url.pathname);
    const matchedPatterns = matched.map((entry) => entry.fullPattern);

    const invalidatedKeys = options?.reactivityKeys ? normalizeReactivityKeys(options.reactivityKeys) : undefined;
    const candidates = matched.filter((entry) => {
      const isDeferred = entry.loaderOptions?.priority === "deferred";
      if (isDeferred && options?.includeDeferred === false) return false;
      if (!entry.hasLoader) return false;
      if (!invalidatedKeys || invalidatedKeys.length === 0) return true;
      const paramsRaw = extractParams(entry.fullPattern, url.pathname) ?? {};
      const loaderKeys = collectLoaderReactivityKeys(entry.routeId, paramsRaw, {
        fallback: entry.loaderOptions?.reactivityKeys,
      });
      return matchesLoaderReactivity(loaderKeys, invalidatedKeys);
    });

    const remaining = [...candidates];
    const outputs: Array<{ readonly routeId: string; readonly result: UnknownRouteResult }> = [];
    const successByPattern = new Map<string, unknown>();
    // DQ-035: a dependent loader is never fresher than its parent. A `Stale`
    // parent still feeds its child (discarding in-hand data is exactly what
    // `Stale` exists to avoid), but the child's own `Success` is degraded to
    // `Stale` carrying the parent's error — transitively, so a grandchild of a
    // stale parent is stale too. This is `Result.all`'s composition rule
    // applied along the loader tree.
    const staleErrorByPattern = new Map<string, unknown>();

    while (remaining.length > 0) {
      const runnable = remaining.filter((entry) => {
        if (!entry.loaderOptions?.dependsOnParent) return true;
        const parentPattern = entry.parentPattern(matchedPatterns);
        if (!parentPattern) return true;
        return successByPattern.has(parentPattern);
      });

      const batch = runnable.length > 0 ? runnable : [remaining[0] as RouteEntry];
      const batchResults = yield* Effect.all(batch.map((entry) => {
        const parentPattern = entry.parentPattern([...successByPattern.keys()]);
        const parentData = parentPattern ? successByPattern.get(parentPattern) : undefined;
        const inheritedStale =
          entry.loaderOptions?.dependsOnParent === true
            && parentPattern !== undefined
            && staleErrorByPattern.has(parentPattern)
            ? { error: staleErrorByPattern.get(parentPattern) }
            : undefined;
        return entry.runLoader(url, parentData).pipe(
          Effect.map((result) => ({
            routeId: entry.routeId,
            result: inheritedStale !== undefined && result._tag === "Success"
              ? CoreResult.stale(inheritedStale.error, result.value)
              : result,
            pattern: entry.fullPattern,
          })),
        );
      }), { concurrency: "unbounded" });

      for (const item of batchResults) {
        outputs.push({ routeId: item.routeId, result: item.result });
        const success = loaderSuccess(item.result);
        if (success !== undefined) {
          successByPattern.set(item.pattern, success.value);
        }
        if (item.result._tag === "Stale") {
          staleErrorByPattern.set(item.pattern, item.result.error);
        }
      }

      for (const entry of batch) {
        const idx = remaining.indexOf(entry);
        if (idx >= 0) remaining.splice(idx, 1);
      }
    }

    return outputs;
  });
}

interface StreamingNavigationResult {
  readonly critical: ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>;
  readonly deferredScripts: ReadonlyArray<string>;
  /**
   * Set when a matched route guard refused the request. The server render
   * paths translate this into a non-200 status; loaders never ran, so
   * neither `critical` nor `deferredScripts` can carry protected data.
   */
  readonly guardDenied?: { readonly error: unknown };
}

/**
 * R3's server half: run every matched guard, parents-first, fail-fast,
 * BEFORE any loader starts. Gating only the render would still let the
 * query execute and — for a deferred loader — serialize the payload into
 * the page before anyone checked whether the caller may see it. Returns the
 * denial (never fails), so callers decide the response shape.
 */
function matchedGuardDenial(
  entries: ReadonlyArray<RouteEntry>,
  url: URL,
): Effect.Effect<{ readonly error: unknown } | undefined, never> {
  const guards = matchedRouteEntries(entries, url.pathname).flatMap((entry) => entry.guards);
  if (guards.length === 0) return Effect.succeed(undefined);
  return Effect.exit(
    Effect.forEach(guards, (check) => check as Effect.Effect<unknown, unknown, never>, {
      discard: true,
    }),
  ).pipe(
    Effect.map((exit) =>
      exit._tag === "Failure"
        ? {
          error: Cause.findErrorOption(exit.cause).pipe(
            Option.getOrElse(() => exit.cause as unknown),
          ),
        }
        : undefined
    ),
  );
}

function runStreamingNavigationInternal(
  entries: ReadonlyArray<RouteEntry>,
  url: URL,
  options?: {
    /**
     * Set when the caller already ran (and passed) the matched-guard check,
     * so guards execute exactly once per door.
     */
    readonly guardsPrechecked?: boolean;
  },
): Effect.Effect<StreamingNavigationResult, never> {
  return Effect.gen(function* () {
    // The client navigation path runs its own guard pass in `RouterRuntime`
    // and calls `runMatchedLoaders` directly, so guards run once per door.
    if (options?.guardsPrechecked !== true) {
      const denial = yield* matchedGuardDenial(entries, url);
      if (denial !== undefined) {
        return { critical: [], deferredScripts: [], guardDenied: denial };
      }
    }
    // DQ-017 (fixed in place, 2026-08-11): ONE pass over all matched loaders.
    // Critical and deferred loaders fork together — waves only where
    // `dependsOnParent` orders them — so every loader starts before any
    // result gates anything and each runs exactly once per request. The old
    // critical-then-all double pass re-ran cache-missing loaders twice.
    const all = yield* runMatchedLoadersInternal(entries, url, { includeDeferred: true });
    const matched = matchedRouteEntries(entries, url.pathname);
    const deferredIds = new Set(
      matched
        .filter((entry) => entry.loaderOptions?.priority === "deferred")
        .map((entry) => entry.routeId),
    );
    const patternByRouteId = new Map(entries.map((entry) => [entry.routeId, entry.fullPattern] as const));
    const critical = all.filter((item) => !deferredIds.has(item.routeId));
    const deferred = all
      .filter((item) => deferredIds.has(item.routeId))
      .map((item) => {
        const pattern = patternByRouteId.get(item.routeId);
        return {
          ...item,
          params: (pattern ? extractParams(pattern, url.pathname) : null) ?? {},
        };
      });
    const deferredScripts = streamDeferredLoaderScripts(deferred);
    return { critical, deferredScripts };
  });
}

function setResolvedHeadEntries(
  store: RouteHeadStore,
  entries: ReadonlyArray<RouteEntry>,
  url: URL,
  results: ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>,
): void {
  const resultByRouteId = new Map(results.map((item) => [item.routeId, item.result] as const));
  for (const entry of matchedRouteEntries(entries, url.pathname)) {
    const title = entry.title;
    const metaExtra = entry.metaExtra;
    if (title === undefined && metaExtra === undefined) continue;

    const params = extractParams(entry.fullPattern, url.pathname) ?? {};
    const loaderResult = resultByRouteId.get(entry.routeId);
    const loaderData = loaderSuccess(loaderResult)?.value;
    const resolvedTitle = title === undefined
      ? undefined
      : typeof title === "function"
        ? title(params, loaderData, loaderResult)
        : title;
    const resolvedMeta = metaExtra === undefined
      ? undefined
      : typeof metaExtra === "function"
        ? metaExtra(params, loaderData, loaderResult)
        : metaExtra;

    store.entries.set(entry.routeId, {
      id: entry.routeId,
      depth: entry.fullPattern.split("/").filter(Boolean).length,
      title: resolvedTitle,
      meta: resolvedMeta,
    });
  }
}

/** Collect all route nodes in a tree. */
export function nodes(root: AppRouteNode<any, any, any, any, any, any>): ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>;
export function nodes(root: AnyRoute): ReadonlyArray<AnyRoute>;
export function nodes(root: AnyAppRouteNode | AnyRoute): ReadonlyArray<AnyAppRouteNode | AnyRoute> {
  return nodesInternal(root);
}

/** Find the parent of a route node inside a route tree. */
export function parentOf(root: AppRouteNode<any, any, any, any, any, any>, target: AppRouteNode<any, any, any, any, any, any>): AppRouteNode<any, any, any, any, any, any> | null;
export function parentOf(root: AnyRoute, target: AnyRoute): AnyRoute | null;
export function parentOf(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): AnyAppRouteNode | AnyRoute | null {
  return parentOfInternal(root, target);
}

/** Return all ancestors of a route node from root to nearest parent. */
export function ancestorsOf(root: AppRouteNode<any, any, any, any, any, any>, target: AppRouteNode<any, any, any, any, any, any>): ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>;
export function ancestorsOf(root: AnyRoute, target: AnyRoute): ReadonlyArray<AnyRoute>;
export function ancestorsOf(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): ReadonlyArray<AnyAppRouteNode | AnyRoute> {
  return ancestorsOfInternal(root, target);
}

/** Return the depth of a route node in its tree. */
export function depthOf(root: AppRouteNode<any, any, any, any, any, any>, target: AppRouteNode<any, any, any, any, any, any>): number;
export function depthOf(root: AnyRoute, target: AnyRoute): number;
export function depthOf(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): number {
  return ancestorsOfInternal(root, target).length;
}

/** Return the full chain from root to the target route node. */
export function routeChainOf(root: AppRouteNode<any, any, any, any, any, any>, target: AppRouteNode<any, any, any, any, any, any>): ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>;
export function routeChainOf(root: AnyRoute, target: AnyRoute): ReadonlyArray<AnyRoute>;
export function routeChainOf(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): ReadonlyArray<AnyAppRouteNode | AnyRoute> {
  return routeChainOfInternal(root, target);
}

/** Compute the resolved full path of a route node inside a tree. */
export function fullPathOf(root: AppRouteNode<any, any, any, any, any, any>, target: AppRouteNode<any, any, any, any, any, any>): string;
export function fullPathOf(root: AnyRoute, target: AnyRoute): string;
export function fullPathOf(root: AppRouteNode<any, any, any, any, any, any> | AnyRoute, target: AppRouteNode<any, any, any, any, any, any> | AnyRoute): string;
export function fullPathOf(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): string {
  return routeChainOfInternal(root, target).reduce((acc, node) =>
    isUnifiedRoute(node)
      ? unifiedJoinRoutePath(acc, node)
      : joinRoutePath(acc, node.path, node.kind), "") || "/";
}

/** Return parameter names present in the full route chain path. */
export function paramNamesOf(root: AppRouteNode<any, any, any, any, any, any>, target: AppRouteNode<any, any, any, any, any, any>): ReadonlyArray<string>;
export function paramNamesOf(root: AnyRoute, target: AnyRoute): ReadonlyArray<string>;
export function paramNamesOf(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): ReadonlyArray<string> {
  const names = new Set<string>();
  for (const node of routeChainOfInternal(root, target)) {
    for (const part of node.path.split("/").filter(Boolean)) {
      if (part.startsWith(":")) names.add(paramNameOf(part));
    }
  }
  return [...names];
}

/** Validate a route tree for duplicate ids and duplicate param names within a chain. */
export function validateTree(root: AppRouteNode<any, any, any, any, any, any>): ReadonlyArray<string>;
export function validateTree(root: AnyRoute): ReadonlyArray<string>;
export function validateTree(root: AnyAppRouteNode | AnyRoute): ReadonlyArray<string> {
  if (!isUnifiedRoute(root)) {
    const errors: Array<string> = [];
    const seenIds = new Map<string, AnyAppRouteNode>();
    const walkNode = (node: AnyAppRouteNode, parentChain: ReadonlyArray<AnyAppRouteNode>) => {
      const routeId = node.options.id;
      if (routeId) {
        if (seenIds.has(routeId)) errors.push(`Duplicate route id '${routeId}'`);
        else seenIds.set(routeId, node);
      }
      const chain = [...parentChain, node];
      const seenParams = new Set<string>();
      for (const route of chain) {
        for (const part of route.path.split("/").filter(Boolean)) {
          if (!part.startsWith(":")) continue;
          const name = paramNameOf(part);
          if (seenParams.has(name)) errors.push(`Duplicate route param '${name}' in chain for '${fullPathOf(root, node)}'`);
          seenParams.add(name);
        }
      }
      const siblingPatterns = new Map<string, AnyAppRouteNode>();
      for (const child of node.children) {
        const normalized = normalizeRoutePattern(child.path, child.kind);
        if (siblingPatterns.has(normalized)) errors.push(`Conflicting sibling routes under '${fullPathOf(root, node)}': '${child.path}' conflicts with '${siblingPatterns.get(normalized)?.path ?? ""}'`);
        else siblingPatterns.set(normalized, child);
      }
      for (const child of node.children) walkNode(child, chain);
    };
    walkNode(root, []);
    return errors;
  }

  const errors: Array<string> = [];
  const seenIds = new Map<string, AnyRoute>();
  const walkRoute = (route: AnyRoute, parentChain: ReadonlyArray<AnyRoute>) => {
    const routeId = route[UnifiedRouteSymbol].meta.id;
    if (routeId) {
      if (seenIds.has(routeId)) errors.push(`Duplicate route id '${routeId}'`);
      else seenIds.set(routeId, route);
    }
    const chain = [...parentChain, route];
    const seenParams = new Set<string>();
    for (const item of chain) {
      for (const part of item.path.split("/").filter(Boolean)) {
        if (!part.startsWith(":")) continue;
        const name = paramNameOf(part);
        if (seenParams.has(name)) errors.push(`Duplicate route param '${name}' in chain for '${fullPathOf(root, route)}'`);
        seenParams.add(name);
      }
    }
    const siblingPatterns = new Map<string, AnyRoute>();
    for (const child of route.children) {
      const typedChild = child as AnyRoute;
      const normalized = normalizedUnifiedRoutePattern(typedChild);
      if (siblingPatterns.has(normalized)) {
        errors.push(`Conflicting sibling routes under '${fullPathOf(root, route)}': '${typedChild.path}' conflicts with '${siblingPatterns.get(normalized)?.path ?? ""}'`);
      } else {
        siblingPatterns.set(normalized, typedChild);
      }
    }
    if (route.kind !== "layout" && route.children.length > 0) {
      errors.push(`Route '${fullPathOf(root, route)}' has children but is not a layout route`);
    }
    for (const child of route.children) walkRoute(child as AnyRoute, chain);
  };
  walkRoute(root, []);
  return errors;
}

/**
 * Render an app route tree for a server request into a structured SSR result.
 *
 * During the unified-route migration this accepts both legacy route nodes and
 * unified route roots. Unified route roots use tree-based loader streaming and
 * route-owned head metadata resolution.
 */
export function renderRequest<T extends AppRouteNode<any, any, any, any, any, any>>(
  app: T,
  options: {
    readonly request: Request;
    readonly layer?: Layer.Layer<any>;
  },
): Effect.Effect<RenderRequestResult, never>;
export function renderRequest(
  app: AnyRoute | AppRouteNode<any, any, any, any, any, any>,
  options: {
    readonly request: Request;
    readonly layer?: Layer.Layer<any>;
  },
): Effect.Effect<RenderRequestResult, never>;
export function renderRequest(
  app: AnyRoute | AppRouteNode<any, any, any, any, any, any>,
  options: {
    readonly request: Request;
    readonly layer?: Layer.Layer<any>;
  },
): Effect.Effect<RenderRequestResult, never> {
  return Effect.gen(function* () {
    const headerMap = new Map<string, Array<string>>();
    let status = 200;
    const responseService = {
      setStatus: (next: number) => {
        status = next;
      },
      setHeader: (name: string, value: string) => {
        headerMap.set(name.toLowerCase(), [value]);
      },
      appendHeader: (name: string, value: string) => {
        const key = name.toLowerCase();
        headerMap.set(key, [...(headerMap.get(key) ?? []), value]);
      },
      redirect: (location: string, nextStatus = 302) => {
        status = nextStatus;
        headerMap.set("location", [location]);
      },
      notFound: () => {
        status = 404;
      },
      snapshot: () => ({ status, headers: headerMap as ReadonlyMap<string, ReadonlyArray<string>> }),
    };
    const requestUrl = new URL(options.request.url);
    // Per-request state: this render's head entries and loader cache are its
    // own, so concurrent renders cannot see each other and neither can clobber
    // the client stores.
    const headStore = makeRouteHeadStore({ applyToDocument: false });
    const loaderCache = makeLoaderCacheStore(); loaderCache.requestScoped = true;
    const routeEntries = routeEntriesOf(app);
    const streaming = yield* runStreamingNavigationInternal(routeEntries, requestUrl).pipe(
      Effect.provideService(LoaderCacheTag, loaderCache),
    );
    // A guard refusal is visible to the host as a status, not only as an
    // absence of loader data ("learns nothing" needs both halves). Marking
    // the request's cache store is what stops the RENDER from re-running the
    // protected loader on a cache miss.
    if (streaming.guardDenied !== undefined) {
      responseService.setStatus(403);
      loaderCache.guardDenied = true;
    }
    const appComponent = isUnifiedRoute(app) ? app.component : componentOf(app);
    let effect = ComponentRuntime.renderEffect(appComponent, {}).pipe(
      Effect.provide(Server({ url: requestUrl.toString() })),
      Effect.provideService(ServerRequestTag, { request: options.request, url: requestUrl }),
      Effect.provideService(ServerResponseTag, responseService),
      Effect.provideService(RouteHeadTag, headStore),
      Effect.provideService(LoaderCacheTag, loaderCache),
      Effect.provideService(RouteSourceTag, { source: app }),
    ) as Effect.Effect<unknown, never, never>;
    if (options.layer) {
      effect = effect.pipe(Effect.provide(options.layer)) as Effect.Effect<unknown, never, never>;
    }

    // Unified-route trees own their head metadata up front; route-node trees
    // still resolve head during render via `Component.route`.
    if (isUnifiedRoute(app)) {
      setResolvedHeadEntries(headStore, routeEntries, requestUrl, streaming.critical);
      // R3 (`DQ-030`): a matched loader failure with declared
      // `loaderErrorCases` renders the tagged fallback instead of the page
      // component — the failure is neither thrown nor silently swallowed.
      for (const item of streaming.critical) {
        if (item.result._tag !== "Failure") continue;
        const entry = routeEntries.find(
          (candidate) => candidate.routeId === item.routeId,
        );
        const cases = entry?.loaderErrorCases;
        if (cases === undefined) continue;
        const error = item.result.error;
        const tag = typeof error === "object" && error !== null && "_tag" in error
          ? String((error as { readonly _tag: unknown })._tag)
          : "_";
        const record = cases as Readonly<
          Record<string, ((error: unknown, params: unknown) => unknown) | undefined>
        >;
        const handler = record[tag] ?? record["_"];
        if (handler === undefined) continue;
        const params = entry === undefined
          ? {}
          : extractParams(entry.fullPattern, requestUrl.pathname) ?? {};
        const fallbackView = handler(error, params);
        effect = Effect.succeed(fallbackView) as Effect.Effect<unknown, never, never>;
        break;
      }
    }
    const previousRequestEvent = getRequestEvent();
    setRequestEvent({ request: options.request, url: requestUrl });
    let html: string;
    try {
      html = runInRouteHeadStore(headStore, () =>
        runInLoaderCacheStore(loaderCache, () => renderToString(() => Effect.runSync(effect))));
    } finally {
      setRequestEvent(previousRequestEvent);
    }
    const head = resolveRouteHeadOf(headStore);
    return {
      status,
      headers: new Map(headerMap),
      head,
      html,
      loaderPayload: streaming.critical,
      deferred: streaming.deferredScripts,
    } satisfies RenderRequestResult;
  });
}

/**
 * Streaming server navigation (M11 item 4, `DQ-017`): fork ALL matched
 * loaders — critical and deferred — as one concurrent pass under the request,
 * and flush the shell immediately instead of `renderRequest`'s
 * loaders-then-render sequence. The stream emits the shell HTML first, then
 * one chunk of `DQ-034` loader-handoff entries (inert `data-af-loader` JSON
 * scripts — the same wire `renderRequest` uses, no new format) once every
 * loader settles, so client hydration fills the loader cache instead of
 * refetching.
 *
 * Slice limits, deliberate: the shell renders WITHOUT waiting on critical
 * loader data, so unified-route head enrichment and `loaderErrorCases`
 * fallbacks (both derived from critical results) stay on `renderRequest`;
 * a component that must render FROM loader data belongs behind an async
 * region (`renderComponentAsync`) once regions route through it.
 */
export function renderRequestStream<T extends AppRouteNode<any, any, any, any, any, any>>(
  app: T,
  options: {
    readonly request: Request;
    readonly layer?: Layer.Layer<any>;
  },
): Stream.Stream<string, never>;
export function renderRequestStream(
  app: AnyRoute | AppRouteNode<any, any, any, any, any, any>,
  options: {
    readonly request: Request;
    readonly layer?: Layer.Layer<any>;
  },
): Stream.Stream<string, never>;
export function renderRequestStream(
  app: AnyRoute | AppRouteNode<any, any, any, any, any, any>,
  options: {
    readonly request: Request;
    readonly layer?: Layer.Layer<any>;
  },
): Stream.Stream<string, never> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const requestUrl = new URL(options.request.url);
      const headerMap = new Map<string, Array<string>>();
      let status = 200;
      const responseService = {
        setStatus: (next: number) => {
          status = next;
        },
        setHeader: (name: string, value: string) => {
          headerMap.set(name.toLowerCase(), [value]);
        },
        appendHeader: (name: string, value: string) => {
          const key = name.toLowerCase();
          headerMap.set(key, [...(headerMap.get(key) ?? []), value]);
        },
        redirect: (location: string, nextStatus = 302) => {
          status = nextStatus;
          headerMap.set("location", [location]);
        },
        notFound: () => {
          status = 404;
        },
        snapshot: () => ({ status, headers: headerMap as ReadonlyMap<string, ReadonlyArray<string>> }),
      };
      const headStore = makeRouteHeadStore({ applyToDocument: false });
      const loaderCache = makeLoaderCacheStore(); loaderCache.requestScoped = true;
      const routeEntries = routeEntriesOf(app);

      // R3's server half: the guard verdict must exist BEFORE the shell
      // renders (the shell flushes immediately, and the render path consults
      // the denial mark), so guards run here rather than inside the forked
      // loader pass.
      const guardDenial = yield* matchedGuardDenial(routeEntries, requestUrl);
      if (guardDenial !== undefined) {
        status = 403;
        loaderCache.guardDenied = true;
      }

      // Every matched loader is in flight BEFORE any component renders.
      // Detached, as renderToStream's region fibers are: the unwrap effect's
      // own fiber ends once the stream is built, and a child fiber would be
      // interrupted with it before the handoff chunk joins.
      const loadersFiber = yield* Effect.forkDetach(
        guardDenial !== undefined
          ? Effect.succeed<StreamingNavigationResult>({ critical: [], deferredScripts: [] })
          : runStreamingNavigationInternal(routeEntries, requestUrl, {
            guardsPrechecked: true,
          }).pipe(
            Effect.provideService(LoaderCacheTag, loaderCache),
          ),
      );

      const appComponent = isUnifiedRoute(app) ? app.component : componentOf(app);
      let effect = ComponentRuntime.renderEffect(appComponent, {}).pipe(
        Effect.provide(Server({ url: requestUrl.toString() })),
        Effect.provideService(ServerRequestTag, { request: options.request, url: requestUrl }),
        Effect.provideService(ServerResponseTag, responseService),
        Effect.provideService(RouteHeadTag, headStore),
        Effect.provideService(LoaderCacheTag, loaderCache),
        Effect.provideService(RouteSourceTag, { source: app }),
      ) as Effect.Effect<unknown, never, never>;
      if (options.layer) {
        effect = effect.pipe(Effect.provide(options.layer)) as Effect.Effect<unknown, never, never>;
      }

      const shell = Effect.sync(() => {
        const previousRequestEvent = getRequestEvent();
        setRequestEvent({ request: options.request, url: requestUrl });
        try {
          return runInRouteHeadStore(headStore, () =>
            runInLoaderCacheStore(loaderCache, () => renderToString(() => Effect.runSync(effect))));
        } finally {
          setRequestEvent(previousRequestEvent);
        }
      });

      // One handoff chunk once every loader settles: critical results ride
      // the same DQ-034 entry scripts as deferred ones, so the client cache
      // fill (`hydrateLoaderHandoff`) covers the whole navigation.
      const patternByRouteId = new Map(
        routeEntries.map((entry) => [entry.routeId, entry.fullPattern] as const),
      );
      const handoff = Fiber.join(loadersFiber).pipe(
        Effect.map(({ critical, deferredScripts }) => {
          const criticalScripts = streamDeferredLoaderScripts(
            critical.map((item) => {
              const pattern = patternByRouteId.get(item.routeId);
              return {
                ...item,
                params:
                  (pattern ? extractParams(pattern, requestUrl.pathname) : null)
                    ?? {},
              };
            }),
          );
          return [...criticalScripts, ...deferredScripts].join("");
        }),
      );

      return Stream.fromEffect(shell).pipe(
        Stream.concat(Stream.fromEffect(handoff)),
        Stream.filter((chunk) => chunk.length > 0),
      );
    }),
  );
}

export type RouteLink<P, Q> = ((paramsValue: P, options?: { readonly query?: Partial<Q>; readonly hash?: string }) => string) & {
  readonly pattern: string;
};

/** Access the current server request inside SSR/server handlers. */
export const serverRequest = Effect.service(ServerRequestTag);

/** Access just the current request URL inside SSR/server handlers. */
export const serverUrl = Effect.service(ServerRequestTag).pipe(Effect.map((value) => value.url));

/** Set the current server response status. */
export const setStatus = (status: number) =>
  Effect.service(ServerResponseTag).pipe(Effect.map((response) => response.setStatus(status)));

/** Set a response header on the current server response. */
export const setHeader = (name: string, value: string) =>
  Effect.service(ServerResponseTag).pipe(Effect.map((response) => response.setHeader(name, value)));

/** Append a response header on the current server response. */
export const appendHeader = (name: string, value: string) =>
  Effect.service(ServerResponseTag).pipe(Effect.map((response) => response.appendHeader(name, value)));

/** Mark the current server response as a redirect. */
export const serverRedirect = (location: string, status = 302) =>
  Effect.service(ServerResponseTag).pipe(Effect.map((response) => response.redirect(location, status)));

/** Mark the current server response as not found. */
export const serverNotFound = () =>
  Effect.service(ServerResponseTag).pipe(Effect.map((response) => response.notFound()));

export function resolvePattern(parentPrefix: string, pattern: string): string {
  if (pattern.startsWith("/")) return pattern;
  const base = parentPrefix.endsWith("/") ? parentPrefix.slice(0, -1) : parentPrefix;
  return `${base}/${pattern}`.replace(/\/+/g, "/");
}

/** Param name for a `:name` / `:name?` pattern segment, with any `?` stripped. */
function paramNameOf(part: string): string {
  return part.slice(1).replace(/\?$/, "");
}

// R5.4: `Route` and `ServerRoute` share one segment engine
// (`route-pattern.ts`), so the grammars — `:param`, `:param?`, `*` — cannot
// drift between the two matchers or between matching and `Route.link`.
export function extractParams(pattern: string, pathname: string): Record<string, string> | null {
  return extractPatternParams(pattern, pathname, false);
}

export function matchPattern(pattern: string, pathname: string, exact?: boolean): boolean {
  return matchPatternSegments(pattern, pathname, exact === true);
}

export const params = Effect.gen(function* () {
  const ctx = yield* RouteContextTag;
  return ctx.params();
});

export const query = Effect.gen(function* () {
  const ctx = yield* RouteContextTag;
  return ctx.query();
});

export const hash = Effect.gen(function* () {
  const ctx = yield* RouteContextTag;
  return ctx.hash();
});

export const prefix = Effect.gen(function* () {
  const ctx = yield* RouteContextTag;
  return ctx.prefix();
});

/**
 * Read the current route loader data atom from route context.
 *
 * Use inside component setup when the component is rendered under a route with
 * `Route.loader(...)`. The returned atom throws if read before loader data is
 * available.
 */
export function loaderData<A>(): Effect.Effect<Atom.ReadonlyAtom<A>, never, RouteContext<any, any, any>> {
  return Effect.gen(function* () {
    const ctx = yield* RouteContextTag;
    const direct = ctx.loaderData;
    if (direct) return direct as Atom.ReadonlyAtom<A>;
    const result = ctx.loaderResult;
    if (result) {
      return Atom.derived(() => {
        const current = result();
        const success = loaderSuccess(current);
        if (success !== undefined) return success.value as A;
        throw new Error("[effect-atom-jsx/Route] loader data not available yet.");
      }) as Atom.ReadonlyAtom<A>;
    }
    throw new Error("[effect-atom-jsx/Route] loaderData used without Route.loader.");
  });
}

/**
 * Loader state accessor for async rendering, as the unified `Result` model
 * (`Loading` / `Refreshing` / `Success` / `Failure` / `Defect`) — the same
 * model queries and actions emit. Use this with `Async` / `Result`
 * control-flow components.
 */
export function loaderResult<A, E = unknown>(): Effect.Effect<Atom.ReadonlyAtom<CoreResultType<A, E>>, never, RouteContext<any, any, any>> {
  return Effect.gen(function* () {
    const ctx = yield* RouteContextTag;
    if (ctx.loaderResult) {
      return ctx.loaderResult as Atom.ReadonlyAtom<CoreResultType<A, E>>;
    }
    if (ctx.loaderData) {
      return Atom.derived(() => CoreResult.success(ctx.loaderData!() as A)) as Atom.ReadonlyAtom<CoreResultType<A, E>>;
    }
    return Atom.derived(() => CoreResult.loading) as Atom.ReadonlyAtom<CoreResultType<A, E>>;
  });
}

export function matches(pattern: string): Effect.Effect<Atom.ReadonlyAtom<boolean>, never, RouterService> {
  return Effect.gen(function* () {
    const router = yield* RouterTag;
    return Atom.derived(() => matchPattern(pattern, router.url().pathname));
  });
}

/**
 * Create a typed URL builder for a routed component or route node.
 *
 * @example
 * const href = Route.link(UserRoute)({ userId: "alice" })
 */
export function link<T extends ComponentType<any, any, any, any, any> | AppRouteNode<any, any, any, any, any, any> | AnyRoute>(
  routed: T,
): T extends AppRouteNode<infer P, infer Q, any, any, any, any>
  ? RouteLink<P, Q>
  : T extends Route<any, infer P, infer Q, any, any, any>
    ? RouteLink<P, Q>
  : T extends RoutedComponent<any, any, any>
    ? RouteLink<RouteParamsOf<T>, RouteQueryOf<T>>
  : RouteLink<Record<string, string>, Record<string, string>> {
  const routedComponent = isRouteNode(routed)
    ? materializeNode(routed as AppRouteNode<any, any, any, any, any, any>)
    : routed;
  const meta = isUnifiedRoute(routed)
    ? routed[UnifiedRouteSymbol].meta
    : getRouteMeta(asRouteComponent(routedComponent as ComponentType<any, any, any, any, any>));
  if (!meta) {
    throw new Error("[effect-atom-jsx/Route] Route.link requires a routed component or unified route.");
  }

  const encodeParams = encodeWithSchema(meta.paramsSchema);
  const encodeQuery = meta.querySchema ? encodeWithSchema(meta.querySchema) : undefined;

  const make = (paramsValue: RouteParamsOf<T>, options?: { readonly query?: Partial<RouteQueryOf<T>>; readonly hash?: string }) => {
    // DQ-038: substitution goes through the shared segment model, so an
    // absent optional segment disappears instead of leaving a stray `?`.
    const encoded = encodeParams(paramsValue) as Record<string, unknown>;
    let path = substitutePattern(meta.fullPattern, encoded ?? {});

    if (options?.query) {
      // Without a declared query schema the values pass through untyped —
      // query composition must not silently vanish on schema-less routes.
      const q = encodeQuery
        ? encodeQuery(options.query as RouteQueryOf<T>) as Record<string, unknown>
        : options.query as Record<string, unknown>;
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v !== undefined) usp.set(k, String(v));
      }
      const qs = usp.toString();
      if (qs.length > 0) path += `?${qs}`;
    }

    if (options?.hash) path += `#${options.hash}`;
    return path;
  };
  return Object.assign(make, { pattern: meta.fullPattern }) as T extends AppRouteNode<infer P, infer Q, any, any, any, any>
    ? RouteLink<P, Q>
    : T extends Route<any, infer P, infer Q, any, any, any>
      ? RouteLink<P, Q>
    : T extends RoutedComponent<any, any, any>
      ? RouteLink<RouteParamsOf<T>, RouteQueryOf<T>>
      : RouteLink<Record<string, string>, Record<string, string>>;
}

/** JSX-friendly anchor helper backed by a typed route link. */
export function Link<P, Q>(props: {
  readonly to: RouteLink<P, Q> | (((paramsValue: P, options?: { readonly query?: Partial<Q>; readonly hash?: string }) => string) & { readonly pattern?: string });
  readonly params: P;
  readonly query?: Partial<Q>;
  readonly hash?: string;
  readonly class?: string | ((active: boolean) => string);
  readonly preload?: "hover";
  readonly children: unknown;
}) {
  const runtime = useContext(ManagedRuntimeContext);
  const href = props.to(props.params, { query: props.query, hash: props.hash });
  // DQ-031: active state reads the ROUTER SERVICE's URL — `window.location`
  // is simply wrong under the Hash, Memory, and Server layers, so there is no
  // browser fallback of any kind here.
  const serviceOption = runtime === null
    ? undefined
    : runtime.runSync(Effect.serviceOption(RouterTag));
  const routerService = serviceOption !== undefined && serviceOption._tag === "Some"
    ? serviceOption.value
    : undefined;
  const active = props.to.pattern !== undefined && routerService !== undefined
    ? matchPattern(props.to.pattern, routerService.url().pathname)
    : false;
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    if (runtime !== null) {
      runtime.runFork(Effect.gen(function* () {
        const router = yield* RouterTag;
        yield* router.navigate(href);
      }) as Effect.Effect<void, never, never>);
    }
    // No `pushState` + synthetic `PopStateEvent` fallback: a Link outside a
    // router runtime is inert rather than a second navigation stack.
  };
  const onMouseEnter = () => {
    if (props.preload !== "hover" || runtime === null) return;
    runtime.runFork(Effect.gen(function* () {
      const router = yield* RouterTag;
      if (router.preload) {
        yield* router.preload(href);
      }
      const source = yield* resolveRouteSource();
      if (source !== undefined) {
        yield* prefetch(source, props.to as RouteLink<P, Q>, props.params, { query: props.query, hash: props.hash, scope: "full" });
      }
    }) as Effect.Effect<void, never, never>);
  };
  const className = typeof props.class === "function" ? props.class(active) : props.class;
  // No document, no anchor: outside any DOM (browser or installed server
  // document) the Link is inert rather than reaching for browser globals.
  if ((globalThis as { readonly document?: unknown }).document === undefined) {
    return null;
  }
  return createComponent("a" as any, {
    href,
    class: className,
    onClick,
    onMouseEnter,
    children: props.children,
  });
}

export function queryAtom<A>(
  key: string,
  schema: Schema.Schema<A>,
  options: { readonly default: A },
): Effect.Effect<Atom.WritableAtom<A>, never, RouterService> {
  return Effect.gen(function* () {
    const router = yield* RouterTag;
    const decode = decodeWithSchemaOption(schema);
    const encode = encodeWithSchema(schema);
    const defaultEncoded = String(encode(options.default));

    // DQ-031(b): a signal write navigates optimistically, then reconciles.
    // The atom updates immediately from the written value; the navigation is
    // FORKED (never `Effect.runSync` around an async navigation); a failed
    // navigation rolls the atom back to the URL's value and surfaces the
    // error on the service's navigation error channel. The accepted cost is a
    // visible window where atom and URL disagree — the same trade every
    // optimistic update makes, bounded by the rollback rule.
    const [override, setOverride] = createSignal<{ readonly value: A } | null>(null);
    return Atom.writable(
      () => {
        const pending = override();
        if (pending !== null) return pending.value;
        const raw = router.url().searchParams.get(key);
        if (raw === null) return options.default;
        const decoded = decode(raw);
        return decoded._tag === "Some" ? decoded.value : options.default;
      },
      (_ctx, next) => {
        const url = new URL(router.url().toString());
        const encoded = String(encode(next));
        if (encoded === defaultEncoded) {
          url.searchParams.delete(key);
        } else {
          url.searchParams.set(key, encoded);
        }
        setOverride({ value: next });
        Effect.runFork(
          router.navigate(url.pathname + url.search + url.hash, { replace: true }).pipe(
            Effect.matchEffect({
              onSuccess: () =>
                Effect.sync(() => {
                  // Reconciled: the URL now carries the value.
                  setOverride(null);
                }),
              onFailure: (error) =>
                Effect.sync(() => {
                  // Rolled back: never left showing a state that did not land.
                  setOverride(null);
                }).pipe(
                  Effect.andThen(
                    router.onNavigationError === undefined
                      ? Effect.void
                      : router.onNavigationError(error),
                  ),
                ),
            }),
          ),
        );
      },
    );
  });
}

/**
 * Attach a loader to a component or route node.
 *
 * Loader requirements/errors bubble through route execution and SSR. Results
 * are keyed by route id and readable with `Route.loaderData()` or
 * `Route.loaderResult()`.
 */
export function loader<T extends AnyAppRouteNode, A, E, R>(
  fn: (params: RouteNodeParamsOf<T>, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, R>,
  options?: LoaderOptions,
): NodeLoaderEnhancer<T, A, E, R>;
export function loader<C extends ComponentType<any, any, any, any, any>, P, Q, H, A, E, R>(
  fn: (params: P, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, R>,
  options?: LoaderOptions,
): LoaderRouteEnhancer<P, A, E, R>;
export function loader<P, A, E, R>(
  fn: (params: P, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, R>,
  options?: LoaderOptions,
): LoaderEnhancer<P, A, E, R>;
export function loader<P, A, E, R>(
  fn: (params: P, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, R>,
  options?: LoaderOptions,
): LoaderRouteEnhancer<P, A, E, R> {
  const attach = (route: AnyRouteAttachTarget | AnyRoute) => {
    if (isUnifiedRoute(route)) {
      return copyUnifiedRoute(route, {
        loaderFn: fn as LoaderFn,
        loaderOptions: options ?? {},
        loader: {} as { readonly data: A; readonly error: E },
      });
    }
    if (isRouteNode(route)) {
      return appendNodeEnhancer(route, (component) => {
        setLoaderInternals(component, fn, options);
        return component;
      });
    }
    setLoaderInternals(route, fn, options);
    return route;
  };
  return attach as LoaderRouteEnhancer<P, A, E, R>;
}

/** Attach loader error renderers keyed by typed error `_tag`. */
export function loaderError(
  cases: LoaderErrorCases<any, any>,
): <C extends ComponentType<any, any, any, any, any> | AnyRoute>(component: C) => C {
  return <C extends ComponentType<any, any, any, any, any> | AnyRoute>(component: C): C => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        loaderErrorCases: cases,
      }) as C;
    }
    asRouteComponent(component).__routeLoaderError = cases;
    return component;
  };
}

export const reload: Effect.Effect<void, never, RouterService> = Effect.gen(function* () {
  const router = yield* RouterTag;
  const current = router.url();
  yield* router.navigate(current.pathname + current.search + current.hash, { replace: true }).pipe(
    Effect.catch((error) =>
      router.onNavigationError === undefined
        ? Effect.void
        : router.onNavigationError(error)
    ),
  );
});

/** Prefetch the loaders a link target would run, against an explicit source. */
export function prefetch<P, Q>(
  source: RouteSource,
  to: RouteLink<P, Q>,
  paramsValue: P,
  options?: { readonly query?: Partial<Q>; readonly hash?: string; readonly scope?: "loader" | "component" | "full" },
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const href = to(paramsValue, { query: options?.query, hash: options?.hash });
    const url = new URL(href, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    yield* runMatchedLoaders(source, url, { includeDeferred: true });
  }) as Effect.Effect<void, never>;
}

function resolveSingleFlightRouteId(target: LoaderTarget): string {
  if (typeof target === "string") {
    return target;
  }
  if (isUnifiedRoute(target)) {
    const meta = target[UnifiedRouteSymbol].meta;
    return meta.id ?? meta.fullPattern;
  }
  const meta = getRouteMeta(asRouteComponent(target));
  return meta?.id ?? meta?.fullPattern ?? "";
}

/**
 * Build a seeded loader success entry from canonical mutation data.
 *
 * Useful when the mutation result already contains the exact next loader value.
 */
export function setLoaderData<C extends ComponentType<any, any, any, any, any> & LoaderTaggedComponent<any, any>>(
  route: C,
  data: RouteLoaderDataOf<C>,
): SingleFlightLoaderEntry;
export function setLoaderData<C extends AnyRoute>(
  route: C,
  data: LoaderDataOf<C>,
): SingleFlightLoaderEntry;
export function setLoaderData<A>(
  routeId: string,
  data: A,
): SingleFlightLoaderEntry;
export function setLoaderData(
  route: LoaderTarget,
  data: unknown,
): SingleFlightLoaderEntry {
  return {
    routeId: resolveSingleFlightRouteId(route),
    result: CoreResult.success(data),
  };
}

/**
 * Build a seeded loader result entry from a fully formed `Result` value.
 *
 * Use this when you want to seed loading/failure/success explicitly.
 */
export function setLoaderResult<C extends ComponentType<any, any, any, any, any> & LoaderTaggedComponent<any, any>>(
  route: C,
  result: CoreResultType<RouteLoaderDataOf<C>, RouteLoaderErrorOf<C>>,
): SingleFlightLoaderEntry;
export function setLoaderResult<C extends AnyRoute>(
  route: C,
  result: CoreResultType<LoaderDataOf<C>, LoaderErrorOf<C>>,
): SingleFlightLoaderEntry;
export function setLoaderResult(
  routeId: string,
  result: UnknownRouteResult,
): SingleFlightLoaderEntry;
export function setLoaderResult(
  route: LoaderTarget,
  result: UnknownRouteResult,
): SingleFlightLoaderEntry {
  return {
    routeId: resolveSingleFlightRouteId(route),
    result,
  };
}

/**
 * Convenience helper for the common case where a mutation result can be mapped
 * directly into a loader success payload.
 */
export function seedLoader<A, C extends ComponentType<any, any, any, any, any> & LoaderTaggedComponent<any, any>>(
  route: C,
  select?: (result: A) => RouteLoaderDataOf<C>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoader<A, C extends AnyRoute>(
  route: C,
  select?: (result: A) => LoaderDataOf<C>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoader<A>(
  route: LoaderTarget,
  select?: (result: A) => unknown,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry> {
  return (result) => [{
    routeId: resolveSingleFlightRouteId(route),
    result: CoreResult.success(select ? select(result) : result),
  }];
}

/**
 * Convenience helper for projecting a mutation result into an arbitrary loader
 * `Result` payload.
 */
export function seedLoaderResult<A, C extends ComponentType<any, any, any, any, any> & LoaderTaggedComponent<any, any>>(
  route: C,
  select: (result: A) => CoreResultType<RouteLoaderDataOf<C>, RouteLoaderErrorOf<C>>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoaderResult<A, C extends AnyRoute>(
  route: C,
  select: (result: A) => CoreResultType<LoaderDataOf<C>, LoaderErrorOf<C>>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoaderResult<A>(
  route: LoaderTarget,
  select: (result: A) => UnknownRouteResult,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry> {
  return (result) => [{
    routeId: resolveSingleFlightRouteId(route),
    result: select(result),
  }];
}

/**
 * Create a route-scoped action/mutation helper.
 *
 * `reactivityKeys` invalidate matching loaders/queries after success.
 */
export function action<Args extends ReadonlyArray<unknown>, A, E, R>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: { readonly reactivityKeys?: ReactivityKeysInput; readonly onSuccess?: () => Effect.Effect<void> },
): Effect.Effect<(...args: Args) => Effect.Effect<A, E, R>, never> {
  return Effect.sync(() =>
    (...args: Args) => fn(...args).pipe(
      Effect.tap(() => Effect.sync(() => {
        if (options?.reactivityKeys) {
          invalidateLoaderReactivity(options.reactivityKeys);
        }
      })),
      Effect.tap(() => options?.onSuccess ? options.onSuccess() : Effect.void),
    ));
}

/**
 * Low-level single-flight runner.
 *
 * Executes the mutation, captures Reactivity invalidations emitted during that
 * execution, selects affected matched loaders for the target URL, and returns a
 * hydration-ready payload in one Effect.
 */
export function actionSingleFlight<Args extends ReadonlyArray<unknown>, A, E, R>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: SingleFlightOptions<Args, A>,
): Effect.Effect<(...args: Args) => Effect.Effect<SingleFlightPayload<A>, E, R | RouterService>, never> {
  return Effect.sync(() =>
    (...args: Args) => Effect.gen(function* () {
      const invalidationCapture = beginReactivityInvalidationCapture();
      const mutationExit = yield* Effect.exit(
        Effect.gen(function* () {
          const mutation = yield* fn(...args);
          if (options?.reactivityKeys) {
            invalidateLoaderReactivity(options.reactivityKeys);
          }
          if (options?.onSuccess) {
            yield* options.onSuccess(mutation, args);
          }
          return mutation;
        }),
      );
      const capturedInvalidations = invalidationCapture.end();
      if (mutationExit._tag === "Failure") {
        return yield* Effect.failCause(mutationExit.cause);
      }
      const mutation = mutationExit.value;

      const router = yield* RouterTag;
      const currentUrl = router.url();
      const targetRaw = typeof options?.target === "function"
        ? options.target(mutation, args, currentUrl)
        : options?.target;
      const targetUrl = targetRaw === undefined
        ? currentUrl
        : targetRaw instanceof URL
          ? targetRaw
          : new URL(targetRaw, currentUrl.origin);

      const seededLoaders = options?.setLoaders?.(mutation, args, targetUrl) ?? [];
      const seededIds = new Set(seededLoaders.map((item) => item.routeId));
      const revalidate = options?.revalidate ?? "reactivity";
      const allLoaders = revalidate === "none"
        ? [] as ReadonlyArray<SingleFlightLoaderEntry>
        : yield* resolveRouteSource(options?.app).pipe(
          Effect.flatMap((source) => source === undefined
            ? Effect.succeed([] as ReadonlyArray<SingleFlightLoaderEntry>)
            : runMatchedLoaders(source, targetUrl, {
              includeDeferred: options?.includeDeferred ?? true,
              reactivityKeys: revalidate === "reactivity" ? capturedInvalidations : undefined,
            })),
        );
      const filteredLoaders = Array.isArray(revalidate)
        ? allLoaders.filter((item) => revalidate.includes(item.routeId))
        : revalidate === "reactivity" && capturedInvalidations.length === 0
          // Nothing was invalidated, so nothing needs revalidation: return an
          // empty loader list instead of re-running the full matched set.
          ? []
          // "matched" (and "reactivity" with invalidations) uses the matched run.
          : allLoaders;
      const loaders = [...seededLoaders, ...filteredLoaders.filter((item) => !seededIds.has(item.routeId))];

      return {
        mutation,
        url: targetUrl.toString(),
        loaders,
      } as SingleFlightPayload<A>;
    }));
}

/**
 * Mutation-handle wrapper around `actionSingleFlight`.
 *
 * Prefer this when you want the route single-flight payload but also want the
 * familiar local mutation state accessors (`result`, `pending`, transitions).
 */
export function mutationSingleFlight<Args extends ReadonlyArray<unknown>, A, E, R>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: ({
    readonly name?: string;
    readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
    readonly onError?: (error: E) => void;
    readonly onPayload?: (payload: SingleFlightPayload<A>, args: Args) => Effect.Effect<void>;
  } & SingleFlightOptions<Args, A>),
): Effect.Effect<SingleFlightMutationHandle<Args, A, E, R>, never, RouterService> {
  const runSingleFlight = actionSingleFlight(fn, options);
  return Effect.gen(function* () {
    const run = yield* runSingleFlight;
    const router = yield* RouterTag;
    const runBound = (...args: Args): Effect.Effect<SingleFlightPayload<A>, E, R> =>
      run(...args).pipe(Effect.provideService(RouterTag, router));

    const mutation = defineMutation<Args, E, R>(
      (args) => runBound(...args).pipe(
        Effect.tap((payload) => options?.onPayload ? options.onPayload(payload, args) : Effect.void),
        Effect.asVoid,
      ),
      {
        name: options?.name,
        onTransition: options?.onTransition,
        onFailure: (error) => {
          if (hasTag(error, "ResultDefectError")) return;
          options?.onError?.(error as E);
        },
      },
    );

    const out = ((...args: Args) => {
      mutation.run(args);
    }) as SingleFlightMutationHandle<Args, A, E, R>;
    out.run = (...args: Args) => mutation.run(args);
    out.runEffect = (...args: Args) => runBound(...args).pipe(
      Effect.tap((payload) => options?.onPayload ? options.onPayload(payload, args) : Effect.void),
      Effect.mapError((error) => error as E | BridgeError | MutationSupersededError),
    );
    out.effect = (...args: Args) => mutation.effect(args);
    out.result = mutation.result;
    out.pending = mutation.pending;
    return out;
  });
}

/**
 * Default freshness window for hydrated single-flight loader entries.
 *
 * Hydrated single-flight entries default to 30s freshness so the client does
 * not immediately refetch data the server just computed; routes can override
 * this via their own loader `staleTime`.
 */
const defaultHydratedLoaderStaleTimeMs = 30_000;

export interface HydrateSingleFlightOptions {
  /**
   * Called for each payload entry whose `routeId` matches no known route
   * (tree, registry by id, and registry by pattern all miss). Without this
   * callback such entries are skipped silently.
   */
  readonly onMissingRoute?: (routeId: string) => void;
}

/**
 * Hydrate loader cache entries from a previously returned single-flight payload.
 *
 * When a route tree is provided, hydration prefers the explicit tree over the
 * global registry so unified routes can hydrate without relying on registry
 * lookups.
 */
export function hydrateSingleFlightPayload(
  payload: SingleFlightPayload<unknown>,
  source: RouteSource,
  options: HydrateSingleFlightOptions = {},
): Effect.Effect<void, never> {
  return currentLoaderCacheStore.pipe(Effect.map((store) => {
    const url = new URL(payload.url);
    const entries = routeEntriesOf(source);
    for (const item of payload.loaders) {
      const entry = entries.find((candidate) => candidate.routeId === item.routeId)
        ?? entries.find((candidate) => candidate.fullPattern === item.routeId);
      if (!entry) {
        options.onMissingRoute?.(item.routeId);
        continue;
      }
      const params = extractParams(entry.fullPattern, url.pathname) ?? {};
      const loaderOptions = entry.loaderOptions;
      setLoaderCacheEntry(item.routeId, params, item.result, {
        ...loaderOptions,
        staleTime:
          loaderOptions?.staleTime ?? defaultHydratedLoaderStaleTimeMs,
      }, store);
    }
  }));
}

/**
 * Turn a low-level single-flight runner into a request handler that accepts the
 * posted args/url envelope and returns a serializable success/failure response.
 */
export function createSingleFlightHandler<Args extends ReadonlyArray<unknown>, A, E, R>(
  run: (...args: Args) => Effect.Effect<SingleFlightPayload<A>, E, R | RouterService>,
  options?: { readonly baseUrl?: string },
): (request: SingleFlightRequest<Args>) => Effect.Effect<SingleFlightWireResponse, never, R> {
  return (request) => {
    const base = options?.baseUrl ?? "http://localhost";
    const requestUrl = new URL(request.url, base).toString();
    return run(...request.args).pipe(
      Effect.provide(Server({ url: requestUrl })),
      Effect.match({
        onSuccess: (payload) => ({
          ok: true as const,
          payload: encodeSingleFlightPayload(payload),
        }),
        onFailure: (error) => ({
          ok: false as const,
          error: Serialization.encodeWireValue(error),
        }),
      }),
    );
  };
}

/**
 * Build a fetch-backed single-flight transport service.
 *
 * This adapter keeps transport concerns separate from route orchestration.
 * It can be installed globally and consumed transparently by mutation handles.
 */
export function FetchSingleFlightTransport(options?: {
  readonly endpoint?: string | ((request: SingleFlightRequest<ReadonlyArray<unknown>>) => string | undefined);
  readonly fetch?: (input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) => Promise<{ readonly json: () => Promise<unknown> }>;
}): Layer.Layer<SingleFlightTransportService> {
  return Layer.succeed(SingleFlightTransportTag, {
    execute: (
      request: { readonly name?: string; readonly args: ReadonlyArray<unknown>; readonly url: string },
      overrides?: {
        readonly endpoint?: string;
        readonly fetch?: (input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) => Promise<{ readonly json: () => Promise<unknown> }>;
      },
    ) => Effect.tryPromise({
      try: async () => {
        const endpoint = overrides?.endpoint
          ?? (typeof options?.endpoint === "function" ? options.endpoint(request as SingleFlightRequest<ReadonlyArray<unknown>>) : options?.endpoint)
          ?? request.name;
        if (!endpoint) {
          throw new SingleFlightTransportError({
            message: "No single-flight endpoint resolved",
          });
        }
        const fetchImpl = overrides?.fetch ?? options?.fetch
          ?? ((input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) =>
            fetch(input, init as RequestInit) as Promise<{ readonly json: () => Promise<unknown> }>);
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        return await response.json();
      },
      catch: (cause) =>
        cause instanceof SingleFlightTransportError
          ? cause
          : new SingleFlightTransportError({
              message: "Failed to execute single-flight transport",
              cause,
            }),
    }),
  });
}

/**
 * High-level server helper for building a typed single-flight endpoint.
 *
 * This is the recommended server API: it combines mutation execution, loader
 * selection, optional direct loader seeding, and request/response shaping.
 */
export function singleFlight<Args extends ReadonlyArray<unknown>, A, E, R>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: (SingleFlightOptions<Args, A> & { readonly baseUrl?: string }),
): (request: SingleFlightRequest<Args>) => Effect.Effect<SingleFlightWireResponse, never, R> {
  const run = actionSingleFlight(fn, options);
  return (request) => run.pipe(
    Effect.flatMap((runner) => createSingleFlightHandler(runner, { baseUrl: options?.baseUrl })(request)),
  );
}

/**
 * Client-side single-flight transport helper.
 *
 * Posts a `SingleFlightRequest`, decodes the server response, and hydrates any
 * returned loader payloads by default.
 */
export function invokeSingleFlight<Args extends ReadonlyArray<unknown>, A>(
  endpoint: string,
  request: SingleFlightRequest<Args>,
  options?: {
    readonly fetch?: (input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) => Promise<{ readonly json: () => Promise<unknown> }>;
    readonly hydrate?: boolean;
    readonly app?: RouteSource;
  },
): Effect.Effect<
  SingleFlightPayload<A>,
  SingleFlightInvokeError | SingleFlightDecodeError,
  never
> {
  return Effect.tryPromise({
    try: async () => {
      const fetchImpl = options?.fetch ?? ((input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) =>
        fetch(input, init as RequestInit) as Promise<{ readonly json: () => Promise<unknown> }>);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      return await response.json();
    },
    catch: (cause) =>
      new SingleFlightInvokeError({
        message: "Failed to invoke single-flight endpoint",
        cause,
      }),
  }).pipe(
    // Validation before hydration: a malformed response is a typed decode
    // failure and seeds nothing into the loader cache.
    Effect.flatMap((raw) => decodeSingleFlightResponse<A>(raw)),
    Effect.tap((payload) => options?.hydrate === false
      ? Effect.void
      : resolveRouteSource(options?.app).pipe(
        Effect.flatMap((source) => source === undefined
          ? Effect.void
          : hydrateSingleFlightPayload(payload as SingleFlightPayload<unknown>, source)),
      )),
  );
}

/**
 * Attach a guard Effect that must succeed before a route renders.
 *
 * The returned enhancer carries both call signatures — unified route and
 * component — so authored pipes need no casts on either tier (R3).
 */
export function guard<Req, E>(
  check: Effect.Effect<unknown, E, Req>,
): GuardEnhancer<Req, E>;
export function guard<Req, E>(
  check: Effect.Effect<unknown, E, Req>,
): GuardEnhancer<Req, E> {
  const attach = (component: RouteTargetComponent) => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        guards: [...component[UnifiedRouteSymbol].guards, check],
      });
    }
    if (isRouteNode(component)) {
      // A guard piped onto a route NODE is stored on the node itself and
      // read back by `routeGuardsOfTarget`. Before this branch existed the
      // call fell through to the component arm, which stamped
      // `__routeGuards` onto the node object — where nothing ever read it,
      // so `Route.guard(...)(Route.page(...))` type-checked, composed, and
      // gated nothing (the auth-bypass shape R3 exists to forbid).
      const node = component as AnyAppRouteNode & {
        __routeGuards?: ReadonlyArray<Effect.Effect<unknown, any, any>>;
      };
      node.__routeGuards = [...(node.__routeGuards ?? []), check];
      return node;
    }
    const routed = asRouteComponent(component);
    const previous = routed.__routeGuards;
    routed.__routeGuards = [...(previous ?? []), check];
    return routed;
  };
  return attach as GuardEnhancer<Req, E>;
}

/** Attach static or loader-aware document title metadata to a route. */
export function title<P, A = unknown, E = unknown>(
  value: NonNodeRouteTitleValue<P, A, E>,
): TitleRouteEnhancer<P, A, E>;
export function title<T extends AnyAppRouteNode>(
  value: string | ((params: RouteNodeParamsOf<T>, loaderData: RouteNodeLoaderDataOf<T> | undefined, loaderResult: CoreResultType<RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> | undefined) => string),
): NodeTitleEnhancer<T>;
export function title<P, A = unknown, E = unknown>(
  value: NonNodeRouteTitleValue<P, A, E>,
): TitleEnhancer<P, A, E>;
export function title(
  value: string | ((params: unknown, loaderData: unknown, loaderResult: CoreResultType<unknown, unknown> | undefined) => string),
): TitleRouteEnhancer<unknown, unknown, unknown> {
  // Implementation is intentionally untyped at the union root so TS7 does not
  // explode on Component|AppRouteNode|AnyRoute overload instantiation depth.
  const attach = (component: unknown): unknown => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        title: value,
      });
    }
    if (isRouteNode(component)) {
      return appendNodeEnhancer(component as AnyAppRouteNode, (inner: any) => {
        setTitleInternal(inner, value);
        return inner;
      });
    }
    setTitleInternal(component as ComponentType<any, any, any, any, any>, value);
    return component;
  };
  return attach as TitleRouteEnhancer<unknown, unknown, unknown>;
}

/** Attach static or loader-aware meta records to a route. */
export function meta<P, A = unknown, E = unknown>(
  value: NonNodeRouteMetaExtraValue<P, A, E>,
): MetaRouteEnhancer<P, A, E>;
export function meta<T extends AnyAppRouteNode>(
  value: RouteMetaRecord | ((params: RouteNodeParamsOf<T>, loaderData: RouteNodeLoaderDataOf<T> | undefined, loaderResult: CoreResultType<RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> | undefined) => RouteMetaRecord),
): NodeMetaEnhancer<T>;
export function meta<P, A = unknown, E = unknown>(
  value: NonNodeRouteMetaExtraValue<P, A, E>,
): MetaEnhancer<P, A, E>;
export function meta(
  value: RouteMetaRecord | ((params: unknown, loaderData: unknown, loaderResult: CoreResultType<unknown, unknown> | undefined) => RouteMetaRecord),
): MetaRouteEnhancer<unknown, unknown, unknown> {
  // Implementation is intentionally untyped at the union root so TS7 does not
  // explode on Component|AppRouteNode|AnyRoute overload instantiation depth.
  const attach = (component: unknown): unknown => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        metaExtra: value,
      });
    }
    if (isRouteNode(component)) {
      return appendNodeEnhancer(component as AnyAppRouteNode, (inner: any) => {
        setMetaInternal(inner, value);
        return inner;
      });
    }
    setMetaInternal(component as ComponentType<any, any, any, any, any>, value);
    return component;
  };
  return attach as MetaRouteEnhancer<unknown, unknown, unknown>;
}

// R3 (`DQ-030`): `Route.transition` is deleted. It needed a view-transition
// model this library does not have, so it was a silent no-op behind a
// plausible name -- worse than its absence. View transitions return, if they
// do, as a designed feature rather than a stored-and-never-read field.

export function sitemapParams<P, E = never, R = never>(
  enumerate: () => Effect.Effect<ReadonlyArray<P>, E, R>,
): <C extends ComponentType<any, any, any, any, any>>(component: C) => C {
  return <C extends ComponentType<any, any, any, any, any>>(component: C): C => {
    asRouteComponent<any, any, any, any, any>(component).__routeSitemapParams = enumerate as () => Effect.Effect<ReadonlyArray<any>>;
    return component;
  };
}

export function collect(component: unknown): ReadonlyArray<RouteMeta<any, any, any>> {
  const out: Array<RouteMeta<any, any, any>> = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown) => {
    if (seen.has(value)) return;
    seen.add(value);
    if (typeof value !== "function" && (typeof value !== "object" || value === null)) return;
    if (isUnifiedRoute(value)) {
      out.push(value[UnifiedRouteSymbol].meta);
      for (const child of value.children) {
        walk(child);
      }
      return;
    }
    if (isRouteNode(value)) {
      const materialized = materializeNode(value);
      walk(materialized);
      for (const child of value.children) {
        walk(child);
      }
      return;
    }
    const meta = getRouteMeta(asRouteComponent(value as ComponentType<any, any, any, any, any>));
    if (meta) out.push(meta);
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) {
        walk(child);
      }
    }
  };
  walk(component);
  return out;
}

/**
 * Run the loaders matched by `url` in `source`.
 *
 * `source` is a route tree root or an explicit `Route.registry([...])`. There is
 * no implicit global route set: R2 deleted it.
 */
export function runMatchedLoaders(
  source: RouteSource,
  url: URL,
  options?: { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReactivityKeysInput },
): Effect.Effect<ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>, never> {
  return runMatchedLoadersInternal(routeEntriesOf(source), url, options);
}

/**
 * Run every matched route's guards for `url`, parents first, failing fast
 * (R3, `DQ-030`).
 *
 * A failing guard fails this effect with the guard's own error, which is how
 * the runtime's navigation path refuses the navigation *before any loader
 * runs*. A guard belongs to its route: unmatched routes' guards are never
 * consulted.
 */
export function runMatchedRouteGuards(
  source: RouteSource,
  url: URL,
): Effect.Effect<void, unknown> {
  const entries = routeEntriesOf(source);
  const matched = matchedRouteEntries(entries, url.pathname);
  const guards = matched.flatMap((entry) => entry.guards);
  return Effect.forEach(guards, (check) => check as Effect.Effect<unknown, unknown, never>, {
    discard: true,
  });
}

/** Run matched loaders split into critical and deferred (streamed) sets. */
export function runStreamingNavigation(
  source: RouteSource,
  url: URL,
): Effect.Effect<{
  readonly critical: ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>;
  readonly deferredScripts: ReadonlyArray<string>;
}, never> {
  return runStreamingNavigationInternal(routeEntriesOf(source), url);
}

function findParentPattern(pattern: string, candidates: ReadonlyArray<string>): string | undefined {
  const ordered = [...candidates].sort((a, b) => b.length - a.length);
  for (const candidate of ordered) {
    if (pattern !== candidate && pattern.startsWith(candidate)) return candidate;
  }
  return undefined;
}

export function runRouteLoader(
  route: AnyRoute,
  url: URL,
  parentData?: unknown,
): Effect.Effect<UnknownRouteResult, never>;
export function runRouteLoader(
  component: ComponentType<any, any, any, any, any>,
  meta: RouteMeta<any, any, any>,
  url: URL,
  parentData?: unknown,
): Effect.Effect<UnknownRouteResult, never>;
export function runRouteLoader(
  component: AnyRoute | ComponentType<any, any, any, any, any>,
  metaOrUrl: RouteMeta<any, any, any> | URL,
  urlOrParent?: URL | unknown,
  parentDataArg?: unknown,
): Effect.Effect<UnknownRouteResult, never> {
  // Dispatch on the ARGUMENT shape, not only the route kind: a self-stamped
  // `Component.route` sugar value is a unified route AND a component, and its
  // own setup path still calls the legacy `(component, meta, url)` form.
  if (isUnifiedRoute(component) && metaOrUrl instanceof URL) {
    const url = metaOrUrl;
    const parentData = urlOrParent;
    const loaderFn = component[UnifiedRouteSymbol].loaderFn;
    if (!loaderFn) return Effect.succeed(CoreResult.loading);
    const meta = component[UnifiedRouteSymbol].meta;
    const paramsRaw = extractParams(meta.fullPattern, url.pathname) ?? {};
    return runCachedLoader(
      meta.id ?? meta.fullPattern,
      paramsRaw,
      loaderFn(paramsRaw, { parent: <A>() => parentData as A }),
      component[UnifiedRouteSymbol].loaderOptions,
    );
  }
  const meta = metaOrUrl as RouteMeta<any, any, any>;
  const url = urlOrParent as URL;
  const parentData = parentDataArg;
  // The legacy 3-arg form only ever receives components (including
  // self-stamped `Component.route` sugar, which is both).
  const legacyComponent = component as ComponentType<any, any, any, any, any>;
  const loaderFn = asRouteComponent(legacyComponent).__routeLoader;
  if (!loaderFn) return Effect.succeed(CoreResult.loading);
  const paramsRaw = extractParams(meta.fullPattern, url.pathname) ?? {};
  const routeId = meta.id ?? meta.fullPattern;
  const loaderOptions = asRouteComponent(legacyComponent).__routeLoaderOptions;
  return runCachedLoader(
    routeId,
    paramsRaw,
    loaderFn(paramsRaw, { parent: <A>() => parentData as A }),
    loaderOptions,
  );
}

export function serializeLoaderData(results: ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>): string {
  const object: Record<string, UnknownRouteResult> = {};
  for (const item of results) {
    object[item.routeId] = item.result;
  }
  return Serialization.encodeResultRecord(object);
}

export function deserializeLoaderData(serialized: string): Record<string, UnknownRouteResult> {
  return Serialization.decodeResultRecord(serialized);
}

// ─── Versioned loader-data handoff ───────────────────────────────────────────
//
// R2 item 4: `window.__LOADER_DATA__` / `window.__HYDRATE_ROUTE__` were an
// undocumented, unvalidated, unversioned pair — the second one defined nowhere
// in src at all. They are replaced by one declared, versioned envelope that is
// encoded and decoded through the `Serialization` seam, so streamed loader data
// uses the same wire projection as the SSR payload and malformed input is a
// typed failure rather than whatever the page happened to assign.

/** Current loader-handoff envelope version. Bump on any shape change. */
export const loaderHandoffVersion = 1 as const;

/** The single global the server writes streamed loader data into. */
export const loaderHandoffGlobalKey = "__afuiLoaderHandoff" as const;

/** The optional hook a client may install to observe entries as they stream in. */
export const loaderHandoffNotifyKey = "__afuiLoaderHandoffNotify" as const;

/**
 * Attribute marking one inert, per-entry loader payload script (`DQ-034`):
 * deferred loader results ship on the resume-manifest channel family
 * (`data-af-*`) as `<script type="application/json" data-af-loader>` tags —
 * no executable inline JS and no second window global beside the manifest.
 */
export const loaderEntryScriptAttribute = "data-af-loader" as const;

/**
 * One streamed loader entry: the route id, the params the loader ran with (so
 * the client caches under the same identity the server used), and the canonical
 * result wire shape.
 */
export const LoaderHandoffEntry = Schema.Struct({
  routeId: Schema.String,
  params: Schema.Record(Schema.String, Schema.String),
  result: Serialization.ResultWire,
});

/** The versioned envelope accumulated on `window[loaderHandoffGlobalKey]`. */
export const LoaderHandoff = Schema.Struct({
  version: Schema.Literal(loaderHandoffVersion),
  entries: Schema.Array(LoaderHandoffEntry),
});

export type LoaderHandoffEntryValue = {
  readonly routeId: string;
  readonly params: Readonly<Record<string, string>>;
  readonly result: Serialization.ResultWireValue;
};

export type LoaderHandoff = {
  readonly version: typeof loaderHandoffVersion;
  readonly entries: ReadonlyArray<LoaderHandoffEntryValue>;
};

type LoaderHandoffCarrier = {
  [loaderHandoffGlobalKey]?: LoaderHandoff & { entries: Array<LoaderHandoff["entries"][number]> };
  [loaderHandoffNotifyKey]?: (entry: LoaderHandoff["entries"][number]) => void;
};

function loaderHandoffCarrier(): LoaderHandoffCarrier | undefined {
  return typeof globalThis === "undefined" ? undefined : globalThis as unknown as LoaderHandoffCarrier;
}

/**
 * Emit the streamed-loader scripts for deferred results.
 *
 * Each script appends validated entries to the versioned envelope and notifies
 * the optional client hook. The payload is produced by `Serialization` so the
 * embedded JSON is script-safe and schema-checked at encode time.
 */
export function streamDeferredLoaderScripts(
  results: ReadonlyArray<{
    readonly routeId: string;
    readonly result: UnknownRouteResult;
    readonly params?: Readonly<Record<string, string>>;
  }>,
): ReadonlyArray<string> {
  return results.map((item) => {
    const payload = Serialization.encodeSync(LoaderHandoffEntry, {
      routeId: item.routeId,
      params: item.params ?? {},
      result: Serialization.resultToWire(item.result),
    });
    // DQ-034 / R6: one handoff. The entry is data on the manifest channel,
    // not a script that builds a parallel window global — the client reads it
    // through `readLoaderHandoff`/`hydrateLoaderHandoff` (and, once streaming
    // installs land, through the incremental manifest reader). Inert JSON is
    // also CSP-friendlier than executable inline scripts.
    return `<script type="application/json" ${loaderEntryScriptAttribute}>${payload}</script>`;
  });
}

/**
 * Read and validate the loader handoff envelope.
 *
 * Decoding goes through the injectable `Serialization` service, so a malformed
 * or version-mismatched handoff is a typed `SchemaError`, never a defect.
 */
export function readLoaderHandoff(
  input?: unknown,
): Effect.Effect<LoaderHandoff, Schema.SchemaError, Serialization.SerializationService> {
  return Effect.gen(function* () {
    const serialization = yield* Serialization.Tag;
    const raw = input ?? (() => {
      const envelope = loaderHandoffCarrier()?.[loaderHandoffGlobalKey];
      const entries: Array<unknown> = envelope === undefined ? [] : [...envelope.entries];
      // Inert per-entry payload scripts on the manifest channel (DQ-034) are
      // part of the same handoff: one channel, one decoder, one cache write.
      const documentValue = (globalThis as {
        readonly document?: {
          readonly querySelectorAll?: (selector: string) => ArrayLike<{ readonly textContent: string | null }>;
        };
      }).document;
      if (typeof documentValue?.querySelectorAll === "function") {
        const scripts = documentValue.querySelectorAll(`script[${loaderEntryScriptAttribute}]`);
        for (let index = 0; index < scripts.length; index += 1) {
          const text = scripts[index]?.textContent;
          if (text === null || text === undefined) continue;
          try {
            entries.push(JSON.parse(text));
          } catch {
            // Malformed entries fail below through the schema, not here —
            // but unparseable text cannot even reach the schema, so it is
            // skipped rather than turned into a defect.
          }
        }
      }
      return { version: loaderHandoffVersion, entries };
    })();
    return yield* serialization.deserialize(LoaderHandoff, JSON.stringify(raw)) as Effect.Effect<LoaderHandoff, Schema.SchemaError>;
  });
}

/**
 * Hydrate the loader cache from the versioned handoff envelope.
 *
 * This is the client half of the streamed-loader channel that
 * `window.__HYDRATE_ROUTE__` only ever gestured at.
 */
export function hydrateLoaderHandoff(
  source: RouteSource,
  options?: {
    readonly input?: unknown;
    readonly onMissingRoute?: (routeId: string) => void;
  },
): Effect.Effect<void, Schema.SchemaError, Serialization.SerializationService> {
  return Effect.gen(function* () {
    const handoff = yield* readLoaderHandoff(options?.input);
    const store = yield* currentLoaderCacheStore;
    const entries = routeEntriesOf(source);
    for (const item of handoff.entries) {
      const entry = entries.find((candidate) => candidate.routeId === item.routeId)
        ?? entries.find((candidate) => candidate.fullPattern === item.routeId);
      if (!entry) {
        options?.onMissingRoute?.(item.routeId);
        continue;
      }
      const loaderOptions = entry.loaderOptions;
      setLoaderCacheEntry(item.routeId, item.params, Serialization.resultFromWire(item.result), {
        ...loaderOptions,
        staleTime: loaderOptions?.staleTime ?? defaultHydratedLoaderStaleTimeMs,
      }, store);
    }
  });
}

/**
 * Subscribe to streamed handoff entries.
 *
 * Installs the notify hook the emitted scripts call and replays any entries
 * that already arrived before subscription. Returns an unsubscribe function.
 */
export function onLoaderHandoffEntry(
  handler: (entry: LoaderHandoff["entries"][number]) => void,
): () => void {
  const carrier = loaderHandoffCarrier();
  if (!carrier) return () => {};
  for (const entry of carrier[loaderHandoffGlobalKey]?.entries ?? []) {
    handler(entry);
  }
  const previous = carrier[loaderHandoffNotifyKey];
  carrier[loaderHandoffNotifyKey] = (entry) => {
    previous?.(entry);
    handler(entry);
  };
  return () => {
    carrier[loaderHandoffNotifyKey] = previous;
  };
}

/** Collect sitemap entries for every route in an explicit route source. */
export function collectSitemapEntries(
  source: RouteSource,
  baseUrl = "http://localhost",
): Effect.Effect<ReadonlyArray<{ readonly loc: string }>, never> {
  return collectSitemapEntriesInternal(routeEntriesOf(source), baseUrl);
}

export function validateLinks(component: unknown): ReadonlyArray<string> {
  const metas = collect(component);
  const seen = new Set<string>();
  const errors: Array<string> = [];
  for (const meta of metas) {
    if (seen.has(meta.fullPattern)) {
      errors.push(`Duplicate route pattern: ${meta.fullPattern}`);
    }
    seen.add(meta.fullPattern);
  }
  return errors;
}

export function Switch(props: { readonly children: ReadonlyArray<unknown>; readonly fallback?: unknown }): unknown {
  const children = Array.isArray(props.children) ? props.children : [props.children];
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) return child;
  }
  return props.fallback ?? null;
}

export function lazy<T extends { readonly default?: unknown }>(
  importer: () => Promise<T>,
  options?: { readonly loading?: () => unknown },
): ((props: any) => unknown) & { readonly preload: () => Promise<unknown> } {
  const [loaded, setLoaded] = createSignal<unknown>(null);
  const [failed, setFailed] = createSignal<unknown>(null);
  let inflight: Promise<unknown> | undefined;
  const load = (): Promise<unknown> => {
    if (inflight) return inflight;
    inflight = importer().then(
      (module) => {
        const resolved = module.default ?? module;
        setLoaded(() => resolved);
        return resolved;
      },
      (error) => {
        setFailed(error);
        throw error;
      },
    );
    return inflight;
  };
  const component = (props: any) => {
    void load();
    const error = failed();
    if (error) throw error;
    const value = loaded();
    if (typeof value === "function") {
      return (value as (p: any) => unknown)(props);
    }
    return options?.loading?.() ?? null;
  };
  return Object.assign(component, { preload: load });
}

function browserUrl(): URL {
  return new URL(window.location.href);
}

/**
 * Preload the loaders for `to`.
 *
 * Router layers have no route tree of their own, so the app's route source is
 * injected (`Route.routeSourceLayer(app)`). Without it there is nothing to
 * match against and preload is a no-op rather than a global-registry lookup.
 */
function preloadUrl(to: string, base: URL | string): Effect.Effect<void> {
  return Effect.serviceOption(RouteSourceTag).pipe(
    Effect.flatMap((option) =>
      option._tag === "Some"
        ? runMatchedLoaders(option.value.source, new URL(to, base), { includeDeferred: true }).pipe(Effect.asVoid)
        : Effect.void),
  );
}

export const Browser: Layer.Layer<RouterService> = Layer.effect(
  RouterTag,
  Effect.gen(function* () {
    const url = makeWritableUrlAtom(browserUrl());
    const onPop = () => {
      url.set(browserUrl());
    };
    window.addEventListener("popstate", onPop);
    yield* Effect.addFinalizer(() => Effect.sync(() => window.removeEventListener("popstate", onPop)));

    return {
      url,
      navigate: (to, options) => Effect.sync(() => {
        if (options?.replace) {
          window.history.replaceState(null, "", to);
        } else {
          window.history.pushState(null, "", to);
        }
        url.set(new URL(to, window.location.origin));
      }),
      back: () => Effect.sync(() => window.history.back()),
      forward: () => Effect.sync(() => window.history.forward()),
      preload: (to) => preloadUrl(to, window.location.origin),
    } as RouterService;
  }),
);

export const Hash: Layer.Layer<RouterService> = Layer.effect(
  RouterTag,
  Effect.gen(function* () {
    const read = () => new URL(window.location.hash.slice(1) || "/", window.location.origin);
    const url = makeWritableUrlAtom(read());
    const onHash = () => {
      url.set(read());
    };
    window.addEventListener("hashchange", onHash);
    yield* Effect.addFinalizer(() => Effect.sync(() => window.removeEventListener("hashchange", onHash)));

    return {
      url,
      navigate: (to) => Effect.sync(() => {
        window.location.hash = to;
      }),
      back: () => Effect.sync(() => window.history.back()),
      forward: () => Effect.sync(() => window.history.forward()),
      preload: (to) => preloadUrl(to, window.location.origin),
    } as RouterService;
  }),
);

export function Server(request: { readonly url: string }): Layer.Layer<RouterService> {
  const url = makeWritableUrlAtom(new URL(request.url));
  return Layer.succeed(RouterTag, {
    url,
    navigate: () => Effect.void,
    back: () => Effect.void,
    forward: () => Effect.void,
    preload: (to) => preloadUrl(to, url()),
  });
}

export function Memory(initial = "/"): Layer.Layer<RouterService> {
  const url = makeWritableUrlAtom(new URL(initial, "http://test.local"));
  const entries = [url().toString()];
  let index = 0;
  return Layer.succeed(RouterTag, {
    url,
    navigate: (to) => Effect.sync(() => {
      const next = new URL(to, "http://test.local");
      index += 1;
      entries.splice(index, entries.length - index, next.toString());
      url.set(next);
    }),
    back: () => Effect.sync(() => {
      if (index <= 0) return;
      index -= 1;
      const next = entries[index];
      if (next) url.set(new URL(next));
    }),
    forward: () => Effect.sync(() => {
      if (index >= entries.length - 1) return;
      index += 1;
      const next = entries[index];
      if (next) url.set(new URL(next));
    }),
    preload: (to) => preloadUrl(to, url()),
  } as RouterService);
}

export const Router = {
  Tag: RouterTag,
  Browser,
  Hash,
  Server,
  Memory,
} as const;

export const Route = {
  path,
  page,
  layout,
  index,
  define,
  ref,
  mount,
  children,
  id,
  paramsSchema,
  querySchema,
  hashSchema,
  nodes,
  parentOf,
  ancestorsOf,
  depthOf,
  routeChainOf,
  fullPathOf,
  paramNamesOf,
  validateTree,
  params,
  query,
  hash,
  prefix,
  matches,
  link,
  Link,
  queryAtom,
  loader,
  loaderData,
  loaderResult,
  loaderError,
  prefetch,
  setLoaderData,
  setLoaderResult,
  seedLoader,
  seedLoaderResult,
  action,
  actionSingleFlight,
  mutationSingleFlight,
  hydrateSingleFlightPayload,
  hydrateLoaderHandoff,
  readLoaderHandoff,
  onLoaderHandoffEntry,
  LoaderHandoff,
  LoaderHandoffEntry,
  loaderHandoffVersion,
  loaderHandoffGlobalKey,
  loaderHandoffNotifyKey,
  createSingleFlightHandler,
  FetchSingleFlightTransport,
  singleFlight,
  invokeSingleFlight,
  reload,
  guard,
  title,
  meta,
  lazy,
  Switch,
  componentOf,
  runMatchedLoaders,
  runStreamingNavigation,
  runRouteLoader,
  serializeLoaderData,
  deserializeLoaderData,
  streamDeferredLoaderScripts,
  collectSitemapEntries,
  collectAll,
  registry,
  isRouteRegistry,
  routeSourceLayer,
  collect,
  validateLinks,
  UnifiedRouteSymbol,
  RouteMetaSymbol,
  RouteLoaderMetaSymbol,
  RouteRegistrySymbol,
  RouteContextTag,
  RouteSourceTag,
  RouteHeadTag,
  makeRouteHeadStore,
  currentRouteHeadStore,
  runInRouteHeadStore,
  resolveRouteHeadOf,
  SingleFlightTransportTag,
  RouterTag,
  resolvePattern,
  matchPattern,
  extractParams,
} as const;
