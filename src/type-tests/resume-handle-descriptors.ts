import { Effect, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true
    : false;
type Expect<T extends true> = T;

/**
 * Milestone 2 items 3-4: the symbol-based inspection protocol is uniform
 * across every setup handle kind, and each kind has a distinct descriptor.
 */

declare const stateHandle: Component.StateAtom<number>;
declare const derivedHandle: Component.DerivedAtom<number>;
declare const refHandle: Component.RefHandle<{ readonly id: string }>;
declare const queryHandle: Component.QueryAtom<number, string>;
declare const actionHandle: Component.ComponentAction<
  readonly [number],
  void,
  string
>;

// Each handle kind resolves to its own descriptor through the shared helper.
const stateInspection = Resume.inspectHandle(stateHandle);
const derivedInspection = Resume.inspectHandle(derivedHandle);
const refInspection = Resume.inspectHandle(refHandle);
const queryInspection = Resume.inspectHandle(queryHandle);
const actionInspection = Resume.inspectHandle(actionHandle);

export type _StateKind = Expect<Equal<typeof stateInspection.kind, "state">>;
export type _DerivedKind = Expect<
  Equal<typeof derivedInspection.kind, "derived">
>;
export type _RefKind = Expect<Equal<typeof refInspection.kind, "ref">>;
export type _QueryKind = Expect<Equal<typeof queryInspection.kind, "query">>;
export type _ActionKind = Expect<Equal<typeof actionInspection.kind, "action">>;

// Derived values are always recomputed; refs are always host-bound.
export type _DerivedRecomputed = Expect<
  Equal<typeof derivedInspection.recomputed, true>
>;
export type _RefHostBound = Expect<Equal<typeof refInspection.hostBound, true>>;
export type _RefRead = Expect<
  Equal<ReturnType<typeof refInspection.read>, { readonly id: string } | null>
>;

// State and query descriptors stay distinctly branded: a query handle is not
// assignable to a state handle, which is what keeps `Result` unwrapping sound.
declare const asState: (h: Resume.InspectableStateHandle<number>) => void;
// @ts-expect-error query handles must not satisfy the state handle brand
asState(queryHandle);
declare const asDerived: (h: Resume.InspectableDerivedHandle<number>) => void;
// @ts-expect-error state handles must not satisfy the derived handle brand
asDerived(stateHandle);

// Handles remain usable as their underlying primitives.
export type _StateIsAtom = Expect<
  Equal<typeof stateHandle extends Atom.WritableAtom<number> ? true : false, true>
>;
export type _DerivedIsAtom = Expect<
  Equal<
    typeof derivedHandle extends Atom.ReadonlyAtom<number> ? true : false,
    true
  >
>;
export type _RefIsRef = Expect<
  Equal<
    typeof refHandle extends Component.ComponentRef<{ readonly id: string }>
      ? true
      : false,
    true
  >
>;

/**
 * Milestone 2 acceptance: action requirement/error/argument inference stays
 * precise for both plain closures and portable bodies.
 */
const plainAction = Component.action(
  (_a: number, _b: string) => Effect.succeed(1 as const),
);
export type _PlainAction = Expect<
  Equal<
    typeof plainAction,
    Effect.Effect<
      Component.ComponentAction<readonly [number, string], 1, never>,
      never,
      never
    >
  >
>;

const PortableBody = Portable.code({
  id: "type-tests.resume.action",
  buildId: "type-tests-build",
  captures: Schema.Struct({ label: Schema.String }),
  run: (_captures: { readonly label: string }, _n: number) =>
    Effect.fail("boom" as const),
});
const portableAction = Component.action(
  Portable.bind(PortableBody, { label: "x" }),
);
export type _PortableActionArgs = Expect<
  Equal<
    typeof portableAction,
    Effect.Effect<
      Component.ComponentAction<readonly [number], never, "boom">,
      never,
      never
    >
  >
>;

// Every handle is inspectable through the one shared protocol symbol.
export type _UniformProtocol = Expect<
  Equal<
    [
      typeof stateHandle,
      typeof derivedHandle,
      typeof refHandle,
      typeof queryHandle,
      typeof actionHandle,
    ] extends ReadonlyArray<Resume.InspectableHandle<any, any>> ? true : false,
    true
  >
>;
