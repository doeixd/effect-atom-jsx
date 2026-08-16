import { Effect, Schema } from "effect";
import * as Atom from "./Atom.js";
import type * as Portable from "./Portable.js";
import type { Result } from "./effect-ts.js";

export const HandleInspectionTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Resume/HandleInspection",
);
export const HandleKindTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Resume/HandleKind",
);
export const BindingReactivityKeyPrefix = "af:binding:" as const;

export function bindingReactivityKey(
  componentId: string,
  binding: string,
): string {
  return `${BindingReactivityKeyPrefix}${componentId}/${binding}`;
}

export function isBindingReactivityKey(key: string): boolean {
  return key.startsWith(BindingReactivityKeyPrefix);
}

/** Schema-backed policy for snapshotting the value behind a state binding. */
export interface StateSnapshotPolicy<A, Encoded> {
  readonly kind: "state";
  readonly strategy: "snapshot";
  readonly schema: Schema.Codec<A, Encoded>;
}

export type AnyStateSnapshotPolicy = StateSnapshotPolicy<any, any>;

/**
 * Schema-backed policy for snapshotting the settled success value behind a
 * component query binding. Only settled `Success` results are snapshotted;
 * unsettled or failed queries fall back to activation.
 */
export interface QuerySnapshotPolicy<A, Encoded> {
  readonly kind: "query";
  readonly strategy: "snapshot";
  readonly schema: Schema.Codec<A, Encoded>;
}

export type AnyQuerySnapshotPolicy = QuerySnapshotPolicy<any, any>;

/**
 * Schema-backed projection policy for a HANDLE-SHAPED binding (`DQ-055`,
 * ratified): the binding does not have to be an atom. `read` extracts the
 * snapshot value from the live handle at collect time; `restore` rebuilds a
 * LIVE handle from the decoded snapshot at restore time (running in the
 * restoration Scope, without replaying setup). Wire kind stays `"state"`,
 * so no manifest version change.
 */
export interface ViaSnapshotPolicy<Handle, A, Encoded> {
  readonly kind: "state";
  readonly strategy: "via";
  readonly schema: Schema.Codec<A, Encoded>;
  readonly read: (handle: Handle) => A;
  readonly restore: (snapshot: A) => Effect.Effect<Handle, unknown, any>;
}

export type AnyViaSnapshotPolicy = ViaSnapshotPolicy<any, any, any>;

export type AnyBindingSnapshotPolicy =
  | AnyStateSnapshotPolicy
  | AnyQuerySnapshotPolicy
  | AnyViaSnapshotPolicy;

/** Resume policy accepted for a named setup binding in the current slice. */
export type BindingResumePolicy<Binding> =
  | ViaSnapshotPolicy<Binding, any, any>
  | (Binding extends Atom.WritableAtom<infer A> ? StateSnapshotPolicy<A, any>
    : Binding extends Atom.ReadonlyAtom<Result<infer A, any>, any>
      ? QuerySnapshotPolicy<A, any>
    : never);

/**
 * The inverse of {@link BindingResumePolicy}: the binding shape a given
 * policy can legally snapshot. `Setup.bind` constrains the bound value
 * against this — a constraint (checked after inference) rather than an
 * options type, because typing the options as `BindOptions<A>` fixes `A`
 * to `unknown` before a context-sensitive callback is processed.
 */
export type PolicyBindingOf<P extends AnyBindingSnapshotPolicy> = P extends {
  readonly strategy: "via";
} ? (P extends ViaSnapshotPolicy<infer Handle, any, any> ? Handle : never)
  : P extends StateSnapshotPolicy<infer A, any> ? Atom.WritableAtom<A>
  : P extends QuerySnapshotPolicy<infer A, any>
    ? Atom.ReadonlyAtom<Result<A, any>, any>
  : never;

/** Create an immutable, schema-backed state snapshot policy. */
export function snapshotState<A, Encoded>(
  schema: Schema.Codec<A, Encoded>,
): StateSnapshotPolicy<A, Encoded> {
  return Object.freeze({
    kind: "state",
    strategy: "snapshot",
    schema,
  });
}

/** Create an immutable, schema-backed query snapshot policy. */
export function snapshotQuery<A, Encoded>(
  schema: Schema.Codec<A, Encoded>,
): QuerySnapshotPolicy<A, Encoded> {
  return Object.freeze({
    kind: "query",
    strategy: "snapshot",
    schema,
  });
}

/**
 * Create an immutable, schema-backed PROJECTION snapshot policy for a
 * handle-shaped binding (`DQ-055`): `read` extracts the snapshot from the
 * handle, `restore` rebuilds a live handle from the decoded snapshot.
 */
export function snapshotVia<Handle, A, Encoded>(options: {
  readonly schema: Schema.Codec<A, Encoded>;
  readonly read: (handle: Handle) => A;
  readonly restore: (snapshot: A) => Effect.Effect<Handle, unknown, any>;
}): ViaSnapshotPolicy<Handle, A, Encoded> {
  return Object.freeze({
    kind: "state",
    strategy: "via",
    schema: options.schema,
    read: options.read,
    restore: options.restore,
  });
}

/** Read-only runtime capabilities published by a component state handle. */
export interface StateHandleInspection<A> {
  readonly kind: "state";
  readonly read: () => A;
  readonly isDisposed: () => boolean;
}

/**
 * Read-only runtime capabilities published by a component query handle.
 *
 * `executable` is present only for portable query executors; opaque query
 * closures cannot be lazily reloaded and require fallback activation.
 */
export interface QueryHandleInspection<A, E = unknown> {
  readonly kind: "query";
  readonly read: () => Result<A, E>;
  readonly isDisposed: () => boolean;
  readonly executable?: Portable.AnyBoundCode;
  /** Canonical semantic invalidation keys tracked by this query. */
  readonly reactivityKeys: ReadonlyArray<string>;
  /**
   * Execution semantics that are not represented on the wire. Snapshots are
   * emitted only when both are false, because retry/poll schedules cannot be
   * restored exactly on the client.
   */
  readonly semantics?: {
    readonly hasRetry: boolean;
    readonly hasPoll: boolean;
  };
}

/**
 * Read-only runtime capabilities published by a derived (computed) handle.
 *
 * Derived values are recomputed from their inputs on the client, so they are
 * never snapshotted directly; the descriptor exists so that inspection is
 * uniform across every setup handle kind.
 */
export interface DerivedHandleInspection<A> {
  readonly kind: "derived";
  readonly read: () => A;
  readonly isDisposed: () => boolean;
  /** Derived values are always recomputed, never restored from the wire. */
  readonly recomputed: true;
}

/**
 * Read-only runtime capabilities published by a component ref handle.
 *
 * Refs address host nodes and are therefore never portable: they always
 * inspect as host-bound and require client re-binding.
 */
export interface RefHandleInspection<T> {
  readonly kind: "ref";
  readonly read: () => T | null;
  readonly isDisposed: () => boolean;
  /** Refs point at host objects and can never be serialized. */
  readonly hostBound: true;
}

/**
 * Read-only runtime capabilities published by a component action handle.
 *
 * `executable` is present only for portable action bodies; opaque action
 * closures cannot be lazily reloaded and require fallback activation.
 */
export interface ActionHandleInspection<A = unknown, E = unknown> {
  readonly kind: "action";
  readonly isDisposed: () => boolean;
  readonly executable?: Portable.AnyBoundCode;
  /** Canonical semantic invalidation keys invalidated after success. */
  readonly reactivityKeys: ReadonlyArray<string>;
  readonly _A?: (_: never) => A;
  readonly _E?: (_: never) => E;
}

export type HandleInspection<A = unknown, E = unknown> =
  | StateHandleInspection<A>
  | QueryHandleInspection<A, E>
  | DerivedHandleInspection<A>
  | RefHandleInspection<A>
  | ActionHandleInspection<A, E>;

/** Handle kinds that publish a synchronous readable value. */
export type ReadableHandleInspection<A = unknown, E = unknown> =
  | StateHandleInspection<A>
  | QueryHandleInspection<A, E>
  | DerivedHandleInspection<A>
  | RefHandleInspection<A>;

export interface InspectableHandle<A = unknown, E = unknown> {
  readonly [HandleInspectionTypeId]: () => HandleInspection<A, E>;
}

export interface InspectableStateHandle<A = unknown>
  extends InspectableHandle<A, never>
{
  readonly [HandleKindTypeId]: "state";
}

export interface InspectableQueryHandle<A = unknown, E = unknown>
  extends InspectableHandle<A, E>
{
  readonly [HandleKindTypeId]: "query";
}

export interface InspectableDerivedHandle<A = unknown>
  extends InspectableHandle<A, never>
{
  readonly [HandleKindTypeId]: "derived";
}

export interface InspectableRefHandle<T = unknown>
  extends InspectableHandle<T, never>
{
  readonly [HandleKindTypeId]: "ref";
}

export interface InspectableActionHandle<A = unknown, E = unknown>
  extends InspectableHandle<A, E>
{
  readonly [HandleKindTypeId]: "action";
}

export const ControlledBindingTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Resume/ControlledBinding",
);

/**
 * Mark an adopted caller-owned atom as a CONTROLLED binding
 * (`Component.bindable`): the caller owns the value, so resume collection
 * must never snapshot it — "snapshot only for setup-owned state"
 * (`docs/kit-research/behaviors/controlled-uncontrolled.md`). Idempotent.
 */
export function markControlledBinding<T extends object>(value: T): T {
  if (!(ControlledBindingTypeId in value)) {
    Object.defineProperty(value, ControlledBindingTypeId, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true,
    });
  }
  return value;
}

/** Is this value a caller-owned controlled binding adopted by `bindable`? */
export function isControlledBinding(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function")
    && value !== null
    && (value as { readonly [ControlledBindingTypeId]?: unknown })[
        ControlledBindingTypeId
      ] === true
  );
}

/**
 * Is this value a live state handle — an annotated `Component.state` handle
 * or a writable atom (the framework's reactive primitives with hydration
 * identity)? Never true for the wire form a serialization reference
 * replaced: a hydration-key string is data, not a handle.
 */
export function isStateHandleValue(value: unknown): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  const kind = (value as { readonly [HandleKindTypeId]?: unknown })[HandleKindTypeId];
  if (kind === "state") return true;
  return Atom.isAtom(value) && Atom.isWritable(value as Atom.Atom<unknown>);
}

export function annotateHandle<Target extends object, A>(
  target: Target,
  inspection: StateHandleInspection<A>,
): Target & InspectableStateHandle<A>;
export function annotateHandle<Target extends object, A, E>(
  target: Target,
  inspection: QueryHandleInspection<A, E>,
): Target & InspectableQueryHandle<A, E>;
export function annotateHandle<Target extends object, A>(
  target: Target,
  inspection: DerivedHandleInspection<A>,
): Target & InspectableDerivedHandle<A>;
export function annotateHandle<Target extends object, T>(
  target: Target,
  inspection: RefHandleInspection<T>,
): Target & InspectableRefHandle<T>;
export function annotateHandle<Target extends object, A, E>(
  target: Target,
  inspection: ActionHandleInspection<A, E>,
): Target & InspectableActionHandle<A, E>;
export function annotateHandle<Target extends object, A, E = unknown>(
  target: Target,
  inspection: HandleInspection<A, E>,
): Target & InspectableHandle<A, E> {
  Object.defineProperty(target, HandleInspectionTypeId, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => inspection,
  });
  Object.defineProperty(target, HandleKindTypeId, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: inspection.kind,
  });
  return target as Target & InspectableHandle<A, E>;
}

export function inspectHandle<A>(
  value: InspectableStateHandle<A>,
): StateHandleInspection<A>;
export function inspectHandle<A, E>(
  value: InspectableQueryHandle<A, E>,
): QueryHandleInspection<A, E>;
export function inspectHandle<A>(
  value: InspectableDerivedHandle<A>,
): DerivedHandleInspection<A>;
export function inspectHandle<T>(
  value: InspectableRefHandle<T>,
): RefHandleInspection<T>;
export function inspectHandle<A, E>(
  value: InspectableActionHandle<A, E>,
): ActionHandleInspection<A, E>;
export function inspectHandle<A, E>(
  value: InspectableHandle<A, E>,
): HandleInspection<A, E>;
export function inspectHandle(value: unknown): HandleInspection | undefined;
export function inspectHandle(value: unknown): HandleInspection | undefined {
  if (
    (typeof value === "object" || typeof value === "function")
    && value !== null
    && HandleInspectionTypeId in value
  ) {
    return (value as InspectableHandle)[HandleInspectionTypeId]();
  }
  return undefined;
}
