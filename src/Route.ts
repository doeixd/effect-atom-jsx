import { Effect, Layer, Schema, ServiceMap } from "effect";
import * as Atom from "./Atom.js";
import { createComponent } from "./dom.js";
import { renderToString, setRequestEvent } from "./dom.js";
import { useContext, type Accessor } from "./api.js";
import {
  ManagedRuntimeContext,
  defineMutation,
  type Result as MutationResult,
  type BridgeError,
  type MutationSupersededError,
} from "./effect-ts.js";
import * as Result from "./Result.js";
import { SingleFlightTransportTag, type SingleFlightTransportService } from "./SingleFlightTransport.js";
import * as ComponentRuntime from "./Component.js";
import * as RouterRuntimeModule from "./RouterRuntime.js";
import {
  collectLoaderReactivityKeys,
  clearLoaderCache,
  getLoaderCacheEntry,
  invalidateLoaderReactivity,
  matchesLoaderReactivity,
  runCachedLoader,
  setLoaderCacheEntry,
} from "./router-runtime.js";
import { beginReactivityInvalidationCapture } from "./reactivity-runtime.js";
import type { Component as ComponentType } from "./Component.js";

export interface NavigateOptions {
  readonly replace?: boolean;
}

export interface RouterService {
  readonly url: Atom.ReadonlyAtom<URL>;
  readonly navigate: (to: string, options?: NavigateOptions) => Effect.Effect<void>;
  readonly back: () => Effect.Effect<void>;
  readonly forward: () => Effect.Effect<void>;
  readonly preload?: (to: string) => Effect.Effect<void>;
}

export const RouterTag = ServiceMap.Service<RouterService>("Router");

export interface RouteContext<P = unknown, Q = unknown, H = unknown> {
  readonly prefix: Atom.ReadonlyAtom<string>;
  readonly params: Atom.ReadonlyAtom<P>;
  readonly query: Atom.ReadonlyAtom<Q>;
  readonly hash: Atom.ReadonlyAtom<H | undefined>;
  readonly matched: Atom.ReadonlyAtom<boolean>;
  readonly pattern: string;
  readonly routeId?: string;
  readonly loaderData?: Atom.ReadonlyAtom<unknown>;
  readonly loaderResult?: Atom.ReadonlyAtom<Result.Result<unknown, unknown>>;
}

export const RouteContextTag = ServiceMap.Service<RouteContext<any, any, any>>("RouteContext");
export const ServerRequestTag = ServiceMap.Service<{ readonly request: Request; readonly url: URL }>("ServerRequest");
export const ServerResponseTag = ServiceMap.Service<{
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
type UnknownRouteResult = Result.Result<unknown, unknown>;
type RouteTitleValue<P, LD, LE> = string | ((params: P, loaderData: LD | undefined, loaderResult: Result.Result<LD, LE> | undefined) => string);
type RouteMetaExtraValue<P, LD, LE> = RouteMetaRecord | ((params: P, loaderData: LD | undefined, loaderResult: Result.Result<LD, LE> | undefined) => RouteMetaRecord);
type StoredRouteTitle = string | ((params: unknown, loaderData: unknown, loaderResult: UnknownRouteResult | undefined) => string);
type StoredRouteMetaExtra = RouteMetaRecord | ((params: unknown, loaderData: unknown, loaderResult: UnknownRouteResult | undefined) => RouteMetaRecord);

interface UnifiedRouteInternals<P, Q, H, LD, LE> {
  readonly kind: UnifiedRouteKind;
  readonly meta: RouteMeta<P, Q, H>;
  readonly children: ReadonlyArray<AnyRoute>;
  readonly loaderFn?: LoaderFn;
  readonly loaderOptions?: LoaderOptions;
  readonly loaderErrorCases?: LoaderErrorCases<unknown, unknown>;
  readonly title?: StoredRouteTitle;
  readonly metaExtra?: StoredRouteMetaExtra;
  readonly transition?: { readonly enter?: Effect.Effect<unknown>; readonly exit?: Effect.Effect<unknown> };
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
}

export type AnyRoute = Route<any, any, any, any, any, any>;
export type AnyLayoutRoute = LayoutRoute<any, any, any, any, any, any>;

type SegmentPart<S extends string> =
  S extends `:${infer Name}?` ? { readonly [K in Name]?: string }
  : S extends `:${infer Name}` ? { readonly [K in Name]: string }
  : {};

type MergeParams<A, B> = {
  readonly [K in keyof A | keyof B]: K extends keyof B
    ? B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

export type ExtractParams<Path extends string> =
  string extends Path ? Record<string, string>
  : Path extends `${infer Head}/${infer Tail}` ? MergeParams<SegmentPart<Head>, ExtractParams<Tail>>
  : SegmentPart<Path>;

export interface RenderRequestResult {
  readonly status: number;
  readonly headers: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly head: RouteHead;
  readonly html: string;
  readonly loaderPayload: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>;
  readonly deferred: ReadonlyArray<string>;
}

type AnyAppRouteNode = AppRouteNode<any, any, any, any, any, any>;

type RouteNodeEnhancer<I extends AnyAppRouteNode = AnyAppRouteNode, O extends AnyAppRouteNode = AnyAppRouteNode> = (node: I) => O;
type UnifiedRouteEnhancer<I extends AnyRoute = AnyRoute, O extends AnyRoute = AnyRoute> = (route: I) => O;

type RouteNodeComponentOf<T extends AnyAppRouteNode> = T extends AppRouteNode<any, any, any, infer C, any, any> ? C : never;
type WithNodeParams<T extends AnyAppRouteNode, P> = AppRouteNode<P, RouteNodeQueryOf<T>, RouteNodeHashOf<T>, RouteNodeComponentOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>>;
type WithNodeQuery<T extends AnyAppRouteNode, Q> = AppRouteNode<RouteNodeParamsOf<T>, Q, RouteNodeHashOf<T>, RouteNodeComponentOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>>;
type WithNodeHash<T extends AnyAppRouteNode, H> = AppRouteNode<RouteNodeParamsOf<T>, RouteNodeQueryOf<T>, H, RouteNodeComponentOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>>;
type WithNodeLoader<T extends AnyAppRouteNode, A, E> = AppRouteNode<RouteNodeParamsOf<T>, RouteNodeQueryOf<T>, RouteNodeHashOf<T>, RouteNodeComponentOf<T>, A, E>;
type AnyRouteAttachTarget = AnyAppRouteNode | ComponentType<any, any, any, any>;
type RouteIdEnhancer =
  & (<T extends AnyAppRouteNode>(route: T) => T)
  & (<C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>);
type RouteParamsSchemaEnhancer<P> =
  & (<T extends AnyAppRouteNode>(route: T) => WithNodeParams<T, P>)
  & (<C, Q, H, LD, LE>(route: Route<C, any, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>);
type RouteQuerySchemaEnhancer<Q> =
  & (<T extends AnyAppRouteNode>(route: T) => WithNodeQuery<T, Q>)
  & (<C, P, H, LD, LE>(route: Route<C, P, any, H, LD, LE>) => Route<C, P, Q, H, LD, LE>);
type RouteHashSchemaEnhancer<H> =
  & (<T extends AnyAppRouteNode>(route: T) => WithNodeHash<T, H>)
  & (<C, P, Q, LD, LE>(route: Route<C, P, Q, any, LD, LE>) => Route<C, P, Q, H, LD, LE>);
type RouteChildrenEnhancer =
  & (<T extends AnyAppRouteNode>(route: T) => T)
  & (<C, P, Q, H, LD, LE>(route: LayoutRoute<C, P, Q, H, LD, LE>) => LayoutRoute<C, P, Q, H, LD, LE>);
type RouteTarget = AnyAppRouteNode | AnyRoute;
type RouteTargetComponent = ComponentType<any, any, any, any> | AnyRoute;
type GuardEnhancer<Req, E> = UnifiedGuardEnhancer<Req, E>
  & (<Props, R0, E0, B>(component: ComponentType<Props, R0, E0, B>) => ComponentType<Props, R0 | Req, E0 | E, B>);
type TitleRouteEnhancer<P, A, E> = (<T extends Route<any, P, any, any, A, E>>(route: T) => T)
  & NodeTitleEnhancer<AnyAppRouteNode>
  & TitleEnhancer<P, A, E>;
type MetaRouteEnhancer<P, A, E> = (<T extends Route<any, P, any, any, A, E>>(route: T) => T)
  & NodeMetaEnhancer<AnyAppRouteNode>
  & MetaEnhancer<P, A, E>;
type LoaderRouteEnhancer<P, A, E, R> = LoaderEnhancer<P, A, E, R>
  & NodeLoaderEnhancer<AnyAppRouteNode, A, E, R>
  & (<C, Q, H>(route: Route<C, P, Q, H, void, never>) => Route<C, P, Q, H, A, E>);

export type MaterializedAppRoute<P, Q, H, C extends ComponentType<any, any, any, any>, A, LE> = RoutedComponent<P, Q, H> & LoaderTaggedComponent<A, LE> & C;

export interface AppRouteNodeDef<P = unknown, Q = unknown, H = unknown, C extends ComponentType<any, any, any, any> = ComponentType<any, any, any, any>, A = unknown, LE = unknown> {
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
  readonly enhancers: ReadonlyArray<(component: ComponentType<any, any, any, any>) => ComponentType<any, any, any, any>>;
}

export interface AppRouteNodeState<P = unknown, Q = unknown, H = unknown, C extends ComponentType<any, any, any, any> = ComponentType<any, any, any, any>, A = unknown, LE = unknown> {
  readonly materialized?: MaterializedAppRoute<P, Q, H, C, A, LE>;
}

export interface AppRouteNode<P = unknown, Q = unknown, H = unknown, C extends ComponentType<any, any, any, any> = ComponentType<any, any, any, any>, A = unknown, LE = unknown> {
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
  readonly enhancers: ReadonlyArray<(component: ComponentType<any, any, any, any>) => ComponentType<any, any, any, any>>;
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
  readonly reactivityKeys?: ReadonlyArray<string>;
  readonly revalidateOnFocus?: boolean;
  readonly revalidateOnReconnect?: boolean;
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
  readonly loaders: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>;
}

/** A single loader snapshot carried inside a single-flight payload. */
export type SingleFlightLoaderEntry = {
  readonly routeId: string;
  readonly result: Result.Result<unknown, unknown>;
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

/** Runtime integration point for transparent single-flight transport support. */
export { SingleFlightTransportTag, type SingleFlightTransportService };

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
  readonly app?: AnyRoute | AnyAppRouteNode;
  readonly reactivityKeys?: ReadonlyArray<string>;
  readonly onSuccess?: (result: A, args: Args) => Effect.Effect<void>;
  readonly target?: string | URL | ((result: A, args: Args, currentUrl: URL) => string | URL | undefined);
  readonly revalidate?: "reactivity" | "matched" | "none" | ReadonlyArray<string>;
  readonly includeDeferred?: boolean;
  readonly setLoaders?: (result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
}

type LoaderFn = (params: unknown, deps?: { readonly parent: <A>() => A }) => Effect.Effect<unknown, unknown, unknown>;
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

type RegisteredRoute = {
  readonly component: ComponentType<any, any, any, any>;
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

type RouteDecoratedComponent<P = unknown, Q = unknown, H = unknown, A = unknown, E = unknown> = ComponentType<any, any, any, any> & RoutedMetadataCarrier<P, Q, H, A, E> & {
  __routeLoader?: LoaderFn;
  __routeLoaderOptions?: LoaderOptions;
  __routeLoaderError?: LoaderErrorCases<any, any>;
  __routeTitle?: string | ((params: P, loaderData: A | undefined, loaderResult: Result.Result<A, E> | undefined) => string);
  __routeMetaExtra?: RouteMetaRecord | ((params: P, loaderData: A | undefined, loaderResult: Result.Result<A, E> | undefined) => RouteMetaRecord);
  __routeTransition?: { readonly enter?: Effect.Effect<unknown>; readonly exit?: Effect.Effect<unknown> };
  __routeSitemapParams?: () => Effect.Effect<ReadonlyArray<any>>;
  __routeGuards?: ReadonlyArray<Effect.Effect<unknown, any, any>>;
};

function pipeSelf<T>(self: T, fns: ReadonlyArray<(value: unknown) => unknown>): unknown {
  return fns.reduce<unknown>((acc, fn) => fn(acc), self);
}

function isUnifiedRoute(value: unknown): value is AnyRoute {
  return (typeof value === "object" || typeof value === "function") && value !== null && UnifiedRouteSymbol in value;
}

function isRegistrableComponent(value: unknown): value is ComponentType<any, any, any, any> {
  return typeof value === "function" && ComponentRuntime.Component.TypeId in value;
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
  route.pipe = ((...fns: ReadonlyArray<(value: unknown) => unknown>) => pipeSelf(route, fns)) as Route<C, P, Q, H, LD, LE>["pipe"];
  if (isRegistrableComponent(component)) {
    registerRoute(component, internals.meta);
  }
  return route;
}

function copyUnifiedRoute<C, P, Q, H, LD, LE, P2 = P, Q2 = Q, H2 = H, LD2 = LD, LE2 = LE>(
  route: Route<C, P, Q, H, LD, LE>,
  patch: Partial<UnifiedRouteInternals<P2, Q2, H2, LD2, LE2>>,
): Route<C, P2, Q2, H2, LD2, LE2> {
  const current = route[UnifiedRouteSymbol];
  return makeUnifiedRoute(route.component, {
    kind: (patch.kind ?? current.kind) as UnifiedRouteKind,
    meta: (patch.meta ?? current.meta) as RouteMeta<P2, Q2, H2>,
    children: (patch.children ?? current.children) as ReadonlyArray<AnyRoute>,
    loaderFn: patch.loaderFn ?? current.loaderFn,
    loaderOptions: patch.loaderOptions ?? current.loaderOptions,
    loaderErrorCases: (patch.loaderErrorCases ?? current.loaderErrorCases) as LoaderErrorCases<unknown, unknown> | undefined,
    title: (patch.title ?? current.title) as StoredRouteTitle | undefined,
    metaExtra: (patch.metaExtra ?? current.metaExtra) as StoredRouteMetaExtra | undefined,
    transition: patch.transition ?? current.transition,
    guards: (patch.guards ?? current.guards) as ReadonlyArray<Effect.Effect<unknown, any, any>>,
    loader: (patch.loader ?? current.loader) as UnifiedRouteInternals<P2, Q2, H2, LD2, LE2>["loader"],
  });
}

function isRouteNode(value: unknown): value is AppRouteNode<any, any, any, any, any, any> {
  return typeof value === "object" && value !== null && RouteNodeSymbol in value;
}

function asRouteComponent<P = unknown, Q = unknown, H = unknown, A = unknown, E = unknown>(
  component: ComponentType<any, any, any, any>,
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

function toComponentRouteOptions<P, Q, H>(node: AppRouteNode<P, Q, H, any, any, any>) {
  return {
    params: node.options.params as Schema.Schema<P> | undefined,
    query: node.options.query as Schema.Schema<Q> | undefined,
    hash: node.options.hash as Schema.Schema<H> | undefined,
    exact: node.options.exact,
  };
}

function setLoaderInternals<P, A, E>(
  component: ComponentType<any, any, any, any>,
  fn: (params: P, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, any>,
  options?: LoaderOptions,
): void {
  const routed = asRouteComponent<P, any, any, A, E>(component);
  routed.__routeLoader = fn as LoaderFn;
  routed.__routeLoaderOptions = options ?? {};
  setRouteLoaderMeta<A, E>(routed);
}

function setTitleInternal(component: ComponentType<any, any, any, any>, value: string | ((params: unknown, loaderData: unknown, loaderResult: Result.Result<unknown, unknown> | undefined) => string)): void {
  asRouteComponent(component).__routeTitle = value;
}

function setMetaInternal(component: ComponentType<any, any, any, any>, value: RouteMetaRecord | ((params: unknown, loaderData: unknown, loaderResult: Result.Result<unknown, unknown> | undefined) => RouteMetaRecord)): void {
  asRouteComponent(component).__routeMetaExtra = value;
}

function appendNodeEnhancer<P, Q, H, C extends ComponentType<any, any, any, any>, A, LE>(
  node: AppRouteNode<P, Q, H, C, A, LE>,
  enhancer: (component: C) => C,
): AppRouteNode<P, Q, H, C, A, LE> {
  return withComponentEnhancer(node, enhancer);
}

function getRouteMeta<P, Q, H>(component: RoutedMetadataCarrier<P, Q, H>): RouteMeta<P, Q, H> | undefined {
  return component[RouteMetaSymbol];
}

export function routeMetaOf<C extends ComponentType<any, any, any, any>>(
  component: C,
): RouteMeta<RouteParamsOf<C>, RouteQueryOf<C>, RouteHashOf<C>> | undefined {
  return getRouteMeta(asRouteComponent(component));
}

function setRouteMeta<P, Q, H>(component: RoutedMetadataCarrier<P, Q, H>, meta: RouteMeta<P, Q, H>): void {
  (component as RoutedMetadataCarrier<P, Q, H> & { [RouteMetaSymbol]: RouteMeta<P, Q, H> })[RouteMetaSymbol] = meta;
}

function setRouteLoaderMeta<A, E>(component: RoutedMetadataCarrier<any, any, any, A, E>): void {
  (component as RoutedMetadataCarrier<any, any, any, A, E> & { [RouteLoaderMetaSymbol]: RouteLoaderMeta<A, E> })[RouteLoaderMetaSymbol] = {} as RouteLoaderMeta<A, E>;
}

function makeRouteNode<P, Q, H, C extends ComponentType<any, any, any, any>, A = unknown, LE = unknown>(
  kind: AppRouteNode["kind"],
  path: string,
  component: C,
  options?: AppRouteNode<P, Q, H, C, A, LE>["options"],
  children?: ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>,
  enhancers?: ReadonlyArray<(component: ComponentType<any, any, any, any>) => ComponentType<any, any, any, any>>,
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

function withComponentEnhancer<P, Q, H, C extends ComponentType<any, any, any, any>, A, LE>(
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

function withNodeOptions<P, Q, H, C extends ComponentType<any, any, any, any>, A, LE>(
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

function withNodeChildren<P, Q, H, C extends ComponentType<any, any, any, any>, A, LE>(
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

function materializeNode<P, Q, H, C extends ComponentType<any, any, any, any>, A, LE>(
  node: AppRouteNode<P, Q, H, C, A, LE>,
): (RoutedComponent<P, Q, H> & LoaderTaggedComponent<A, LE> & C) {
  if (node.state.materialized) {
    return node.state.materialized as RoutedComponent<P, Q, H> & LoaderTaggedComponent<A, LE> & C;
  }
  const routed = node.component.pipe(ComponentRuntime.route(node.path, toComponentRouteOptions(node)));
  let current = asRouteComponent<P, Q, H, A, LE>(routed);
  for (const enhancer of node.enhancers) {
    current = asRouteComponent<P, Q, H, A, LE>(enhancer(current));
  }
  if (node.options.id) {
    const meta = getRouteMeta(current);
    if (meta) {
      const withId = { ...meta, id: node.options.id };
      setRouteMeta(current, withId);
      routeRegistryById.set(node.options.id, { component: current, meta: withId });
    }
  }
  const materialized = current as RoutedComponent<P, Q, H> & LoaderTaggedComponent<A, LE> & C;
  (node.state as { materialized?: RoutedComponent<P, Q, H> & LoaderTaggedComponent<A, LE> & C }).materialized = materialized;
  return materialized;
}

type WithLoaderComponent<C, RAdd, EAdd, A, E> = C extends ComponentType<infer Props, infer Req, infer Err, infer B>
  ? (ComponentType<Props, Req | RAdd, Err | EAdd, B>
    & Omit<C, keyof ComponentType<any, any, any, any>>
    & RoutedComponent<RouteParamsOf<C>, RouteQueryOf<C>, RouteHashOf<C>>
    & LoaderTaggedComponent<A, E>)
  : (C & LoaderTaggedComponent<A, E>);

type RouteComponentEnhancer<I extends ComponentType<any, any, any, any>, O extends ComponentType<any, any, any, any>> = (component: I) => O;

type LoaderEnhancer<P, A, E, R> =
  & (<T extends AppRouteNode<P, any, any, any, any, any>>(route: T) => WithNodeLoader<T, A, E>)
  & (<C extends RoutedComponent<P, any, any> & ComponentType<any, any, any, any>>(route: C) => WithLoaderComponent<C, R, E, A, E>)
  & (<C extends ComponentType<any, any, any, any>>(route: C) => WithLoaderComponent<C, R, E, A, E>);

type NodeLoaderEnhancer<T extends AnyAppRouteNode, A, E, R> = LoaderEnhancer<RouteNodeParamsOf<T>, A, E, R> & ((route: T) => WithNodeLoader<T, A, E>);

type TitleEnhancer<P, A, E> =
  & (<T extends AppRouteNode<P, any, any, any, A, E>>(route: T) => T)
  & (<C extends RoutedComponent<P, any, any> & LoaderTaggedComponent<A, E> & ComponentType<any, any, any, any>>(component: C) => C)
  & (<C extends ComponentType<any, any, any, any>>(component: C) => C);

type NodeTitleEnhancer<T extends AnyAppRouteNode> = TitleEnhancer<RouteNodeParamsOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> & ((route: T) => T);

type MetaEnhancer<P, A, E> =
  & (<T extends AppRouteNode<P, any, any, any, A, E>>(route: T) => T)
  & (<C extends RoutedComponent<P, any, any> & LoaderTaggedComponent<A, E> & ComponentType<any, any, any, any>>(component: C) => C)
  & (<C extends ComponentType<any, any, any, any>>(component: C) => C);

type NodeMetaEnhancer<T extends AnyAppRouteNode> = MetaEnhancer<RouteNodeParamsOf<T>, RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> & ((route: T) => T);

type LoaderAttachResult<T, P, A, E, R> =
  T extends AppRouteNode<P, any, any, any, any, any> ? WithNodeLoader<T, A, E>
  : T extends ComponentType<any, any, any, any> ? WithLoaderComponent<T, R, E, A, E>
  : never;

type UnifiedRouteWithLoader<T extends AnyRoute, A, E> = T extends Route<infer C, infer P, infer Q, infer H, any, any>
  ? Route<C, P, Q, H, A, E>
  : never;

type UnifiedLoaderEnhancer<A, E, R> =
  <C, P, Q, H>(route: Route<C, P, Q, H, void, never>) => Route<C, P, Q, H, A, E>;

type UnifiedGuardEnhancer<Req, E> =
  <C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>;

type UnifiedTitleEnhancer<P, A, E> =
  <C, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>;

type UnifiedMetaEnhancer<P, A, E> =
  <C, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>;

type UnifiedTransitionEnhancer =
  <C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => Route<C, P, Q, H, LD, LE>;

const routeRegistry = new Map<string, RegisteredRoute>();
const routeRegistryById = new Map<string, RegisteredRoute>();
let routeIdSeq = 0;

function makeRouteId(): string {
  routeIdSeq += 1;
  return `route-${routeIdSeq}`;
}

export function createRouteId(): string {
  return makeRouteId();
}

/**
 * Internal transitional registry hook.
 *
 * Unified-route execution should prefer explicit route trees over this global
 * registry path.
 */
export function registerRoute(component: ComponentType<any, any, any, any>, meta: RouteMeta<any, any, any>): void {
  const entry = { component, meta };
  routeRegistry.set(meta.fullPattern, entry);
  if (meta.id) routeRegistryById.set(meta.id, entry);
}

/** Internal transitional lookup for registry-backed legacy flows. */
export function findRegisteredRoute(pattern: string): RegisteredRoute | undefined {
  return routeRegistry.get(pattern);
}

/**
 * Collect registered routes.
 *
 * When a route tree is provided, this prefers explicit tree traversal so
 * unified routes do not have to rely on the global registry.
 */
export function collectAll(_root: unknown): ReadonlyArray<RegisteredRoute> {
  if (_root && (isUnifiedRoute(_root) || isRouteNode(_root))) {
    return registeredRoutesFromTree(_root);
  }
  return [...routeRegistryById.values()];
}

/** Internal transitional lookup for registry-backed legacy flows. */
export function getRegisteredRouteById(routeId: string): RegisteredRoute | undefined {
  return routeRegistryById.get(routeId);
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

type ResolvedHeadEntry = {
  readonly id: string;
  readonly depth: number;
  readonly title?: string;
  readonly meta?: RouteMetaRecord;
};

const routeHeadEntries = new Map<string, ResolvedHeadEntry>();
let routeHeadSeq = 0;

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

function flushRouteHead(): void {
  const head = resolveRouteHead([...routeHeadEntries.values()]);
  applyRouteHeadToDocument(head);
}

export function createRouteHeadId(): string {
  routeHeadSeq += 1;
  return `route-head-${routeHeadSeq}`;
}

export function setRouteHead(entry: ResolvedHeadEntry): void {
  routeHeadEntries.set(entry.id, entry);
  flushRouteHead();
}

export function removeRouteHead(id: string): void {
  routeHeadEntries.delete(id);
  flushRouteHead();
}

export type RoutedComponent<P, Q, H> = ComponentType<any, any, any, any> & {
  readonly [RouteMetaSymbol]: RouteMeta<P, Q, H>;
};

export type LoaderTaggedComponent<A, E> = ComponentType<any, any, any, any> & {
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

type LoaderTarget = string | LoaderTaggedComponent<any, any> | AnyRoute;

/**
 * Create a first-class unified route by attaching a path pattern to a component.
 *
 * Path params are inferred from the pattern. Use `Route.paramsSchema(...)` when
 * you want decoded params with richer types than the raw string-based inference.
 */
export function path<Pattern extends string>(
  pattern: Pattern,
): <C extends ComponentType<any, any, any, any>>(
  component: C,
) => Route<C, ExtractParams<Pattern>, {}, undefined, void, never> {
  return <C extends ComponentType<any, any, any, any>>(component: C) =>
    makeUnifiedRoute(component, {
      kind: "path",
      meta: {
        pattern,
        fullPattern: pattern,
        id: createRouteId(),
      },
      children: [],
      guards: [],
    });
}

/** Create a first-class page route node. */
function page<C extends ComponentType<any, any, any, any>>(path: string, component: C): AppRouteNode<unknown, unknown, unknown, C, unknown, unknown> {
  return makeRouteNode("page", path, component);
}

/**
 * Mark a route as a layout route.
 *
 * `Route.layout()` is the unified-route form used in a pipe chain. The
 * constructor form is still present temporarily while the refactor is in
 * progress.
 */
export function layout(): <C, P, Q, H, LD, LE>(route: Route<C, P, Q, H, LD, LE>) => LayoutRoute<C, P, Q, H, LD, LE>;
export function layout<C extends ComponentType<any, any, any, any>>(component: C): AppRouteNode<unknown, unknown, unknown, C, unknown, unknown>;
export function layout(component?: ComponentType<any, any, any, any>) {
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
export function index<C extends ComponentType<any, any, any, any>>(component: C): AppRouteNode<unknown, unknown, unknown, C, unknown, unknown>;
export function index(component?: ComponentType<any, any, any, any>) {
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

/** Materialize a route tree and return its root node. */
function define<T extends AppRouteNode<any, any, any, any, any, any>>(root: T): T {
  materializeTree(root);
  return root;
}

/** Reference an existing route node without altering it. */
function ref<T extends AppRouteNode<any, any, any, any, any, any>>(route: T): T {
  return route;
}

/** Attach child route nodes to an existing route node. */
function mount<T extends AppRouteNode<any, any, any, any, any, any>>(
  route: T,
  children: ReadonlyArray<AppRouteNode<any, any, any, any, any, any>>,
): T {
  return withNodeChildren(route, children) as T;
}

/**
 * Attach child routes to a layout route.
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

/** Assign a stable route id to a route or route node. */
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
function componentOf<T extends AppRouteNode<any, any, any, any, any, any>>(route: T): RoutedComponent<RouteNodeParamsOf<T>, RouteNodeQueryOf<T>, RouteNodeHashOf<T>> & LoaderTaggedComponent<RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> & T["component"] {
  return materializeNode(route);
}

function materializeTree(route: AppRouteNode<any, any, any, any, any, any>): void {
  materializeNode(route);
  for (const child of route.children) {
    materializeTree(child);
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
      ? asRouteComponent(component as ComponentType<any, any, any, any>).__routeSitemapParams as (() => Effect.Effect<ReadonlyArray<unknown>>) | undefined
      : undefined;
  }
  const component = routeComponentOfTarget(target);
  return component ? asRouteComponent(component).__routeSitemapParams as (() => Effect.Effect<ReadonlyArray<unknown>>) | undefined : undefined;
}

function routeComponentOfTarget(target: AnyAppRouteNode | AnyRoute): ComponentType<any, any, any, any> | undefined {
  if (isUnifiedRoute(target)) {
    return typeof target.component === "function"
      ? target.component as ComponentType<any, any, any, any>
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

function registeredRouteFromTarget(root: AnyAppRouteNode | AnyRoute, target: AnyAppRouteNode | AnyRoute): RegisteredRoute | undefined {
  const fullPattern = routePathOfTarget(root, target);
  const meta = isUnifiedRoute(target)
    ? { ...target[UnifiedRouteSymbol].meta, fullPattern }
    : routeMetaOf(routeComponentOfTarget(target)!);
  if (!meta) return undefined;
  const component = routeComponentOfTarget(target);
  if (!component) return undefined;
  return {
    component,
    meta,
  };
}

function registeredRoutesFromTree(root: AnyAppRouteNode | AnyRoute): ReadonlyArray<RegisteredRoute> {
  const out: Array<RegisteredRoute> = [];
  for (const target of nodesInternal(root)) {
    const entry = registeredRouteFromTarget(root, target);
    if (entry) out.push(entry);
  }
  return out;
}

function collectSitemapEntriesForTreeInternal(
  root: AnyRoute | AnyAppRouteNode,
  baseUrl: string,
): Effect.Effect<ReadonlyArray<{ readonly loc: string }>, never> {
  return Effect.gen(function* () {
    const out: Array<{ readonly loc: string }> = [];
    for (const entry of nodesInternal(root)) {
      const fullPattern = routePathOfTarget(root, entry);
      if (!fullPattern || fullPattern.includes(":")) {
        const enumerate = routeSitemapParamsOfTarget(entry);
        if (!enumerate) continue;
        const paramsList = yield* enumerate().pipe(
          Effect.match({
            onFailure: () => [] as ReadonlyArray<unknown>,
            onSuccess: (value) => value,
          }),
        );
        const linkFn = isUnifiedRoute(entry)
          ? link(entry)
          : link(componentOf(entry));
        for (const paramsValue of paramsList) {
          out.push({ loc: new URL(linkFn(paramsValue as never), baseUrl).toString() });
        }
        continue;
      }
      out.push({ loc: new URL(fullPattern, baseUrl).toString() });
    }
    return out;
  });
}

function prefetchTreeInternal<P, Q>(
  root: AnyRoute | AnyAppRouteNode,
  to: RouteLink<P, Q>,
  paramsValue: P,
  options?: { readonly query?: Partial<Q>; readonly hash?: string; readonly scope?: "loader" | "component" | "full" },
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const href = to(paramsValue, { query: options?.query, hash: options?.hash });
    const url = new URL(href, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    yield* runMatchedLoadersTreeInternal(root, url, { includeDeferred: true });
  }) as Effect.Effect<void, never>;
}

function runMatchedLoadersRegistry(
  url: URL,
  options?: { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReadonlyArray<string> },
): Effect.Effect<ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>, never> {
  return Effect.gen(function* () {
    const matched = [...routeRegistryById.values()]
      .filter((entry) => matchPattern(entry.meta.fullPattern, url.pathname, entry.meta.exact))
      .sort((a, b) => a.meta.fullPattern.length - b.meta.fullPattern.length);

    const candidates = matched.filter((entry) => {
      const loaderOptions = asRouteComponent(entry.component).__routeLoaderOptions;
      const isDeferred = loaderOptions?.priority === "deferred";
      if (isDeferred && options?.includeDeferred === false) return false;
      if (!asRouteComponent(entry.component).__routeLoader) return false;
      if (!options?.reactivityKeys || options.reactivityKeys.length === 0) return true;
      const routeId = entry.meta.id ?? entry.meta.fullPattern;
      const paramsRaw = extractParams(entry.meta.fullPattern, url.pathname) ?? {};
      const loaderKeys = collectLoaderReactivityKeys(routeId, paramsRaw, {
        fallback: loaderOptions?.reactivityKeys,
      });
      return matchesLoaderReactivity(loaderKeys, options.reactivityKeys);
    });

    const remaining = [...candidates];
    const outputs: Array<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }> = [];
    const successByPattern = new Map<string, unknown>();

    while (remaining.length > 0) {
      const runnable = remaining.filter((entry) => {
        const loaderOptions = asRouteComponent(entry.component).__routeLoaderOptions;
        if (!loaderOptions?.dependsOnParent) return true;
        const parentPattern = findParentPattern(entry.meta.fullPattern, matched.map((m) => m.meta.fullPattern));
        if (!parentPattern) return true;
        return successByPattern.has(parentPattern);
      });

      const batch = runnable.length > 0 ? runnable : [remaining[0] as RegisteredRoute];
      const batchResults = yield* Effect.all(batch.map((entry) => {
        const loaderFn = asRouteComponent(entry.component).__routeLoader as LoaderFn;
        const paramsRaw = extractParams(entry.meta.fullPattern, url.pathname) ?? {};
        const routeId = entry.meta.id ?? entry.meta.fullPattern;
        const loaderOptions = asRouteComponent(entry.component).__routeLoaderOptions;
        const parentPattern = findParentPattern(entry.meta.fullPattern, [...successByPattern.keys()]);
        const parentData = parentPattern ? successByPattern.get(parentPattern) : undefined;
        return runCachedLoader(
          routeId,
          paramsRaw,
          loaderFn(paramsRaw, { parent: <X>() => parentData as X }) as Effect.Effect<unknown, unknown>,
          loaderOptions,
        ).pipe(Effect.map((result) => ({ routeId, result, pattern: entry.meta.fullPattern })));
      }), { concurrency: "unbounded" });

      for (const item of batchResults) {
        outputs.push({ routeId: item.routeId, result: item.result });
        if (item.result._tag === "Success") {
          successByPattern.set(item.pattern, item.result.value);
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

function runMatchedLoadersTreeInternal(
  root: AnyRoute | AnyAppRouteNode,
  url: URL,
  options?: { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReadonlyArray<string> },
): Effect.Effect<ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>, never> {
  return Effect.gen(function* () {
    const matched = collectMatchedRouteTargets(root, url.pathname);

    const candidates = matched.filter((entry) => {
      const loaderOptions = routeLoaderOptionsOfTarget(entry);
      const isDeferred = loaderOptions?.priority === "deferred";
      if (isDeferred && options?.includeDeferred === false) return false;
      if (!targetHasLoader(entry)) {
        return false;
      }
      if (!options?.reactivityKeys || options.reactivityKeys.length === 0) return true;
      const fullPattern = routePathOfTarget(root, entry);
      const routeId = routeIdOfTarget(entry, fullPattern);
      const paramsRaw = extractParams(fullPattern, url.pathname) ?? {};
      const loaderKeys = collectLoaderReactivityKeys(routeId, paramsRaw, {
        fallback: loaderOptions?.reactivityKeys,
      });
      return matchesLoaderReactivity(loaderKeys, options.reactivityKeys);
    });

    const remaining = [...candidates];
    const outputs: Array<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }> = [];
    const successByPattern = new Map<string, unknown>();

    while (remaining.length > 0) {
      const runnable = remaining.filter((entry) => {
        const loaderOptions = routeLoaderOptionsOfTarget(entry);
        if (!loaderOptions?.dependsOnParent) return true;
        const fullPattern = routePathOfTarget(root, entry);
        const parent = parentOfInternal(root, entry);
        if (!parent) return true;
        const parentPattern = routePathOfTarget(root, parent);
        if (parentPattern === fullPattern) return true;
        return successByPattern.has(parentPattern);
      });

      const batch = runnable.length > 0 ? runnable : [remaining[0] as AnyAppRouteNode | AnyRoute];
      const batchResults = yield* Effect.all(batch.map((entry) => {
        const fullPattern = routePathOfTarget(root, entry);
        const routeId = routeIdOfTarget(entry, fullPattern);
        const parent = parentOfInternal(root, entry);
        const parentPattern = parent ? routePathOfTarget(root, parent) : undefined;
        const parentData = parentPattern ? successByPattern.get(parentPattern) : undefined;
        return (isUnifiedRoute(entry)
          ? runRouteLoader(entry, url, parentData)
          : (() => {
            const component = routeComponentOfTarget(entry);
            const meta = component ? routeMetaOf(component) : undefined;
            if (!component || !meta) return Effect.succeed(Result.initial(false));
            return runRouteLoader(component, meta, url, parentData);
          })()).pipe(
            Effect.map((result) => ({ routeId, result, pattern: fullPattern })),
          );
      }), { concurrency: "unbounded" });

      for (const item of batchResults) {
        outputs.push({ routeId: item.routeId, result: item.result });
        if (item.result._tag === "Success") {
          successByPattern.set(item.pattern, item.result.value);
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

function runStreamingNavigationRegistry(
  url: URL,
): Effect.Effect<{
  readonly critical: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>;
  readonly deferredScripts: ReadonlyArray<string>;
}, never> {
  return Effect.gen(function* () {
    const critical = yield* runMatchedLoadersRegistry(url, { includeDeferred: false });
    const all = yield* runMatchedLoadersRegistry(url, { includeDeferred: true });
    const criticalIds = new Set(critical.map((c) => c.routeId));
    const deferred = all.filter((item) => !criticalIds.has(item.routeId));
    const deferredScripts = streamDeferredLoaderScripts(deferred);
    return { critical, deferredScripts };
  });
}

function runStreamingNavigationTreeInternal(
  root: AnyRoute | AnyAppRouteNode,
  url: URL,
): Effect.Effect<{
  readonly critical: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>;
  readonly deferredScripts: ReadonlyArray<string>;
}, never> {
  return Effect.gen(function* () {
    const critical = yield* runMatchedLoadersTreeInternal(root, url, { includeDeferred: false });
    const all = yield* runMatchedLoadersTreeInternal(root, url, { includeDeferred: true });
    const criticalIds = new Set(critical.map((c) => c.routeId));
    const deferred = all.filter((item) => !criticalIds.has(item.routeId));
    const deferredScripts = streamDeferredLoaderScripts(deferred);
    return { critical, deferredScripts };
  });
}

function collectMatchedRouteTargets(root: AnyAppRouteNode | AnyRoute, pathname: string): ReadonlyArray<AnyAppRouteNode | AnyRoute> {
  return nodesInternal(root)
    .filter((entry) => {
      const fullPattern = routePathOfTarget(root, entry);
      return fullPattern.length > 0 && matchPattern(fullPattern, pathname, routeExactOfTarget(entry));
    })
    .sort((a, b) => routePathOfTarget(root, a).length - routePathOfTarget(root, b).length);
}

function setResolvedTreeHeadEntries(
  root: AnyAppRouteNode | AnyRoute,
  url: URL,
  results: ReadonlyArray<{ readonly routeId: string; readonly result: UnknownRouteResult }>,
): void {
  const resultByRouteId = new Map(results.map((item) => [item.routeId, item.result] as const));
  for (const target of collectMatchedRouteTargets(root, url.pathname)) {
    const fullPattern = routePathOfTarget(root, target);
    const routeId = routeIdOfTarget(target, fullPattern);
    const title = routeTitleOfTarget(target);
    const metaExtra = routeMetaExtraOfTarget(target);
    if (title === undefined && metaExtra === undefined) continue;

    const params = extractParams(fullPattern, url.pathname) ?? {};
    const loaderResult = resultByRouteId.get(routeId);
    const loaderData = loaderResult?._tag === "Success" ? loaderResult.value : undefined;
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

    routeHeadEntries.set(routeId, {
      id: routeId,
      depth: fullPattern.split("/").filter(Boolean).length,
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
      if (part.startsWith(":")) names.add(part.slice(1).replace(/\?$/, ""));
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
          const name = part.slice(1);
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
        const name = part.slice(1).replace(/\?$/, "");
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
    const streaming = yield* runStreamingNavigation(app, requestUrl);
    const appComponent = isUnifiedRoute(app) ? app.component : componentOf(app);
    let effect = ComponentRuntime.renderEffect(appComponent, {}).pipe(
      Effect.provide(Server({ url: requestUrl.toString() })),
      Effect.provideService(ServerRequestTag, { request: options.request, url: requestUrl }),
      Effect.provideService(ServerResponseTag, responseService),
    ) as Effect.Effect<unknown, never, never>;
    if (options.layer) {
      effect = effect.pipe(Effect.provide(options.layer)) as Effect.Effect<unknown, never, never>;
    }

    routeHeadEntries.clear();
    if (isUnifiedRoute(app)) {
      setResolvedTreeHeadEntries(app, requestUrl, streaming.critical);
    }
    setRequestEvent({ request: options.request, url: requestUrl });
    const html = renderToString(() => Effect.runSync(effect));
    setRequestEvent(undefined);
    const head = resolveRouteHead([...routeHeadEntries.values()]);
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

export type RouteLink<P, Q> = ((paramsValue: P, options?: { readonly query?: Partial<Q>; readonly hash?: string }) => string) & {
  readonly pattern: string;
};

/** Render a request through a RouterRuntime instance. */
export function renderRequestWithRuntime(
  runtime: RouterRuntimeModule.RouterRuntimeInstance,
  request: Request,
  options?: { readonly layer?: Layer.Layer<any> },
): Effect.Effect<RenderRequestResult, never> {
  return runtime.renderRequest(request, options);
}

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

function toParts(path: string): ReadonlyArray<string> {
  return path.split("/").filter((p) => p.length > 0);
}

export function extractParams(pattern: string, pathname: string): Record<string, string> | null {
  const pp = toParts(pattern);
  const ap = toParts(pathname);
  if (ap.length < pp.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < pp.length; i += 1) {
    const p = pp[i];
    const a = ap[i];
    if (p === undefined || a === undefined) return null;
    if (p.startsWith(":")) {
      out[p.slice(1)] = decodeURIComponent(a);
      continue;
    }
    if (p !== a) return null;
  }
  return out;
}

export function matchPattern(pattern: string, pathname: string, exact?: boolean): boolean {
  const pp = toParts(pattern);
  const ap = toParts(pathname);
  if (exact && ap.length !== pp.length) return false;
  if (ap.length < pp.length) return false;
  for (let i = 0; i < pp.length; i += 1) {
    const p = pp[i];
    const a = ap[i];
    if (p === undefined || a === undefined) return false;
    if (p.startsWith(":")) continue;
    if (p !== a) return false;
  }
  return true;
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

export function loaderData<A>(): Effect.Effect<Atom.ReadonlyAtom<A>, never, RouteContext<any, any, any>> {
  return Effect.gen(function* () {
    const ctx = yield* RouteContextTag;
    const direct = ctx.loaderData;
    if (direct) return direct as Atom.ReadonlyAtom<A>;
    const result = ctx.loaderResult;
    if (result) {
      return Atom.derived(() => {
        const current = result();
        if (current._tag === "Success") return current.value as A;
        throw new Error("[effect-atom-jsx/Route] loader data not available yet.");
      }) as Atom.ReadonlyAtom<A>;
    }
    throw new Error("[effect-atom-jsx/Route] loaderData used without Route.loader.");
  });
}

/**
 * Loader state accessor for async rendering.
 *
 * Use this with `Async` / `Result` control-flow components instead of
 * introducing router-specific loading UI abstractions.
 */
export function loaderResult<A, E = unknown>(): Effect.Effect<Atom.ReadonlyAtom<Result.Result<A, E>>, never, RouteContext<any, any, any>> {
  return Effect.gen(function* () {
    const ctx = yield* RouteContextTag;
    if (ctx.loaderResult) {
      return ctx.loaderResult as Atom.ReadonlyAtom<Result.Result<A, E>>;
    }
    if (ctx.loaderData) {
      return Atom.derived(() => Result.success(ctx.loaderData!() as A)) as Atom.ReadonlyAtom<Result.Result<A, E>>;
    }
    return Atom.derived(() => Result.initial<A, E>(true)) as Atom.ReadonlyAtom<Result.Result<A, E>>;
  });
}

export function matches(pattern: string): Effect.Effect<Atom.ReadonlyAtom<boolean>, never, RouterService> {
  return Effect.gen(function* () {
    const router = yield* RouterTag;
    return Atom.derived(() => matchPattern(pattern, router.url().pathname));
  });
}

export function link<T extends ComponentType<any, any, any, any> | AppRouteNode<any, any, any, any, any, any> | AnyRoute>(
  routed: T,
): T extends AppRouteNode<infer P, infer Q, any, any, any, any>
  ? RouteLink<P, Q>
  : T extends Route<any, infer P, infer Q, any, any, any>
    ? RouteLink<P, Q>
  : T extends RoutedComponent<any, any, any>
    ? RouteLink<RouteParamsOf<T>, RouteQueryOf<T>>
  : RouteLink<Record<string, string>, Record<string, string>> {
  const meta = isUnifiedRoute(routed)
    ? routed[UnifiedRouteSymbol].meta
    : getRouteMeta(asRouteComponent(isRouteNode(routed) ? materializeNode(routed) : routed));
  if (!meta) {
    throw new Error("[effect-atom-jsx/Route] Route.link requires a routed component or unified route.");
  }

  const encodeParams = encodeWithSchema(meta.paramsSchema);
  const encodeQuery = meta.querySchema ? encodeWithSchema(meta.querySchema) : undefined;

  const make = (paramsValue: RouteParamsOf<T>, options?: { readonly query?: Partial<RouteQueryOf<T>>; readonly hash?: string }) => {
    let path = meta.fullPattern;
    const encoded = encodeParams(paramsValue) as Record<string, unknown>;
    for (const [k, v] of Object.entries(encoded ?? {})) {
      path = path.replace(`:${k}`, encodeURIComponent(String(v)));
    }

    if (options?.query && encodeQuery) {
      const q = encodeQuery(options.query as RouteQueryOf<T>) as Record<string, unknown>;
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
  const active = (props.to.pattern ? window.location.pathname.startsWith(props.to.pattern.replace(/:[^/]+/g, "")) : false);
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    if (runtime !== null) {
      runtime.runFork(Effect.gen(function* () {
        const router = yield* RouterTag;
        yield* router.navigate(href);
      }) as Effect.Effect<void, never, never>);
    } else {
      window.history.pushState(null, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  };
  const onMouseEnter = () => {
    if (props.preload !== "hover" || runtime === null) return;
    runtime.runFork(Effect.gen(function* () {
      const router = yield* RouterTag;
      if (router.preload) {
        yield* router.preload(href);
      }
      yield* prefetch(props.to as RouteLink<P, Q>, props.params, { query: props.query, hash: props.hash, scope: "full" });
    }) as Effect.Effect<void, never, never>);
  };
  const className = typeof props.class === "function" ? props.class(active) : props.class;
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

    return Atom.writable(
      () => {
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
        Effect.runSync(router.navigate(url.pathname + url.search, { replace: true }));
      },
    );
  });
}

export function loader<T extends AnyAppRouteNode, A, E, R>(
  fn: (params: RouteNodeParamsOf<T>, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, R>,
  options?: LoaderOptions,
): NodeLoaderEnhancer<T, A, E, R>;
export function loader<C, P, Q, H, A, E, R>(
  fn: (params: P, deps?: { readonly parent: <X>() => X }) => Effect.Effect<A, E, R>,
  options?: LoaderOptions,
): (route: Route<C, P, Q, H, void, never>) => Route<C, P, Q, H, A, E>;
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

export function loaderError(
  cases: LoaderErrorCases<any, any>,
): <C extends ComponentType<any, any, any, any> | AnyRoute>(component: C) => C {
  return <C extends ComponentType<any, any, any, any> | AnyRoute>(component: C): C => {
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
  yield* router.navigate(current.pathname + current.search + current.hash, { replace: true });
});

/**
 * Prefetch loader work.
 *
 * Pass a route tree as the first argument to use the tree-first unified route
 * path; otherwise this falls back to the legacy registry-backed lookup path.
 */
export function prefetch<P, Q>(
  to: RouteLink<P, Q>,
  paramsValue: P,
  options?: { readonly query?: Partial<Q>; readonly hash?: string; readonly scope?: "loader" | "component" | "full" },
): Effect.Effect<void, never>;
export function prefetch<P, Q>(
  root: AnyRoute | AnyAppRouteNode,
  to: RouteLink<P, Q>,
  paramsValue: P,
  options?: { readonly query?: Partial<Q>; readonly hash?: string; readonly scope?: "loader" | "component" | "full" },
): Effect.Effect<void, never>;
export function prefetch<P, Q>(
  rootOrTo: AnyRoute | AnyAppRouteNode | RouteLink<P, Q>,
  toOrParams: RouteLink<P, Q> | P,
  paramsOrOptions?: P | { readonly query?: Partial<Q>; readonly hash?: string; readonly scope?: "loader" | "component" | "full" },
  maybeOptions?: { readonly query?: Partial<Q>; readonly hash?: string; readonly scope?: "loader" | "component" | "full" },
): Effect.Effect<void, never> {
  if (typeof rootOrTo === "function") {
    const to = rootOrTo;
    const paramsValue = toOrParams as P;
    const options = paramsOrOptions as { readonly query?: Partial<Q>; readonly hash?: string; readonly scope?: "loader" | "component" | "full" } | undefined;
    return Effect.gen(function* () {
      const href = to(paramsValue, { query: options?.query, hash: options?.hash });
      const url = new URL(href, typeof window === "undefined" ? "http://localhost" : window.location.origin);
      yield* runMatchedLoaders(url, { includeDeferred: true });
    }) as Effect.Effect<void, never>;
  }
  return prefetchTreeInternal(rootOrTo, toOrParams as RouteLink<P, Q>, paramsOrOptions as P, maybeOptions);
}

/**
 * Prefetch loader work from an explicit route tree.
 *
 * This avoids the global route registry and is the preferred prefetch path for
 * unified route roots and subtrees.
 */
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
export function setLoaderData<C extends LoaderTaggedComponent<any, any>>(
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
    result: Result.success(data),
  };
}

/**
 * Build a seeded loader result entry from a fully formed `Result` value.
 *
 * Use this when you want to seed loading/failure/success explicitly.
 */
export function setLoaderResult<C extends LoaderTaggedComponent<any, any>>(
  route: C,
  result: Result.Result<RouteLoaderDataOf<C>, RouteLoaderErrorOf<C>>,
): SingleFlightLoaderEntry;
export function setLoaderResult<C extends AnyRoute>(
  route: C,
  result: Result.Result<LoaderDataOf<C>, LoaderErrorOf<C>>,
): SingleFlightLoaderEntry;
export function setLoaderResult(
  routeId: string,
  result: Result.Result<unknown, unknown>,
): SingleFlightLoaderEntry;
export function setLoaderResult(
  route: LoaderTarget,
  result: Result.Result<unknown, unknown>,
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
export function seedLoader<A, C extends LoaderTaggedComponent<any, any>>(
  route: C,
  select?: (result: A) => RouteLoaderDataOf<C>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoader<A, C extends AnyRoute>(
  route: C,
  select?: (result: A) => LoaderDataOf<C>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoader<A>(
  route: LoaderTaggedComponent<any, any> | AnyRoute,
  select?: (result: A) => unknown,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry> {
  return (result) => [{
    routeId: resolveSingleFlightRouteId(route),
    result: Result.success(select ? select(result) : result),
  }];
}

/**
 * Convenience helper for projecting a mutation result into an arbitrary loader
 * `Result` payload.
 */
export function seedLoaderResult<A, C extends LoaderTaggedComponent<any, any>>(
  route: C,
  select: (result: A) => Result.Result<RouteLoaderDataOf<C>, RouteLoaderErrorOf<C>>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoaderResult<A, C extends AnyRoute>(
  route: C,
  select: (result: A) => Result.Result<LoaderDataOf<C>, LoaderErrorOf<C>>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry>;
export function seedLoaderResult<A>(
  route: LoaderTaggedComponent<any, any> | AnyRoute,
  select: (result: A) => Result.Result<unknown, unknown>,
): <Args extends ReadonlyArray<unknown>>(result: A, args: Args, targetUrl: URL) => ReadonlyArray<SingleFlightLoaderEntry> {
  return (result) => [{
    routeId: resolveSingleFlightRouteId(route),
    result: select(result),
  }];
}

export function action<Args extends ReadonlyArray<unknown>, A, E, R>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: { readonly reactivityKeys?: ReadonlyArray<string>; readonly onSuccess?: () => Effect.Effect<void> },
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
        : options?.app
          ? yield* runMatchedLoaders(options.app, targetUrl, {
            includeDeferred: options?.includeDeferred ?? true,
            reactivityKeys: revalidate === "reactivity" ? capturedInvalidations : undefined,
          })
          : yield* runMatchedLoaders(targetUrl, {
            includeDeferred: options?.includeDeferred ?? true,
            reactivityKeys: revalidate === "reactivity" ? capturedInvalidations : undefined,
          });
      const filteredLoaders = Array.isArray(revalidate)
        ? allLoaders.filter((item) => revalidate.includes(item.routeId))
        : revalidate === "reactivity" && capturedInvalidations.length === 0
          ? options?.app
            ? yield* runMatchedLoaders(options.app, targetUrl, { includeDeferred: options?.includeDeferred ?? true })
            : yield* runMatchedLoaders(targetUrl, { includeDeferred: options?.includeDeferred ?? true })
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
 * Hydrate loader cache entries from a previously returned single-flight payload.
 *
 * When a route tree is provided, hydration prefers the explicit tree over the
 * global registry so unified routes can hydrate without relying on registry
 * lookups.
 */
export function hydrateSingleFlightPayload(
  payload: SingleFlightPayload<unknown>,
): Effect.Effect<void, never>;
export function hydrateSingleFlightPayload(
  payload: SingleFlightPayload<unknown>,
  root: AnyRoute | AnyAppRouteNode,
): Effect.Effect<void, never>;
export function hydrateSingleFlightPayload(
  payload: SingleFlightPayload<unknown>,
  root?: AnyRoute | AnyAppRouteNode,
): Effect.Effect<void, never> {
  return Effect.sync(() => {
  const url = new URL(payload.url);
  const treeRoutes = root ? registeredRoutesFromTree(root) : undefined;
  for (const item of payload.loaders) {
    const byTree = treeRoutes?.find((entry) => (entry.meta.id ?? entry.meta.fullPattern) === item.routeId);
    const byId = byTree ?? getRegisteredRouteById(item.routeId);
    const byPattern = byId ?? findRegisteredRoute(item.routeId);
    if (!byPattern) continue;
    const params = extractParams(byPattern.meta.fullPattern, url.pathname) ?? {};
    const loaderOptions = asRouteComponent(byPattern.component).__routeLoaderOptions;
    setLoaderCacheEntry(item.routeId, params, item.result, loaderOptions);
  }
  });
}

/**
 * Turn a low-level single-flight runner into a request handler that accepts the
 * posted args/url envelope and returns a serializable success/failure response.
 */
export function createSingleFlightHandler<Args extends ReadonlyArray<unknown>, A, E, R>(
  run: (...args: Args) => Effect.Effect<SingleFlightPayload<A>, E, R | RouterService>,
  options?: { readonly baseUrl?: string },
): (request: SingleFlightRequest<Args>) => Effect.Effect<SingleFlightResponse<A, E>, never, R> {
  return (request) => {
    const base = options?.baseUrl ?? "http://localhost";
    const requestUrl = new URL(request.url, base).toString();
    return run(...request.args).pipe(
      Effect.provide(Server({ url: requestUrl })),
      Effect.match({
        onSuccess: (payload) => ({ ok: true as const, payload }),
        onFailure: (error) => ({ ok: false as const, error }),
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
    execute: <Args extends ReadonlyArray<unknown>, A, E = unknown>(
      request: SingleFlightRequest<Args>,
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
          throw { _tag: "SingleFlightTransportError", message: "No single-flight endpoint resolved" } as const;
        }
        const fetchImpl = overrides?.fetch ?? options?.fetch
          ?? ((input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) =>
            fetch(input, init as RequestInit) as Promise<{ readonly json: () => Promise<unknown> }>);
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        });
        return await response.json() as SingleFlightResponse<A, E>;
      },
      catch: (cause) => {
        if (typeof cause === "object" && cause !== null && "_tag" in cause && (cause as { readonly _tag: string })._tag === "SingleFlightTransportError") {
          return cause as { readonly _tag: "SingleFlightTransportError"; readonly message: string; readonly cause?: unknown };
        }
        return { _tag: "SingleFlightTransportError", message: "Failed to execute single-flight transport", cause } as const;
      },
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
): (request: SingleFlightRequest<Args>) => Effect.Effect<SingleFlightResponse<A, E>, never, R> {
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
    readonly app?: AnyRoute | AnyAppRouteNode;
  },
): Effect.Effect<SingleFlightPayload<A>, { readonly _tag: "SingleFlightInvokeError"; readonly message: string; readonly cause?: unknown }, never> {
  return Effect.tryPromise({
    try: async () => {
      const fetchImpl = options?.fetch ?? ((input: string, init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string }) =>
        fetch(input, init as RequestInit) as Promise<{ readonly json: () => Promise<unknown> }>);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const parsed = await response.json() as SingleFlightResponse<A, unknown>;
      if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
        throw { _tag: "SingleFlightInvokeError", message: "Invalid single-flight response shape" } as const;
      }
      if (parsed.ok === false) {
        throw { _tag: "SingleFlightInvokeError", message: "Single-flight action failed", cause: parsed.error } as const;
      }
      return parsed.payload;
    },
    catch: (cause) => {
      if (typeof cause === "object" && cause !== null && "_tag" in cause && (cause as { readonly _tag: string })._tag === "SingleFlightInvokeError") {
        return cause as { readonly _tag: "SingleFlightInvokeError"; readonly message: string; readonly cause?: unknown };
      }
      return { _tag: "SingleFlightInvokeError", message: "Failed to invoke single-flight endpoint", cause } as const;
    },
  }).pipe(
    Effect.tap((payload) => options?.hydrate === false
      ? Effect.void
      : options?.app
        ? hydrateSingleFlightPayload(payload as SingleFlightPayload<unknown>, options.app)
        : hydrateSingleFlightPayload(payload as SingleFlightPayload<unknown>)),
  );
}

export function guard<Req, E>(
  check: Effect.Effect<unknown, E, Req>,
): UnifiedGuardEnhancer<Req, E>;
export function guard<Req, E>(
  check: Effect.Effect<unknown, E, Req>,
): GuardEnhancer<Req, E> {
  const attach = (component: RouteTargetComponent) => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        guards: [...component[UnifiedRouteSymbol].guards, check],
      });
    }
    const routed = asRouteComponent(component);
    const previous = routed.__routeGuards;
    routed.__routeGuards = [...(previous ?? []), check];
    return routed;
  };
  return attach as GuardEnhancer<Req, E>;
}

export function title<P, A = unknown, E = unknown>(
  value: string | ((params: P, loaderData: A | undefined, loaderResult: Result.Result<A, E> | undefined) => string),
): <T extends Route<any, P, any, any, A, E>>(route: T) => T;
export function title<T extends AnyAppRouteNode>(
  value: string | ((params: RouteNodeParamsOf<T>, loaderData: RouteNodeLoaderDataOf<T> | undefined, loaderResult: Result.Result<RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> | undefined) => string),
): NodeTitleEnhancer<T>;
export function title<P, A = unknown, E = unknown>(
  value: string | ((params: P, loaderData: A | undefined, loaderResult: Result.Result<A, E> | undefined) => string),
): TitleEnhancer<P, A, E>;
export function title(
  value: string | ((params: unknown, loaderData: unknown, loaderResult: Result.Result<unknown, unknown> | undefined) => string),
): TitleRouteEnhancer<unknown, unknown, unknown> {
  const attach = <C extends ComponentType<any, any, any, any> | AnyAppRouteNode | AnyRoute>(component: C): C => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        title: value,
      }) as C;
    }
    if (isRouteNode(component)) {
      return appendNodeEnhancer(component, (inner) => {
        setTitleInternal(inner, value);
        return inner;
      }) as C;
    }
    setTitleInternal(component, value);
    return component;
  };
  return attach as TitleRouteEnhancer<unknown, unknown, unknown>;
}

export function meta<P, A = unknown, E = unknown>(
  value: RouteMetaRecord | ((params: P, loaderData: A | undefined, loaderResult: Result.Result<A, E> | undefined) => RouteMetaRecord),
): <T extends Route<any, P, any, any, A, E>>(route: T) => T;
export function meta<T extends AnyAppRouteNode>(
  value: RouteMetaRecord | ((params: RouteNodeParamsOf<T>, loaderData: RouteNodeLoaderDataOf<T> | undefined, loaderResult: Result.Result<RouteNodeLoaderDataOf<T>, RouteNodeLoaderErrorOf<T>> | undefined) => RouteMetaRecord),
): NodeMetaEnhancer<T>;
export function meta<P, A = unknown, E = unknown>(
  value: RouteMetaRecord | ((params: P, loaderData: A | undefined, loaderResult: Result.Result<A, E> | undefined) => RouteMetaRecord),
): MetaEnhancer<P, A, E>;
export function meta(
  value: RouteMetaRecord | ((params: unknown, loaderData: unknown, loaderResult: Result.Result<unknown, unknown> | undefined) => RouteMetaRecord),
): MetaRouteEnhancer<unknown, unknown, unknown> {
  const attach = <C extends ComponentType<any, any, any, any> | AnyAppRouteNode | AnyRoute>(component: C): C => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        metaExtra: value,
      }) as C;
    }
    if (isRouteNode(component)) {
      return appendNodeEnhancer(component, (inner) => {
        setMetaInternal(inner, value);
        return inner;
      }) as C;
    }
    setMetaInternal(component, value);
    return component;
  };
  return attach as MetaRouteEnhancer<unknown, unknown, unknown>;
}

export function transition(
  value: { readonly enter?: Effect.Effect<unknown>; readonly exit?: Effect.Effect<unknown> },
): <C extends ComponentType<any, any, any, any> | AnyRoute>(component: C) => C {
  return <C extends ComponentType<any, any, any, any> | AnyRoute>(component: C): C => {
    if (isUnifiedRoute(component)) {
      return copyUnifiedRoute(component, {
        transition: value,
      }) as C;
    }
    asRouteComponent(component).__routeTransition = value;
    return component;
  };
}

export function sitemapParams<P, E = never, R = never>(
  enumerate: () => Effect.Effect<ReadonlyArray<P>, E, R>,
): <C extends ComponentType<any, any, any, any>>(component: C) => C {
  return <C extends ComponentType<any, any, any, any>>(component: C): C => {
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
    const meta = getRouteMeta(asRouteComponent(value as ComponentType<any, any, any, any>));
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
 * Run matched loaders.
 *
 * With only a `URL`, this uses the legacy registry-backed lookup path. When a
 * route tree is provided first, it traverses that explicit tree instead.
 */
export function runMatchedLoaders(
  url: URL,
  options?: { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReadonlyArray<string> },
): Effect.Effect<ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>, never>;

export function runMatchedLoaders(
  root: AnyRoute | AnyAppRouteNode,
  url: URL,
  options?: { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReadonlyArray<string> },
): Effect.Effect<ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>, never>;
export function runMatchedLoaders(
  rootOrUrl: AnyRoute | AnyAppRouteNode | URL,
  urlOrOptions?: URL | { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReadonlyArray<string> },
  maybeOptions?: { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReadonlyArray<string> },
): Effect.Effect<ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>, never> {
  if (rootOrUrl instanceof URL) {
    const url = rootOrUrl;
    const options = urlOrOptions as { readonly includeDeferred?: boolean; readonly reactivityKeys?: ReadonlyArray<string> } | undefined;
    return runMatchedLoadersRegistry(url, options);
  }
  return runMatchedLoadersTreeInternal(rootOrUrl, urlOrOptions as URL, maybeOptions);
}
export function runStreamingNavigation(
  url: URL,
): Effect.Effect<{
  readonly critical: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>;
  readonly deferredScripts: ReadonlyArray<string>;
}, never>;
export function runStreamingNavigation(
  root: AnyRoute | AnyAppRouteNode,
  url: URL,
): Effect.Effect<{
  readonly critical: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>;
  readonly deferredScripts: ReadonlyArray<string>;
}, never>;
export function runStreamingNavigation(
  rootOrUrl: AnyRoute | AnyAppRouteNode | URL,
  maybeUrl?: URL,
): Effect.Effect<{
  readonly critical: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>;
  readonly deferredScripts: ReadonlyArray<string>;
}, never> {
  if (rootOrUrl instanceof URL) {
    return runStreamingNavigationRegistry(rootOrUrl);
  }
  return runStreamingNavigationTreeInternal(rootOrUrl, maybeUrl as URL);
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
  component: ComponentType<any, any, any, any>,
  meta: RouteMeta<any, any, any>,
  url: URL,
  parentData?: unknown,
): Effect.Effect<UnknownRouteResult, never>;
export function runRouteLoader(
  component: AnyRoute | ComponentType<any, any, any, any>,
  metaOrUrl: RouteMeta<any, any, any> | URL,
  urlOrParent?: URL | unknown,
  parentDataArg?: unknown,
): Effect.Effect<UnknownRouteResult, never> {
  if (isUnifiedRoute(component)) {
    const url = metaOrUrl as URL;
    const parentData = urlOrParent;
    const loaderFn = component[UnifiedRouteSymbol].loaderFn;
    if (!loaderFn) return Effect.succeed(Result.initial(false));
    const meta = component[UnifiedRouteSymbol].meta;
    const paramsRaw = extractParams(meta.fullPattern, url.pathname) ?? {};
    return runCachedLoader(
      meta.id ?? meta.fullPattern,
      paramsRaw,
      loaderFn(paramsRaw, { parent: <A>() => parentData as A }) as Effect.Effect<unknown, unknown>,
      component[UnifiedRouteSymbol].loaderOptions,
    );
  }
  const meta = metaOrUrl as RouteMeta<any, any, any>;
  const url = urlOrParent as URL;
  const parentData = parentDataArg;
  const loaderFn = asRouteComponent(component).__routeLoader;
  if (!loaderFn) return Effect.succeed(Result.initial(false));
  const paramsRaw = extractParams(meta.fullPattern, url.pathname) ?? {};
  const routeId = meta.id ?? meta.fullPattern;
  const loaderOptions = asRouteComponent(component).__routeLoaderOptions;
  return runCachedLoader(
    routeId,
    paramsRaw,
    loaderFn(paramsRaw, { parent: <A>() => parentData as A }) as Effect.Effect<unknown, unknown>,
    loaderOptions,
  );
}

export function serializeLoaderData(results: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>): string {
  const object: Record<string, unknown> = {};
  for (const item of results) {
    object[item.routeId] = item.result;
  }
  return JSON.stringify(object);
}

export function deserializeLoaderData(serialized: string): Record<string, Result.Result<unknown, unknown>> {
  const parsed = JSON.parse(serialized) as Record<string, Result.Result<unknown, unknown>>;
  return parsed;
}

export function streamDeferredLoaderScripts(
  results: ReadonlyArray<{ readonly routeId: string; readonly result: Result.Result<unknown, unknown> }>,
): ReadonlyArray<string> {
  return results.map((item) =>
    `<script>window.__LOADER_DATA__=window.__LOADER_DATA__||{};window.__LOADER_DATA__[${JSON.stringify(item.routeId)}]=${JSON.stringify(item.result)};window.__HYDRATE_ROUTE__&&window.__HYDRATE_ROUTE__(${JSON.stringify(item.routeId)});</script>`);
}

/**
 * Collect sitemap entries.
 *
 * Pass a route tree as the first argument to use the explicit tree-first path;
 * otherwise this falls back to the legacy registry-backed collector.
 */
export function collectSitemapEntries(baseUrl: string): Effect.Effect<ReadonlyArray<{ readonly loc: string }>, never>;
export function collectSitemapEntries(root: AnyRoute | AnyAppRouteNode, baseUrl: string): Effect.Effect<ReadonlyArray<{ readonly loc: string }>, never>;
export function collectSitemapEntries(
  rootOrBaseUrl: AnyRoute | AnyAppRouteNode | string,
  maybeBaseUrl?: string,
): Effect.Effect<ReadonlyArray<{ readonly loc: string }>, never> {
  if (typeof rootOrBaseUrl !== "string") {
    return collectSitemapEntriesForTreeInternal(rootOrBaseUrl, maybeBaseUrl ?? "http://localhost");
  }
  const baseUrl = rootOrBaseUrl;
  return Effect.gen(function* () {
    const out: Array<{ readonly loc: string }> = [];
    for (const entry of routeRegistryById.values()) {
      const enumerate = asRouteComponent(entry.component).__routeSitemapParams;
      if (!enumerate) {
        out.push({ loc: new URL(entry.meta.fullPattern, baseUrl).toString() });
        continue;
      }
      const paramsList = yield* enumerate().pipe(
        Effect.match({
          onFailure: () => [] as ReadonlyArray<any>,
          onSuccess: (value) => value,
        }),
      );
      const linkFn = link(entry.component) as (params: unknown) => string;
      for (const paramsValue of paramsList) {
        out.push({ loc: new URL(linkFn(paramsValue), baseUrl).toString() });
      }
    }
    return out;
  });
}

/**
 * Collect sitemap entries by traversing an explicit route tree.
 *
 * Unified route trees should prefer this over the registry-based collector so
 * sitemap generation follows the actual app tree directly.
 */

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
): (props: any) => unknown {
  let loaded: unknown = null;
  void importer().then((module) => {
    loaded = module.default ?? module;
  });
  return (props: any) => {
    if (typeof loaded === "function") {
      return (loaded as (p: any) => unknown)(props);
    }
    return options?.loading?.() ?? null;
  };
}

function browserUrl(): URL {
  return new URL(window.location.href);
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
      preload: () => Effect.void,
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
      preload: () => Effect.void,
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
    preload: () => Effect.void,
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
    preload: () => Effect.void,
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
  layout,
  index,
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
  createSingleFlightHandler,
  FetchSingleFlightTransport,
  singleFlight,
  invokeSingleFlight,
  reload,
  guard,
  title,
  meta,
  transition,
  lazy,
  Switch,
  runMatchedLoaders,
  runStreamingNavigation,
  runRouteLoader,
  serializeLoaderData,
  deserializeLoaderData,
  streamDeferredLoaderScripts,
  collectSitemapEntries,
  collectAll,
  collect,
  validateLinks,
  UnifiedRouteSymbol,
  RouteMetaSymbol,
  RouteLoaderMetaSymbol,
  RouteContextTag,
  SingleFlightTransportTag,
  RouterTag,
  createRouteId,
  resolvePattern,
  matchPattern,
  extractParams,
} as const;
