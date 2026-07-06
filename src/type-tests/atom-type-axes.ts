import { Effect, Layer, ServiceMap } from "effect";
import * as Atom from "../Atom.js";
import * as FetchResult from "../Result.js";
import type { BridgeError } from "../effect-ts.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;
type EffectSuccess<T> = T extends Effect.Effect<infer A, any, any> ? A : never;
type EffectError<T> = T extends Effect.Effect<any, infer E, any> ? E : never;
type EffectRequirements<T> = T extends Effect.Effect<any, any, infer R> ? R : never;

type AuthError = { readonly _tag: "AuthError" };
type HttpError = { readonly _tag: "HttpError" };
type Api = { readonly load: () => Effect.Effect<number, HttpError> };
const Api = ServiceMap.Service<Api>("Api");

const runtime = Atom.runtime(Layer.empty);

const auth = runtime.atom(Effect.fail({ _tag: "AuthError" } as AuthError));
type _AuthValue = Expect<Equal<Atom.ValueOf<typeof auth>, import("../effect-ts.js").Result<never, AuthError>>>;
type _AuthError = Expect<Equal<Atom.ErrorOf<typeof auth>, AuthError>>;
type _AuthRequirements = Expect<Equal<Atom.RequirementsOf<typeof auth>, never>>;

const profile = runtime.atom((get) =>
  Effect.gen(function* () {
    yield* get.result(auth);
    return yield* Effect.fail<HttpError>({ _tag: "HttpError" });
  }),
);

type _ProfileError = Expect<Equal<
  Atom.ErrorOf<typeof profile>,
  BridgeError | AuthError | HttpError
>>;

const authResult = Atom.result(auth);
type _AuthResultSuccess = Expect<Equal<EffectSuccess<typeof authResult>, never>>;
type _AuthResultError = Expect<Equal<EffectError<typeof authResult>, AuthError | BridgeError>>;

const authResultDataLast = Atom.result()(auth);
type _AuthResultDataLastError = Expect<Equal<EffectError<typeof authResultDataLast>, AuthError | BridgeError>>;

declare const readContext: Atom.Context;
declare const writeContext: Atom.WriteContext<unknown>;

const authFromReadContext = readContext.result(auth);
const authFromWriteContext = writeContext.result(auth);

type _ReadContextResultError = Expect<Equal<EffectError<typeof authFromReadContext>, AuthError | BridgeError>>;
type _WriteContextResultError = Expect<Equal<EffectError<typeof authFromWriteContext>, AuthError | BridgeError>>;

const fetchResultAtom = Atom.readable((): FetchResult.Result<string, HttpError> =>
  FetchResult.failure<string, HttpError>({ _tag: "HttpError" }));
const fetchResultEffect = Atom.result(fetchResultAtom);
type _FetchResultSuccess = Expect<Equal<EffectSuccess<typeof fetchResultEffect>, string>>;
type _FetchResultError = Expect<Equal<EffectError<typeof fetchResultEffect>, HttpError | BridgeError>>;

const count = Atom.value(0);
const label = count.pipe(Atom.map((n) => String(n)));

type _MappedValue = Expect<Equal<Atom.ValueOf<typeof label>, string>>;
type _MappedError = Expect<Equal<Atom.ErrorOf<typeof label>, never>>;

const unboundQuery = Atom.query(() =>
  Effect.gen(function* () {
    const api = yield* Api;
    return yield* api.load();
  }),
);

type _UnboundQueryValue = Expect<Equal<Atom.ValueOf<typeof unboundQuery>, import("../effect-ts.js").Result<number, HttpError>>>;
type _UnboundQueryError = Expect<Equal<Atom.ErrorOf<typeof unboundQuery>, HttpError>>;
type _UnboundQueryRequirementA = Expect<Atom.RequirementsOf<typeof unboundQuery> extends Api ? true : false>;
type _UnboundQueryRequirementB = Expect<Api extends Atom.RequirementsOf<typeof unboundQuery> ? true : false>;

const reactiveUnboundQuery = unboundQuery.pipe(Atom.withReactivity(["profile"]));
type _ReactiveUnboundQueryValue = Expect<Equal<Atom.ValueOf<typeof reactiveUnboundQuery>, Atom.ValueOf<typeof unboundQuery>>>;
type _ReactiveUnboundQueryError = Expect<Equal<Atom.ErrorOf<typeof reactiveUnboundQuery>, HttpError>>;
type _ReactiveUnboundQueryRequirement = Expect<Equal<Atom.RequirementsOf<typeof reactiveUnboundQuery>, Atom.RequirementsOf<typeof unboundQuery>>>;

const optionalProfile = Atom.readable<string | null, HttpError, Api>(() => null);
const safeProfile = optionalProfile.pipe(Atom.withFallback("anonymous"));
type _FallbackValue = Expect<Equal<Atom.ValueOf<typeof safeProfile>, string>>;
type _FallbackError = Expect<Equal<Atom.ErrorOf<typeof safeProfile>, HttpError>>;
type _FallbackRequirement = Expect<Equal<Atom.RequirementsOf<typeof safeProfile>, Api>>;

const projection = Atom.projectionAsync<{ readonly count: number }, HttpError, Api>(
  (draft) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return { count: yield* api.load() };
    }),
  { count: 0 },
);

type _ProjectionValue = Expect<Equal<Atom.ValueOf<typeof projection>, import("../effect-ts.js").Result<{ readonly count: number }, HttpError>>>;
type _ProjectionError = Expect<Equal<Atom.ErrorOf<typeof projection>, HttpError>>;
type _ProjectionRequirement = Expect<Equal<Atom.RequirementsOf<typeof projection>, Api>>;

const boundProjection = Atom.projectionAsync<{ readonly count: number }, HttpError, Api>(
  (draft) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return { count: yield* api.load() };
    }),
  { count: 0 },
  { runtime: Atom.runtime(Layer.succeed(Api, { load: () => Effect.succeed(1) })).managed },
);

type _BoundProjectionRequirement = Expect<Equal<Atom.RequirementsOf<typeof boundProjection>, never>>;

const unboundEffect = Atom.get(unboundQuery);
type _UnboundEffectRequirements = Expect<Equal<EffectRequirements<typeof unboundEffect>, Api>>;
