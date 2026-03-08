/**
 * owner.ts — Ownership tree for structured cleanup.
 *
 * Every reactive computation is owned by an Owner. When an Owner is
 * disposed it recursively disposes all its children and runs registered
 * cleanup callbacks, then un-registers itself from its parent.
 *
 * This mirrors Solid's createRoot / Owner model and maps naturally onto
 * Effect's Scope concept (see effect-ts.ts for that bridge).
 */

export type CleanupFn = () => void;

export class Owner {
  private _children: Set<Owner> = new Set();
  private _cleanups: CleanupFn[] = [];
  private _parent: Owner | null;
  private _disposed = false;

  constructor(parent: Owner | null = null) {
    this._parent = parent;
    parent?._children.add(this);
  }

  addCleanup(fn: CleanupFn): void {
    if (this._disposed) {
      // Already disposed — run immediately so we don't leak.
      fn();
      return;
    }
    this._cleanups.push(fn);
  }

  addChild(child: Owner): void {
    this._children.add(child);
  }

  removeChild(child: Owner): void {
    this._children.delete(child);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Dispose children first (depth-first, inner-to-outer).
    for (const child of this._children) {
      child.dispose();
    }
    this._children.clear();

    // Run cleanups in reverse registration order.
    for (let i = this._cleanups.length - 1; i >= 0; i--) {
      try {
        this._cleanups[i]();
      } catch (e) {
        console.error("[effect-atom-jsx] Error in cleanup:", e);
      }
    }
    this._cleanups = [];

    this._parent?.removeChild(this);
    this._parent = null;
  }

  get disposed(): boolean {
    return this._disposed;
  }
}

/** The currently active owner (set while a root/effect/component runs). */
let currentOwner: Owner | null = null;

export function getOwner(): Owner | null {
  return currentOwner;
}

export function setOwner(owner: Owner | null): Owner | null {
  const prev = currentOwner;
  currentOwner = owner;
  return prev;
}

/** Run `fn` under the given `owner`, restoring the previous owner after. */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const prev = setOwner(owner);
  try {
    return fn();
  } finally {
    setOwner(prev);
  }
}
