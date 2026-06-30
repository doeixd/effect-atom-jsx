import { Effect, Layer } from "effect";
import * as Atom from "../Atom.js";
import { defineQuery, type BridgeError } from "../effect-ts.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;
type EffectError<T> = T extends Effect.Effect<any, infer E, any> ? E : never;

type AuthError = { readonly _tag: "AuthError" };
type HttpError = { readonly _tag: "HttpError" };

const runtime = Atom.runtime(Layer.empty);
const userId = Atom.value("u1");
const auth = runtime.atom(Effect.fail({ _tag: "AuthError" } as AuthError));

const plainRead = defineQuery(
  (get) => {
    const id = get(userId);
    return Effect.succeed(id.length);
  },
  { runtime: runtime.managed },
);

type _PlainReadError = Expect<Equal<EffectError<ReturnType<typeof plainRead.effect>>, BridgeError>>;

const composed = defineQuery(
  (get) =>
    Effect.gen(function* () {
      yield* get.result(auth);
      return yield* Effect.fail({ _tag: "HttpError" } as HttpError);
    }),
  { runtime: runtime.managed },
);

type _ComposedError = Expect<Equal<
  EffectError<ReturnType<typeof composed.effect>>,
  AuthError | HttpError | BridgeError
>>;
