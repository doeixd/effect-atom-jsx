import type { Effect } from "effect";
import * as Portable from "./Portable.js";
import {
  beginReactivityReadCapture,
  isReactivityKeyWitness,
  normalizeReactivityKeys,
} from "./reactivity-runtime.js";
import {
  ExpressionElementMarkerAttributeName,
  inspectExpression,
  isExpressionAttributeName,
  isExpressionStylePropertyName,
  onExpressionCreated,
  type ExpressionDependencyDecodeError,
  type ExpressionTargetValue,
  type ResumableExpression,
} from "./resume-expression.js";
import type { SetupPlan, SetupStepInspection } from "./Component.js";
import {
  BindingReactivityKeyPrefix,
  bindingReactivityKey,
  inspectHandle,
  isBindingReactivityKey,
  type AnyBindingSnapshotPolicy,
  type AnyQuerySnapshotPolicy,
  type AnyStateSnapshotPolicy,
} from "./resume-handle.js";
import {
  ActivationProjection,
  DeferredNoArgs,
  inspectEventHandler,
  replayTargetAttribute,
  type ActivationProjectionValue,
  type EventTargetKey,
} from "./resume-event.js";

export type ResumeDiagnosticCode =
  | "opaque-event-handler"
  | "event-data-unsupported"
  | "invalid-event-type"
  | "marker-collision"
  | "event-contract-missing"
  | "unsupported-event-semantics"
  | "missing-snapshot-binding"
  | "snapshot-handle-mismatch"
  | "snapshot-inspection-failure"
  | "snapshot-read-failure"
  | "duplicate-snapshot-binding"
  | "event-inspection-failure"
  | "missing-component-boundary"
  | "opaque-query-executor"
  | "unsettled-query-snapshot"
  | "unsupported-query-semantics"
  | "undeclared-expression-dependency"
  | "reserved-expression-dependency"
  | "expression-dependency-ownership"
  | "unresolved-expression-dependency"
  | "unsupported-expression-output"
  | "unsupported-expression-target"
  | "missing-expression-boundary";

export type ResumeDiagnosticPhase = "collect";
export type ResumeDiagnosticSeverity = "warning";
export type ResumeDiagnosticDisposition = "fallback-required";

export interface ResumeDiagnostic {
  readonly code: ResumeDiagnosticCode;
  readonly phase: ResumeDiagnosticPhase;
  readonly severity: ResumeDiagnosticSeverity;
  readonly disposition: ResumeDiagnosticDisposition;
  readonly eventType?: string;
  readonly element?: string;
  readonly componentId?: string;
  readonly binding?: string;
  readonly expressionId?: string;
  readonly codeId?: string;
  readonly reason: string;
}

export interface PendingPortableEvent {
  readonly kind: "portable";
  readonly id: string;
  readonly eventType: string;
  readonly invocation: typeof DeferredNoArgs;
  readonly executable: Portable.AnyBoundCode;
}

export interface PendingActivationEvent {
  readonly kind: "activation";
  readonly id: string;
  readonly eventType: string;
  readonly invocation: typeof ActivationProjection;
  readonly projection: ActivationProjectionValue["kind"];
  readonly targetKey: EventTargetKey;
}

export type PendingEvent = PendingPortableEvent | PendingActivationEvent;

export interface PendingStateBinding {
  readonly kind: "state";
  readonly name: string;
  readonly policy: AnyStateSnapshotPolicy;
  readonly value: unknown;
}

export interface PendingQueryBinding {
  readonly kind: "query";
  readonly name: string;
  readonly policy: AnyQuerySnapshotPolicy;
  /** The settled success value read from the query handle. */
  readonly value: unknown;
  readonly executable: Portable.AnyBoundCode;
  readonly reactivityKeys: ReadonlyArray<string>;
}

export type PendingBinding = PendingStateBinding | PendingQueryBinding;

export interface PendingExpression {
  readonly id: string;
  /** The discriminated patch target this instance was registered against. */
  readonly target: ExpressionTargetValue;
  readonly executable: Portable.AnyBoundCode;
  readonly deps: ReadonlyArray<string>;
  readonly inputs?: ReadonlyArray<string>;
  readonly ownerComponentId?: string;
  readonly validateDependencies: (
    values: ReadonlyArray<unknown>,
  ) => Effect.Effect<void, ExpressionDependencyDecodeError>;
  /** Per-insertion runtime identity; never serialized. */
  readonly source: object;
}

export interface PendingComponentSnapshot {
  readonly id: string;
  readonly definitionName?: string;
  readonly activation?: Portable.AnyBoundCode;
  readonly bindings: Array<PendingBinding>;
}

export interface ResumeSession {
  readonly events: Array<PendingEvent>;
  readonly components: Array<PendingComponentSnapshot>;
  readonly expressions: Array<PendingExpression>;
  readonly diagnostics: Array<ResumeDiagnostic>;
  readonly observations: WeakMap<object, Readonly<Record<string, string>>>;
  readonly componentIds: Map<unknown, string>;
  readonly renderedComponentIds: Set<string>;
  readonly componentBoundaryMarkers: Map<
    string,
    {
      readonly start: unknown;
      readonly end: unknown;
    }
  >;
  readonly createdExpressions: Set<ResumableExpression>;
  readonly renderedExpressions: WeakSet<ResumableExpression>;
  readonly expressionOwners: WeakMap<ResumableExpression, string>;
  readonly bindingReactivityKeys: WeakMap<object, string>;
  readonly expressionRegions: WeakMap<
    object,
    {
      readonly id: string;
      readonly start: unknown;
      readonly end: unknown;
    }
  >;
  readonly invalidExpressionRegions: WeakSet<object>;
  /**
   * Instance ids already accumulated into one host element's installation-only
   * marker. Owning this in the session — not per helper call — is what makes
   * two expressions on one element emit one `data-af-expr` attribute.
   */
  readonly expressionElementMarkers: WeakMap<object, Array<string>>;
  readonly currentComponentIds: Array<string>;
  nextEventId: number;
  nextComponentId: number;
  nextExpressionId: number;
}

let activeSession: ResumeSession | undefined;
const noMarkers: Readonly<Record<string, string>> = Object.freeze({});
const componentActivations = new WeakMap<object, Portable.AnyCode>();

export function registerComponentActivation(
  component: object,
  activation: Portable.AnyCode,
): void {
  componentActivations.set(component, activation);
}

export function makeResumeSession(): ResumeSession {
  return {
    events: [],
    components: [],
    expressions: [],
    diagnostics: [],
    observations: new WeakMap(),
    componentIds: new Map(),
    renderedComponentIds: new Set(),
    componentBoundaryMarkers: new Map(),
    createdExpressions: new Set(),
    renderedExpressions: new WeakSet(),
    expressionOwners: new WeakMap(),
    bindingReactivityKeys: new WeakMap(),
    expressionRegions: new WeakMap(),
    invalidExpressionRegions: new WeakSet(),
    expressionElementMarkers: new WeakMap(),
    currentComponentIds: [],
    nextEventId: 0,
    nextComponentId: 0,
    nextExpressionId: 0,
  };
}

function recordFallbackDiagnostic(
  session: ResumeSession,
  diagnostic: Omit<
    ResumeDiagnostic,
    "phase" | "severity" | "disposition"
  >,
): void {
  session.diagnostics.push({
    phase: "collect",
    severity: "warning",
    disposition: "fallback-required",
    ...diagnostic,
  });
}

export function runInResumeSession<A>(
  session: ResumeSession,
  evaluate: () => A,
): A {
  const previous = activeSession;
  activeSession = session;
  const stopObservingExpressions = onExpressionCreated((expression) => {
    if (activeSession === session) {
      session.createdExpressions.add(expression);
      const ownerComponentId = session.currentComponentIds.at(-1);
      if (ownerComponentId !== undefined) {
        session.expressionOwners.set(expression, ownerComponentId);
      }
    }
  });
  try {
    return evaluate();
  } finally {
    stopObservingExpressions();
    activeSession = previous;
  }
}

/**
 * Associate dynamic expression regions rendered by `evaluate` with the
 * closest addressable component currently rendering.
 */
export function withRenderedComponentOwner<A>(
  bindings: unknown,
  evaluate: () => A,
): A {
  const session = activeSession;
  const componentId = session?.componentIds.get(bindings);
  if (session === undefined || componentId === undefined) {
    return evaluate();
  }
  session.currentComponentIds.push(componentId);
  try {
    return evaluate();
  } finally {
    session.currentComponentIds.pop();
  }
}

/**
 * Evaluate one marked expression during SSR, verify its declared semantic
 * dependencies, and wrap supported text output in a durable comment-pair
 * region. Unsupported expressions remain ordinary SSR output and require
 * component activation.
 */
export function observeRenderedExpression(
  expression: ResumableExpression,
  insertion: object,
  evaluate: () => unknown,
): unknown {
  const session = activeSession;
  const inspection = inspectExpression(expression);
  if (session === undefined || inspection === undefined) {
    return evaluate();
  }

  session.renderedExpressions.add(expression);
  const capture = beginReactivityReadCapture();
  let value: unknown;
  let captured: ReadonlyArray<string> = [];
  try {
    value = evaluate();
  } finally {
    captured = capture.end();
  }

  const ownerComponentId = session.currentComponentIds.at(-1);
  const resolved = resolveExpressionDependencies(
    session,
    inspection,
    insertion,
    ownerComponentId,
    captured,
    session.expressionRegions.get(insertion)?.id,
  );
  if (resolved === undefined) return value;
  const canonicalDeps = resolved.deps;
  const resolvedInputs = resolved.inputs;
  const inputsMatchDeps = resolvedInputs === undefined;

  if (typeof value !== "string" && typeof value !== "number") {
    session.invalidExpressionRegions.add(insertion);
    const observation = session.expressionRegions.get(insertion);
    recordFallbackDiagnostic(session, {
      code: "unsupported-expression-output",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      ...(observation === undefined
        ? {}
        : { expressionId: observation.id }),
      reason: `Expression "${inspection.executable.code.id}" produced ${
        value === null ? "null" : Array.isArray(value) ? "an array" : typeof value
      }; Milestone 8 text regions support only string or number output.`,
    });
    return value;
  }

  const documentValue = (
    globalThis as {
      readonly document?: {
        readonly createComment?: (text: string) => unknown;
      };
    }
  ).document;
  if (typeof documentValue?.createComment !== "function") {
    session.invalidExpressionRegions.add(insertion);
    recordFallbackDiagnostic(session, {
      code: "missing-expression-boundary",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      reason: `Expression "${inspection.executable.code.id}" rendered without an SSR document capable of creating ownership markers.`,
    });
    return value;
  }

  if (session.invalidExpressionRegions.has(insertion)) return value;
  let observation = session.expressionRegions.get(insertion);
  if (observation === undefined) {
    const expressionId = `x${session.nextExpressionId}`;
    session.nextExpressionId += 1;
    observation = {
      id: expressionId,
      start: documentValue.createComment(`af:expr:${expressionId}:start`),
      end: documentValue.createComment(`af:expr:${expressionId}:end`),
    };
    session.expressionRegions.set(insertion, observation);
    session.expressions.push({
      id: expressionId,
      target: { kind: "text" },
      executable: inspection.executable,
      deps: canonicalDeps,
      ...(inputsMatchDeps ? {} : { inputs: resolvedInputs }),
      ...(ownerComponentId === undefined
        ? {}
        : { ownerComponentId }),
      validateDependencies: inspection.validateDependencies,
      source: insertion,
    });
  }
  return [
    observation.start,
    value,
    observation.end,
  ];
}

/**
 * Resolve and validate one expression's declared semantic dependencies against
 * the closest resumable component snapshot.
 *
 * Shared by the text-region observer and the non-text target registrar so both
 * target families agree on ownership, reserved keys, and undeclared reads.
 * Returns `undefined` when a fallback diagnostic has already been recorded.
 *
 * @internal
 */
function resolveExpressionDependencies(
  session: ResumeSession,
  inspection: NonNullable<ReturnType<typeof inspectExpression>>,
  insertion: object,
  ownerComponentId: string | undefined,
  captured: ReadonlyArray<string>,
  expressionId: string | undefined,
):
  | {
    readonly deps: ReadonlyArray<string>;
    readonly inputs?: ReadonlyArray<string>;
  }
  | undefined
{
  const resolvedDeps: string[] = [];
  const resolvedInputs: string[] = [];
  let unresolvedDependencyCount = 0;
  let reservedDependencyCount = 0;
  let foreignBindingDependencyCount = 0;
  for (const dep of inspection.deps) {
    if (typeof dep === "string") {
      if (isBindingReactivityKey(dep)) {
        reservedDependencyCount += 1;
        continue;
      }
      resolvedDeps.push(dep);
      resolvedInputs.push(dep);
      continue;
    }
    if (isReactivityKeyWitness(dep)) {
      const normalized = normalizeReactivityKeys([dep]);
      if (normalized.some(isBindingReactivityKey)) {
        reservedDependencyCount += 1;
        continue;
      }
      resolvedDeps.push(...normalized);
      resolvedInputs.push(dep.name);
      continue;
    }
    const implicitKey = session.bindingReactivityKeys.get(dep);
    if (implicitKey === undefined) {
      unresolvedDependencyCount += 1;
    } else if (
      ownerComponentId === undefined
      || !implicitKey.startsWith(
        `${BindingReactivityKeyPrefix}${ownerComponentId}/`,
      )
    ) {
      foreignBindingDependencyCount += 1;
    } else {
      resolvedDeps.push(implicitKey);
      resolvedInputs.push(implicitKey);
    }
  }
  const diagnosticId = expressionId === undefined ? {} : { expressionId };
  if (reservedDependencyCount > 0) {
    session.invalidExpressionRegions.add(insertion);
    recordFallbackDiagnostic(session, {
      code: "reserved-expression-dependency",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      ...diagnosticId,
      reason:
        `Expression "${inspection.executable.code.id}" declares ${reservedDependencyCount} internal binding ${
          reservedDependencyCount === 1 ? "key" : "keys"
        } directly. Pass the typed Component.state handle instead; internal binding identities are installation-owned.`,
    });
    return undefined;
  }
  if (foreignBindingDependencyCount > 0) {
    session.invalidExpressionRegions.add(insertion);
    recordFallbackDiagnostic(session, {
      code: "expression-dependency-ownership",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      ...diagnosticId,
      reason:
        `Expression "${inspection.executable.code.id}" reads ${foreignBindingDependencyCount} state ${
          foreignBindingDependencyCount === 1 ? "handle" : "handles"
        } outside its closest resumable component. Fine-grained expression ownership cannot outlive a different component boundary.`,
    });
    return undefined;
  }
  if (unresolvedDependencyCount > 0) {
    session.invalidExpressionRegions.add(insertion);
    recordFallbackDiagnostic(session, {
      code: "unresolved-expression-dependency",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      ...diagnosticId,
      reason: `Expression "${inspection.executable.code.id}" references ${
        unresolvedDependencyCount === 1 ? "a binding" : "bindings"
      } that are not part of the closest resumable component snapshot.`,
    });
    return undefined;
  }
  const canonicalDeps = [...new Set(resolvedDeps)];
  const inputsMatchDeps =
    canonicalDeps.length === resolvedInputs.length
    && canonicalDeps.every((key, index) => key === resolvedInputs[index]);
  const declared = new Set(canonicalDeps);
  const undeclared = captured.filter((key) => !declared.has(key));
  if (undeclared.length > 0) {
    session.invalidExpressionRegions.add(insertion);
    recordFallbackDiagnostic(session, {
      code: "undeclared-expression-dependency",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      ...diagnosticId,
      reason: `Expression "${inspection.executable.code.id}" read undeclared reactivity ${
        undeclared.length === 1 ? "key" : "keys"
      } ${undeclared.map((key) => JSON.stringify(key)).join(", ")}.`,
    });
    return undefined;
  }
  return {
    deps: canonicalDeps,
    ...(inputsMatchDeps ? {} : { inputs: resolvedInputs }),
  };
}

/** The outcome of registering one non-text expression target during SSR. */
export interface ObservedExpressionTarget {
  /**
   * Whether the ordinary DOM helper should apply `value`. Only a *refused
   * target name* suppresses the write; every other fallback still emits the
   * ordinary SSR output so activation fallback sees a correct document.
   */
  readonly write: boolean;
  readonly value: unknown;
}

const refusedExpressionTarget: ObservedExpressionTarget = Object.freeze({
  write: false,
  value: undefined,
});

function describeExpressionTarget(target: ExpressionTargetValue): string {
  switch (target.kind) {
    case "text":
      return "text";
    case "class":
      return "the class string";
    case "attribute":
      return `the "${target.name}" attribute`;
    case "style-property":
      return `the "${target.name}" style property`;
  }
}

function expressionTargetIsAllowed(target: ExpressionTargetValue): boolean {
  switch (target.kind) {
    case "text":
    case "class":
      return true;
    case "attribute":
      return isExpressionAttributeName(target.name);
    case "style-property":
      return isExpressionStylePropertyName(target.name);
  }
}

/**
 * The single SSR registrar for non-text expression targets.
 *
 * The three compiler-facing helpers in `dom.ts` (`exprAttribute`, `exprClass`,
 * `exprStyleProperty`) name their target kind and delegate here, so target
 * validation and installation-marker accumulation live in exactly one place —
 * which is what makes two expressions on one host element produce one
 * `data-af-expr` attribute listing both instance ids.
 *
 * @internal
 */
export function observeRenderedExpressionTarget(
  element: object,
  expression: ResumableExpression,
  registration: object,
  target: ExpressionTargetValue,
  evaluate: () => unknown,
): ObservedExpressionTarget {
  const session = activeSession;
  const inspection = inspectExpression(expression);
  if (session === undefined || inspection === undefined) {
    return { write: true, value: evaluate() };
  }

  session.renderedExpressions.add(expression);
  const ownerComponentId = session.currentComponentIds.at(-1);

  if (!expressionTargetIsAllowed(target)) {
    session.invalidExpressionRegions.add(registration);
    recordFallbackDiagnostic(session, {
      code: "unsupported-expression-target",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      reason:
        `Expression "${inspection.executable.code.id}" targets ${describeExpressionTarget(target)}, which is outside the portable target allowlist.`,
    });
    return refusedExpressionTarget;
  }

  const capture = beginReactivityReadCapture();
  let value: unknown;
  let captured: ReadonlyArray<string> = [];
  try {
    value = evaluate();
  } finally {
    captured = capture.end();
  }

  const resolved = resolveExpressionDependencies(
    session,
    inspection,
    registration,
    ownerComponentId,
    captured,
    undefined,
  );
  if (resolved === undefined) return { write: true, value };

  if (
    typeof value !== "string"
    && typeof value !== "number"
    && value !== null
    && value !== undefined
  ) {
    session.invalidExpressionRegions.add(registration);
    recordFallbackDiagnostic(session, {
      code: "unsupported-expression-output",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      reason: `Expression "${inspection.executable.code.id}" produced ${
        Array.isArray(value) ? "an array" : typeof value
      }; non-text targets support string, number, null, or undefined output.`,
    });
    return { write: true, value };
  }

  const host = element as {
    readonly getAttribute?: (name: string) => string | null;
    readonly setAttribute?: (name: string, value: string) => void;
  };
  if (typeof host.setAttribute !== "function") {
    session.invalidExpressionRegions.add(registration);
    recordFallbackDiagnostic(session, {
      code: "missing-expression-boundary",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      codeId: inspection.executable.code.id,
      reason: `Expression "${inspection.executable.code.id}" rendered onto a host that cannot carry the "${ExpressionElementMarkerAttributeName}" ownership marker.`,
    });
    return { write: true, value };
  }

  let markerIds = session.expressionElementMarkers.get(element);
  if (markerIds === undefined) {
    const existing = typeof host.getAttribute === "function"
      ? host.getAttribute(ExpressionElementMarkerAttributeName)
      : null;
    if (existing !== null) {
      session.invalidExpressionRegions.add(registration);
      recordFallbackDiagnostic(session, {
        code: "marker-collision",
        ...(ownerComponentId === undefined
          ? {}
          : { componentId: ownerComponentId }),
        codeId: inspection.executable.code.id,
        reason: `Expression "${inspection.executable.code.id}" conflicts with the reserved "${ExpressionElementMarkerAttributeName}" attribute.`,
      });
      return { write: true, value };
    }
    markerIds = [];
    session.expressionElementMarkers.set(element, markerIds);
  }

  const expressionId = `x${session.nextExpressionId}`;
  session.nextExpressionId += 1;
  markerIds.push(expressionId);
  host.setAttribute(
    ExpressionElementMarkerAttributeName,
    markerIds.join(" "),
  );
  session.expressions.push({
    id: expressionId,
    target,
    executable: inspection.executable,
    deps: resolved.deps,
    ...(resolved.inputs === undefined ? {} : { inputs: resolved.inputs }),
    ...(ownerComponentId === undefined ? {} : { ownerComponentId }),
    validateDependencies: inspection.validateDependencies,
    source: registration,
  });
  return { write: true, value };
}

/**
 * Emit ghost-expression diagnostics after the synchronous render completes.
 */
export function finalizeResumeSession(session: ResumeSession): void {
  const validExpressions = session.expressions.filter(
    (expression) =>
      !session.invalidExpressionRegions.has(expression.source),
  );
  session.expressions.splice(
    0,
    session.expressions.length,
    ...validExpressions,
  );
  for (const expression of session.createdExpressions) {
    if (session.renderedExpressions.has(expression)) continue;
    const inspection = inspectExpression(expression);
    const ownerComponentId = session.expressionOwners.get(expression);
    recordFallbackDiagnostic(session, {
      code: "missing-expression-boundary",
      ...(ownerComponentId === undefined
        ? {}
        : { componentId: ownerComponentId }),
      ...(inspection === undefined
        ? {}
        : { codeId: inspection.executable.code.id }),
      reason: inspection === undefined
        ? "A resumable expression was created but never rendered into an addressable DOM region."
        : `Expression "${inspection.executable.code.id}" was created but never rendered into an addressable DOM region.`,
    });
  }
}

/**
 * Observe a fully committed named setup result. The setup itself has already
 * succeeded, so collection never exposes partially-produced bindings.
 */
export function observeCommittedComponentBindings(
  componentValue: object,
  definitionName: string | undefined,
  plan: SetupPlan,
  props: unknown,
  bindings: unknown,
): void {
  const session = activeSession;
  if (session === undefined) return;

  const resumableSteps = plan.kind === "named"
    ? flattenSetupSteps(plan.steps).filter(
      (step): step is SetupStepInspection & {
        readonly name: string;
        readonly resume: AnyBindingSnapshotPolicy;
      } => step.name !== undefined && step.resume !== undefined,
    )
    : [];
  const activationCode = componentActivations.get(componentValue);
  if (resumableSteps.length === 0 && activationCode === undefined) return;

  const componentId = `c${session.nextComponentId}`;
  session.nextComponentId += 1;
  const component: PendingComponentSnapshot = {
    id: componentId,
    ...(definitionName === undefined ? {} : { definitionName }),
    ...(activationCode === undefined
      ? {}
      : { activation: Portable.bind(activationCode, props) }),
    bindings: [],
  };
  session.components.push(component);
  session.componentIds.set(bindings, componentId);

  const record = typeof bindings === "object" && bindings !== null
    ? bindings as Readonly<Record<string, unknown>>
    : {};
  const observedNames = new Set<string>();
  for (const step of resumableSteps) {
    const name = step.name;
    if (observedNames.has(name)) {
      recordFallbackDiagnostic(session, {
        code: "duplicate-snapshot-binding",
        componentId,
        binding: name,
        reason: `Component "${componentId}" declares snapshot binding "${name}" more than once.`,
      });
      continue;
    }
    observedNames.add(name);
    if (!Object.prototype.hasOwnProperty.call(record, name)) {
      recordFallbackDiagnostic(session, {
        code: "missing-snapshot-binding",
        componentId,
        binding: name,
        reason: `Component "${componentId}" did not commit declared snapshot binding "${name}".`,
      });
      continue;
    }
    let handle: ReturnType<typeof inspectHandle>;
    try {
      handle = inspectHandle(record[name]);
    } catch (error) {
      recordFallbackDiagnostic(session, {
        code: "snapshot-inspection-failure",
        componentId,
        binding: name,
        reason: `Binding "${componentId}/${name}" could not be inspected for snapshotting: ${String(error)}`,
      });
      continue;
    }
    const bindingHandle = record[name];
    if (
      (typeof bindingHandle === "object" || typeof bindingHandle === "function")
      && bindingHandle !== null
    ) {
      session.bindingReactivityKeys.set(
        bindingHandle,
        bindingReactivityKey(componentId, name),
      );
    }
    if (handle?.kind !== step.resume.kind) {
      recordFallbackDiagnostic(session, {
        code: "snapshot-handle-mismatch",
        componentId,
        binding: name,
        reason: step.resume.kind === "state"
          ? `Binding "${componentId}/${name}" declared a state snapshot policy but did not produce a Component.state handle.`
          : `Binding "${componentId}/${name}" declared a query snapshot policy but did not produce a Component.query handle.`,
      });
      continue;
    }
    if (step.resume.kind === "state") {
      try {
        component.bindings.push({
          kind: "state",
          name,
          policy: step.resume,
          value: handle.read(),
        });
      } catch (error) {
        recordFallbackDiagnostic(session, {
          code: "snapshot-read-failure",
          componentId,
          binding: name,
          reason: `Binding "${componentId}/${name}" could not be read for snapshotting: ${String(error)}`,
        });
      }
      continue;
    }
    if (handle.kind !== "query" || handle.executable === undefined) {
      recordFallbackDiagnostic(session, {
        code: "opaque-query-executor",
        componentId,
        binding: name,
        reason: `Query binding "${componentId}/${name}" has an opaque executor and cannot be lazily reloaded on the client.`,
      });
      continue;
    }
    if (
      handle.semantics?.hasRetry === true
      || handle.semantics?.hasPoll === true
    ) {
      recordFallbackDiagnostic(session, {
        code: "unsupported-query-semantics",
        componentId,
        binding: name,
        reason: `Query binding "${componentId}/${name}" uses ${
          handle.semantics.hasRetry ? "a retry schedule" : "a poll schedule"
        }, which cannot be restored exactly from a snapshot.`,
      });
      continue;
    }
    let settled: unknown;
    try {
      settled = handle.read();
    } catch (error) {
      recordFallbackDiagnostic(session, {
        code: "snapshot-read-failure",
        componentId,
        binding: name,
        reason: `Binding "${componentId}/${name}" could not be read for snapshotting: ${String(error)}`,
      });
      continue;
    }
    if (
      typeof settled !== "object"
      || settled === null
      || (settled as { readonly _tag?: string })._tag !== "Success"
    ) {
      recordFallbackDiagnostic(session, {
        code: "unsettled-query-snapshot",
        componentId,
        binding: name,
        reason: `Query binding "${componentId}/${name}" was not a settled Success at collection time and requires fallback activation.`,
      });
      continue;
    }
    component.bindings.push({
      kind: "query",
      name,
      policy: step.resume,
      value: (settled as { readonly value: unknown }).value,
      executable: handle.executable,
      reactivityKeys: handle.reactivityKeys,
    });
  }
}

/**
 * Wrap one state-addressable component result in stable comment sentinels.
 *
 * The paired marker shape does not assume an element root, so it also
 * represents fragments, text-only views, and empty output.
 */
export function observeRenderedComponentBoundary(
  result: unknown,
  bindings: unknown,
): unknown {
  const session = activeSession;
  if (session === undefined) return result;

  const componentId = session.componentIds.get(bindings);
  if (componentId === undefined) return result;

  let markers = session.componentBoundaryMarkers.get(componentId);
  if (markers === undefined) {
    const documentValue = (
      globalThis as {
        readonly document?: {
          readonly createComment?: (text: string) => unknown;
        };
      }
    ).document;
    if (typeof documentValue?.createComment !== "function") {
      recordFallbackDiagnostic(session, {
        code: "missing-component-boundary",
        componentId,
        reason: `Component "${componentId}" was rendered without an SSR document capable of creating ownership markers.`,
      });
      return result;
    }
    markers = {
      start: documentValue.createComment(
        `af:component:${componentId}:start`,
      ),
      end: documentValue.createComment(
        `af:component:${componentId}:end`,
      ),
    };
    session.componentBoundaryMarkers.set(componentId, markers);
  }
  session.renderedComponentIds.add(componentId);
  return [markers.start, result, markers.end];
}

function flattenSetupSteps(
  steps: ReadonlyArray<SetupStepInspection>,
): ReadonlyArray<SetupStepInspection> {
  const flattened: SetupStepInspection[] = [];
  for (const step of steps) {
    if (step.kind === "fragment" && step.plan?.kind === "named") {
      flattened.push(...flattenSetupSteps(step.plan.steps));
    } else {
      flattened.push(step);
    }
  }
  return flattened;
}

/**
 * Inspect the event properties emitted by the JSX compiler for one server
 * element. The no-session path is intentionally one branch and one shared
 * empty object.
 */
export function observeServerEventTarget(
  target: object,
): Readonly<Record<string, string>> {
  const session = activeSession;
  if (session === undefined) return noMarkers;

  const previous = session.observations.get(target);
  if (previous !== undefined) return previous;

  const record = target as Record<string, unknown>;
  const element = typeof record.nodeName === "string"
    ? record.nodeName.toLowerCase()
    : "unknown";
  const markers: Record<string, string> = {};

  for (const property of Object.getOwnPropertyNames(target)) {
    if (!property.startsWith("$$") || property.length <= 2) continue;
    if (
      property.endsWith("Data")
      && Object.prototype.hasOwnProperty.call(
        target,
        property.slice(0, -"Data".length),
      )
    ) {
      continue;
    }

    const eventType = property.slice(2);
    const handler = record[property];
    if (handler === undefined || handler === null) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(eventType)) {
      recordFallbackDiagnostic(session, {
        code: "invalid-event-type",
        eventType,
        element,
        reason: `Event "${eventType}" cannot be represented by the initial resume marker format.`,
      });
      continue;
    }

    let attachment: ReturnType<typeof inspectEventHandler>;
    let inspection: Portable.ExecutableInspection<
      ReadonlyArray<unknown>,
      unknown,
      unknown,
      unknown
    >;
    try {
      attachment = inspectEventHandler(handler);
      inspection = attachment?.kind === "portable"
        ? attachment.inspection
        : Portable.inspectExecutable(handler);
    } catch (error) {
      recordFallbackDiagnostic(session, {
        code: "event-inspection-failure",
        eventType,
        element,
        reason: `The ${eventType} handler on <${element}> could not be inspected safely: ${String(error)}`,
      });
      continue;
    }
    if (attachment === undefined && inspection.kind === "portable") {
      recordFallbackDiagnostic(session, {
        code: "event-contract-missing",
        eventType,
        element,
        reason: `The ${eventType} handler on <${element}> is portable but has no explicit Resume.event(...) invocation contract.`,
      });
      continue;
    }
    if (
      attachment?.kind === "portable" &&
      attachment.unsupportedReason !== undefined
    ) {
      recordFallbackDiagnostic(session, {
        code: "unsupported-event-semantics",
        eventType,
        element,
        reason: attachment.unsupportedReason,
      });
      continue;
    }
    if (
      attachment?.kind === "activation"
      && !attachment.projection.supportsEventType(eventType)
    ) {
      recordFallbackDiagnostic(session, {
        code: "unsupported-event-semantics",
        eventType,
        element,
        reason:
          `The ${attachment.projection.id} activation projection cannot faithfully capture the ${eventType} event on <${element}>.`,
      });
      continue;
    }
    if (attachment?.kind !== "activation" && inspection.kind === "opaque") {
      recordFallbackDiagnostic(session, {
        code: "opaque-event-handler",
        eventType,
        element,
        reason: `The ${eventType} handler on <${element}> is an opaque closure and requires fallback activation.`,
      });
      continue;
    }

    const dataProperty = `${property}Data`;
    if (Object.prototype.hasOwnProperty.call(target, dataProperty)) {
      recordFallbackDiagnostic(session, {
        code: "event-data-unsupported",
        eventType,
        element,
        reason: `The ${eventType} handler on <${element}> uses compiler-bound event data, which is not portable in this slice.`,
      });
      continue;
    }

    const markerName = `data-af-event-${eventType}`;
    const existingMarker = typeof record.getAttribute === "function"
      ? (record.getAttribute as (name: string) => string | null).call(
        target,
        markerName,
      )
      : null;
    if (existingMarker !== null) {
      recordFallbackDiagnostic(session, {
        code: "marker-collision",
        eventType,
        element,
        reason: `The ${eventType} handler on <${element}> conflicts with the reserved "${markerName}" attribute.`,
      });
      continue;
    }

    const id = `e${session.nextEventId}`;
    session.nextEventId += 1;
    if (attachment?.kind === "activation") {
      const replayAttribute = replayTargetAttribute(eventType);
      const existingReplayKey = typeof record.getAttribute === "function"
        ? (record.getAttribute as (name: string) => string | null).call(
            target,
            replayAttribute,
          )
        : null;
      if (
        existingReplayKey !== null &&
        existingReplayKey !== attachment.targetKey
      ) {
        recordFallbackDiagnostic(session, {
          code: "marker-collision",
          eventType,
          element,
          reason: `The ${eventType} handler on <${element}> conflicts with the reserved "${replayAttribute}" attribute.`,
        });
        continue;
      }
      session.events.push({
        kind: "activation",
        id,
        eventType,
        invocation: attachment.invocation,
        projection: attachment.projection.id,
        targetKey: attachment.targetKey,
      });
      markers[replayAttribute] = attachment.targetKey;
    } else {
      if (attachment?.kind !== "portable" || inspection.kind !== "portable") {
        recordFallbackDiagnostic(session, {
          code: "event-inspection-failure",
          eventType,
          element,
          reason: `The ${eventType} handler on <${element}> did not retain a portable execution descriptor.`,
        });
        continue;
      }
      session.events.push({
        kind: "portable",
        id,
        eventType,
        invocation: attachment.invocation,
        executable: inspection.executable,
      });
    }
    markers[markerName] = id;
  }

  const frozen = Object.freeze(markers);
  session.observations.set(target, frozen);
  return frozen;
}
