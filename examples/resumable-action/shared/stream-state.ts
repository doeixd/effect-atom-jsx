import type * as Resume from "effect-atom-jsx/Resume";

/** Probe state for the streaming + fragment proof page (`streaming.html`). */
export interface StreamingBrowserState {
  saves: string[];
  diagnostics: Resume.ClientDiagnostic[];
  loaderCalls: number;
  ready: boolean;
  firstFragmentDisposed: boolean;
}

declare global {
  interface Window {
    __STREAM_TEST__: StreamingBrowserState;
    __STREAM_REMOUNT__?: () => Promise<void>;
    __STREAM_END__?: () => Promise<void>;
  }
}

export function streamingBrowserState(): StreamingBrowserState | undefined {
  return typeof window === "undefined" ? undefined : window.__STREAM_TEST__;
}
