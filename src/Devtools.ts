/**
 * Devtools — registry snapshots, invalidation/action timeline, slot-contract
 * tree helpers, and a minimal MCP-style control surface for AI agents.
 */
import * as Atom from "./Atom.js";
import * as Registry from "./Registry.js";
import type * as View from "./View.js";

export type TimelinePhase = "start" | "success" | "failure" | "defect" | "invalidate" | "snapshot";

export interface TimelineEvent {
  readonly id: number;
  readonly at: number;
  readonly kind: "action" | "query" | "invalidate" | "snapshot" | "other";
  readonly name?: string;
  readonly phase: TimelinePhase;
  readonly details?: unknown;
}

export interface AtomSnapshotEntry {
  readonly name?: string;
  readonly value: unknown;
}

export interface DevtoolsState {
  readonly events: readonly TimelineEvent[];
  readonly snapshots: readonly { readonly at: number; readonly atoms: readonly AtomSnapshotEntry[] }[];
  readonly excludeFromHistory: ReadonlySet<string>;
  readonly keyframeInterval: number;
}

export interface DevtoolsSession {
  readonly record: (event: Omit<TimelineEvent, "id" | "at"> & { readonly at?: number }) => TimelineEvent;
  readonly timeline: () => readonly TimelineEvent[];
  readonly snapshotAtoms: (entries: readonly AtomSnapshotEntry[]) => void;
  readonly snapshots: () => DevtoolsState["snapshots"];
  readonly excludeFromHistory: (name: string) => void;
  readonly setKeyframeInterval: (n: number) => void;
  readonly clear: () => void;
  /** MCP-style read API for agents. */
  readonly mcp: {
    readonly readTimeline: () => readonly TimelineEvent[];
    readonly readSnapshots: () => DevtoolsState["snapshots"];
    readonly rewindTo: (eventId: number) => readonly TimelineEvent[];
    readonly dispatchNamed: (name: string, run: () => void) => TimelineEvent;
  };
}

let nextId = 1;

export function createSession(options?: {
  readonly keyframeInterval?: number;
}): DevtoolsSession {
  const events: TimelineEvent[] = [];
  const snapshots: Array<{ readonly at: number; readonly atoms: readonly AtomSnapshotEntry[] }> = [];
  const excludeFromHistory = new Set<string>();
  let keyframeInterval = options?.keyframeInterval ?? 50;

  const record: DevtoolsSession["record"] = (event) => {
    if (event.name !== undefined && excludeFromHistory.has(event.name)) {
      return {
        id: -1,
        at: event.at ?? Date.now(),
        kind: event.kind,
        name: event.name,
        phase: event.phase,
        details: event.details,
      };
    }
    const entry: TimelineEvent = {
      id: nextId++,
      at: event.at ?? Date.now(),
      kind: event.kind,
      name: event.name,
      phase: event.phase,
      details: event.details,
    };
    events.push(entry);
    if (keyframeInterval > 0 && events.length % keyframeInterval === 0) {
      snapshots.push({ at: entry.at, atoms: [] });
    }
    return entry;
  };

  const session: DevtoolsSession = {
    record,
    timeline: () => events.slice(),
    snapshotAtoms(entries) {
      snapshots.push({ at: Date.now(), atoms: entries });
      record({ kind: "snapshot", phase: "snapshot", details: { count: entries.length } });
    },
    snapshots: () => snapshots.slice(),
    excludeFromHistory(name) {
      excludeFromHistory.add(name);
    },
    setKeyframeInterval(n) {
      keyframeInterval = Math.max(0, n);
    },
    clear() {
      events.length = 0;
      snapshots.length = 0;
    },
    mcp: {
      readTimeline: () => events.slice(),
      readSnapshots: () => snapshots.slice(),
      rewindTo(eventId) {
        const idx = events.findIndex((e) => e.id === eventId);
        if (idx < 0) return events.slice();
        events.length = idx + 1;
        return events.slice();
      },
      dispatchNamed(name, run) {
        record({ kind: "action", name, phase: "start" });
        try {
          run();
          return record({ kind: "action", name, phase: "success" });
        } catch (error) {
          return record({ kind: "action", name, phase: "failure", details: error });
        }
      },
    },
  };

  return session;
}

/** Snapshot callable/writable atoms by optional labels (values via Registry or direct get). */
export function snapshotRegistry(
  registry: Registry.Registry,
  atoms: ReadonlyArray<{ readonly name?: string; readonly atom: Atom.Atom<any> }>,
): readonly AtomSnapshotEntry[] {
  return atoms.map(({ name, atom }) => ({
    name,
    value: registry.get(atom),
  }));
}

/** Capture a slot-contract tree description from View metadata for the panel. */
export function slotContractTree(view: View.View<any>): {
  readonly name?: string;
  readonly slots: readonly string[];
  readonly metadata: Record<string, unknown>;
} {
  const slots = view.slots as Record<string, unknown>;
  return {
    name: view.name,
    slots: Object.keys(slots),
    metadata: (view.slotMetadata ?? {}) as Record<string, unknown>,
  };
}

/** Wrap observe-style callbacks so operation `name` is load-bearing on the timeline. */
export function observeToTimeline(
  session: DevtoolsSession,
  event: {
    readonly kind: "action" | "query";
    readonly name?: string;
    readonly phase: TimelinePhase;
    readonly startedAt?: number;
    readonly finishedAt?: number;
    readonly durationMs?: number;
  },
): void {
  session.record({
    kind: event.kind,
    name: event.name ?? "<unnamed>",
    phase: event.phase,
    details: {
      startedAt: event.startedAt,
      finishedAt: event.finishedAt,
      durationMs: event.durationMs,
      named: event.name !== undefined && event.name.length > 0,
    },
  });
}

export const Devtools = {
  createSession,
  snapshotRegistry,
  slotContractTree,
  observeToTimeline,
} as const;
