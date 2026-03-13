import {
  Cause,
  Effect,
  Fiber,
  Layer,
  Queue,
  Schedule,
  Scope,
  Schema,
  Stream as FxStream,
  type ServiceMap,
} from "effect";
import { createSignal, onCleanup, useContext, type Accessor } from "./api.js";
import * as Atom from "./Atom.js";
import type * as Behavior from "./Behavior.js";
import * as Element from "./Element.js";
import * as Route from "./Route.js";
import { defineMutation, defineQuery, ManagedRuntimeContext, mount as mountRuntime, type Result } from "./effect-ts.js";
import { currentComponentScope } from "./component-scope.js";

export const ComponentTypeId: unique symbol = Symbol.for("effect-atom-jsx/Component");

const ComponentImplTypeId: unique symbol = Symbol.for("effect-atom-jsx/ComponentImpl");

type Pipeable<Self> = {
  pipe(): Self;
  pipe<A>(ab: (self: Self) => A): A;
  pipe<A, B>(ab: (self: Self) => A, bc: (a: A) => B): B;
  pipe<A, B, C>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C): C;
  pipe<A, B, C, D>(ab: (self: Self) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D): D;
};

export interface Component<Props, Req, E, Bindings = unknown> {
  (props: Props): unknown;
  readonly [ComponentTypeId]: {
    readonly Props: Props;
    readonly Req: Req;
    readonly E: E;
    readonly Bindings: Bindings;
  };
  pipe(): this;
  pipe<A>(ab: (self: this) => A): A;
  pipe<A, B>(ab: (self: this) => A, bc: (a: A) => B): B;
  pipe<A, B, C>(ab: (self: this) => A, bc: (a: A) => B, cd: (b: B) => C): C;
  pipe<A, B, C, D>(ab: (self: this) => A, bc: (a: A) => B, cd: (b: B) => C, de: (c: C) => D): D;
}

export interface HeadlessComponent<Props, Req, E, Bindings>
  extends Component<Props & { readonly children?: (bindings: Bindings) => unknown }, Req, E, Bindings> {}

type ErrorHandlers = Record<string, (error: any) => unknown>;

type PropsSpec<Props> = {
  readonly parse: (value: unknown) => Props;
};

type RequirementSpec<Req> = {
  readonly tags: ReadonlyArray<ServiceMap.Key<any, any>>;
  readonly _Req?: (_: Req) => Req;
};

type InternalComponent<Props, Req, E, Bindings> = {
  readonly [ComponentImplTypeId]: true;
  readonly props: PropsSpec<Props>;
  readonly requirements: RequirementSpec<Req>;
  readonly setup: (props: Props) => Effect.Effect<Bindings, E, Req>;
  readonly view?: (props: Props, bindings: Bindings) => unknown;
  readonly loading?: () => unknown;
  readonly boundary?: ErrorHandlers;
  readonly memo?: (prev: Props, next: Props) => boolean;
};

function isInternalComponent<Props, Req, E, Bindings>(
  value: unknown,
): value is InternalComponent<Props, Req, E, Bindings> {
  return (typeof value === "object" || typeof value === "function")
    && value !== null
    && ComponentImplTypeId in value;
}

function pipeSelf(self: unknown, fns: ReadonlyArray<(value: any) => any>): unknown {
  return fns.reduce((acc, fn) => fn(acc), self);
}

function runForkWithAmbient<R, A, E>(effect: Effect.Effect<A, E, R>): Fiber.Fiber<A, E> {
  const ambient = useContext(ManagedRuntimeContext);
  const scope = currentComponentScope();
  const scoped = scope === null
    ? effect
    : Scope.provide(scope)(effect as Effect.Effect<A, E, R | Scope.Scope>) as Effect.Effect<A, E, R>;
  if (ambient !== null) {
    return ambient.runFork(scoped as Effect.Effect<A, E, never>) as Fiber.Fiber<A, E>;
  }
  return Effect.runFork(scoped as Effect.Effect<A, E, never>) as Fiber.Fiber<A, E>;
}

function matchBoundary(boundary: ErrorHandlers | undefined, error: unknown): unknown {
  if (boundary === undefined) return null;
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = String((error as { readonly _tag: string })._tag);
    const handler = boundary[tag];
    if (handler !== undefined) return handler(error);
  }
  if (boundary.Unknown !== undefined) return boundary.Unknown(error);
  return null;
}

function toComponent<Props, Req, E, Bindings>(
  internal: InternalComponent<Props, Req, E, Bindings>,
): Component<Props, Req, E, Bindings> {
  const component = ((unsafeProps: Props) => {
    const props = internal.props.parse(unsafeProps);
    const [bindings, setBindings] = createSignal<Bindings | null>(null);
    const [error, setError] = createSignal<unknown | null>(null);

    const fiber = runForkWithAmbient(
      internal.setup(props).pipe(
        Effect.matchCause({
          onSuccess: (value): void => {
            setBindings(value);
          },
          onFailure: (cause): void => {
            const typed = Cause.findErrorOption(cause);
            if (typed._tag === "Some") {
              setError(typed.value);
            } else {
              setError({ _tag: "Defect", cause: Cause.pretty(cause) });
            }
          },
        }),
      ),
    );

    onCleanup(() => {
      Effect.runFork(Fiber.interrupt(fiber));
    });

    return () => {
      const failure = error();
      if (failure !== null) {
        const rendered = matchBoundary(internal.boundary, failure);
        return rendered;
      }

      const ready = bindings();
      if (ready === null) {
        return internal.loading?.() ?? null;
      }

      if (internal.view === undefined) {
        const renderProp = (props as RenderPropChildren<Bindings>).children;
        return typeof renderProp === "function" ? renderProp(ready) : null;
      }
      return internal.view(props, ready);
    };
  }) as Component<Props, Req, E, Bindings>;

  const out = Object.assign(component, {
    [ComponentTypeId]: {
      Props: undefined as unknown as Props,
      Req: undefined as unknown as Req,
      E: undefined as unknown as E,
      Bindings: undefined as unknown as Bindings,
    },
    [ComponentImplTypeId]: true as const,
    props: internal.props,
    requirements: internal.requirements,
    setup: internal.setup,
    view: internal.view,
    loading: internal.loading,
    boundary: internal.boundary,
    memo: internal.memo,
  });

  out.pipe = ((...fns: ReadonlyArray<(value: any) => any>) => pipeSelf(out, fns)) as typeof out["pipe"];
  return out;
}

function internals<Props, Req, E, Bindings>(
  component: Component<Props, Req, E, Bindings>,
): InternalComponent<Props, Req, E, Bindings> {
  if (!isInternalComponent<Props, Req, E, Bindings>(component)) {
    throw new Error("[effect-atom-jsx/Component] expected a Component value.");
  }
  return component;
}

function provideLayerToSetup<Props, Req, E, Bindings, ROut, E2, RIn>(
  component: Component<Props, Req, E, Bindings>,
  layer: Layer.Layer<ROut, E2, RIn>,
): Component<Props, Exclude<Req, ROut> | RIn, E | E2, Bindings> {
  const i = internals(component);
  return toComponentLike(component, {
    ...i,
    setup: (props) => i.setup(props).pipe(Effect.provide(layer as any)) as any,
  }) as Component<Props, Exclude<Req, ROut> | RIn, E | E2, Bindings>;
}

type HeadlessChildren<Bindings> = { readonly children?: (bindings: Bindings) => unknown };

export function props<Props>(): PropsSpec<Props> {
  return {
    parse: (value) => value as Props,
  };
}

export function propsSchema<SchemaProps>(schema: Schema.Schema<SchemaProps>): PropsSpec<SchemaProps> {
  const decode = Schema.decodeUnknownSync(schema as any);
  return {
    parse: (value) => decode(value) as SchemaProps,
  };
}

export function require<Req = never>(...tags: ReadonlyArray<ServiceMap.Key<any, any>>): RequirementSpec<Req> {
  return { tags };
}

export function make<Props, Req, E, Bindings>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: (props: Props) => Effect.Effect<Bindings, E, Req>,
  view: (props: Props, bindings: Bindings) => unknown,
): Component<Props, Req, E, Bindings> {
  return toComponent({
    [ComponentImplTypeId]: true,
    props: propSpec,
    requirements: req,
    setup,
    view,
  });
}

export function headless<Props, Req, E, Bindings>(
  propSpec: PropsSpec<Props>,
  req: RequirementSpec<Req>,
  setup: (props: Props) => Effect.Effect<Bindings, E, Req>,
): HeadlessComponent<Props, Req, E, Bindings> {
  return toComponent({
    [ComponentImplTypeId]: true,
    props: propSpec as unknown as PropsSpec<Props & HeadlessChildren<Bindings>>,
    requirements: req,
    setup: setup as unknown as (props: Props & HeadlessChildren<Bindings>) => Effect.Effect<Bindings, E, Req>,
  }) as HeadlessComponent<Props, Req, E, Bindings>;
}

export function from<Props>(
  fn: (props: Props) => unknown,
): Component<Props, never, never, {}> {
  return make(
    props<Props>(),
    require<never>(),
    () => Effect.succeed({}),
    (componentProps) => fn(componentProps),
  );
}

export type Requirements<T> = T extends Component<any, infer Req, any, any> ? Req : never;
export type Errors<T> = T extends Component<any, any, infer E, any> ? E : never;
export type PropsOf<T> = T extends Component<infer Props, any, any, any> ? Props : never;
export type BindingsOf<T> = T extends Component<any, any, any, infer Bindings> ? Bindings : never;

type RenderPropChildren<Bindings> = { readonly children?: (bindings: Bindings) => unknown };

export interface SlotMap {
  readonly [name: string]: Element.Handle | Element.Collection<Element.Handle>;
}

export function setupEffect<Props, Req, E, Bindings>(
  component: Component<Props, Req, E, Bindings>,
  propsValue: Props,
): Effect.Effect<Bindings, E, Req> {
  const i = internals(component);
  const parsed = i.props.parse(propsValue);
  return i.setup(parsed);
}

export function renderEffect<Props, Req, E, Bindings>(
  component: Component<Props, Req, E, Bindings>,
  propsValue: Props,
): Effect.Effect<unknown, E, Req> {
  const i = internals(component);
  const parsed = i.props.parse(propsValue);
  return i.setup(parsed).pipe(
    Effect.map((bindings) => {
      if (i.view === undefined) {
        const renderProp = (parsed as RenderPropChildren<Bindings>).children;
        return typeof renderProp === "function" ? renderProp(bindings) : null;
      }
      return i.view(parsed, bindings);
    }),
  );
}

export interface ComponentAction<Args extends ReadonlyArray<unknown>, A, E> {
  (...args: Args): void;
  run(...args: Args): void;
  runEffect(...args: Args): Effect.Effect<A, E>;
  result: Accessor<Result<void, E>>;
  pending: Accessor<boolean>;
}

export interface ActionOptions {
  readonly name?: string;
  readonly reactivityKeys?: Atom.ReactivityKeysInput;
  readonly onTransition?: (event: { readonly phase: "start" | "success" | "failure" | "defect" }) => void;
  readonly concurrency?: "switch" | "queue" | "drop" | { readonly max: number };
  readonly detached?: boolean;
}

export function state<A>(initial: A): Effect.Effect<Atom.WritableAtom<A>> {
  return Effect.sync(() => Atom.value(initial) as unknown as Atom.WritableAtom<A>);
}

export function derived<A>(fn: () => A): Effect.Effect<Atom.ReadonlyAtom<A>> {
  return Effect.sync(() => Atom.derived(() => fn()));
}

export function query<A, E, R>(
  effect: () => Effect.Effect<A, E, R>,
  options?: {
    readonly name?: string;
    readonly retrySchedule?: Schedule.Schedule<unknown, any, any>;
    readonly pollSchedule?: Schedule.Schedule<unknown, any, any>;
  },
): Effect.Effect<Atom.ReadonlyAtom<Result<A, E>>, never, R> {
  return Effect.sync(() => defineQuery(effect, options).result as Atom.ReadonlyAtom<Result<A, E>>);
}

export function action<Args extends ReadonlyArray<unknown>, A, E, R>(
  fn: (...args: Args) => Effect.Effect<A, E, R>,
  options?: ActionOptions,
): Effect.Effect<ComponentAction<Args, A, E>, never, R> {
  return Effect.sync(() => {
    const handle = defineMutation<Args, E, R>(
      (args) => fn(...args),
      {
        name: options?.name,
        onTransition: options?.onTransition,
        onSuccess: () => {
          if (options?.reactivityKeys !== undefined) {
            Atom.invalidateReactivity(options.reactivityKeys);
          }
        },
      },
    );

    const out = ((...args: Args) => {
      if (options?.concurrency === "drop" && handle.pending()) return;
      handle.run(args);
    }) as ComponentAction<Args, A, E>;
    out.run = (...args: Args) => {
      if (options?.concurrency === "drop" && handle.pending()) return;
      handle.run(args);
    };
    out.runEffect = (...args: Args) =>
      Effect.tryPromise({
        try: async () => {
          if (options?.concurrency === "drop" && handle.pending()) {
            return undefined as unknown as A;
          }
          handle.run(args);
          return await Effect.runPromise(fn(...args) as Effect.Effect<A, E, never>);
        },
        catch: (error) => error as E,
      });
    out.result = handle.result;
    out.pending = handle.pending;
    return out;
  });
}

export type ComponentRef<T> = { current: T | null };

export function ref<T>(): Effect.Effect<ComponentRef<T>> {
  return Effect.sync(() => ({ current: null }));
}

export function fromDequeue<A>(
  dequeue: Queue.Dequeue<A>,
  handler: (value: A) => void,
): Effect.Effect<void, never, Scope.Scope> {
  return FxStream.fromQueue(dequeue).pipe(
    FxStream.runForEach((value) => Effect.sync(() => handler(value as A))),
    Effect.forkScoped,
    Effect.asVoid,
  );
}

export function schedule(
  scheduleDef: Schedule.Schedule<unknown, any, any>,
  run: () => void,
): Effect.Effect<void, never, Scope.Scope> {
  return scheduleEffect(scheduleDef, Effect.sync(run));
}

export function scheduleEffect<A, E, R>(
  scheduleDef: Schedule.Schedule<unknown, any, any>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<void, never, Scope.Scope | R> {
  return FxStream.fromSchedule(scheduleDef).pipe(
    FxStream.runForEach(() => effect.pipe(Effect.catchCause(() => Effect.void))),
    Effect.forkScoped,
    Effect.asVoid,
  ) as Effect.Effect<void, never, Scope.Scope | R>;
}

export function withLayer<ROut, E2, RIn>(
  layer: Layer.Layer<ROut, E2, RIn>,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Exclude<Requirements<C>, ROut> | RIn, Errors<C> | E2, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) =>
    provideLayerToSetup(component, layer) as PreserveRouteMetadata<C, Component<PropsOf<C>, Exclude<Requirements<C>, ROut> | RIn, Errors<C> | E2, BindingsOf<C>>>;
}

export function withErrorBoundary<Handled extends string>(
  handlers: Record<Handled, (error: any) => unknown>,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Exclude<Errors<C>, { readonly _tag: Handled }>, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      boundary: {
        ...(i.boundary ?? {}),
        ...handlers,
      },
    }) as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Exclude<Errors<C>, { readonly _tag: Handled }>, BindingsOf<C>>>;
  };
}

export function withLoading(
  fallback: () => unknown,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, { ...i, loading: fallback });
  };
}

export function withSpan(
  name: string,
  _attributes?: Record<string, unknown>,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => i.setup(props).pipe(Effect.withSpan(name)),
    });
  };
}

export function memo<Props>(
  equals: (prev: Props, next: Props) => boolean,
): <C extends Component<Props, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<Props, Requirements<C>, Errors<C>, BindingsOf<C>>> {
  return <C extends Component<Props, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, { ...i, memo: equals });
  };
}

export function tapSetup<Props, Req, E, Bindings, E2, R2>(
  tap: (bindings: Bindings) => Effect.Effect<unknown, E2, R2>,
): <C extends Component<Props, Req, E, Bindings>>(component: C) => PreserveRouteMetadata<C, Component<Props, Req | R2, E | E2, Bindings>> {
  return <C extends Component<Props, Req, E, Bindings>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => i.setup(props).pipe(Effect.tap(tap as any)) as any,
    }) as PreserveRouteMetadata<C, Component<Props, Req | R2, E | E2, Bindings>>;
  };
}

export function withPreSetup<E2, R2>(
  pre: Effect.Effect<unknown, E2, R2>,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | R2, Errors<C> | E2, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => pre.pipe(Effect.flatMap(() => i.setup(props))) as any,
    }) as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | R2, Errors<C> | E2, BindingsOf<C>>>;
  };
}

export function withSetupRetry(
  retry: Schedule.Schedule<unknown, any, any>,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C>, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => i.setup(props).pipe(Effect.retry(retry)),
    });
  };
}

export function withSetupTimeout(
  duration: number | string,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C> | { readonly _tag: "ComponentSetupTimeout" }, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) => {
    const i = internals(component);
    const timeout = typeof duration === "number" ? `${duration} millis` : duration;
    return toComponentLike(component, {
      ...i,
      setup: (props) => Effect.raceFirst(
        i.setup(props) as any,
        Effect.sleep(timeout as any).pipe(
          Effect.flatMap(() => Effect.fail({ _tag: "ComponentSetupTimeout" as const })),
        ),
      ),
    }) as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C>, Errors<C> | { readonly _tag: "ComponentSetupTimeout" }, BindingsOf<C>>>;
  };
}

type RoutedComponentInternals<P, Q, H, A, E> = Route.RoutedComponent<P, Q, H> & {
  readonly [Route.RouteLoaderMetaSymbol]?: {
    readonly data: A;
    readonly error: E;
  };
  __routeLoader?: (params: unknown, deps?: { readonly parent: <X>() => X }) => Effect.Effect<unknown, unknown, unknown>;
  __routeLoaderOptions?: Route.LoaderOptions;
  __routeLoaderError?: Record<string, (error: unknown, params: unknown) => unknown>;
  __routeTitle?: string | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => string);
  __routeMetaExtra?: Route.RouteMetaRecord | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => Route.RouteMetaRecord);
  __routeGuards?: ReadonlyArray<Effect.Effect<unknown, any, any>>;
};

type WithRouteMeta<P, Q, H> = {
  [Route.RouteMetaSymbol]: Route.RouteMeta<P, Q, H>;
};

type PreserveRouteMetadata<Source, Target> = Target
  & (Source extends Route.RoutedComponent<infer P, infer Q, infer H> ? Route.RoutedComponent<P, Q, H> : {})
  & (Source extends Route.LoaderTaggedComponent<infer A, infer E> ? Route.LoaderTaggedComponent<A, E> : {});

type RouteBindings<P, Q, H> = {
  readonly __routeMatched: Atom.ReadonlyAtom<boolean>;
  readonly __routeInner: unknown;
  readonly __routeCtx: Route.RouteContext<P, Q, H>;
  readonly __routeHeadId: string;
  readonly __routePattern: string;
};

function asRoutedComponent<P, Q, H, A = unknown, E = unknown>(
  component: Component<any, any, any, any>,
): RoutedComponentInternals<P, Q, H, A, E> {
  return component as unknown as RoutedComponentInternals<P, Q, H, A, E>;
}

function setRoutedMeta<P, Q, H>(component: Component<any, any, any, any>, meta: Route.RouteMeta<P, Q, H>): void {
  (asRoutedComponent<P, Q, H>(component) as RoutedComponentInternals<P, Q, H, unknown, unknown> & WithRouteMeta<P, Q, H>)[Route.RouteMetaSymbol] = meta;
}

function copyRouteDecorations(
  source: Component<any, any, any, any>,
  target: Component<any, any, any, any>,
): void {
  const sourceRoute = asRoutedComponent(source);
  const targetRoute = asRoutedComponent(target);

  const meta = sourceRoute[Route.RouteMetaSymbol];
  if (meta) {
    setRoutedMeta(target, meta);
    Route.registerRoute(target, meta);
  }

  const loaderMeta = sourceRoute[Route.RouteLoaderMetaSymbol];
  if (loaderMeta) {
    (targetRoute as RoutedComponentInternals<any, any, any, unknown, unknown> & { [Route.RouteLoaderMetaSymbol]: typeof loaderMeta })[Route.RouteLoaderMetaSymbol] = loaderMeta;
  }

  targetRoute.__routeLoader = sourceRoute.__routeLoader;
  targetRoute.__routeLoaderOptions = sourceRoute.__routeLoaderOptions;
  targetRoute.__routeLoaderError = sourceRoute.__routeLoaderError;
  targetRoute.__routeTitle = sourceRoute.__routeTitle;
  targetRoute.__routeMetaExtra = sourceRoute.__routeMetaExtra;
  targetRoute.__routeGuards = sourceRoute.__routeGuards;
}

function toComponentLike<Source extends Component<any, any, any, any>, Props, Req, E, Bindings>(
  source: Source,
  internal: InternalComponent<Props, Req, E, Bindings>,
): PreserveRouteMetadata<Source, Component<Props, Req, E, Bindings>> {
  const wrapped = toComponent(internal);
  copyRouteDecorations(source, wrapped);
  return wrapped as PreserveRouteMetadata<Source, Component<Props, Req, E, Bindings>>;
}

function decodeRouteOption<A>(schema: Schema.Schema<A>) {
  return Schema.decodeUnknownOption(schema as any);
}

function routeErrorTag(error: unknown): string {
  return typeof error === "object" && error !== null && "_tag" in error
    ? String((error as { readonly _tag: string })._tag)
    : "_";
}

/**
 * Transitional routed-component helper.
 *
 * The unified route-first API should prefer `Route.path(...)` and route pipe
 * composition. This helper remains only for the narrower remaining
 * routed-component setup cases still under migration.
 */
export function route<P = Record<string, string>, Q = Record<string, string | undefined>, H = string>(
  pattern: string,
  options?: {
    readonly params?: Schema.Schema<P>;
    readonly query?: Schema.Schema<Q>;
    readonly hash?: Schema.Schema<H>;
    readonly exact?: boolean;
    readonly onParseError?: "not-found" | "error" | ((error: unknown) => Effect.Effect<void>);
  },
): <Props, Req, E, Bindings>(
  component: Component<Props, Req, E, Bindings>,
) => (Component<Props, Req | Route.RouterService | Route.RouteContext<any, any, any>, E | { readonly _tag: "RouteParseError" }, Bindings>
  & Route.RoutedComponent<P, Q, H>) {
  return <Props, Req, E, Bindings>(component: Component<Props, Req, E, Bindings>) => {
    const i = internals(component);

    let wrapped: Component<Props, Req | Route.RouterService | Route.RouteContext<any, any, any>, E | { readonly _tag: "RouteParseError" }, RouteBindings<P, Q, H>>;

    wrapped = toComponent({
      ...i,
      setup: (props) => Effect.gen(function* () {
        const router = yield* Route.RouterTag;
        const parentPrefix = "";
        const headId = Route.createRouteHeadId();

        const fullPattern = Route.resolvePattern(parentPrefix, pattern);
        const routeMatched = yield* derived(() => Route.matchPattern(fullPattern, router.url().pathname, options?.exact));

        const paramsAtom = yield* derived(() => {
          if (!routeMatched()) return {} as P;
          const raw = Route.extractParams(fullPattern, router.url().pathname) ?? {};
          if (!options?.params) return raw as P;
          const decoded = decodeRouteOption(options.params)(raw);
          if (decoded._tag === "Some") return decoded.value as P;
          if (options?.onParseError === "error") {
            throw { _tag: "RouteParseError" as const, message: "Invalid route params" };
          }
          if (typeof options?.onParseError === "function") {
            Effect.runFork(options.onParseError({ _tag: "RouteParseError", message: "Invalid route params" }));
          }
          return {} as P;
        });

        const queryAtomValue = yield* derived(() => {
          if (!routeMatched()) return {} as Q;
          const raw = Object.fromEntries(router.url().searchParams.entries());
          if (!options?.query) return raw as Q;
          const decoded = decodeRouteOption(options.query)(raw);
          if (decoded._tag === "Some") return decoded.value as Q;
          if (options?.onParseError === "error") {
            throw { _tag: "RouteParseError" as const, message: "Invalid route query" };
          }
          if (typeof options?.onParseError === "function") {
            Effect.runFork(options.onParseError({ _tag: "RouteParseError", message: "Invalid route query" }));
          }
          return {} as Q;
        });

        const hashAtomValue = yield* derived(() => {
          const h = router.url().hash;
          const raw = h.startsWith("#") ? h.slice(1) : h;
          if (raw.length === 0) return undefined as H | undefined;
          if (!options?.hash) return raw as H;
          const decoded = decodeRouteOption(options.hash)(raw);
          return decoded._tag === "Some" ? decoded.value as H : undefined;
        });

        const prefixAtom = yield* derived(() => {
          if (!routeMatched()) return "";
          const matched = Route.extractParams(fullPattern, router.url().pathname);
          return matched === null ? "" : fullPattern;
        });

        const ctx: Route.RouteContext<P, Q, H> = {
          prefix: prefixAtom,
          params: paramsAtom,
          query: queryAtomValue,
          hash: hashAtomValue,
          matched: routeMatched,
          pattern: fullPattern,
          routeId: undefined,
        };

        const guards = asRoutedComponent<P, Q, H, unknown, unknown>(wrapped).__routeGuards ?? [];
        if (routeMatched()) {
          for (const guardEffect of guards) {
            yield* guardEffect;
          }
        }

        if (!routeMatched()) {
          Route.removeRouteHead(headId);
          return { __routeMatched: routeMatched, __routeInner: null, __routeCtx: ctx, __routeHeadId: headId, __routePattern: fullPattern } satisfies RouteBindings<P, Q, H>;
        }

        const wrappedRoute = asRoutedComponent<P, Q, H, unknown, unknown>(wrapped);
        const routeMeta = wrappedRoute[Route.RouteMetaSymbol];
        const routeId = routeMeta?.id ?? fullPattern;
        const loaderOptions = wrappedRoute.__routeLoaderOptions ?? {};
        const loaderResult = yield* Route.runRouteLoader(wrapped, {
          pattern,
          fullPattern,
          paramsSchema: options?.params,
          querySchema: options?.query,
          hashSchema: options?.hash,
          exact: options?.exact,
          id: routeId,
        }, router.url());

        let loaderDataAtom: Atom.ReadonlyAtom<unknown> | undefined;
        let loaderResultAtom: Atom.ReadonlyAtom<any> | undefined;
        if (wrappedRoute.__routeLoader) {
          if (loaderOptions.streaming) {
            const resultState = yield* state(loaderResult);
            loaderResultAtom = resultState;
            loaderDataAtom = Atom.derived(() => {
              const current = resultState();
              return current._tag === "Success" ? current.value : undefined;
            });
          } else {
            if (loaderResult._tag === "Failure") {
              const cases = wrappedRoute.__routeLoaderError;
              if (cases) {
                const tag = routeErrorTag(loaderResult.error);
                const handler = cases[tag] ?? cases._;
                if (handler) {
                  const fallbackView = handler(loaderResult.error, paramsAtom());
                  return { __routeMatched: routeMatched, __routeInner: { __routeLoaderErrorView: fallbackView }, __routeCtx: ctx, __routeHeadId: headId, __routePattern: fullPattern } satisfies RouteBindings<P, Q, H>;
                }
              }
              throw loaderResult.error;
            }
            const loaded = loaderResult._tag === "Success" ? loaderResult.value : undefined;
            loaderDataAtom = Atom.value(loaded);
            loaderResultAtom = Atom.value(loaderResult);
          }
        }

        const ctxWithLoader: Route.RouteContext<P, Q, H> = {
          ...ctx,
          routeId,
          loaderData: loaderDataAtom,
          loaderResult: loaderResultAtom,
        };

        const inner = yield* i.setup(props).pipe(
          Effect.provideService(Route.RouteContextTag, ctxWithLoader),
        );

        const routeTitle: string
          | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => string)
          | undefined = wrappedRoute.__routeTitle;
        const routeMetaExtra: Route.RouteMetaRecord
          | ((params: P, loaderData: unknown | undefined, loaderResult: Result<unknown, unknown> | undefined) => Route.RouteMetaRecord)
          | undefined = wrappedRoute.__routeMetaExtra;
        const applyHead = () => {
          if (!routeMatched()) {
            Route.removeRouteHead(headId);
            return;
          }
          const loaderDataForHead = loaderDataAtom ? loaderDataAtom() : undefined;
          const loaderResultForHead = loaderResultAtom ? loaderResultAtom() : undefined;
          const titleResolved = routeTitle === undefined
            ? undefined
            : typeof routeTitle === "function"
              ? routeTitle(paramsAtom(), loaderDataForHead, loaderResultForHead)
              : routeTitle;
          const metaResolved = routeMetaExtra === undefined
            ? undefined
            : typeof routeMetaExtra === "function"
              ? routeMetaExtra(paramsAtom(), loaderDataForHead, loaderResultForHead)
              : routeMetaExtra;

          Route.setRouteHead({
            id: headId,
            depth: fullPattern.split("/").filter(Boolean).length,
            title: titleResolved,
            meta: metaResolved,
          });
        };

        applyHead();

        const headUnsubscribers: Array<() => void> = [];
        headUnsubscribers.push(Atom.subscribe(routeMatched, applyHead, { immediate: false }));
        headUnsubscribers.push(Atom.subscribe(paramsAtom, applyHead, { immediate: false }));
        if (loaderDataAtom) {
          headUnsubscribers.push(Atom.subscribe(loaderDataAtom, applyHead, { immediate: false }));
        }
        if (loaderResultAtom) {
          headUnsubscribers.push(Atom.subscribe(loaderResultAtom, applyHead, { immediate: false }));
        }
        const componentScope = currentComponentScope();
        if (componentScope !== null) {
          yield* Effect.addFinalizer(() => Effect.sync(() => {
            for (const unsubscribe of headUnsubscribers) {
              unsubscribe();
            }
            Route.removeRouteHead(headId);
          })).pipe(Scope.provide(componentScope));
        }

        return { __routeMatched: routeMatched, __routeInner: inner, __routeCtx: ctxWithLoader, __routeHeadId: headId, __routePattern: fullPattern } satisfies RouteBindings<P, Q, H>;
      }),
      view: (props, bindings: RouteBindings<P, Q, H>) => {
        if (!bindings.__routeMatched()) {
          if (bindings.__routeHeadId) {
            Route.removeRouteHead(String(bindings.__routeHeadId));
          }
          return null;
        }
        if (bindings.__routeInner && typeof bindings.__routeInner === "object" && "__routeLoaderErrorView" in bindings.__routeInner) {
          return bindings.__routeInner.__routeLoaderErrorView;
        }
        if (bindings.__routeInner === null) return null;
        if (i.view === undefined) {
          const renderProp = (props as RenderPropChildren<unknown>).children;
          return typeof renderProp === "function" ? renderProp(bindings.__routeInner) : null;
        }
        return i.view(props, bindings.__routeInner as Bindings);
      },
    });

    const meta: Route.RouteMeta<P, Q, H> = {
      pattern,
      fullPattern: Route.resolvePattern("", pattern),
      paramsSchema: options?.params,
      querySchema: options?.query,
      hashSchema: options?.hash,
      exact: options?.exact,
      id: Route.createRouteId(),
    };
    setRoutedMeta<P, Q, H>(wrapped, meta);
    Route.registerRoute(wrapped, meta);
    return wrapped as typeof wrapped & Route.RoutedComponent<P, Q, H>;
  };
}

/**
 * Transitional routed-component guard helper.
 *
 * New code should prefer `Route.guard(...)` on unified routes.
 */
export function guard<Req, E>(
  check: Effect.Effect<unknown, E, Req>,
): <C extends Component<any, any, any, any>>(
  component: C,
) => PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | Req, Errors<C> | E, BindingsOf<C>>> {
  return <C extends Component<any, any, any, any>>(component: C) => {
    const routed = asRoutedComponent(component);
    const current = routed.__routeGuards ?? [];
    routed.__routeGuards = [...current, check];
    return component as unknown as PreserveRouteMetadata<C, Component<PropsOf<C>, Requirements<C> | Req, Errors<C> | E, BindingsOf<C>>>;
  };
}

export function withBehavior<Elements, AddedBindings, BR, BE, Props, Req, E, Bindings>(
  behavior: Behavior.Behavior<Elements, AddedBindings, BR, BE>,
  selectElements: (bindings: Bindings, props: Props) => Elements,
  merge?: (bindings: Bindings, added: AddedBindings) => Bindings & AddedBindings,
): (
  component: Component<Props, Req, E, Bindings>,
) => Component<Props, Req | BR, E | BE, Bindings & AddedBindings> {
  return (component) => {
    const i = internals(component);
    return toComponentLike(component, {
      ...i,
      setup: (props) => Effect.gen(function* () {
        const base: Bindings = yield* (i.setup(props) as any);
        const elements = selectElements(base, props);
        const added: AddedBindings = yield* (behavior.run(elements) as any);
        if (merge) {
          return merge(base, added);
        }
        return { ...(base as any), ...(added as any) };
      }) as any,
    }) as Component<Props, Req | BR, E | BE, Bindings & AddedBindings>;
  };
}

export function slotInteractive(): Effect.Effect<Element.Interactive> {
  return Effect.sync(() => Element.interactive());
}

export function slotContainer(): Effect.Effect<Element.Container> {
  return Effect.sync(() => Element.container());
}

export function slotFocusable(): Effect.Effect<Element.Focusable> {
  return Effect.sync(() => Element.focusable());
}

export function slotTextInput(): Effect.Effect<Element.TextInput> {
  return Effect.sync(() => Element.textInput());
}

export function slotDraggable(): Effect.Effect<Element.Draggable> {
  return Effect.sync(() => Element.draggable());
}

export function slotCollection<E extends Element.Handle>(items: ReadonlyArray<E> = []): Effect.Effect<Element.Collection<E>> {
  return Effect.sync(() => Element.collection(items));
}

export interface MountOptions<Props, R, E> {
  readonly props: Props;
  readonly layer: Layer.Layer<R, E, never>;
  readonly target: Element;
  readonly onScopeError?: (cause: Cause.Cause<unknown>) => void;
  readonly supervisor?: unknown;
}

export function mount<Props, Req, E>(
  component: Component<Props, Req, E, any>,
  options: MountOptions<Props, Req, any>,
): () => void {
  const dispose = mountRuntime(() => component(options.props), options.target, options.layer as Layer.Layer<Req, any, never>);
  return () => {
    dispose();
  };
}

export const Component = {
  TypeId: ComponentTypeId,
  make,
  from,
  headless,
  props,
  propsSchema,
  require,
  setupEffect,
  renderEffect,
  mount,
  state,
  derived,
  query,
  action,
  ref,
  fromDequeue,
  schedule,
  scheduleEffect,
  withLayer,
  withErrorBoundary,
  withLoading,
  withSpan,
  memo,
  tapSetup,
  withPreSetup,
  withSetupRetry,
  withSetupTimeout,
  route,
  withBehavior,
  slotInteractive,
  slotContainer,
  slotFocusable,
  slotTextInput,
  slotDraggable,
  slotCollection,
} as const;
