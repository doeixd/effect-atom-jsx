import type * as Resume from "effect-atom-jsx/Resume";
import type {
  BenchmarkDensity,
  BenchmarkMode,
} from "./build.js";

export interface BenchmarkOwnership {
  readonly boundaryControllers: number;
  readonly expressionControllers: number;
  readonly expressionDependencyKeys: number;
  readonly expressionSubscriptions: number;
  readonly pendingFibers: number;
}

export interface BenchmarkBrowserState {
  readonly mode: BenchmarkMode;
  readonly density: BenchmarkDensity;
  readonly navigationStartedAt: number;
  ready: boolean;
  readyAt?: number;
  appImports: number;
  loaderCalls: number;
  loaderStartedAt?: number;
  loaderResolvedAt?: number;
  setupRuns: number;
  viewRuns: number;
  componentResources: number;
  componentDisposals: number;
  startupNodeReused?: boolean;
  patches: number;
  lastPatchAt?: number;
  disposed: boolean;
  diagnostics: Resume.ClientDiagnostic[];
  ownershipBeforeUse?: BenchmarkOwnership;
  ownershipAfterDispose?: BenchmarkOwnership;
}

export interface BenchmarkPayload {
  readonly manifestUtf8Bytes: number;
  readonly markerUtf8Bytes: number;
  readonly combinedRawBytes: number;
  readonly combinedGzipBytes: number;
}

declare global {
  interface Window {
    __AF_BENCHMARK__: BenchmarkBrowserState;
    __AF_BENCHMARK_PAYLOAD__: BenchmarkPayload;
    __AF_BENCHMARK_WRITE_SHARED__?: (value: number) => Promise<void>;
    __AF_BENCHMARK_WRITE_INDEPENDENT__?: (
      index: number,
      value: number,
    ) => Promise<void>;
    __AF_BENCHMARK_INSPECT__?: () => BenchmarkOwnership;
    __AF_BENCHMARK_DISPOSE__?: () => Promise<void>;
  }
}

export function browserState(): BenchmarkBrowserState | undefined {
  return typeof window === "undefined"
    ? undefined
    : window.__AF_BENCHMARK__;
}
