import type * as Resume from "effect-atom-jsx/Resume";

export interface ResumableExtractBrowserState {
  /** Client-side imports of the transformed application module. */
  appImports: number;
  /** Resolver loader invocations for the generated code entry. */
  loaderCalls: number;
  setupRuns: number;
  viewRuns: number;
  parentSetupRuns: number;
  parentViewRuns: number;
  siblingSetupRuns: number;
  siblingViewRuns: number;
  eagerSetupRuns: number;
  eagerViewRuns: number;
  eagerNodeReused: boolean | undefined;
  eagerRenderedText: string;
  eagerComparator: "dom-hydration" | "eager-rerender" | undefined;
  notes: string[];
  diagnostics: Resume.ClientDiagnostic[];
  ready: boolean;
  disposed: boolean;
}

declare global {
  interface Window {
    __EXTRACT_TEST__: ResumableExtractBrowserState;
    __EXTRACT_DISPOSE__?: () => Promise<void>;
    __EXTRACT_WRITE__?: (count: number) => Promise<void>;
  }
}

export function browserState(): ResumableExtractBrowserState | undefined {
  return typeof window === "undefined" ? undefined : window.__EXTRACT_TEST__;
}
