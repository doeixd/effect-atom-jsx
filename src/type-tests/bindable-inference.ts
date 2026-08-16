/**
 * Pins `Component.bindable` + `Setup.bind` inference for the K0b
 * controlled/uncontrolled differential pair: the SAME call site adopts a
 * caller's atom or owns fresh state, with no casts and no `unknown`
 * bindings. The three-argument `bind` overload keeps its parameters `A`-free
 * (policy infers into its own parameter, validated via `A`'s constraint) —
 * typing options as `BindOptions<A>` fixed `A` to `unknown` before a
 * context-sensitive callback was processed, which is how these shapes
 * regressed to `unknown` and forced casts in tests.
 */
import { Effect, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Component from "../Component.js";
import * as Resume from "../Resume.js";

declare const maybe: Atom.WritableAtom<string> | undefined;

// ─── bindable accepts the atom-or-value union and stays precise ─────────────
const unionResult = Component.bindable(maybe ?? "own-default");
type UnionA = typeof unionResult extends Effect.Effect<infer A, any, any> ? A : never;
declare const probeUnion: UnionA;
const _union: Atom.WritableAtom<string> | Component.StateAtom<string> = probeUnion;

// Pure forms keep their precise returns.
declare const external: Atom.WritableAtom<number>;
const _adopted: Effect.Effect<Atom.WritableAtom<number>> = Component.bindable(external);
const _owned: Effect.Effect<Component.StateAtom<number>> = Component.bindable(7);

// ─── bind: context-sensitive callback, no options ───────────────────────────
const noOptions = Component.setup<{ readonly value?: Atom.WritableAtom<string> }>().bind(
  "value",
  ({ props }) => Component.bindable(props.value ?? "own-default"),
);
declare const probeA: Component.SetupBindingsOf<typeof noOptions>;
const _a: string = probeA.value();

// ─── bind: context-sensitive callback WITH resume options ───────────────────
// The differential-pair call site exactly as an end user writes it — the
// shape that used to collapse `A` to `unknown`.
const contextSensitive = Component.setup<{ readonly value?: Atom.WritableAtom<string> }>().bind(
  "value",
  ({ props }) => Component.bindable(props.value ?? "own-default"),
  { resume: Resume.snapshotState(Schema.String) },
);
declare const probeC: Component.SetupBindingsOf<typeof contextSensitive>;
const _c: string = probeC.value();
probeC.value.set("next");

// ─── bind: annotated callback with resume options ───────────────────────────
const plainCallback = Component.setup<{ readonly value?: Atom.WritableAtom<string> }>().bind(
  "value",
  (input: Component.SetupInput<{ readonly value?: Atom.WritableAtom<string> }, {}>) =>
    Component.bindable(input.props.value ?? "own-default"),
  { resume: Resume.snapshotState(Schema.String) },
);
declare const probeB: Component.SetupBindingsOf<typeof plainCallback>;
const _b: string = probeB.value();

// ─── an incompatible policy still fails AT the bind call ────────────────────
Component.setup<{}>().bind(
  "count",
  // @ts-expect-error the snapshot codec must encode the state value type
  () => Component.state(0),
  { resume: Resume.snapshotState(Schema.String) },
);
