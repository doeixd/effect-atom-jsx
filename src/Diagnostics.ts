import { Effect, Layer, ServiceMap } from "effect";
import * as Behavior from "./Behavior.js";
import * as Component from "./Component.js";
import * as Element from "./Element.js";
import * as Route from "./Route.js";
import * as ServerRoute from "./ServerRoute.js";
import * as Style from "./Style.js";
import * as View from "./View.js";

/** Severity levels used by all AF-UI diagnostic producers. */
export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticSource =
  | "view"
  | "component"
  | "style"
  | "behavior"
  | "a11y"
  | "route"
  | "server-route";

/**
 * Structured diagnostic emitted by validators, doctor targets, and opt-in
 * development reporting.
 *
 * `source` identifies the subsystem that surfaced the issue. `code` keeps the
 * precise validator code, which may still reference the lower-level subsystem
 * that detected the condition.
 */
export interface Diagnostic {
  readonly source: DiagnosticSource;
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly slot?: string;
  readonly component?: string;
  readonly platform?: string;
  readonly property?: string;
  readonly event?: string;
  readonly route?: string;
  readonly details?: unknown;
}

/** Receives diagnostics from an opt-in diagnostics layer. */
export interface Reporter {
  report(diagnostic: Diagnostic): void;
  reportAll(diagnostics: readonly Diagnostic[]): void;
}

/** Effect service used to report diagnostics during render/mount. */
export interface ReporterService {
  readonly reporter: Reporter;
}

export const ReporterTag = ServiceMap.Service<ReporterService>("DiagnosticsReporter");

/**
 * Create a diagnostic reporter.
 *
 * Reporters dedupe by `(source, code, message, slot)` by default so render-time
 * validation does not spam repeated messages during reactive updates.
 */
export function reporter(
  onDiagnostic: (diagnostic: Diagnostic) => void,
  options?: {
    readonly dedupe?: boolean;
  },
): Reporter {
  const seen = new Set<string>();
  const shouldDedupe = options?.dedupe ?? true;
  return {
    report(diagnostic) {
      const key = `${diagnostic.source}\u0000${diagnostic.code}\u0000${diagnostic.message}\u0000${diagnostic.slot ?? ""}`;
      if (shouldDedupe && seen.has(key)) return;
      seen.add(key);
      onDiagnostic(diagnostic);
    },
    reportAll(diagnostics) {
      for (const diagnostic of diagnostics) {
        this.report(diagnostic);
      }
    },
  };
}

/**
 * Create a diagnostics reporter layer.
 *
 * Provide this layer around component render/mount tests or dev builds to
 * collect auto-reported diagnostics. Without this layer, production rendering
 * remains explicit-only.
 */
export function layer(
  onDiagnostic: (diagnostic: Diagnostic) => void,
  options?: {
    readonly dedupe?: boolean;
  },
): Layer.Layer<ReporterService> {
  return Layer.succeed(ReporterTag, { reporter: reporter(onDiagnostic, options) });
}

/**
 * Opt-in dev-mode diagnostics layer. When this service is present in the
 * composition root, component render/mount auto-runs slot-contract and view
 * validators and reports through the shared reporter (deduped by default).
 *
 * Production stays explicit-only: omit this layer and nothing auto-runs.
 *
 * @example
 * const AppLayer = Layer.mergeAll(
 *   Diagnostics.devLayer(),
 *   Reactivity.live,
 *   // ...
 * );
 * Component.mount(App, { props: {}, layer: AppLayer, target });
 */
export function devLayer(
  options?: {
    readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
    readonly dedupe?: boolean;
    readonly console?: boolean;
  },
): Layer.Layer<ReporterService> {
  const useConsole = options?.console ?? true;
  return layer((diagnostic) => {
    options?.onDiagnostic?.(diagnostic);
    if (useConsole) {
      const line = format(diagnostic);
      if (diagnostic.severity === "error") console.error(line);
      else if (diagnostic.severity === "warning") console.warn(line);
      else console.info(line);
    }
  }, { dedupe: options?.dedupe });
}

/** Report diagnostics through the current `ReporterService`. */
export function report(diagnostics: readonly Diagnostic[]): Effect.Effect<readonly Diagnostic[], never, ReporterService> {
  return Effect.gen(function* () {
    const service = yield* ReporterTag;
    service.reporter.reportAll(diagnostics);
    return diagnostics;
  });
}

/** Summary produced by `doctor` and the `af-ui doctor` CLI. */
export interface DoctorReport {
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
}

/** Named export inspected by doctor collection. */
export interface DoctorTarget {
  readonly name: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** Summarize a set of diagnostics into release/CI-friendly counts. */
export function doctor(diagnostics: readonly Diagnostic[]): DoctorReport {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errorCount += 1;
    else if (diagnostic.severity === "warning") warningCount += 1;
    else infoCount += 1;
  }
  return {
    diagnostics,
    ok: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
  };
}

/** Format all diagnostics in a doctor report as one newline-separated string. */
export function formatReport(report: DoctorReport): string {
  if (report.diagnostics.length === 0) return "No diagnostics.";
  return report.diagnostics.map(format).join("\n");
}

/** Options for converting subsystem-specific validation output to `Diagnostic`. */
export interface NormalizeOptions {
  readonly source?: DiagnosticSource;
  readonly severity?: DiagnosticSeverity;
}

function sourceOfCode(code: string): DiagnosticSource {
  const prefix = code.split(":")[0];
  switch (prefix) {
    case "view":
      return "view";
    case "component":
      return "component";
    case "style":
      return "style";
    case "behavior":
      return "behavior";
    case "a11y":
      return "a11y";
    case "route":
      return "route";
    case "server-route":
      return "server-route";
    default:
      return "view";
  }
}

/**
 * Normalize subsystem-specific diagnostic objects into the shared shape.
 *
 * Any extra fields remain available under `details` while common fields such
 * as `slot`, `platform`, `property`, and `event` are lifted for tooling.
 */
export function normalize(
  diagnostic: { readonly code: string; readonly message: string } & object,
  options?: NormalizeOptions,
): Diagnostic {
  const fields = diagnostic as { readonly [key: string]: unknown };
  return {
    source: options?.source ?? sourceOfCode(diagnostic.code),
    severity: options?.severity ?? "error",
    code: diagnostic.code,
    message: diagnostic.message,
    slot: typeof fields.slot === "string" ? fields.slot : undefined,
    component: typeof fields.component === "string" ? fields.component : undefined,
    platform: typeof fields.platform === "string" ? fields.platform : undefined,
    property: typeof fields.property === "string" ? fields.property : undefined,
    event: typeof fields.event === "string" ? fields.event : undefined,
    details: diagnostic,
  };
}

/** Convert plain validator messages into structured diagnostics. */
export function fromMessages(
  source: DiagnosticSource,
  messages: ReadonlyArray<string>,
  options?: {
    readonly severity?: DiagnosticSeverity;
    readonly code?: string;
  },
): readonly Diagnostic[] {
  return messages.map((message) => ({
    source,
    severity: options?.severity ?? "error",
    code: options?.code ?? `${source}:validation`,
    message,
  }));
}

/**
 * Collect view diagnostics from slot targets, remaps, typed trees, and
 * optional platform metadata.
 */
export function collectView<Slots>(
  view: View.View<Slots>,
  options?: {
    readonly slotTargets?: readonly string[];
    readonly allowHidden?: boolean;
    readonly platform?: View.PlatformMetadata;
  },
): readonly Diagnostic[] {
  const diagnostics = [
    ...(options?.slotTargets === undefined ? [] : View.validateSlotTargets(view, options.slotTargets, { allowHidden: options.allowHidden })),
    ...View.validateRemaps(view),
    ...View.validateTree(view, { allowHidden: options?.allowHidden }),
    ...(options?.platform === undefined ? [] : View.validatePlatform(view, options.platform)),
  ];
  return diagnostics.map((diagnostic) => normalize(diagnostic, { source: "view" }));
}

/**
 * Render a component's view and collect declared-vs-rendered slot diagnostics.
 */
export function collectComponent<Props, Req, E, Bindings, Slots>(
  component: Component.Component<Props, Req, E, Bindings, Slots>,
  props: Props,
): Effect.Effect<readonly Diagnostic[], E, Req> {
  return Component.validateRenderedSlotContract(component, props).pipe(
    Effect.map((diagnostics) => diagnostics.map((diagnostic) => normalize(diagnostic, { source: "component" }))),
  );
}

/** Collect style diagnostics against explicit platform metadata. */
export function collectStylePlatform<S extends string>(
  style: Style.ComposedStyle<S, any>,
  platform: Style.StylePlatformMetadata,
): readonly Diagnostic[] {
  return Style.validatePlatform(style, platform).map((diagnostic) => normalize(diagnostic, { source: "style" }));
}

/** Collect style attachment diagnostics against a rendered view. */
export function collectStyleAttachment<S extends string, Slots>(
  style: Style.ComposedStyle<S, any>,
  view: View.View<Slots>,
  options?: {
    readonly allowHidden?: boolean;
  },
): readonly Diagnostic[] {
  return Style.validateAttachment(style, view, options).map((diagnostic) => normalize(diagnostic, { source: "style" }));
}

/** Collect behavior attachment diagnostics against a rendered view. */
export function collectBehaviorAttachment<
  Elements extends Record<string, unknown>,
  Slots,
  M extends { readonly [K in keyof Elements]: keyof Slots & string },
>(
  behavior: Behavior.Behavior<Elements, unknown, unknown, unknown>,
  elementMap: M,
  view: View.View<Slots>,
  options?: {
    readonly allowHidden?: boolean;
  },
): readonly Diagnostic[] {
  return Behavior.validateAttachmentBySlots(behavior, elementMap, view, options)
    .map((diagnostic) => normalize(diagnostic, { source: "behavior" }));
}

/** Collect route-tree validation diagnostics. */
export function collectRouteTree(root: Route.AnyRoute): readonly Diagnostic[] {
  return fromMessages("route", Route.validateTree(root));
}

/** Collect server-route graph validation diagnostics. */
export function collectServerRoutes(
  routes: ReadonlyArray<ServerRoute.ServerRouteNode<any, any, any, any>>,
): readonly Diagnostic[] {
  return fromMessages("server-route", ServerRoute.validate(routes));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return isRecord(value)
    && typeof value.source === "string"
    && typeof value.severity === "string"
    && typeof value.code === "string"
    && typeof value.message === "string";
}

function isDiagnosticArray(value: unknown): value is readonly Diagnostic[] {
  return Array.isArray(value) && value.every(isDiagnostic);
}

function isRouteTree(value: unknown): value is Route.AnyRoute | Route.AppRouteNode<any, any, any, any, any, any> {
  return isRecord(value) && (Route.UnifiedRouteSymbol in value || Route.RouteNodeSymbol in value);
}

function isServerRouteNode(value: unknown): value is ServerRoute.ServerRouteNode<any, any, any, any> {
  return isRecord(value) && ServerRoute.ServerRouteNodeSymbol in value;
}

function targetFromExport(name: string, value: unknown): DoctorTarget | undefined {
  if (isDiagnosticArray(value)) {
    return { name, diagnostics: value };
  }
  if (isRouteTree(value)) {
    return { name, diagnostics: collectRouteTree(value as Route.AnyRoute) };
  }
  if (Array.isArray(value) && value.every(isServerRouteNode)) {
    return { name, diagnostics: collectServerRoutes(value) };
  }
  if (isRecord(value) && isDiagnosticArray(value.diagnostics)) {
    return { name, diagnostics: value.diagnostics };
  }
  return undefined;
}

/**
 * Discover doctor targets from a module namespace.
 *
 * Recognized exports are diagnostic arrays, route trees, server-route arrays,
 * and objects with a `diagnostics` array.
 */
export function collectDoctorTargets(
  moduleExports: Record<string, unknown>,
  options?: {
    readonly exports?: readonly string[];
  },
): readonly DoctorTarget[] {
  const names = options?.exports ?? Object.keys(moduleExports);
  const targets: DoctorTarget[] = [];
  for (const name of names) {
    if (!(name in moduleExports)) continue;
    const target = targetFromExport(name, moduleExports[name]);
    if (target !== undefined) {
      targets.push(target);
    }
  }
  return targets;
}

/** Summarize all diagnostics from named doctor targets. */
export function doctorFromTargets(targets: readonly DoctorTarget[]): DoctorReport {
  return doctor(targets.flatMap((target) => target.diagnostics));
}

/** Return true when any diagnostic has severity `"error"`. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

/** Format one diagnostic for console or CLI output. */
export function format(diagnostic: Diagnostic): string {
  return `[${diagnostic.severity}] ${diagnostic.source}/${diagnostic.code}: ${diagnostic.message}`;
}

export const Diagnostics = {
  normalize,
  fromMessages,
  collectView,
  collectComponent,
  collectStylePlatform,
  collectStyleAttachment,
  collectBehaviorAttachment,
  collectRouteTree,
  collectServerRoutes,
  collectDoctorTargets,
  doctorFromTargets,
  reporter,
  layer,
  devLayer,
  report,
  doctor,
  formatReport,
  hasErrors,
  format,
  ReporterTag,
} as const;
