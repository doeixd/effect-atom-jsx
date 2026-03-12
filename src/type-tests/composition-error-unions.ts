import { Effect, Layer } from "effect";
import * as Atom from "../Atom.js";
import type { BridgeError } from "../effect-ts.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const runtime = Atom.runtime(Layer.empty);

const auth = runtime.atom(Effect.fail({ _tag: "AuthError" } as const));

const profile = runtime.atom((get) =>
  Effect.gen(function* () {
    const _auth = yield* get.result(auth);
    return yield* Effect.fail({ _tag: "HttpError" } as const);
  }),
);

type ProfileError = typeof profile extends Atom.AsyncAtom<any, infer E> ? E : never;
type _ProfileErrorCheck = Expect<Equal<ProfileError, BridgeError | { readonly _tag: "AuthError" } | { readonly _tag: "HttpError" }>>;
