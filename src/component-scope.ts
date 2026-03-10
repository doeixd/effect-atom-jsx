import { Effect, Exit, Scope } from "effect";
import { contextMap, createContext, getOwner, onCleanup, useContext } from "./api.js";

export const ComponentScopeContext = createContext<Scope.Closeable | null>(null);

export function currentComponentScope(): Scope.Closeable | null {
  return useContext(ComponentScopeContext);
}

export function withComponentScope<T>(scope: Scope.Closeable | null, fn: () => T): T {
  if (scope === null) return fn();
  const owner = getOwner();
  if (owner === null) return fn();

  let map = contextMap.get(owner);
  if (!map) {
    map = new Map();
    contextMap.set(owner, map);
  }

  const key = ComponentScopeContext.id;
  const hadPrevious = map.has(key);
  const previous = map.get(key);
  map.set(key, scope);
  try {
    return fn();
  } finally {
    if (hadPrevious) {
      map.set(key, previous);
    } else {
      map.delete(key);
    }
  }
}

export function forkComponentScope(parent: Scope.Closeable | null): Scope.Closeable | null {
  if (parent === null) return null;
  return Scope.forkUnsafe(parent);
}

export function closeComponentScope(scope: Scope.Closeable | null): void {
  if (scope === null) return;
  Effect.runFork(Scope.close(scope, Exit.void));
}

export function bindScopeCleanup(scope: Scope.Closeable | null): void {
  if (scope === null) return;
  onCleanup(() => closeComponentScope(scope));
}
