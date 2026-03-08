/**
 * tracking.ts — Global synchronous dependency tracking context.
 *
 * This is the beating heart of the reactive system. A single global
 * `currentObserver` pointer is set whenever a Computation is executing.
 * Any Signal read during that window registers itself as a dependency
 * of the running Computation — the same approach used by Solid, Vue, and MobX.
 */

export interface IComputation {
  /** Called by a Signal when it learns the computation depends on it. */
  addDependency(signal: ISignal<unknown>): void;
  /** Called by a Signal when its value has changed. */
  invalidate(): void;
}

export interface ISignal<T> {
  /** Remove a subscriber (called when a computation re-runs and re-collects deps). */
  removeSubscriber(computation: IComputation): void;
}

/** The computation that is currently executing (null when outside a reactive context). */
let currentObserver: IComputation | null = null;

export function getObserver(): IComputation | null {
  return currentObserver;
}

export function setObserver(obs: IComputation | null): IComputation | null {
  const prev = currentObserver;
  currentObserver = obs;
  return prev;
}

/** Run `fn` without tracking. Any signal reads inside will not register deps. */
export function runUntracked<T>(fn: () => T): T {
  const prev = setObserver(null);
  try {
    return fn();
  } finally {
    setObserver(prev);
  }
}

/**
 * Batch flag. When > 0, Signal writes are queued rather than immediately
 * propagated. Flushes when the outermost batch exits.
 */
let batchDepth = 0;
const batchQueue: Set<IComputation> = new Set();

export function isBatching(): boolean {
  return batchDepth > 0;
}

export function enqueueComputation(comp: IComputation): void {
  batchQueue.add(comp);
}

export function runBatch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      // Flush — snapshot so re-entrant writes queue into next flush.
      const toRun = [...batchQueue];
      batchQueue.clear();
      for (const comp of toRun) {
        comp.invalidate();
      }
    }
  }
}
