import { Effect, Fiber, Layer, ServiceMap } from "effect";
import * as Route from "./Route.js";
import * as ServerRoute from "./ServerRoute.js";
import type { AnyRoute, AppRouteNode } from "./Route.js";
import type { ServerRouteNode } from "./ServerRoute.js";

export type RouterHistoryAction = "push" | "replace" | "pop" | "none";
export type RouterTaskPhase = "idle" | "loading" | "submitting" | "rendering" | "dispatching" | "cancelled";
export interface RouterTaskState {
  readonly phase: RouterTaskPhase;
  readonly target?: string;
  readonly method?: string;
  readonly outcome?: unknown;
  readonly interrupted?: boolean;
}
export type RouterNavigationState = RouterTaskState;
export type RouterRevalidationState = RouterTaskState;

export interface RouterRuntimeOutcome {
  readonly kind: "action" | "fetch" | "document" | "dispatch";
  readonly status?: number;
  readonly headers?: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly response?: unknown;
  readonly encoded?: unknown;
  readonly redirect?: { readonly location: string; readonly status: number };
  readonly notFound?: true;
  readonly result?: unknown;
  readonly error?: unknown;
}

function idleTask(outcome?: unknown): RouterTaskState {
  return { phase: "idle", outcome };
}

function loadingTask(target: string): RouterTaskState {
  return { phase: "loading", target };
}

function submittingTask(target: string, method: string): RouterTaskState {
  return { phase: "submitting", target, method };
}

function renderingTask(target: string): RouterTaskState {
  return { phase: "rendering", target };
}

function dispatchingTask(target: string): RouterTaskState {
  return { phase: "dispatching", target };
}

function cancelledTask(target?: string, outcome?: unknown): RouterTaskState {
  return { phase: "cancelled", target, outcome, interrupted: true };
}

function actionOutcome(value: {
  readonly response?: unknown;
  readonly status?: number;
  readonly headers?: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly encoded?: unknown;
  readonly redirect?: { readonly location: string; readonly status: number };
  readonly notFound?: true;
  readonly error?: unknown;
}): RouterRuntimeOutcome {
  return { kind: "action", ...value };
}

function fetchOutcome(value: {
  readonly response?: unknown;
  readonly status?: number;
  readonly headers?: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly encoded?: unknown;
  readonly redirect?: { readonly location: string; readonly status: number };
  readonly notFound?: true;
  readonly error?: unknown;
}): RouterRuntimeOutcome {
  return { kind: "fetch", ...value };
}

function documentOutcome(result: Route.RenderRequestResult): RouterRuntimeOutcome {
  return { kind: "document", status: result.status, headers: result.headers, result };
}

function dispatchOutcome(result: ServerRoute.DispatchResult): RouterRuntimeOutcome {
  return { kind: "dispatch", result };
}

function erroredOutcome(kind: RouterRuntimeOutcome["kind"], error: unknown): RouterRuntimeOutcome {
  return { kind, error };
}

function fetcherState(key: string, route: string, state: RouterTaskState, outcome?: RouterRuntimeOutcome): RouterRuntimeFetcherState {
  return {
    key,
    route,
    state,
    outcome,
  };
}

export interface RouterRuntimeFetcherState {
  readonly key: string;
  readonly state: RouterTaskState;
  readonly route?: string;
  readonly outcome?: RouterRuntimeOutcome;
}

export interface RouterRuntimeSnapshot {
  readonly initialized: boolean;
  readonly historyAction: RouterHistoryAction;
  readonly location: URL;
  readonly appMatches: ReadonlyArray<string>;
  readonly serverMatch: string | null;
  readonly matchedServerRoute: string | null;
  readonly navigation: RouterNavigationState;
  readonly revalidation: RouterTaskState;
  readonly loaderData: ReadonlyMap<string, unknown>;
  readonly actionData: ReadonlyMap<string, RouterRuntimeOutcome> | null;
  readonly errors: ReadonlyMap<string, unknown> | null;
  readonly fetchers: ReadonlyMap<string, RouterRuntimeFetcherState>;
  readonly inFlight: {
    readonly navigation: number | null;
    readonly submit: number | null;
    readonly request: number | null;
    readonly dispatch: number | null;
    readonly revalidate: number | null;
    readonly fetchers: ReadonlyMap<string, number>;
  };
  readonly requestState: RouterTaskState;
  readonly dispatchState: RouterTaskState;
  readonly lastActionOutcome: RouterRuntimeOutcome | null;
  readonly lastFetchOutcome: RouterRuntimeOutcome | null;
  readonly lastDocumentResult: RouterRuntimeOutcome | null;
  readonly lastDispatchResult: RouterRuntimeOutcome | null;
  readonly restoreScrollPosition: number | false | null;
  readonly preventScrollReset: boolean;
}

export interface HistoryEvent {
  readonly action: RouterHistoryAction;
  readonly location: URL;
}

export interface HistoryAdapter {
  readonly location: () => URL;
  readonly push: (to: string) => void;
  readonly replace: (to: string) => void;
  readonly go: (delta: number) => void;
  readonly subscribe: (listener: (event: HistoryEvent) => void) => () => void;
}

export interface HistoryService {
  readonly location: () => URL;
  readonly push: (to: string) => Effect.Effect<void>;
  readonly replace: (to: string) => Effect.Effect<void>;
  readonly go: (delta: number) => Effect.Effect<void>;
}

export interface NavigationService {
  readonly navigate: RouterRuntimeInstance["navigate"];
  readonly navigateApp: RouterRuntimeInstance["navigateApp"];
  readonly submit: RouterRuntimeInstance["submit"];
  readonly fetch: RouterRuntimeInstance["fetch"];
  readonly revalidate: RouterRuntimeInstance["revalidate"];
  readonly cancel: RouterRuntimeInstance["cancel"];
}

export const HistoryTag = ServiceMap.Service<HistoryService>("History");
export const NavigationTag = ServiceMap.Service<NavigationService>("Navigation");
export const RouterRuntimeTag = ServiceMap.Service<RouterRuntimeInstance>("RouterRuntime");

export interface RouterRuntimeConfig {
  readonly app: AppRouteNode<any, any, any, any, any, any> | AnyRoute;
  readonly server?: ReadonlyArray<ServerRouteNode<any, any, any, any>>;
  readonly history: HistoryAdapter;
}

export interface RouterRuntimeInstance {
  readonly initialize: () => Effect.Effect<void>;
  readonly snapshot: () => Effect.Effect<RouterRuntimeSnapshot>;
  readonly subscribe: (listener: (snapshot: RouterRuntimeSnapshot) => void) => () => void;
  readonly navigate: (to: string | number, options?: { readonly replace?: boolean }) => Effect.Effect<void>;
  readonly navigateApp: (route: AppRouteNode<any, any, any, any, any, any> | AnyRoute, options?: { readonly params?: Record<string, string>; readonly replace?: boolean }) => Effect.Effect<void>;
  readonly submit: (to: string | ServerRouteNode<any, any, any, any>, options: { readonly method?: string; readonly formData?: FormData; readonly body?: unknown }) => Effect.Effect<void>;
  readonly fetch: (key: string, to: string | ServerRouteNode<any, any, any, any>, options?: { readonly method?: string; readonly formData?: FormData; readonly body?: unknown }) => Effect.Effect<void>;
  readonly revalidate: () => Effect.Effect<void>;
  readonly cancel: (target?: "navigation" | "submit" | "request" | "dispatch" | "revalidate" | { readonly fetchKey: string }) => Effect.Effect<void>;
  readonly renderRequest: (request: Request, options?: { readonly layer?: Layer.Layer<any> }) => Effect.Effect<Route.RenderRequestResult, never>;
  readonly dispatchRequest: (request: Request, options?: { readonly layer?: Layer.Layer<any> }) => Effect.Effect<ServerRoute.DispatchResult, unknown>;
}

function toRequestUrl(base: URL, to: string): URL {
  return new URL(to, base);
}

function routeTargetPath(target: string | ServerRouteNode<any, any, any, any>): string {
  return typeof target === "string" ? target : target.path ?? target.key ?? "";
}

function routeTargetMethod(target: string | ServerRouteNode<any, any, any, any>, fallback?: string): string {
  return typeof target === "string" ? (fallback ?? "GET") : (target.method ?? fallback ?? "GET");
}

function makeRequestInit(options?: { readonly method?: string; readonly formData?: FormData; readonly body?: unknown }): RequestInit {
  if (options?.formData) {
    return { method: options.method ?? "POST", body: options.formData };
  }
  if (options && "body" in options && options.body !== undefined) {
    return {
      method: options.method ?? "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.body),
    };
  }
  return { method: options?.method ?? "GET" };
}

function createRuntimeResponseService() {
  let status = 200;
  const headers = new Map<string, Array<string>>();
  return {
    setStatus: (next: number) => {
      status = next;
    },
    setHeader: (name: string, value: string) => {
      headers.set(name.toLowerCase(), [value]);
    },
    appendHeader: (name: string, value: string) => {
      const key = name.toLowerCase();
      headers.set(key, [...(headers.get(key) ?? []), value]);
    },
    redirect: (location: string, nextStatus = 302) => {
      status = nextStatus;
      headers.set("location", [location]);
    },
    notFound: () => {
      status = 404;
    },
    snapshot: () => ({ status, headers: headers as ReadonlyMap<string, ReadonlyArray<string>> }),
  };
}

function collectAppNodes(root: AppRouteNode<any, any, any, any, any, any> | AnyRoute): ReadonlyArray<AppRouteNode<any, any, any, any, any, any> | AnyRoute> {
  const out: Array<AppRouteNode<any, any, any, any, any, any> | AnyRoute> = [];
  const walk = (node: AppRouteNode<any, any, any, any, any, any> | AnyRoute) => {
    out.push(node);
    for (const child of node.children) walk(child as AppRouteNode<any, any, any, any, any, any> | AnyRoute);
  };
  walk(root);
  return out;
}

function nodePath(node: AppRouteNode<any, any, any, any, any, any> | AnyRoute): string {
  return Route.fullPathOf(node as any, node as any);
}

function nodeExact(node: AppRouteNode<any, any, any, any, any, any> | AnyRoute): boolean | undefined {
  return Route.UnifiedRouteSymbol in (node as object)
    ? (node as AnyRoute)[Route.UnifiedRouteSymbol].meta.exact ?? ((node as AnyRoute).kind === "index" ? true : undefined)
    : (node as AppRouteNode<any, any, any, any, any, any>).kind === "index" ? true : (node as AppRouteNode<any, any, any, any, any, any>).options.exact;
}

function nodeId(node: AppRouteNode<any, any, any, any, any, any> | AnyRoute): string {
  return Route.UnifiedRouteSymbol in (node as object)
    ? (node as AnyRoute)[Route.UnifiedRouteSymbol].meta.id ?? nodePath(node)
    : (node as AppRouteNode<any, any, any, any, any, any>).options.id ?? nodePath(node);
}

function matchedAppNodes(
  nodes: ReadonlyArray<AppRouteNode<any, any, any, any, any, any> | AnyRoute>,
  pathname: string,
): ReadonlyArray<AppRouteNode<any, any, any, any, any, any> | AnyRoute> {
  return nodes.filter((node) => nodePath(node).length > 0 && Route.matchPattern(nodePath(node), pathname, nodeExact(node)));
}

function createSnapshot(state: {
  initialized: boolean;
  historyAction: RouterHistoryAction;
  location: URL;
  navigation: RouterNavigationState;
  revalidation: RouterTaskState;
  loaderData: Map<string, unknown>;
  actionData: Map<string, RouterRuntimeOutcome> | null;
  errors: Map<string, unknown> | null;
  fetchers: Map<string, RouterRuntimeFetcherState>;
  inFlight: {
    readonly navigation: number | null;
    readonly submit: number | null;
    readonly request: number | null;
    readonly dispatch: number | null;
    readonly revalidate: number | null;
    readonly fetchers: ReadonlyMap<string, number>;
  };
  requestState: RouterTaskState;
  dispatchState: RouterTaskState;
  lastActionOutcome: RouterRuntimeOutcome | null;
  lastFetchOutcome: RouterRuntimeOutcome | null;
  lastDocumentResult: RouterRuntimeOutcome | null;
  lastDispatchResult: RouterRuntimeOutcome | null;
  restoreScrollPosition: number | false | null;
  preventScrollReset: boolean;
  appNodes: ReadonlyArray<AppRouteNode<any, any, any, any, any, any> | AnyRoute>;
  serverRoutes: ReadonlyArray<ServerRouteNode<any, any, any, any>>;
}): RouterRuntimeSnapshot {
  const pathname = state.location.pathname;
  const appMatches = state.appNodes
    .filter((node) => nodePath(node).length > 0 && Route.matchPattern(nodePath(node), pathname, nodeExact(node)))
    .map((node) => nodeId(node));
  const matchedServer = ServerRoute.find(state.serverRoutes, "GET", pathname, { kind: "document" })
    ?? ServerRoute.find(state.serverRoutes, "GET", pathname);
  const serverMatch = matchedServer?.key ?? matchedServer?.path ?? null;
  return {
    initialized: state.initialized,
    historyAction: state.historyAction,
    location: new URL(state.location.toString()),
    appMatches,
    serverMatch,
    matchedServerRoute: matchedServer ? ServerRoute.identity(matchedServer) : null,
    navigation: state.navigation,
    revalidation: state.revalidation,
    loaderData: new Map(state.loaderData),
    actionData: state.actionData ? new Map(state.actionData) : null,
    errors: state.errors ? new Map(state.errors) : null,
    fetchers: new Map(state.fetchers),
    inFlight: {
      navigation: state.inFlight.navigation,
      submit: state.inFlight.submit,
      request: state.inFlight.request,
      dispatch: state.inFlight.dispatch,
      revalidate: state.inFlight.revalidate,
      fetchers: new Map(state.inFlight.fetchers),
    },
    requestState: state.requestState,
    dispatchState: state.dispatchState,
    lastActionOutcome: state.lastActionOutcome,
    lastFetchOutcome: state.lastFetchOutcome,
    lastDocumentResult: state.lastDocumentResult,
    lastDispatchResult: state.lastDispatchResult,
    restoreScrollPosition: state.restoreScrollPosition,
    preventScrollReset: state.preventScrollReset,
  };
}

export function create(config: RouterRuntimeConfig): RouterRuntimeInstance {
  let initialized = false;
  let historyAction: RouterHistoryAction = "none";
  let location = new URL(config.history.location().toString());
  let navigation: RouterNavigationState = idleTask();
  let revalidation: RouterRevalidationState = idleTask();
  let restoreScrollPosition: number | false | null = null;
  let preventScrollReset = false;
  const loaderData = new Map<string, unknown>();
  let actionData: Map<string, RouterRuntimeOutcome> | null = null;
  let errors: Map<string, unknown> | null = null;
  const fetchers = new Map<string, RouterRuntimeFetcherState>();
  let requestState: RouterRuntimeSnapshot["requestState"] = idleTask();
  let dispatchState: RouterRuntimeSnapshot["dispatchState"] = idleTask();
  let lastActionOutcome: RouterRuntimeOutcome | null = null;
  let lastFetchOutcome: RouterRuntimeOutcome | null = null;
  let lastDocumentResult: RouterRuntimeOutcome | null = null;
  let lastDispatchResult: RouterRuntimeOutcome | null = null;
  let nextTaskId = 1;
  let inFlightNavigation: number | null = null;
  let inFlightSubmit: number | null = null;
  let inFlightRequest: number | null = null;
  let inFlightDispatch: number | null = null;
  let inFlightRevalidate: number | null = null;
  const inFlightFetchers = new Map<string, number>();
  const inFlightFetchFibers = new Map<string, Fiber.Fiber<void, unknown>>();
  let inFlightNavigationFiber: Fiber.Fiber<void, never> | null = null;
  let inFlightSubmitFiber: Fiber.Fiber<void, unknown> | null = null;
  let inFlightRequestFiber: Fiber.Fiber<Route.RenderRequestResult, never> | null = null;
  let inFlightDispatchFiber: Fiber.Fiber<ServerRoute.DispatchResult, unknown> | null = null;
  let inFlightRevalidateFiber: Fiber.Fiber<void, never> | null = null;
  const subscribers = new Set<(snapshot: RouterRuntimeSnapshot) => void>();
  const appNodes = collectAppNodes(config.app);
  const serverRoutes = config.server ?? [];
  let unsubscribeHistory: (() => void) | null = null;

  const refreshMatchedLoaders = (): Effect.Effect<void> => Effect.gen(function* () {
    loaderData.clear();
      errors = null;
      const matched = matchedAppNodes(appNodes, location.pathname);
      for (const node of matched) {
        const result = Route.UnifiedRouteSymbol in (node as object)
          ? yield* Route.runRouteLoader(node as AnyRoute, location)
          : yield* (() => {
            const component = Route.componentOf(node as AppRouteNode<any, any, any, any, any, any>);
            const meta = Route.routeMetaOf(component);
            if (!meta) return Effect.succeed(Route.Result.initial(false));
            return Route.runRouteLoader(component, meta, location);
          })();
        const routeId = nodeId(node);
        if (result._tag === "Success") {
          loaderData.set(routeId, result.value);
        } else if (result._tag === "Failure") {
        if (errors === null) errors = new Map();
        errors.set(routeId, result.error);
      }
    }
  });

  const refreshMatchedLoadersAt = (nextLocation: URL): Effect.Effect<void> => Effect.gen(function* () {
    loaderData.clear();
      errors = null;
      const matched = matchedAppNodes(appNodes, nextLocation.pathname);
      for (const node of matched) {
        const result = Route.UnifiedRouteSymbol in (node as object)
          ? yield* Route.runRouteLoader(node as AnyRoute, nextLocation)
          : yield* (() => {
            const component = Route.componentOf(node as AppRouteNode<any, any, any, any, any, any>);
            const meta = Route.routeMetaOf(component);
            if (!meta) return Effect.succeed(Route.Result.initial(false));
            return Route.runRouteLoader(component, meta, nextLocation);
          })();
        const routeId = nodeId(node);
        if (result._tag === "Success") {
          loaderData.set(routeId, result.value);
        } else if (result._tag === "Failure") {
        if (errors === null) errors = new Map();
        errors.set(routeId, result.error);
      }
    }
  });

  const prepareRequestLocation = (request: Request): Effect.Effect<void> => Effect.gen(function* () {
    const nextLocation = new URL(request.url);
    location = nextLocation;
    historyAction = "none";
    navigation = loadingTask(nextLocation.pathname);
    emit();
    yield* refreshMatchedLoadersAt(nextLocation);
    navigation = idleTask();
    emit();
  });

  const emit = () => {
    const snapshot = createSnapshot({
      initialized,
      historyAction,
      location,
      navigation,
      revalidation,
      loaderData,
      actionData,
      errors,
      fetchers,
      requestState,
      dispatchState,
      lastActionOutcome,
      lastFetchOutcome,
      lastDocumentResult,
      lastDispatchResult,
      inFlight: {
        navigation: inFlightNavigation,
        submit: inFlightSubmit,
        request: inFlightRequest,
        dispatch: inFlightDispatch,
        revalidate: inFlightRevalidate,
        fetchers: inFlightFetchers,
      },
      restoreScrollPosition,
      preventScrollReset,
      appNodes,
      serverRoutes,
    });
    for (const subscriber of subscribers) subscriber(snapshot);
  };

  const beginTask = (setState: (state: RouterTaskState) => void, state: RouterTaskState) => {
    setState(state);
    emit();
  };

  const allocateTaskId = () => nextTaskId++;

  const isCurrentTask = (kind: "navigation" | "submit" | "request" | "dispatch" | "revalidate" | "fetch", id: number, key?: string): boolean => {
    switch (kind) {
      case "navigation":
        return inFlightNavigation === id;
      case "submit":
        return inFlightSubmit === id;
      case "request":
        return inFlightRequest === id;
      case "dispatch":
        return inFlightDispatch === id;
      case "revalidate":
        return inFlightRevalidate === id;
      case "fetch":
        return key !== undefined && inFlightFetchers.get(key) === id;
    }
  };

  const finishTask = (setState: (state: RouterTaskState) => void, outcome?: unknown) => {
    setState(idleTask(outcome));
    emit();
  };

  const clearInFlight = (target: "navigation" | "submit" | "request" | "dispatch" | "revalidate" | { readonly fetchKey: string }) => {
    if (target === "navigation") inFlightNavigation = null;
    else if (target === "submit") inFlightSubmit = null;
    else if (target === "request") inFlightRequest = null;
    else if (target === "dispatch") inFlightDispatch = null;
    else if (target === "revalidate") inFlightRevalidate = null;
    else if (typeof target === "object" && "fetchKey" in target) inFlightFetchers.delete(target.fetchKey);
  };

  const supersedeTask = (
    current: RouterTaskState,
    setState: (state: RouterTaskState) => void,
    next: RouterTaskState,
  ) => {
    if (current.phase !== "idle" && current.phase !== "cancelled") {
      setState(cancelledTask(current.target, current.outcome));
      emit();
    }
    setState(next);
    emit();
  };

  const cancelTask = (target?: "navigation" | "submit" | "request" | "dispatch" | "revalidate" | { readonly fetchKey: string }) => {
    if (!target || target === "navigation") {
      navigation = cancelledTask(navigation.target, navigation.outcome);
    }
    if (target === "submit") {
      navigation = cancelledTask(navigation.target, navigation.outcome);
    }
    if (target === "request") {
      requestState = cancelledTask(requestState.target, requestState.outcome);
    }
    if (target === "dispatch") {
      dispatchState = cancelledTask(dispatchState.target, dispatchState.outcome);
    }
    if (target === "revalidate") {
      revalidation = cancelledTask(revalidation.target, revalidation.outcome);
    }
    if (target && typeof target === "object" && "fetchKey" in target) {
      const current = fetchers.get(target.fetchKey);
      if (current) {
        fetchers.set(target.fetchKey, fetcherState(
          current.key,
          current.route ?? current.state.target ?? "",
          cancelledTask(current.state.target ?? current.route, current.outcome),
          current.outcome,
        ));
      }
    }
    emit();
  };

  const interruptTrackedFiber = (target: "navigation" | "submit" | "request" | "dispatch" | "revalidate" | { readonly fetchKey: string }): Effect.Effect<void, never> => (Effect.gen(function* () {
    if (target === "navigation" && inFlightNavigationFiber) {
      yield* Fiber.interrupt(inFlightNavigationFiber);
      inFlightNavigationFiber = null;
    }
    if (target === "submit" && inFlightSubmitFiber) {
      yield* Fiber.interrupt(inFlightSubmitFiber);
      inFlightSubmitFiber = null;
    }
    if (target === "request" && inFlightRequestFiber) {
      yield* Fiber.interrupt(inFlightRequestFiber);
      inFlightRequestFiber = null;
    }
    if (target === "dispatch" && inFlightDispatchFiber) {
      yield* Fiber.interrupt(inFlightDispatchFiber);
      inFlightDispatchFiber = null;
    }
    if (target === "revalidate" && inFlightRevalidateFiber) {
      yield* Fiber.interrupt(inFlightRevalidateFiber);
      inFlightRevalidateFiber = null;
    }
    if (typeof target === "object" && "fetchKey" in target) {
      const fiber = inFlightFetchFibers.get(target.fetchKey);
      if (fiber) {
        yield* Fiber.interrupt(fiber);
        inFlightFetchFibers.delete(target.fetchKey);
      }
    }
  }) as Effect.Effect<void, never>);


  return {
    initialize: () => Effect.sync(() => {
      if (initialized) return;
      initialized = true;
      unsubscribeHistory = config.history.subscribe((event) => {
        historyAction = event.action;
        location = new URL(event.location.toString());
        if (inFlightNavigationFiber) {
          Effect.runFork(Fiber.interrupt(inFlightNavigationFiber));
        }
        const taskId = inFlightNavigation ?? allocateTaskId();
        inFlightNavigation = taskId;
        if (navigation.phase === "idle" || navigation.phase === "cancelled") {
          navigation = loadingTask(location.pathname);
          emit();
        }
        const body = refreshMatchedLoaders().pipe(
          Effect.tap(() => Effect.sync(() => {
            if (isCurrentTask("navigation", taskId)) {
              finishTask((state) => {
                navigation = state;
              }, new Map(loaderData));
              clearInFlight("navigation");
            }
          })),
          Effect.onInterrupt(() => Effect.sync(() => {
            if (isCurrentTask("navigation", taskId)) {
              navigation = cancelledTask(location.pathname, navigation.outcome);
              clearInFlight("navigation");
              emit();
            }
          })),
        ) as Effect.Effect<void, never, never>;
        inFlightNavigationFiber = Effect.runFork(body);
      });
      Effect.runSync(refreshMatchedLoaders());
      emit();
    }),
    snapshot: () => Effect.sync(() => createSnapshot({
      initialized,
      historyAction,
      location,
      navigation,
      revalidation,
      loaderData,
      actionData,
      errors,
      fetchers,
      requestState,
      dispatchState,
      lastActionOutcome,
      lastFetchOutcome,
      lastDocumentResult,
      lastDispatchResult,
      inFlight: {
        navigation: inFlightNavigation,
        submit: inFlightSubmit,
        request: inFlightRequest,
        dispatch: inFlightDispatch,
        revalidate: inFlightRevalidate,
        fetchers: inFlightFetchers,
      },
      restoreScrollPosition,
      preventScrollReset,
      appNodes,
      serverRoutes,
    })),
    subscribe: (listener) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    navigate: (to, options) => Effect.sync(() => {
      Effect.runFork(interruptTrackedFiber("navigation"));
      if (typeof to === "number") {
        const taskId = allocateTaskId();
        inFlightNavigation = taskId;
        supersedeTask(navigation, (state) => {
          navigation = state;
        }, loadingTask(String(to)));
        config.history.go(to);
        return;
      }
      const taskId = allocateTaskId();
      inFlightNavigation = taskId;
      supersedeTask(navigation, (state) => {
        navigation = state;
      }, loadingTask(to));
      preventScrollReset = false;
      if (options?.replace) config.history.replace(to);
      else config.history.push(to);
    }),
    navigateApp: (route, options) => Effect.sync(() => {
      Effect.runFork(interruptTrackedFiber("navigation"));
      let to = route.path;
      for (const [key, value] of Object.entries(options?.params ?? {})) {
        to = to.replace(`:${key}`, encodeURIComponent(String(value)));
      }
      const taskId = allocateTaskId();
      inFlightNavigation = taskId;
      supersedeTask(navigation, (state) => {
        navigation = state;
      }, loadingTask(to));
      preventScrollReset = false;
      if (options?.replace) config.history.replace(to);
      else config.history.push(to);
    }),
    submit: ((to, options) => Effect.gen(function* () {
      cancelTask("navigation");
      yield* interruptTrackedFiber("submit");
      const taskId = allocateTaskId();
      inFlightSubmit = taskId;
      const path = routeTargetPath(to);
      const method = routeTargetMethod(to, options.method ?? "POST");
      supersedeTask(navigation, (state) => {
        navigation = state;
      }, submittingTask(path, method));
      if (typeof to !== "string") {
        const request = new Request(toRequestUrl(location, path), makeRequestInit({
          method,
          formData: options.formData,
          body: options.body,
        }));
        const responseService = createRuntimeResponseService();
        const body = ServerRoute.executeWithServices(to, request, responseService).pipe(Effect.match({
          onSuccess: (result) => {
            if (!isCurrentTask("submit", taskId)) return;
            const outcome = actionOutcome({
              response: result.response,
              status: result.status,
              headers: result.headers,
              encoded: result.encoded,
              redirect: result.redirect,
              notFound: result.notFound,
            });
            actionData = new Map([[path, outcome]]);
            lastActionOutcome = outcome;
          },
          onFailure: (error) => {
            if (!isCurrentTask("submit", taskId)) return;
            if (errors === null) errors = new Map();
            errors.set(path, error);
            lastActionOutcome = erroredOutcome("action", error);
          },
        })).pipe(Effect.asVoid);
        const fiber = Effect.runFork(body as Effect.Effect<void, unknown, never>);
        inFlightSubmitFiber = fiber;
        const exit = yield* Fiber.await(fiber);
        inFlightSubmitFiber = null;
        if (exit._tag !== "Success") {
          throw exit;
        }
      } else {
        actionData = new Map([[path, actionOutcome({ response: { method } })]]);
      }
      if (isCurrentTask("submit", taskId)) {
        finishTask((state) => {
          navigation = state;
        }, lastActionOutcome);
        inFlightSubmit = null;
      }
    })) as RouterRuntimeInstance["submit"],
    fetch: (key, to, options) => Effect.gen(function* () {
      cancelTask({ fetchKey: key });
      yield* interruptTrackedFiber({ fetchKey: key });
      const taskId = allocateTaskId();
      inFlightFetchers.set(key, taskId);
      const path = routeTargetPath(to);
      const method = routeTargetMethod(to, options?.method);
      const currentFetcher = fetchers.get(key)?.state ?? idleTask();
      let nextFetcherState: RouterTaskState = method !== "GET" ? submittingTask(path, method) : loadingTask(path);
      if (currentFetcher.phase !== "idle" && currentFetcher.phase !== "cancelled") {
        fetchers.set(key, fetcherState(key, path, cancelledTask(currentFetcher.target ?? path, currentFetcher.outcome), fetchers.get(key)?.outcome));
        emit();
      }
      fetchers.set(key, fetcherState(key, path, nextFetcherState));
      emit();
      if (typeof to !== "string") {
        const request = new Request(toRequestUrl(location, path), makeRequestInit({
          method,
          formData: options?.formData,
          body: options?.body,
        }));
        let nextData: unknown = undefined;
        const responseService = createRuntimeResponseService();
        const body = ServerRoute.executeWithServices(to, request, responseService).pipe(Effect.match({
          onSuccess: (result) => {
            if (!isCurrentTask("fetch", taskId, key)) return;
            nextData = fetchOutcome({
              response: result.response,
              status: result.status,
              headers: result.headers,
              encoded: result.encoded,
              redirect: result.redirect,
              notFound: result.notFound,
            });
            lastFetchOutcome = nextData as RouterRuntimeOutcome;
          },
          onFailure: (error) => {
            if (!isCurrentTask("fetch", taskId, key)) return;
            if (errors === null) errors = new Map();
            errors.set(path, error);
            lastFetchOutcome = erroredOutcome("fetch", error);
          },
        })).pipe(Effect.asVoid);
        const fiber = Effect.runFork(body as Effect.Effect<void, unknown, never>);
        inFlightFetchFibers.set(key, fiber);
        yield* Fiber.await(fiber);
        inFlightFetchFibers.delete(key);
        if (isCurrentTask("fetch", taskId, key)) {
          fetchers.set(key, fetcherState(
            key,
            path,
            idleTask(nextData),
            nextData as RouterRuntimeOutcome | undefined,
          ));
        }
      } else {
        if (isCurrentTask("fetch", taskId, key)) {
          fetchers.set(key, fetcherState(key, path, idleTask()));
        }
      }
      if (isCurrentTask("fetch", taskId, key)) {
        clearInFlight({ fetchKey: key });
        emit();
      }
    }),
    revalidate: (() => Effect.gen(function* () {
      cancelTask("navigation");
      yield* interruptTrackedFiber("revalidate");
      const taskId = allocateTaskId();
      inFlightRevalidate = taskId;
      supersedeTask(revalidation, (state) => {
        revalidation = state;
      }, loadingTask(location.pathname));
      yield* refreshMatchedLoaders();
      if (isCurrentTask("revalidate", taskId)) {
        finishTask((state) => {
          revalidation = state;
        }, new Map(loaderData));
        clearInFlight("revalidate");
      }
    })) as RouterRuntimeInstance["revalidate"],
    cancel: (target) => Effect.sync(() => {
      cancelTask(target);
    }),
    renderRequest: (request, options) => Effect.gen(function* () {
      cancelTask("request");
      yield* interruptTrackedFiber("request");
      const taskId = allocateTaskId();
      inFlightRequest = taskId;
      supersedeTask(requestState, (state) => {
        requestState = state;
      }, renderingTask(request.url));
      yield* prepareRequestLocation(request);
      const result = yield* (Effect.tryPromise({
        try: async () => {
          const fiber = Effect.runFork(
            Route.renderRequest(config.app, {
              request,
              layer: options?.layer,
            }) as Effect.Effect<Route.RenderRequestResult, never, never>,
          );
          inFlightRequestFiber = fiber;
          const exit = await Effect.runPromise(Fiber.await(fiber));
          inFlightRequestFiber = null;
          if (exit._tag === "Success") return exit.value as Route.RenderRequestResult;
          throw exit;
        },
        catch: (error) => error,
      }) as Effect.Effect<Route.RenderRequestResult, never, never>);
      if (isCurrentTask("request", taskId)) {
        lastDocumentResult = documentOutcome(result);
        finishTask((state) => {
          requestState = state;
        }, lastDocumentResult);
        clearInFlight("request");
      }
      return result;
    }),
    dispatchRequest: (request, options) => Effect.gen(function* () {
      cancelTask("dispatch");
      yield* interruptTrackedFiber("dispatch");
      const taskId = allocateTaskId();
      inFlightDispatch = taskId;
      supersedeTask(requestState, (state) => {
        requestState = state;
      }, dispatchingTask(request.url));
      supersedeTask(dispatchState, (state) => {
        dispatchState = state;
      }, dispatchingTask(request.url));
      yield* prepareRequestLocation(request);
      const result = yield* Effect.tryPromise({
        try: async () => {
          const fiber = Effect.runFork(
            ServerRoute.dispatch(serverRoutes, request, {
              layer: options?.layer,
            }) as Effect.Effect<ServerRoute.DispatchResult, unknown, never>,
          );
          inFlightDispatchFiber = fiber;
          const exit = await Effect.runPromise(Fiber.await(fiber));
          inFlightDispatchFiber = null;
          if (exit._tag === "Success") return exit.value as ServerRoute.DispatchResult;
          throw exit;
        },
        catch: (error) => error,
      });
      if (isCurrentTask("dispatch", taskId)) {
        lastDispatchResult = dispatchOutcome(result);
        finishTask((state) => {
          dispatchState = state;
        }, lastDispatchResult);
        finishTask((state) => {
          requestState = state;
        }, lastDispatchResult);
        clearInFlight("dispatch");
      }
      return result;
    }),
  };
}

export function createMemoryHistory(initial: string): HistoryAdapter {
  const stack = [new URL(initial, "http://memory.local")];
  let index = 0;
  const listeners = new Set<(event: HistoryEvent) => void>();
  const emit = (action: RouterHistoryAction) => {
    const event = { action, location: new URL(stack[index].toString()) };
    for (const listener of listeners) listener(event);
  };
  return {
    location: () => new URL(stack[index].toString()),
    push: (to) => {
      stack.splice(index + 1);
      stack.push(new URL(to, stack[index]));
      index = stack.length - 1;
      emit("push");
    },
    replace: (to) => {
      stack[index] = new URL(to, stack[index]);
      emit("replace");
    },
    go: (delta) => {
      index = Math.max(0, Math.min(stack.length - 1, index + delta));
      emit("pop");
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Expose a RouterRuntime instance as Effect services/layers. */
export function toLayer(runtime: RouterRuntimeInstance, history: HistoryAdapter): Layer.Layer<RouterRuntimeInstance | HistoryService | NavigationService> {
  return Layer.mergeAll(
    Layer.succeed(RouterRuntimeTag, runtime),
    Layer.succeed(HistoryTag, {
      location: () => history.location(),
      push: (to: string) => Effect.sync(() => {
        history.push(to);
      }),
      replace: (to: string) => Effect.sync(() => {
        history.replace(to);
      }),
      go: (delta: number) => Effect.sync(() => {
        history.go(delta);
      }),
    } satisfies HistoryService),
    Layer.succeed(NavigationTag, {
      navigate: runtime.navigate,
      navigateApp: runtime.navigateApp,
      submit: runtime.submit,
      fetch: runtime.fetch,
      revalidate: runtime.revalidate,
      cancel: runtime.cancel,
    } satisfies NavigationService),
  );
}

export const RouterRuntime = {
  create,
  createMemoryHistory,
  toLayer,
  HistoryTag,
  NavigationTag,
  RouterRuntimeTag,
} as const;
