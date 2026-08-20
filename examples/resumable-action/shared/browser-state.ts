import type * as Resume from "effect-atom-jsx/Resume";

export type BrowserBoundaryState =
  | { readonly status: "dormant" }
  | { readonly status: "resuming" }
  | { readonly status: "activating" }
  | { readonly status: "active" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "disposed" };

export interface ResumableActionBrowserState {
  actionImports: number;
  componentImports: number;
  loaderCalls: number;
  componentLoaderCalls: number;
  setupRuns: number;
  viewRuns: number;
  componentResources: number;
  componentDisposals: number;
  saves: string[];
  diagnostics: Resume.ClientDiagnostic[];
  ready: boolean;
  disposed: boolean;
}

declare global {
  interface Window {
    __RESUME_TEST__: ResumableActionBrowserState;
    __RESUME_DISPOSE__?: () => Promise<void>;
    __RESUME_ACTIVATE__?: (componentId?: string) => Promise<void>;
    __RESUME_RESUME__?: (componentId?: string) => Promise<void>;
    __RESUME_BOUNDARY_STATE__?: (
      componentId?: string,
    ) => BrowserBoundaryState | undefined;
  }
}

export function browserState(): ResumableActionBrowserState | undefined {
  return typeof window === "undefined" ? undefined : window.__RESUME_TEST__;
}
