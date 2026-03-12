import { Cause, Effect, Option, Schema } from "effect";
import * as Route from "./Route.js";
import type { RouterRuntimeInstance } from "./RouterRuntime.js";
import type { AppRouteNode } from "./Route.js";

export const ServerRouteNodeSymbol: unique symbol = Symbol.for("effect-atom-jsx/ServerRouteNode");

export type ServerRouteKind = "action" | "document" | "json" | "resource";

type AnyServerRouteNode = ServerRouteNode<any, any, any, any, any, any, any>;

type ServerRouteEnhancer<I extends AnyServerRouteNode = AnyServerRouteNode, O extends AnyServerRouteNode = AnyServerRouteNode> = (route: I) => O;

export interface ServerRouteMeta<P = unknown, F = unknown, B = unknown, R = unknown, Q = unknown, H = unknown, C = unknown> {
  readonly key?: string;
  readonly method?: string;
  readonly path?: string;
  readonly paramsSchema?: Schema.Schema<P>;
  readonly querySchema?: Schema.Schema<Q>;
  readonly formSchema?: Schema.Schema<F>;
  readonly bodySchema?: Schema.Schema<B>;
  readonly headersSchema?: Schema.Schema<H>;
  readonly cookiesSchema?: Schema.Schema<C>;
  readonly responseSchema?: Schema.Schema<R>;
  readonly app?: AppRouteNode<any, any, any, any, any, any>;
  readonly documentRenderer?: unknown;
  readonly handler?: (input: { readonly params: P; readonly form: F; readonly body: B; readonly query: Q; readonly headers: H; readonly cookies: C }) => Effect.Effect<R, unknown, unknown>;
}

export interface ServerRouteNode<P = unknown, F = unknown, B = unknown, R = unknown, Q = unknown, H = unknown, C = unknown> {
  readonly [ServerRouteNodeSymbol]: true;
  readonly meta: ServerRouteMeta<P, F, B, R, Q, H, C>;
  readonly kind: ServerRouteKind;
  readonly key?: string;
  readonly method?: string;
  readonly path?: string;
  readonly paramsSchema?: Schema.Schema<P>;
  readonly querySchema?: Schema.Schema<Q>;
  readonly formSchema?: Schema.Schema<F>;
  readonly bodySchema?: Schema.Schema<B>;
  readonly headersSchema?: Schema.Schema<H>;
  readonly cookiesSchema?: Schema.Schema<C>;
  readonly responseSchema?: Schema.Schema<R>;
  readonly app?: AppRouteNode<any, any, any, any, any, any>;
  readonly documentRenderer?: unknown;
  readonly handler?: (input: { readonly params: P; readonly form: F; readonly body: B; readonly query: Q; readonly headers: H; readonly cookies: C }) => Effect.Effect<R, unknown, unknown>;
  pipe<R1 extends ServerRouteNode<any, any, any, any, any, any, any>>(op1: ServerRouteEnhancer<this, R1>): R1;
  pipe<R1 extends ServerRouteNode<any, any, any, any, any, any, any>, R2 extends ServerRouteNode<any, any, any, any, any, any, any>>(op1: ServerRouteEnhancer<this, R1>, op2: ServerRouteEnhancer<R1, R2>): R2;
  pipe<R1 extends ServerRouteNode<any, any, any, any, any, any, any>, R2 extends ServerRouteNode<any, any, any, any, any, any, any>, R3 extends ServerRouteNode<any, any, any, any, any, any, any>>(op1: ServerRouteEnhancer<this, R1>, op2: ServerRouteEnhancer<R1, R2>, op3: ServerRouteEnhancer<R2, R3>): R3;
  pipe<R1 extends ServerRouteNode<any, any, any, any, any, any, any>, R2 extends ServerRouteNode<any, any, any, any, any, any, any>, R3 extends ServerRouteNode<any, any, any, any, any, any, any>, R4 extends ServerRouteNode<any, any, any, any, any, any, any>>(op1: ServerRouteEnhancer<this, R1>, op2: ServerRouteEnhancer<R1, R2>, op3: ServerRouteEnhancer<R2, R3>, op4: ServerRouteEnhancer<R3, R4>): R4;
  pipe<R1 extends ServerRouteNode<any, any, any, any, any, any, any>, R2 extends ServerRouteNode<any, any, any, any, any, any, any>, R3 extends ServerRouteNode<any, any, any, any, any, any, any>, R4 extends ServerRouteNode<any, any, any, any, any, any, any>, R5 extends ServerRouteNode<any, any, any, any, any, any, any>>(op1: ServerRouteEnhancer<this, R1>, op2: ServerRouteEnhancer<R1, R2>, op3: ServerRouteEnhancer<R2, R3>, op4: ServerRouteEnhancer<R3, R4>, op5: ServerRouteEnhancer<R4, R5>): R5;
  pipe<R1 extends ServerRouteNode<any, any, any, any, any, any, any>, R2 extends ServerRouteNode<any, any, any, any, any, any, any>, R3 extends ServerRouteNode<any, any, any, any, any, any, any>, R4 extends ServerRouteNode<any, any, any, any, any, any, any>, R5 extends ServerRouteNode<any, any, any, any, any, any, any>, R6 extends ServerRouteNode<any, any, any, any, any, any, any>>(op1: ServerRouteEnhancer<this, R1>, op2: ServerRouteEnhancer<R1, R2>, op3: ServerRouteEnhancer<R2, R3>, op4: ServerRouteEnhancer<R3, R4>, op5: ServerRouteEnhancer<R4, R5>, op6: ServerRouteEnhancer<R5, R6>): R6;
  pipe(...ops: ReadonlyArray<ServerRouteEnhancer>): ServerRouteNode<P, F, B, R, Q, H, C>;
}

export type ParamsOf<T> = T extends ServerRouteNode<infer P, any, any, any, any, any, any> ? P : never;
export type FormOf<T> = T extends ServerRouteNode<any, infer F, any, any, any, any, any> ? F : never;
export type BodyOf<T> = T extends ServerRouteNode<any, any, infer B, any, any, any, any> ? B : never;
export type ResponseOf<T> = T extends ServerRouteNode<any, any, any, infer R, any, any, any> ? R : never;
export type QueryOf<T> = T extends ServerRouteNode<any, any, any, any, infer Q, any, any> ? Q : never;
export type HeadersOf<T> = T extends ServerRouteNode<any, any, any, any, any, infer H, any> ? H : never;
export type CookiesOf<T> = T extends ServerRouteNode<any, any, any, any, any, any, infer C> ? C : never;

export type ServerHandlerInputOf<T extends AnyServerRouteNode> = {
  readonly params: ParamsOf<T>;
  readonly form: FormOf<T>;
  readonly body: BodyOf<T>;
  readonly query: QueryOf<T>;
  readonly headers: HeadersOf<T>;
  readonly cookies: CookiesOf<T>;
};

type WithParams<T extends AnyServerRouteNode, P> = ServerRouteNode<P, FormOf<T>, BodyOf<T>, ResponseOf<T>, QueryOf<T>, HeadersOf<T>, CookiesOf<T>>;
type WithQuery<T extends AnyServerRouteNode, Q> = ServerRouteNode<ParamsOf<T>, FormOf<T>, BodyOf<T>, ResponseOf<T>, Q, HeadersOf<T>, CookiesOf<T>>;
type WithForm<T extends AnyServerRouteNode, F> = ServerRouteNode<ParamsOf<T>, F, BodyOf<T>, ResponseOf<T>, QueryOf<T>, HeadersOf<T>, CookiesOf<T>>;
type WithBody<T extends AnyServerRouteNode, B> = ServerRouteNode<ParamsOf<T>, FormOf<T>, B, ResponseOf<T>, QueryOf<T>, HeadersOf<T>, CookiesOf<T>>;
type WithHeaders<T extends AnyServerRouteNode, H> = ServerRouteNode<ParamsOf<T>, FormOf<T>, BodyOf<T>, ResponseOf<T>, QueryOf<T>, H, CookiesOf<T>>;
type WithCookies<T extends AnyServerRouteNode, C> = ServerRouteNode<ParamsOf<T>, FormOf<T>, BodyOf<T>, ResponseOf<T>, QueryOf<T>, HeadersOf<T>, C>;
type WithResponse<T extends AnyServerRouteNode, R> = ServerRouteNode<ParamsOf<T>, FormOf<T>, BodyOf<T>, R, QueryOf<T>, HeadersOf<T>, CookiesOf<T>>;

export interface ExecuteResult<R> {
  readonly response: R | undefined;
  readonly encoded: unknown;
  readonly status: number;
  readonly headers: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly redirect?: { readonly location: string; readonly status: number };
  readonly notFound?: true;
}

export type DispatchResult =
  | { readonly _tag: "document"; readonly result: Route.RenderRequestResult }
  | { readonly _tag: "data"; readonly result: ExecuteResult<unknown> };

export interface AdapterResponse {
  readonly status: number;
  readonly headers: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly body?: unknown;
  readonly html?: string;
  readonly redirect?: { readonly location: string; readonly status: number };
  readonly notFound?: true;
}

type ResponseService = {
  readonly setStatus: (status: number) => void;
  readonly setHeader: (name: string, value: string) => void;
  readonly appendHeader: (name: string, value: string) => void;
  readonly redirect: (location: string, status?: number) => void;
  readonly notFound: () => void;
  readonly snapshot: () => { readonly status: number; readonly headers: ReadonlyMap<string, ReadonlyArray<string>> };
};

export type RedirectSignal = {
  readonly _tag: "ServerRedirect";
  readonly location: string;
  readonly status: number;
};

export type NotFoundSignal = {
  readonly _tag: "ServerNotFound";
};

function matchPath(pattern: string | undefined, pathname: string): boolean {
  if (!pattern) return false;
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.length < patternParts.length) return false;
  for (let i = 0; i < patternParts.length; i += 1) {
    const current = patternParts[i];
    const actual = pathParts[i];
    if (!current || !actual) return false;
    if (current === "*") return true;
    if (current.startsWith(":")) continue;
    if (current !== actual) return false;
  }
  return patternParts.length === pathParts.length || patternParts[patternParts.length - 1] === "*";
}

function normalizeServerPattern(pattern: string | undefined): string {
  if (!pattern) return "";
  return pattern
    .split("/")
    .filter(Boolean)
    .map((part) => part.startsWith(":") ? ":param" : part)
    .join("/");
}

function makeServerRouteNode<P, F, B, R, Q, H, C>(kind: ServerRouteKind, seed?: Partial<ServerRouteNode<P, F, B, R, Q, H, C>>): ServerRouteNode<P, F, B, R, Q, H, C> {
  const meta: ServerRouteMeta<P, F, B, R, Q, H, C> = {
    key: seed?.key,
    method: seed?.method,
    path: seed?.path,
    paramsSchema: seed?.paramsSchema,
    querySchema: seed?.querySchema,
    formSchema: seed?.formSchema,
    bodySchema: seed?.bodySchema,
    headersSchema: seed?.headersSchema,
    cookiesSchema: seed?.cookiesSchema,
    responseSchema: seed?.responseSchema,
    app: seed?.app,
    documentRenderer: seed?.documentRenderer,
    handler: seed?.handler,
  };
  const node: ServerRouteNode<P, F, B, R, Q, H, C> = {
    [ServerRouteNodeSymbol]: true,
    kind,
    meta,
    ...seed,
    pipe: ((...ops: ReadonlyArray<ServerRouteEnhancer>) =>
      ops.reduce<AnyServerRouteNode>((current, op) => op(current), node)) as ServerRouteNode<P, F, B, R, Q, H, C>["pipe"],
  };
  return node;
}

function withField<K extends keyof ServerRouteNode<any, any, any, any, any, any, any>>(key: K, value: ServerRouteNode<any, any, any, any, any, any, any>[K]) {
  return ((route: ServerRouteNode<any, any, any, any, any, any, any>) => ({
    ...route,
    meta: { ...route.meta, [key]: value },
    [key]: value,
  })) as ServerRouteEnhancer;
}

function decodeSchemaOrDefault<A>(schema: Schema.Schema<A> | undefined, input: unknown, fallback: A): A {
  if (!schema) return fallback;
  return Schema.decodeUnknownSync(schema as any)(input) as A;
}

function extractParams(pathPattern: string | undefined, pathname: string): Record<string, string> {
  if (!pathPattern) return {};
  const patternParts = pathPattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  const out: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const pattern = patternParts[i];
    const actual = pathParts[i];
    if (!pattern || !actual) continue;
    if (pattern.startsWith(":")) {
      out[pattern.slice(1)] = decodeURIComponent(actual);
    }
  }
  return out;
}

async function formDataToObject(formData: FormData): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  formData.forEach((value, key) => {
    out[key] = typeof value === "string" ? value : value.name;
  });
  return out;
}

/** Return a redirect control-flow signal from a server handler. */
export function redirect(location: string, status = 302): Effect.Effect<never, RedirectSignal, any> {
  return Effect.gen(function* () {
    const response = yield* Route.ServerResponseTag;
    response.redirect(location, status);
    return yield* Effect.fail({ _tag: "ServerRedirect", location, status } as const);
  });
}

/** Return a not-found control-flow signal from a server handler. */
export function notFound(): Effect.Effect<never, NotFoundSignal, any> {
  return Effect.gen(function* () {
    const response = yield* Route.ServerResponseTag;
    response.notFound();
    return yield* Effect.fail({ _tag: "ServerNotFound" } as const);
  });
}

/** Create a first-class server action route node. */
export function action(seed?: { readonly key?: string }): ServerRouteNode<unknown, unknown, unknown, unknown> {
  return makeServerRouteNode("action", { key: seed?.key });
}

/** Create a first-class server document route node. */
export function document(app: AppRouteNode<any, any, any, any, any, any>): ServerRouteNode<unknown, unknown, unknown, unknown> {
  return makeServerRouteNode("document", { app });
}

/** Create a first-class JSON route node. */
export function json(seed?: { readonly key?: string }): ServerRouteNode<unknown, unknown, unknown, unknown> {
  return makeServerRouteNode("json", { key: seed?.key });
}

/** Create a first-class resource route node. */
export function resource(seed?: { readonly key?: string }): ServerRouteNode<unknown, unknown, unknown, unknown> {
  return makeServerRouteNode("resource", { key: seed?.key });
}

/** Attach an HTTP method to a server route node. */
export function method<M extends string>(value: M): ServerRouteEnhancer {
  return withField("method", value);
}

/** Attach a path to a server route node. */
export function path(value: string): ServerRouteEnhancer {
  return withField("path", value);
}

/** Attach a params schema to a server route node. */
export function params<P>(schema: Schema.Schema<P>): <T extends AnyServerRouteNode>(route: T) => WithParams<T, P> {
  return <T extends AnyServerRouteNode>(route: T): WithParams<T, P> => ({ ...route, meta: { ...route.meta, paramsSchema: schema }, paramsSchema: schema });
}

/** Attach a query schema to a server route node. */
export function query<Q>(schema: Schema.Schema<Q>): <T extends ServerRouteNode<any, any, any, any, any, any, any>>(route: T) => ServerRouteNode<ParamsOf<T>, FormOf<T>, BodyOf<T>, ResponseOf<T>, Q, HeadersOf<T>, CookiesOf<T>> {
  return <T extends AnyServerRouteNode>(route: T): WithQuery<T, Q> => ({ ...route, meta: { ...route.meta, querySchema: schema }, querySchema: schema });
}

/** Attach a form schema to a server route node. */
export function form<F>(schema: Schema.Schema<F>): <T extends AnyServerRouteNode>(route: T) => WithForm<T, F> {
  return <T extends AnyServerRouteNode>(route: T): WithForm<T, F> => ({ ...route, meta: { ...route.meta, formSchema: schema }, formSchema: schema });
}

/** Attach a body schema to a server route node. */
export function body<B>(schema: Schema.Schema<B>): <T extends AnyServerRouteNode>(route: T) => WithBody<T, B> {
  return <T extends AnyServerRouteNode>(route: T): WithBody<T, B> => ({ ...route, meta: { ...route.meta, bodySchema: schema }, bodySchema: schema });
}

/** Attach a headers schema to a server route node. */
export function headers<H>(schema: Schema.Schema<H>): <T extends ServerRouteNode<any, any, any, any, any, any, any>>(route: T) => ServerRouteNode<ParamsOf<T>, FormOf<T>, BodyOf<T>, ResponseOf<T>, QueryOf<T>, H, CookiesOf<T>> {
  return <T extends AnyServerRouteNode>(route: T): WithHeaders<T, H> => ({ ...route, meta: { ...route.meta, headersSchema: schema }, headersSchema: schema });
}

/** Attach a cookies schema to a server route node. */
export function cookies<C>(schema: Schema.Schema<C>): <T extends ServerRouteNode<any, any, any, any, any, any, any>>(route: T) => ServerRouteNode<ParamsOf<T>, FormOf<T>, BodyOf<T>, ResponseOf<T>, QueryOf<T>, HeadersOf<T>, C> {
  return <T extends AnyServerRouteNode>(route: T): WithCookies<T, C> => ({ ...route, meta: { ...route.meta, cookiesSchema: schema }, cookiesSchema: schema });
}

/** Attach a response schema to a server route node. */
export function response<R>(schema: Schema.Schema<R>): <T extends AnyServerRouteNode>(route: T) => WithResponse<T, R> {
  return <T extends AnyServerRouteNode>(route: T): WithResponse<T, R> => ({ ...route, meta: { ...route.meta, responseSchema: schema }, responseSchema: schema });
}

/** Attach a document renderer to a document server route. */
export function documentRenderer(renderer: unknown): ServerRouteEnhancer {
  return withField("documentRenderer", renderer);
}

/** Attach a typed handler to a server route node. */
export function handle<T extends AnyServerRouteNode, R, E = unknown, Req = unknown>(
  fn: (input: ServerHandlerInputOf<T>) => Effect.Effect<R, E, Req>,
): (route: T) => WithResponse<T, R> {
  return (route) => ({ ...route, meta: { ...route.meta, handler: fn }, handler: fn });
}

/** Create a generated path convention for framework-owned action/resource URLs. */
export function generatedPath(key: string): string {
  return `/_server/${key}`;
}

/** Group server routes into a single route graph value. */
export function define<const T extends ReadonlyArray<ServerRouteNode<any, any, any, any>>>(...routes: T): T {
  return routes;
}

/** Return all server routes from a defined graph. */
export function nodes<const T extends ReadonlyArray<ServerRouteNode<any, any, any, any>>>(routes: T): T {
  return routes;
}

/** Find a server route by key. */
export function byKey(
  routes: ReadonlyArray<ServerRouteNode<any, any, any, any>>,
  key: string,
): ServerRouteNode<any, any, any, any> | undefined {
  return routes.find((route) => route.key === key);
}

/** Return a stable route identity string for debugging/tooling. */
export function identity(route: ServerRouteNode<any, any, any, any>): string {
  return route.key ?? `${route.method ?? "*"}:${route.path ?? route.kind}`;
}

/** Validate a server route graph for duplicate keys and duplicate method/path pairs. */
export function validate(routes: ReadonlyArray<ServerRouteNode<any, any, any, any>>): ReadonlyArray<string> {
  const errors: Array<string> = [];
  const seenKeys = new Set<string>();
  const seenMethodPaths = new Set<string>();
  const seenNormalizedDocuments = new Set<string>();
  for (const route of routes) {
    if (route.key) {
      if (seenKeys.has(route.key)) errors.push(`Duplicate server route key '${route.key}'`);
      seenKeys.add(route.key);
    }
    const methodPath = `${route.method ?? "*"}:${route.path ?? ""}`;
    if (seenMethodPaths.has(methodPath)) {
      errors.push(`Duplicate server route method/path '${methodPath}'`);
    }
    seenMethodPaths.add(methodPath);
    if (route.kind === "document") {
      const normalizedDocument = `${route.method ?? "*"}:${normalizeServerPattern(route.path)}`;
      if (seenNormalizedDocuments.has(normalizedDocument)) {
        errors.push(`Overlapping document route '${normalizedDocument}'`);
      }
      seenNormalizedDocuments.add(normalizedDocument);
    }
    if ((route.kind === "action" || route.kind === "json" || route.kind === "resource") && !route.handler) {
      errors.push(`Missing handler for server route '${identity(route)}'`);
    }
    if (route.kind === "document" && !route.app) {
      errors.push(`Missing app route tree for document route '${identity(route)}'`);
    }
    if ((route.formSchema || route.bodySchema) && route.kind === "document") {
      errors.push(`Document route '${identity(route)}' cannot declare form/body decoding`);
    }
  }
  return errors;
}

/** Match a server route node against an HTTP method and pathname. */
export function matches(
  route: ServerRouteNode<any, any, any, any>,
  methodValue: string,
  pathname: string,
): boolean {
  const routeMethod = route.method?.toUpperCase();
  if (routeMethod && routeMethod !== methodValue.toUpperCase()) return false;
  return matchPath(route.path, pathname);
}

/** Find the first matching server route in a route graph. */
export function find(
  routes: ReadonlyArray<ServerRouteNode<any, any, any, any>>,
  methodValue: string,
  pathname: string,
  options?: { readonly kind?: ServerRouteKind },
): ServerRouteNode<any, any, any, any> | undefined {
  return routes.find((route) => {
    if (options?.kind && route.kind !== options.kind) return false;
    return matches(route, methodValue, pathname);
  });
}

/** Execute a typed non-document server route with Schema-driven request decoding. */
export function execute<T extends ServerRouteNode<any, any, any, any>>(
  route: T,
  request: Request,
): Effect.Effect<ExecuteResult<ResponseOf<T>>, unknown> {
  const responseService = createResponseService();
  return executeWithServices(route, request, responseService);
}

function createResponseService(): ResponseService {
  let status = 200;
  const headerMap = new Map<string, Array<string>>();
  return {
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
}

/** Execute a typed server route using explicit request/response services. */
export function executeWithServices<T extends ServerRouteNode<any, any, any, any>>(
  route: T,
  request: Request,
  responseService: ResponseService,
): Effect.Effect<ExecuteResult<ResponseOf<T>>, unknown> {
  return Effect.tryPromise({
    try: async () => {
      const url = new URL(request.url);
      const paramsValue = decodeSchemaOrDefault(route.paramsSchema as Schema.Schema<ParamsOf<T>> | undefined, extractParams(route.path, url.pathname), {} as ParamsOf<T>);
      const queryValue = decodeSchemaOrDefault(route.querySchema as Schema.Schema<QueryOf<T>> | undefined, Object.fromEntries(url.searchParams.entries()), {} as QueryOf<T>);
      const formValue = route.formSchema
        ? decodeSchemaOrDefault(route.formSchema as Schema.Schema<FormOf<T>>, await formDataToObject(await request.clone().formData()), {} as FormOf<T>)
        : {} as FormOf<T>;
      const bodyValue = route.bodySchema
        ? decodeSchemaOrDefault(route.bodySchema as Schema.Schema<BodyOf<T>>, await request.clone().json(), {} as BodyOf<T>)
        : {} as BodyOf<T>;
      const headerObject: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headerObject[key] = value;
      });
      const headersValue = decodeSchemaOrDefault(route.headersSchema as Schema.Schema<HeadersOf<T>> | undefined, headerObject, {} as HeadersOf<T>);
      const cookiesValue = decodeSchemaOrDefault(route.cookiesSchema as Schema.Schema<CookiesOf<T>> | undefined, Object.fromEntries((request.headers.get("cookie") ?? "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
        const index = part.indexOf("=");
        return index >= 0 ? [part.slice(0, index), part.slice(index + 1)] : [part, ""];
      })), {} as CookiesOf<T>);

      if (!route.handler) {
        throw new Error("[effect-atom-jsx/ServerRoute] execute requires a handler.");
      }

      const exit = await Effect.runPromise(Effect.exit(
        (route.handler({
          params: paramsValue,
          form: formValue,
          body: bodyValue,
          query: queryValue,
          headers: headersValue,
          cookies: cookiesValue,
        }) as Effect.Effect<ResponseOf<T>, unknown, never>).pipe(
          Effect.provideService(Route.ServerRequestTag, { request, url }),
          Effect.provideService(Route.ServerResponseTag, responseService),
        ),
      ));

      if (exit._tag === "Failure") {
        const failure = Cause.findErrorOption(exit.cause);
        if (Option.isSome(failure)) {
          const error = failure.value as RedirectSignal | NotFoundSignal;
          if (error && typeof error === "object" && "_tag" in error) {
            if (error._tag === "ServerRedirect") {
              return {
                response: undefined,
                encoded: undefined,
                status: error.status,
                headers: new Map(responseService.snapshot().headers),
                redirect: { location: error.location, status: error.status },
              } satisfies ExecuteResult<ResponseOf<T>>;
            }
            if (error._tag === "ServerNotFound") {
              return {
                response: undefined,
                encoded: undefined,
                status: 404,
                headers: new Map(responseService.snapshot().headers),
                notFound: true,
              } satisfies ExecuteResult<ResponseOf<T>>;
            }
          }
        }
        throw Cause.squash(exit.cause);
      }

      const response = exit.value;
      const encoded = route.responseSchema
        ? Schema.encodeSync(route.responseSchema as any)(response)
        : response;

      return {
        response,
        encoded,
        status: responseService.snapshot().status,
        headers: new Map(responseService.snapshot().headers),
      } satisfies ExecuteResult<ResponseOf<T>>;
    },
    catch: (error) => error,
  });
}

/** Execute a document server route against a Request using the Route SSR bridge. */
export function runDocument(
  route: ServerRouteNode<any, any, any, any>,
  request: Request,
  options?: { readonly layer?: import("effect").Layer.Layer<any> },
): Effect.Effect<Route.RenderRequestResult, never> {
  if (route.kind !== "document" || !route.app) {
    throw new Error("[effect-atom-jsx/ServerRoute] runDocument requires a document route with an app route tree.");
  }
  return Route.renderRequest(route.app, {
    request,
    layer: options?.layer,
  });
}

/** Match and execute the first server route that handles the request. */
export function dispatch(
  routes: ReadonlyArray<ServerRouteNode<any, any, any, any>>,
  request: Request,
  options?: { readonly layer?: import("effect").Layer.Layer<any> },
): Effect.Effect<DispatchResult, unknown> {
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const matched = find(routes, request.method, url.pathname);
    if (!matched) {
      return {
        _tag: "data",
        result: {
          response: undefined,
          encoded: undefined,
          status: 404,
          headers: new Map(),
          notFound: true,
        },
      } satisfies DispatchResult;
    }
    if (matched.kind === "document") {
      return {
        _tag: "document",
        result: yield* runDocument(matched, request, options),
      } satisfies DispatchResult;
    }
    return {
      _tag: "data",
      result: yield* execute(matched, request),
    } satisfies DispatchResult;
  });
}

/** Convert a dispatch or render result into a generic adapter-facing response structure. */
export function toResponse(result: DispatchResult | Route.RenderRequestResult): AdapterResponse {
  if ("_tag" in result) {
    if (result._tag === "document") {
      return {
        status: result.result.status,
        headers: result.result.headers,
        html: result.result.html,
      };
    }
    return {
      status: result.result.status,
      headers: result.result.headers,
      body: result.result.encoded,
      redirect: result.result.redirect,
      notFound: result.result.notFound,
    };
  }
  return {
    status: result.status,
    headers: result.headers,
    html: result.html,
  };
}

/** Dispatch a request through a RouterRuntime instance. */
export function dispatchWithRuntime(
  runtime: RouterRuntimeInstance,
  request: Request,
  options?: { readonly layer?: import("effect").Layer.Layer<any> },
): Effect.Effect<DispatchResult, unknown> {
  return runtime.dispatchRequest(request, options);
}

/** Execute a typed server route using request/response services from the environment. */
export function executeFromServices<T extends ServerRouteNode<any, any, any, any>>(
  route: T,
): Effect.Effect<ExecuteResult<ResponseOf<T>>, unknown, any> {
  return Effect.gen(function* () {
    const requestService = yield* Route.ServerRequestTag;
    const responseService = yield* Route.ServerResponseTag;
    return yield* executeWithServices(route, requestService.request, responseService);
  });
}

export const ServerRoute = {
  action,
  document,
  json,
  resource,
  method,
  path,
  params,
  query,
  form,
  body,
  headers,
  cookies,
  response,
  handle,
  documentRenderer,
  generatedPath,
  define,
  nodes,
  byKey,
  identity,
  validate,
  matches,
  find,
  execute,
  executeWithServices,
  executeFromServices,
  runDocument,
  dispatch,
  toResponse,
  dispatchWithRuntime,
  redirect,
  notFound,
  ServerRouteNodeSymbol,
} as const;
