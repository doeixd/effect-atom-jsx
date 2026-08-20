import type * as Resume from "effect-atom-jsx/Resume";

export type AttributionDensity = 0 | 1 | 24;
export type AttributionStage =
  | "modules"
  | "runtime"
  | "serialization"
  | "json"
  | "guard"
  | "schema"
  | "manifest"
  | "runtime-manifest"
  | "resolver"
  | "scans"
  | "installed";

export interface AttributionBrowserState {
  readonly density: AttributionDensity;
  readonly stage: AttributionStage;
  ready: boolean;
  readyAt?: number;
  disposed: boolean;
  diagnostics: Resume.ClientDiagnostic[];
  boundaryCount?: number;
  expressionCount?: number;
  installation?: Resume.ClientInstallationInspection;
  afterDispose?: Resume.ClientInstallationInspection;
}

declare global {
  interface Window {
    __AF_ATTRIBUTION__: AttributionBrowserState;
    __AF_ATTRIBUTION_DISPOSE__?: () => Promise<void>;
  }
}
