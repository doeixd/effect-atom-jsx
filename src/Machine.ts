/**
 * Affe machine adapter over `@typeonce/effect-machine`.
 *
 * Author machines with effect-machine (`defineStates` / `make` / `handle`).
 * Spawn them into Affe setup/behaviors with `spawn` so state is a resumable
 * `Component.state` atom, listeners reattach in fresh scopes, and dispose is
 * exact-once. Do **not** use their AtomMachine — Affe atoms own the bridge.
 */

import { Machine as EffectMachine } from "@typeonce/effect-machine";
import { Effect, Schema, Scope, Stream } from "effect";
import * as Component from "./Component.js";
import {
  snapshotState as makeStateSnapshotPolicy,
  type StateSnapshotPolicy,
} from "./resume-handle.js";

// ─── Re-export authoring / engine surface ────────────────────────────────────
// Explicit `any` on re-exports keeps our .d.ts portable: effect-machine
// declaration emit references private type names (ValidateStateTree,
// MachineRuntime) that TypeScript cannot re-name from this package.

/** @see `@typeonce/effect-machine` `Machine.defineStates` */
export const defineStates: any = EffectMachine.defineStates;
/** @see `@typeonce/effect-machine` `Machine.make` */
export const make: any = EffectMachine.make;
/** @see `@typeonce/effect-machine` `Machine.isMachine` */
export const isMachine: any = EffectMachine.isMachine;
/** @see `@typeonce/effect-machine` `Machine.start` */
export const start: any = EffectMachine.start;
/** @see `@typeonce/effect-machine` `Machine.encodeSnapshot` */
export const encodeSnapshot: any = EffectMachine.encodeSnapshot;
/** @see `@typeonce/effect-machine` `Machine.decodeSnapshot` */
export const decodeSnapshot: any = EffectMachine.decodeSnapshot;
/** @see `@typeonce/effect-machine` `Machine.isFinal` */
export const isFinal: any = EffectMachine.isFinal;
/** @see `@typeonce/effect-machine` `Machine.isInitialEvent` */
export const isInitialEvent: any = EffectMachine.isInitialEvent;
export const InitialEvent = EffectMachine.InitialEvent;
export const InitialEventTypeId = EffectMachine.InitialEventTypeId;
export const TypeId = EffectMachine.TypeId;

export const StoppedError = EffectMachine.StoppedError;
export const StartupError = EffectMachine.StartupError;
export const InfiniteTransitionError = EffectMachine.InfiniteTransitionError;
export const MachineSchemaDecodeError = EffectMachine.MachineSchemaDecodeError;
export const MachineSchemaEncodeError = EffectMachine.MachineSchemaEncodeError;
export const ChildAlreadyExistsError = EffectMachine.ChildAlreadyExistsError;
export const ProcessLocalError = EffectMachine.ProcessLocalError;

export type MachineRef<State, Event, Error = never, Output = never> =
  EffectMachine.MachineRef<State, Event, Error, Output>;
export type RuntimeSnapshot<State, Error = never, Output = never> =
  EffectMachine.RuntimeSnapshot<State, Error, Output>;
export type EncodedSnapshot = EffectMachine.Machine.EncodedSnapshot;
export type AnyMachine = EffectMachine.Machine.Any;

// ─── Encoded snapshot schema (JSON-safe wire / Component.state payload) ───────

const EncodedActiveState = Schema.Struct({
  path: Schema.String,
  value: Schema.Unknown,
});

const EncodedCompletion = Schema.Struct({
  path: Schema.String,
  output: Schema.optionalKey(Schema.Unknown),
});

/**
 * Schema for effect-machine's normalized wire snapshot.
 *
 * Use with `Resume.snapshotState(Machine.EncodedSnapshotSchema)` on the
 * `state` atom returned by `spawn`.
 */
export const EncodedSnapshotSchema = Schema.Struct({
  _tag: Schema.Literal("MachineSnapshot"),
  active: Schema.Array(EncodedActiveState),
  completed: Schema.optionalKey(Schema.Array(EncodedCompletion)),
});

export type EncodedSnapshotValue = typeof EncodedSnapshotSchema.Type;

/** Resume policy for a spawned machine's encoded-state atom. */
export function snapshotPolicy(): StateSnapshotPolicy<
  EncodedSnapshotValue,
  EncodedSnapshotValue
> {
  return makeStateSnapshotPolicy(EncodedSnapshotSchema);
}

// ─── Spawn handle ────────────────────────────────────────────────────────────

/**
 * Affe-facing handle for one running machine instance.
 *
 * `state` holds the **encoded** snapshot so SSR/resume and styles never depend
 * on Schema class identity. Use `matches` for path checks (Radix `data-state`).
 */
export interface SpawnedMachine<Event = unknown, Error = never> {
  readonly id: string;
  readonly sessionId: string;
  /** Encoded, JSON-safe machine snapshot (Component.state + resume). */
  readonly state: Component.StateAtom<EncodedSnapshotValue>;
  /** Fire-and-forget send; runs under the spawn-time Effect context. */
  readonly send: (event: Event) => void;
  /** Composable send. */
  readonly sendEffect: (
    event: Event,
  ) => Effect.Effect<void, Error | InstanceType<typeof StoppedError>>;
  /** True when `path` is an active configuration path (exact or prefix). */
  readonly matches: (path: string) => boolean;
  /** Active leaf path, if any. */
  readonly path: () => string | undefined;
  /** Active leaf encoded value, if any. */
  readonly value: () => unknown;
  /** Stop the machine (also runs on Scope close; idempotent). */
  readonly stop: Effect.Effect<void>;
}

export interface SpawnOptions {
  /**
   * Restore from a previous encoded or decoded snapshot instead of the
   * machine's authored `initial`. Used for resumability.
   */
  readonly snapshot?: EncodedSnapshotValue | unknown;
}

type AnyMachineRef = EffectMachine.MachineRef<any, any, any, any>;

function isEncodedSnapshot(value: unknown): value is EncodedSnapshotValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly _tag?: unknown })._tag === "MachineSnapshot" &&
    Array.isArray((value as { readonly active?: unknown }).active)
  );
}

function withInitialSnapshot(
  machine: AnyMachine,
  snapshot: unknown,
): AnyMachine {
  return {
    ...machine,
    initial: () => snapshot,
  } as AnyMachine;
}

function activePaths(encoded: EncodedSnapshotValue): ReadonlyArray<string> {
  return encoded.active.map((entry) => entry.path);
}

function matchesPath(encoded: EncodedSnapshotValue, path: string): boolean {
  return activePaths(encoded).some(
    (active) => active === path || active.startsWith(`${path}.`),
  );
}

function leafPath(encoded: EncodedSnapshotValue): string | undefined {
  const paths = activePaths(encoded);
  if (paths.length === 0) return undefined;
  return paths.reduce((best, next) => (next.length >= best.length ? next : best));
}

function leafValue(encoded: EncodedSnapshotValue): unknown {
  const path = leafPath(encoded);
  if (path === undefined) return undefined;
  return encoded.active.find((entry) => entry.path === path)?.value;
}

/**
 * Start a machine in the current Scope and mirror its state into a
 * Component.state atom as an encoded snapshot.
 *
 * Requires `Scope` so the running process and change fiber dispose exactly
 * once when the setup/behavior scope closes.
 */
export function spawn<Event = unknown, Error = never>(
  machine: AnyMachine,
  options?: SpawnOptions,
): Effect.Effect<SpawnedMachine<Event, Error>, unknown, Scope.Scope> {
  return Effect.gen(function* () {
    let definition: AnyMachine = machine;

    if (options?.snapshot !== undefined) {
      const decoded = isEncodedSnapshot(options.snapshot)
        ? yield* (EffectMachine.decodeSnapshot(machine as any, options.snapshot) as Effect.Effect<
          unknown,
          unknown
        >)
        : options.snapshot;
      definition = withInitialSnapshot(machine, decoded);
    }

    const ref = (yield* (EffectMachine.start(definition as any) as Effect.Effect<
      AnyMachineRef,
      unknown
    >)) as AnyMachineRef;
    const initialDecoded = yield* ref.state;
    const initialEncoded = (yield* (EffectMachine.encodeSnapshot(
      definition as any,
      initialDecoded as any,
    ) as Effect.Effect<EncodedSnapshotValue, unknown>)) as EncodedSnapshotValue;

    const state = yield* Component.state<EncodedSnapshotValue>(
      Schema.decodeUnknownSync(EncodedSnapshotSchema)(initialEncoded),
    );

    const services = yield* Effect.context();
    let stopped = false;

    const stopOnce: Effect.Effect<void> = Effect.suspend(() => {
      if (stopped) return Effect.void;
      stopped = true;
      return ref.stop as Effect.Effect<void>;
    });

    yield* Scope.addFinalizer(yield* Effect.service(Scope.Scope), stopOnce);

    yield* Stream.runForEach(ref.changes, (runtime) =>
      Effect.gen(function* () {
        if (
          runtime.status === "active" ||
          runtime.status === "done" ||
          runtime.status === "error" ||
          runtime.status === "stopped"
        ) {
          const encoded = (yield* (EffectMachine.encodeSnapshot(
            definition as any,
            runtime.state as any,
          ) as Effect.Effect<EncodedSnapshotValue, unknown>)) as EncodedSnapshotValue;
          if (!stopped) {
            state.set(Schema.decodeUnknownSync(EncodedSnapshotSchema)(encoded));
          }
        }
      }).pipe(Effect.catchCause(() => Effect.void)),
    ).pipe(Effect.forkScoped, Effect.asVoid);

    const sendEffect = (
      event: Event,
    ): Effect.Effect<void, Error | InstanceType<typeof StoppedError>> =>
      ref.send(event as any) as Effect.Effect<
        void,
        Error | InstanceType<typeof StoppedError>
      >;

    const handle: SpawnedMachine<Event, Error> = {
      id: ref.id,
      sessionId: ref.sessionId,
      state,
      send: (event) => {
        if (stopped) return;
        Effect.runForkWith(services)(
          sendEffect(event).pipe(Effect.catchCause(() => Effect.void)),
        );
      },
      sendEffect: (event) =>
        Effect.suspend(() => {
          if (stopped) {
            return Effect.fail(new (StoppedError as any)()) as Effect.Effect<
              void,
              Error | InstanceType<typeof StoppedError>
            >;
          }
          return sendEffect(event);
        }),
      matches: (path) => matchesPath(state(), path),
      path: () => leafPath(state()),
      value: () => leafValue(state()),
      stop: stopOnce,
    };

    return handle;
  }) as Effect.Effect<SpawnedMachine<Event, Error>, unknown, Scope.Scope>;
}

/** Encode a live decoded snapshot through the machine's schemas. */
export function encodeState(
  machine: AnyMachine,
  snapshot: unknown,
): Effect.Effect<EncodedSnapshotValue, unknown> {
  return EffectMachine.encodeSnapshot(machine as any, snapshot as any) as Effect.Effect<
    EncodedSnapshotValue,
    unknown
  >;
}

/** Decode a wire snapshot through the machine's schemas. */
export function decodeState(
  machine: AnyMachine,
  encoded: unknown,
): Effect.Effect<unknown, unknown> {
  return EffectMachine.decodeSnapshot(machine as any, encoded) as Effect.Effect<
    unknown,
    unknown
  >;
}

export const Machine: {
  readonly TypeId: typeof TypeId;
  readonly defineStates: any;
  readonly make: any;
  readonly isMachine: any;
  readonly start: any;
  readonly spawn: typeof spawn;
  readonly encodeSnapshot: any;
  readonly decodeSnapshot: any;
  readonly encodeState: typeof encodeState;
  readonly decodeState: typeof decodeState;
  readonly EncodedSnapshotSchema: typeof EncodedSnapshotSchema;
  readonly snapshotPolicy: typeof snapshotPolicy;
  readonly isFinal: any;
  readonly isInitialEvent: any;
  readonly InitialEvent: typeof InitialEvent;
  readonly InitialEventTypeId: typeof InitialEventTypeId;
  readonly StoppedError: typeof StoppedError;
  readonly StartupError: typeof StartupError;
  readonly InfiniteTransitionError: typeof InfiniteTransitionError;
  readonly MachineSchemaDecodeError: typeof MachineSchemaDecodeError;
  readonly MachineSchemaEncodeError: typeof MachineSchemaEncodeError;
  readonly ChildAlreadyExistsError: typeof ChildAlreadyExistsError;
  readonly ProcessLocalError: typeof ProcessLocalError;
} = {
  TypeId,
  defineStates,
  make,
  isMachine,
  start,
  spawn,
  encodeSnapshot,
  decodeSnapshot,
  encodeState,
  decodeState,
  EncodedSnapshotSchema,
  snapshotPolicy,
  isFinal,
  isInitialEvent,
  InitialEvent,
  InitialEventTypeId,
  StoppedError,
  StartupError,
  InfiniteTransitionError,
  MachineSchemaDecodeError,
  MachineSchemaEncodeError,
  ChildAlreadyExistsError,
  ProcessLocalError,
};
