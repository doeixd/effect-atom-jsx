/**
 * Compile-time coverage for the core `Result` ergonomics ported from the
 * deleted fetch model (`RESULT_UNIFICATION_PLAN.md` slice 3): `Result.builder`
 * return-type accumulation and `Result.all` tuple inference.
 */

import type { Cause } from "effect";
import { Result } from "../effect-ts.js";
import type { Defect, Failure, ResultDefectError, Success } from "../effect-ts.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

type HttpError = { readonly _tag: "HttpError" };
type AuthError = { readonly _tag: "AuthError" };

declare const users: Result<ReadonlyArray<string>, HttpError>;
declare const session: Result<{ readonly id: number }, AuthError>;

// ─── builder: return type accumulates across handlers ────────────────────────

const empty = Result.builder(users).render();
type _EmptyBuilder = Expect<Equal<typeof empty, undefined>>;

const oneHandler = Result.builder(users).onSuccess((list) => list.length).render();
type _OneHandler = Expect<Equal<typeof oneHandler, number | undefined>>;

const twoHandlers = Result.builder(users)
  .onLoading(() => "loading")
  .onSuccess((list) => list.length)
  .render();
type _TwoHandlers = Expect<Equal<typeof twoHandlers, string | number | undefined>>;

const allHandlers = Result.builder(users)
  .onLoading(() => "loading" as const)
  .onRefreshing(() => 1 as const)
  .onSuccess(() => true as const)
  .onStale(() => null)
  .onFailure(() => ({ kind: "failure" }) as const)
  .onDefect(() => [] as const)
  .render();
type _AllHandlers = Expect<Equal<
  typeof allHandlers,
  "loading" | 1 | true | null | { readonly kind: "failure" } | readonly [] | undefined
>>;

// ─── builder: handler argument types ────────────────────────────────────────

Result.builder(users)
  .onSuccess((value) => {
    type _Value = Expect<Equal<typeof value, ReadonlyArray<string>>>;
    return null;
  })
  .onRefreshing((previous) => {
    type _Previous = Expect<Equal<
      typeof previous,
      Success<ReadonlyArray<string>> | Failure<HttpError> | Defect
    >>;
    return null;
  })
  .onStale((error, data) => {
    type _Error = Expect<Equal<typeof error, HttpError>>;
    type _Data = Expect<Equal<typeof data, ReadonlyArray<string>>>;
    return null;
  })
  // `onFailure` is the documented fallback for `Defect`, so its error channel is
  // the typed error *or* the tagged `ResultDefectError` envelope — never the
  // untagged `{ defect: string }` union the fetch model used.
  .onFailure((error) => {
    type _Error = Expect<Equal<typeof error, HttpError | ResultDefectError>>;
    return null;
  })
  .onDefect((cause, rawCause) => {
    type _Cause = Expect<Equal<typeof cause, string>>;
    type _RawCause = Expect<Equal<typeof rawCause, Cause.Cause<unknown>>>;
    return null;
  })
  .render();

// ─── all: tuple value inference and error union ─────────────────────────────

const combined = Result.all([users, session]);
type _Combined = Expect<Equal<
  typeof combined,
  Result<readonly [ReadonlyArray<string>, { readonly id: number }], HttpError | AuthError>
>>;

const single = Result.all([users]);
type _Single = Expect<Equal<typeof single, Result<readonly [ReadonlyArray<string>], HttpError>>>;

const homogeneous = Result.all([users, users, users]);
type _Homogeneous = Expect<Equal<
  typeof homogeneous,
  Result<readonly [ReadonlyArray<string>, ReadonlyArray<string>, ReadonlyArray<string>], HttpError>
>>;

// Composition: the combined result feeds the builder with the tuple intact.
const rendered = Result.builder(Result.all([users, session]))
  .onSuccess(([list, user]) => {
    type _List = Expect<Equal<typeof list, ReadonlyArray<string>>>;
    type _User = Expect<Equal<typeof user, { readonly id: number }>>;
    return list.length + user.id;
  })
  .render();
type _Rendered = Expect<Equal<typeof rendered, number | undefined>>;
