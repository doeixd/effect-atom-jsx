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
