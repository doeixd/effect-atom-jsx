import { Schema } from "effect";
import type * as Atom from "./Atom.js";
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

export type AnyBindingSnapshotPolicy =
  | AnyStateSnapshotPolicy
  | AnyQuerySnapshotPolicy;

/** Resume policy accepted for a named setup binding in the current slice. */
export type BindingResumePolicy<Binding> =
  Binding extends Atom.WritableAtom<infer A> ? StateSnapshotPolicy<A, any>
    : Binding extends Atom.ReadonlyAtom<Result<infer A, any>, any>
      ? QuerySnapshotPolicy<A, any>
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

export type HandleInspection<A = unknown, E = unknown> =
  | StateHandleInspection<A>
  | QueryHandleInspection<A, E>;

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

export function annotateHandle<Target extends object, A>(
  target: Target,
  inspection: StateHandleInspection<A>,
): Target & InspectableStateHandle<A>;
export function annotateHandle<Target extends object, A, E>(
  target: Target,
  inspection: QueryHandleInspection<A, E>,
): Target & InspectableQueryHandle<A, E>;
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
