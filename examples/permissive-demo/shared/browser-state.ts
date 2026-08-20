import type * as Resume from "effect-atom-jsx/Resume";

export interface PermissiveClick {
  readonly label: string;
  /** Whether the auto-captured Map arrived as a real Map, not a copy shape. */
  readonly isMap: boolean;
  readonly size: number;
  readonly sum: number;
}

export interface PermissiveDemoBrowserState {
  setupRuns: number;
  viewRuns: number;
  loaderCalls: number;
  clicks: PermissiveClick[];
  diagnostics: Resume.ClientDiagnostic[];
  serializerId: string;
  ready: boolean;
  disposed: boolean;
}

declare global {
  interface Window {
    __PERMISSIVE_TEST__: PermissiveDemoBrowserState;
    __PERMISSIVE_DISPOSE__?: () => Promise<void>;
  }
}

export function browserState(): PermissiveDemoBrowserState | undefined {
  return typeof window === "undefined" ? undefined : window.__PERMISSIVE_TEST__;
}

/**
 * Create the test-state object from module code. An inline `<script>` would
 * be the natural place, but this page runs under `script-src 'self'` with no
 * `unsafe-inline` — the point of the CSP proof is that resumability needs no
 * inline execution at all.
 */
export function initBrowserState(): PermissiveDemoBrowserState {
  const state: PermissiveDemoBrowserState = {
    setupRuns: 0,
    viewRuns: 0,
    loaderCalls: 0,
    clicks: [],
    diagnostics: [],
    serializerId: "",
    ready: false,
    disposed: false,
  };
  window.__PERMISSIVE_TEST__ = state;
  return state;
}
