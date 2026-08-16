/**
 * Agent surface (AN-1, `AGENT_NATIVE_NOTES.md` §2–§5, §10) — the agent is
 * just another caller.
 *
 * An exposed catalog entry is a PROJECTION of an existing `Portable.code`
 * value: tool ids are portable code ids (no second identity family), args are
 * decoded through the declared `Schema.Tuple` before `run` observes them, and
 * success/errors are encoded through declared schemas on the way out.
 *
 * Ratified decisions this module implements:
 * - `DQ-080` — the response envelope is exactly two arms:
 *   `{ok:true, payload:{mutation, loaders, invalidated, url}} |
 *   {ok:false, error}`. `invalidated` is additive on the single-flight
 *   payload; drift rides INSIDE the `ok:false` arm. (§10 correction 4: agent
 *   dispatch synthesizes the required `url` as `/_affe/actions/<tool>`.)
 * - `DQ-081` — a drifted call NEVER runs; the failure carries the fresh
 *   manifest so host recovery is mechanical.
 * - `DQ-082` — `makeDispatcher` checks governance at CONSTRUCTION and fails
 *   with the typed `GovernanceUnsatisfiedError`, never a defect.
 * - `DQ-083` — `audited(catalog, { onFailure })` defaults to `refuse`:
 *   write-ahead, then run; the refusal record is itself written.
 * - `DQ-084` — mutation is declared by the CONSTRUCTOR (`exposeMutation`),
 *   never inferred from `reactivityKeys`.
 * - `DQ-085` — redaction is structural (`Agent.secret(schema)`); the
 *   secret-NAME heuristic is `catalogDiagnostics`, a warning that suggests
 *   the structural fix and never enforces.
 * - `DQ-086` — authorize → drift → approve, authorization OUTERMOST: an
 *   unauthorized caller learns nothing (no schema, description, or drift
 *   detail). This is a security invariant of the pipeline, not a preference.
 * - `DQ-087` — a catalog entry whose `render:` names a non-addressable
 *   component throws at catalog construction.
 * - `DQ-088` — args are a `Schema.Tuple` in core; the HTTP/MCP struct
 *   projection is derived from the authored `argNames` via `structArgs`.
 */
import { Cause, Context, Effect, Layer, Option, Schema } from "effect";
import * as Portable from "./Portable.js";
import { ReactivityBroadcast } from "./reactivity-push.js";
import { normalizeReactivityKeys, type ReactivityKeysInput } from "./reactivity-runtime.js";
import * as Resume from "./Resume.js";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AgentToolNotFoundError extends Schema.TaggedErrorClass<AgentToolNotFoundError>(
  "@effect-atom-jsx/AgentToolNotFoundError",
)("AgentToolNotFoundError", {
  tool: Schema.String,
  message: Schema.String,
}) {}

export class AgentArgsDecodeError extends Schema.TaggedErrorClass<AgentArgsDecodeError>(
  "@effect-atom-jsx/AgentArgsDecodeError",
)("AgentArgsDecodeError", {
  tool: Schema.String,
  message: Schema.String,
}) {}

export class AgentErrorEncodeError extends Schema.TaggedErrorClass<AgentErrorEncodeError>(
  "@effect-atom-jsx/AgentErrorEncodeError",
)("AgentErrorEncodeError", {
  tool: Schema.String,
  message: Schema.String,
}) {}

export class AgentBuildIdMissingError extends Schema.TaggedErrorClass<AgentBuildIdMissingError>(
  "@effect-atom-jsx/AgentBuildIdMissingError",
)("AgentBuildIdMissingError", {
  tool: Schema.String,
  message: Schema.String,
}) {}

export class GovernanceUnsatisfiedError extends Schema.TaggedErrorClass<GovernanceUnsatisfiedError>(
  "@effect-atom-jsx/GovernanceUnsatisfiedError",
)("GovernanceUnsatisfiedError", {
  tool: Schema.String,
  /** The missing service's name — what "fail closed" makes actionable. */
  missing: Schema.String,
  message: Schema.String,
}) {}

export class ApprovalDeniedError extends Schema.TaggedErrorClass<ApprovalDeniedError>(
  "@effect-atom-jsx/ApprovalDeniedError",
)("ApprovalDeniedError", {
  summary: Schema.String,
  reason: Schema.String,
}) {}

export class AuthorizationDeniedError extends Schema.TaggedErrorClass<AuthorizationDeniedError>(
  "@effect-atom-jsx/AuthorizationDeniedError",
)("AuthorizationDeniedError", {
  tool: Schema.String,
  reason: Schema.String,
}) {}

// ─── Governance services ─────────────────────────────────────────────────────

/** Who is calling: surface kind, optional user identity, optional lineage. */
export interface CallerContextService {
  readonly caller: string;
  readonly user: unknown;
  readonly lineage: unknown;
}
export const CallerContext = Context.Service<CallerContextService>(
  "effect-atom-jsx/Agent/CallerContext",
);

/** Human (or policy) sign-off for calls that declared an approval need. */
export interface ApprovalService {
  readonly require: (summary: string) => Effect.Effect<void, unknown>;
}
export const Approval = Context.Service<ApprovalService>(
  "effect-atom-jsx/Agent/Approval",
);

/** Caller authorization. Runs OUTERMOST (`DQ-086`). */
export interface AuthorizerService {
  readonly authorize: (tool: string) => Effect.Effect<void, unknown>;
}
export const Authorizer = Context.Service<AuthorizerService>(
  "effect-atom-jsx/Agent/Authorizer",
);

/** Durable audit sink for mutating dispatches. */
export interface AuditLogService {
  readonly record: (entry: AuditRecord) => Effect.Effect<void, unknown>;
}
export const AuditLog = Context.Service<AuditLogService>(
  "effect-atom-jsx/Agent/AuditLog",
);

export interface AuditRecord {
  readonly tool: string;
  readonly id: string;
  readonly buildId: string;
  readonly caller: string;
  readonly outcome: "success" | "denied" | "audit-refused";
  readonly mutation: boolean;
  readonly args: unknown;
  readonly reactivityKeys?: ReadonlyArray<string>;
  readonly error?: unknown;
}

/** The UI surface: identified caller whose human already clicked. */
export function uiLayer(options: { readonly caller: string }): Layer.Layer<
  CallerContextService | ApprovalService
> {
  return Layer.mergeAll(
    Layer.succeed(CallerContext, {
      caller: options.caller,
      user: { _tag: "None" },
      lineage: { _tag: "None" },
    }),
    // The human already interacted; approval is the click that happened.
    Layer.succeed(Approval, { require: () => Effect.void }),
  );
}

/** The agent surface: identified caller; approval must be supplied by the app. */
export function agentLayer(options: { readonly caller: string }): Layer.Layer<
  CallerContextService
> {
  return Layer.succeed(CallerContext, {
    caller: options.caller,
    user: { _tag: "None" },
    lineage: { _tag: "None" },
  });
}

// ─── Secrets (DQ-085) ────────────────────────────────────────────────────────

const SecretAnnotationKey = "effect-atom-jsx/Agent/secret";

/**
 * Mark a field schema as SECRET: its decoded value never appears in audit
 * records (structural redaction). Decode/encode behavior is unchanged — the
 * action still observes the real value.
 */
export function secret<S extends Schema.Top>(schema: S): S {
  return schema.pipe(
    Schema.annotate({ [SecretAnnotationKey]: true }),
  ) as unknown as S;
}

function isSecretSchema(schema: unknown): boolean {
  const annotations = (schema as {
    readonly ast?: { readonly annotations?: Record<string, unknown> };
  })?.ast?.annotations;
  return annotations?.[SecretAnnotationKey] === true;
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export interface AccessDeclaration {
  readonly agent?: boolean;
  readonly http?: boolean;
  readonly approval?: string;
}

export interface ExposeOptions {
  readonly description: string;
  readonly args: Schema.Top;
  readonly argNames?: ReadonlyArray<string>;
  readonly success: Schema.Top;
  readonly error?: Schema.Top;
  /**
   * The ONE reactivity key vocabulary (identity unification, §6): plain
   * strings or `Reactivity.Key` witnesses — the same values queries use.
   * Normalized at construction, so payload, audit, and push all carry the
   * identical strings.
   */
  readonly reactivityKeys?: ReactivityKeysInput;
  readonly access?: AccessDeclaration;
  readonly render?: unknown;
}

export interface CatalogEntry extends Omit<ExposeOptions, "reactivityKeys"> {
  readonly code: Portable.Code<any, any, any, any, any, any>;
  /** DQ-084: declared by the constructor, never inferred. */
  readonly mutation: boolean;
  /** Normalized form of the authored `reactivityKeys`. */
  readonly reactivityKeys?: ReadonlyArray<string>;
}

const CatalogTypeId: unique symbol = Symbol.for("effect-atom-jsx/Agent/Catalog");

export interface Catalog {
  readonly [CatalogTypeId]: true;
  readonly entries: Readonly<Record<string, CatalogEntry>>;
  readonly audit?: { readonly onFailure: "refuse" | "proceed" };
}

function entryOf(
  code: Portable.Code<any, any, any, any, any, any>,
  options: ExposeOptions,
  mutation: boolean,
): CatalogEntry {
  return {
    ...options,
    ...(options.reactivityKeys === undefined
      ? { reactivityKeys: undefined }
      : { reactivityKeys: normalizeReactivityKeys(options.reactivityKeys) }),
    code,
    mutation,
  };
}

/** Expose a portable code value as a READ-ONLY tool (`DQ-084`). */
export function expose(
  code: Portable.Code<any, any, any, any, any, any>,
  options: ExposeOptions,
): CatalogEntry {
  return entryOf(code, options, false);
}

/** Expose a portable code value as a MUTATING tool (`DQ-084`). */
export function exposeMutation(
  code: Portable.Code<any, any, any, any, any, any>,
  options: ExposeOptions,
): CatalogEntry {
  return entryOf(code, options, true);
}

/**
 * Build a catalog from named entries. `DQ-087`: an entry whose `render:`
 * names a non-addressable component throws HERE, at construction — not on
 * the first render.
 */
export function catalog(entries: Readonly<Record<string, CatalogEntry>>): Catalog {
  for (const [name, entry] of Object.entries(entries)) {
    if (entry.render !== undefined) {
      const activation = Resume.activationOf(entry.render as never);
      if (activation === undefined) {
        throw new Error(
          `[Agent.catalog] Entry "${name}" names a render target that is not an addressable component. Wrap it with Resume.addressable(...) so the render target has a stable activation identity.`,
        );
      }
    }
  }
  return { [CatalogTypeId]: true, entries };
}

/**
 * Wrap a catalog with audit middleware (`DQ-083`). Mutating entries are
 * recorded write-ahead; sink failure defaults to `refuse` (the action never
 * runs and the refusal record is itself written).
 */
export function audited(
  base: Catalog,
  options?: { readonly onFailure?: "refuse" | "proceed" },
): Catalog {
  return { ...base, audit: { onFailure: options?.onFailure ?? "refuse" } };
}

/** DQ-084: the constructor-declared mutation flag, inspectable. */
export function isMutation(base: Catalog, tool: string): boolean {
  return base.entries[tool]?.mutation === true;
}

// ─── Diagnostics (DQ-085 heuristic half) ─────────────────────────────────────

const suspiciousNamePattern = /pass(word)?|token|secret|api[_-]?key|credential/i;

export interface AgentDiagnostic {
  readonly code: "agent:secret-name-suggests-redaction";
  readonly severity: "warning";
  readonly message: string;
  readonly tool: string;
  readonly field: string;
}

/**
 * The M7-style secret-NAME heuristic as a diagnostic, never enforcement: a
 * suspiciously named arg field that was not declared `Agent.secret(...)` gets
 * a warning suggesting the structural fix. A declared secret is silent.
 */
export function catalogDiagnostics(base: Catalog): ReadonlyArray<AgentDiagnostic> {
  const diagnostics: Array<AgentDiagnostic> = [];
  for (const [tool, entry] of Object.entries(base.entries)) {
    for (const element of tupleElementsOf(entry.args)) {
      for (const [field, fieldSchema] of Object.entries(structFieldsOf(element))) {
        if (!suspiciousNamePattern.test(field)) continue;
        if (isSecretSchema(fieldSchema)) continue;
        diagnostics.push({
          code: "agent:secret-name-suggests-redaction",
          severity: "warning",
          message:
            `Tool "${tool}" argument field "${field}" looks like a secret but is not declared with Agent.secret(...). Names never enforce redaction; declare it structurally.`,
          tool,
          field,
        });
      }
    }
  }
  return diagnostics;
}

// ─── Schema introspection helpers ────────────────────────────────────────────

function tupleElementsOf(args: Schema.Top): ReadonlyArray<Schema.Top> {
  const elements = (args as { readonly elements?: ReadonlyArray<Schema.Top> }).elements;
  return elements ?? [];
}

function structFieldsOf(schema: Schema.Top): Readonly<Record<string, Schema.Top>> {
  const fields = (schema as { readonly fields?: Record<string, Schema.Top> }).fields;
  return fields ?? {};
}

function jsonSchemaOf(schema: Schema.Top): unknown {
  return (Schema.toJsonSchemaDocument(schema) as { readonly schema: unknown }).schema;
}

// ─── Tool manifest ───────────────────────────────────────────────────────────

export interface ToolManifestEntry {
  readonly name: string;
  readonly description: string;
  readonly id: string;
  readonly buildId: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly render?: { readonly activationId: string; readonly buildId: string };
}

export interface ToolManifest {
  readonly tools: ReadonlyArray<ToolManifestEntry>;
}

/**
 * The struct-shaped input schema a host reads: derived from the args tuple.
 * A single-struct tuple projects the struct itself; a multi-element tuple
 * projects an object keyed by the authored `argNames` (`DQ-088`).
 */
function inputSchemaOf(entry: CatalogEntry): unknown {
  const elements = tupleElementsOf(entry.args);
  if (entry.argNames !== undefined) {
    const properties: Record<string, unknown> = {};
    entry.argNames.forEach((name, index) => {
      const element = elements[index];
      properties[name] = element === undefined ? {} : jsonSchemaOf(element);
    });
    return {
      type: "object",
      properties,
      required: [...entry.argNames],
      additionalProperties: false,
    };
  }
  if (elements.length === 1 && Object.keys(structFieldsOf(elements[0]!)).length > 0) {
    return jsonSchemaOf(elements[0]!);
  }
  return jsonSchemaOf(entry.args);
}

/** Derive the JSON Schema tool manifest from the declared Effect Schemas. */
export function toolManifest(base: Catalog): Effect.Effect<ToolManifest> {
  return Effect.sync(() => ({
    tools: Object.entries(base.entries).map(([name, entry]) => {
      const activation = entry.render === undefined
        ? undefined
        : Resume.activationOf(entry.render as never);
      return {
        name,
        description: entry.description,
        id: entry.code.id,
        buildId: entry.code.buildId,
        inputSchema: inputSchemaOf(entry),
        outputSchema: jsonSchemaOf(entry.success),
        ...(activation === undefined ? {} : {
          render: { activationId: activation.id, buildId: activation.buildId },
        }),
      };
    }),
  }));
}

// ─── Struct-args projection (DQ-088) ─────────────────────────────────────────

/**
 * Lower a named payload to the positional tuple, keyed by the authored
 * `argNames`. The projection both edges (HTTP/MCP) share.
 */
export function structArgs(
  base: Catalog,
  tool: string,
  named: Readonly<Record<string, unknown>>,
): Effect.Effect<ReadonlyArray<unknown>, AgentArgsDecodeError | AgentToolNotFoundError> {
  return Effect.gen(function* () {
    const entry = base.entries[tool];
    if (entry === undefined) {
      return yield* new AgentToolNotFoundError({
        tool,
        message: `Unknown tool "${tool}".`,
      });
    }
    const names = entry.argNames ?? [];
    for (const key of Object.keys(named)) {
      if (!names.includes(key)) {
        return yield* new AgentArgsDecodeError({
          tool,
          message:
            `Tool "${tool}" has no declared argument named "${key}" (declared: ${names.join(", ")}).`,
        });
      }
    }
    return names.map((name) => named[name]);
  });
}

// ─── Dispatch (DQ-080/081/086) ───────────────────────────────────────────────

export interface DispatchRequest {
  readonly tool: string;
  readonly args: ReadonlyArray<unknown>;
  readonly buildId?: string;
}

export type DispatchResponse =
  | {
    readonly ok: true;
    readonly payload: {
      readonly mutation: unknown;
      readonly loaders: ReadonlyArray<unknown>;
      readonly invalidated: ReadonlyArray<string>;
      readonly url: string;
    };
  }
  | { readonly ok: false; readonly error: unknown };

const failure = (error: unknown): DispatchResponse => ({ ok: false, error });

function encodedErrorOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return error;
  // Plain-data view of a tagged error: enumerable fields plus `_tag`.
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) out[key] = value;
  if ("_tag" in error) out._tag = (error as { readonly _tag: unknown })._tag;
  return out;
}

function callerOf(context: { readonly _tag: string; readonly value?: CallerContextService }): string {
  return context._tag === "Some" ? context.value!.caller : "unknown";
}

/** Redact declared-secret fields from an args value for the audit record. */
function scrubArgs(entry: CatalogEntry, args: ReadonlyArray<unknown>): unknown {
  const elements = tupleElementsOf(entry.args);
  return args.map((value, index) => {
    const element = elements[index];
    if (element === undefined) return value;
    const fields = structFieldsOf(element);
    if (typeof value !== "object" || value === null) return value;
    const out: Record<string, unknown> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      out[key] = isSecretSchema(fields[key]) ? "[redacted]" : fieldValue;
    }
    return out;
  });
}

/**
 * The one dispatch implementation. Pipeline (`DQ-086`, security invariant):
 * authorize → tool lookup → drift → args decode → approve → audit
 * write-ahead → run → encode. Every refusal rides inside the `ok: false`
 * arm; the only thing on the Effect error channel is an audit-sink refusal
 * (`DQ-083` — `runFail`-observable, typed, never a defect).
 */
export function dispatch(base: Catalog) {
  return (request: DispatchRequest): Effect.Effect<DispatchResponse, unknown> =>
    Effect.gen(function* () {
      // DQ-086: authorization OUTERMOST — before the tool is even looked up,
      // so an unauthorized caller learns nothing (not even name validity).
      const maybeAuthorizer = yield* Effect.serviceOption(Authorizer);
      if (maybeAuthorizer._tag === "Some") {
        const denied = yield* Effect.exit(maybeAuthorizer.value.authorize(request.tool));
        if (denied._tag === "Failure") {
          const error = exitErrorOf(denied);
          yield* auditDenial(base, request, error);
          return failure(error);
        }
      }

      const entry = base.entries[request.tool];
      if (entry === undefined) {
        return failure(
          new AgentToolNotFoundError({
            tool: request.tool,
            message: `Unknown tool "${request.tool}".`,
          }),
        );
      }

      // DQ-081: drift fails closed, BEFORE the human step, carrying the
      // fresh manifest for mechanical recovery.
      if (request.buildId === undefined) {
        return failure(
          new AgentBuildIdMissingError({
            tool: request.tool,
            message:
              `Dispatch request for "${request.tool}" carries no buildId; drift cannot be checked, so the call is refused.`,
          }),
        );
      }
      if (request.buildId !== entry.code.buildId) {
        const manifest = yield* toolManifest(base);
        // DQ-081: literally the resumability mechanism (`instanceof
        // PortableBuildMismatchError` holds via the prototype), but shaped as
        // WIRE DATA — own enumerable fields only, no Error `message`/`stack`
        // baggage — so the refusal (recovery manifest included) survives
        // JSON byte-for-byte. Recovery data rides INSIDE the error, never a
        // third arm.
        const mismatch = Object.assign(
          Object.create(Portable.PortableBuildMismatchError.prototype),
          {
            _tag: "PortableBuildMismatchError",
            id: entry.code.id,
            expected: entry.code.buildId,
            actual: request.buildId,
            reason:
              `Tool "${request.tool}" was built for "${entry.code.buildId}" but the caller sent "${request.buildId}".`,
            manifest,
          },
        );
        return failure(mismatch);
      }

      // Args decode through the declared schema BEFORE run observes them.
      const decodedArgs = yield* Effect.exit(
        Schema.decodeUnknownEffect(entry.args as Schema.Codec<ReadonlyArray<unknown>, unknown>)(
          request.args,
        ),
      );
      if (decodedArgs._tag === "Failure") {
        return failure(
          new AgentArgsDecodeError({
            tool: request.tool,
            message: `Arguments for "${request.tool}" failed the declared schema.`,
          }),
        );
      }

      // Approve (after drift: no human is asked about a stale call).
      const maybeApproval = yield* Effect.serviceOption(Approval);
      if (maybeApproval._tag === "Some") {
        const approval = yield* Effect.exit(
          maybeApproval.value.require(`Approve dispatch of "${request.tool}"`),
        );
        if (approval._tag === "Failure") {
          const error = exitErrorOf(approval);
          yield* auditDenial(base, request, error);
          return failure(error);
        }
      }

      // DQ-083: audit WRITE-AHEAD for mutating entries of an audited catalog.
      if (base.audit !== undefined && entry.mutation) {
        const refusal = yield* auditWriteAhead(base, entry, request);
        if (refusal !== undefined) {
          // The refusal is the ONLY thing on the Effect error channel.
          return yield* Effect.fail(refusal);
        }
      }

      const runExit = yield* Effect.exit(
        Portable.execute(
          Portable.bind(entry.code, {}),
          ...(decodedArgs.value as ReadonlyArray<unknown>),
        ) as Effect.Effect<unknown, unknown, never>,
      );
      if (runExit._tag === "Failure") {
        const error = exitErrorOf(runExit);
        if (entry.error !== undefined) {
          const encoded = yield* Effect.exit(
            Schema.encodeUnknownEffect(entry.error as Schema.Codec<unknown, unknown>)(error),
          );
          if (encoded._tag === "Success") return failure(encoded.value);
        }
        // Undeclared failure: fails closed, raw error NEVER forwarded.
        return failure(
          new AgentErrorEncodeError({
            tool: request.tool,
            message:
              `Tool "${request.tool}" failed with an error its catalog entry never declared.`,
          }),
        );
      }

      const encodedSuccess = yield* Effect.exit(
        Schema.encodeUnknownEffect(entry.success as Schema.Codec<unknown, unknown>)(
          runExit.value,
        ),
      );
      if (encodedSuccess._tag === "Failure") {
        return failure(
          new AgentErrorEncodeError({
            tool: request.tool,
            message: `Tool "${request.tool}" produced a result its success schema rejects.`,
          }),
        );
      }

      // AN-2: live sync. Only a SUCCESSFUL dispatch broadcasts, and it
      // broadcasts exactly the declared keys — every refusal above returned
      // before this point, so a failed mutation publishes nothing by
      // construction. Absent service = no live sync installed = no-op.
      const invalidated = [...(entry.reactivityKeys ?? [])];
      const broadcast = yield* Effect.serviceOption(ReactivityBroadcast);
      if (broadcast._tag === "Some" && invalidated.length > 0) {
        yield* broadcast.value.publish(invalidated);
      }

      return {
        ok: true,
        payload: {
          mutation: encodedSuccess.value,
          loaders: [],
          invalidated,
          // §10 correction 4: `SingleFlightPayload.url` is required; agent
          // dispatch has no navigation URL, so it synthesizes the action
          // endpoint identity.
          url: `/_affe/actions/${request.tool}`,
        },
      } satisfies DispatchResponse;
    });
}

function exitErrorOf(exit: { readonly _tag: "Failure"; readonly cause: Cause.Cause<unknown> }): unknown {
  return Cause.findErrorOption(exit.cause).pipe(
    Option.getOrElse(() => exit.cause as unknown),
  );
}

/** Record a governance denial (audited catalogs, mutating entries only). */
function auditDenial(
  base: Catalog,
  request: DispatchRequest,
  error: unknown,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const entry = base.entries[request.tool];
    if (base.audit === undefined || entry === undefined || !entry.mutation) return;
    const sink = yield* Effect.serviceOption(AuditLog);
    if (sink._tag === "None") return;
    const caller = callerOf((yield* Effect.serviceOption(CallerContext)) as never);
    yield* sink.value
      .record({
        tool: request.tool,
        id: entry.code.id,
        buildId: entry.code.buildId,
        caller,
        outcome: "denied",
        mutation: true,
        args: scrubArgs(entry, request.args),
        error: encodedErrorOf(error),
      })
      .pipe(Effect.catchCause(() => Effect.void));
  });
}

/**
 * Write-ahead audit (`DQ-083`): the sink is asked BEFORE the action runs.
 * Returns the sink's error when the default `refuse` policy blocks the call
 * (after durably writing the `audit-refused` record); `undefined` to proceed.
 */
function auditWriteAhead(
  base: Catalog,
  entry: CatalogEntry,
  request: DispatchRequest,
): Effect.Effect<unknown | undefined> {
  return Effect.gen(function* () {
    const sink = yield* Effect.serviceOption(AuditLog);
    if (sink._tag === "None") return undefined;
    const caller = callerOf((yield* Effect.serviceOption(CallerContext)) as never);
    const record: AuditRecord = {
      tool: request.tool,
      id: entry.code.id,
      buildId: entry.code.buildId,
      caller,
      outcome: "success",
      mutation: true,
      args: scrubArgs(entry, request.args),
      ...(entry.reactivityKeys === undefined
        ? {}
        : { reactivityKeys: [...entry.reactivityKeys] }),
    };
    const attempt = yield* Effect.exit(sink.value.record(record));
    if (attempt._tag === "Success") return undefined;
    if (base.audit?.onFailure === "proceed") return undefined;
    // Refuse — and the refusal record is itself durable (best effort).
    yield* sink.value
      .record({ ...record, outcome: "audit-refused" })
      .pipe(Effect.catchCause(() => Effect.void));
    return exitErrorOf(attempt);
  });
}

/**
 * The single-flight entry point is the SAME implementation (§3: one dispatch
 * path); the alias exists so the router adapter and the agent endpoint are
 * visibly the same function.
 */
export function singleFlightHandler(base: Catalog) {
  return dispatch(base);
}

// ─── makeDispatcher (DQ-082) ─────────────────────────────────────────────────

/**
 * Construct a dispatcher over a dynamically assembled Layer, checking
 * governance at CONSTRUCTION: an entry that declares an approval requirement
 * over a stack that cannot provide `Approval` fails with the typed
 * `GovernanceUnsatisfiedError` — never an unmet-service defect at call time.
 */
export function makeDispatcher(
  base: Catalog,
  layer: Layer.Layer<any, any, never>,
): Effect.Effect<
  (request: DispatchRequest) => Effect.Effect<DispatchResponse, unknown>,
  GovernanceUnsatisfiedError | unknown
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(layer);
      for (const [tool, entry] of Object.entries(base.entries)) {
        if (entry.access?.approval === undefined) continue;
        if (Context.getOption(context as Context.Context<unknown>, Approval)._tag === "None") {
          return yield* new GovernanceUnsatisfiedError({
            tool,
            missing: "Approval",
            message:
              `Catalog entry "${tool}" declares approval "${entry.access.approval}" but the supplied layer provides no Approval service.`,
          });
        }
      }
      const dispatcher = dispatch(base);
      return (request: DispatchRequest) =>
        dispatcher(request).pipe(Effect.provide(layer));
    }),
  );
}

// ─── Cache identity (identity unification) ───────────────────────────────────

/**
 * The agent surface mints NO cache identity of its own: dispatch dedupe
 * reuses `Portable.cacheKey` over the entry's descriptor and declared
 * reactivity keys.
 */
export function dispatchCacheKey(
  base: Catalog,
  tool: string,
  options: { readonly captures: unknown },
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const entry = base.entries[tool];
    if (entry === undefined) {
      return yield* new AgentToolNotFoundError({
        tool,
        message: `Unknown tool "${tool}".`,
      });
    }
    const descriptor = yield* Portable.describe(
      Portable.bind(entry.code, options.captures as never),
    );
    return Portable.cacheKey(descriptor, entry.reactivityKeys ?? []);
  });
}
