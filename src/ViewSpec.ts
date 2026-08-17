/**
 * AN-5 — the typed view-spec IR, the component catalog, and the validator
 * that make agent-authored UI safe **by construction** (`AGENT_NATIVE_NOTES.md`
 * §4.2, §7 item 5; module name ratified by `DQ-094`).
 *
 * The load-bearing design decision (`DQ-090`, ratified): the IR has **no
 * markup-bearing node kind at all**. Text nodes carry `value`, never `html`.
 * That makes §4.2's security claim true by unrepresentability — raw HTML is
 * rejected at the schema boundary because it cannot be expressed, not
 * because a validator caught it. A diagnostic can be disabled, downgraded,
 * or bypassed by a second entry point; a kind that does not exist cannot be
 * constructed.
 *
 * Three surfaces:
 * - **Constructors** (`element`/`text`/`viewTree`/`on`/`action`,
 *   `stateModel`/`state`/`bindState`) build the closure-free, JSON-clean
 *   tree an agent's emitted JSON also decodes into.
 * - **`decodeSpec`** is the TRUST BOUNDARY for agent output: a structural
 *   decoder that rejects unknown node kinds and undeclared fields
 *   (an `html` field smuggled onto a text node is refused, not stripped),
 *   and whose refusals name the offending KIND and path but never echo
 *   field contents — rejected markup must not travel back out through the
 *   error.
 * - **`validate`** checks a decoded tree against the app's component
 *   catalog, state model, and action allowlist, with one diagnostic code
 *   per refusal so near-neighbour failures stay distinguishable (a
 *   server-only field is not a typo; a hidden tool is not a missing one).
 */
import { Effect, Schema } from "effect";

// ─── Node kinds (DQ-090) ─────────────────────────────────────────────────────

/**
 * The COMPLETE set of tree node kinds. This array is the specification a
 * later contributor must contradict in order to reintroduce a
 * markup-bearing kind — there is deliberately no `ui.html`, `ui.raw`,
 * `ui.markup`, or `ui.script`.
 */
export const NodeKinds = ["ui.element", "ui.text"] as const;
export type NodeKind = (typeof NodeKinds)[number];

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ViewSpecDecodeError extends Schema.TaggedErrorClass<ViewSpecDecodeError>(
  "@effect-atom-jsx/ViewSpecDecodeError",
)("ViewSpecDecodeError", {
  /** Structural description only — never echoes field contents. */
  message: Schema.String,
  path: Schema.String,
}) {}

export class ViewSpecInvalidError extends Schema.TaggedErrorClass<ViewSpecInvalidError>(
  "@effect-atom-jsx/ViewSpecInvalidError",
)("ViewSpecInvalidError", {
  message: Schema.String,
  codes: Schema.Array(Schema.String),
}) {}

// ─── State model ─────────────────────────────────────────────────────────────

export interface StateFieldSpec {
  readonly type: Schema.Top;
  readonly writable: boolean;
  readonly serverOnly?: boolean;
}

/** A typed reference to one declared state field. */
export interface StateFieldRef {
  readonly segments: ReadonlyArray<string>;
  readonly writable: boolean;
  readonly serverOnly: boolean;
}

export interface StateModel<Fields extends Record<string, StateFieldSpec> = Record<string, StateFieldSpec>> {
  readonly name: string;
  readonly fields: { readonly [K in keyof Fields]: StateFieldRef };
}

/**
 * Declare the client-addressable state surface. Field refs carry their
 * declared path/writability for AUTHORING; `validate` re-derives every
 * verdict from the model itself, so a hand-forged ref cannot claim a
 * permission the model never granted.
 */
export function stateModel<const Fields extends Record<string, StateFieldSpec>>(options: {
  readonly name: string;
  readonly fields: Fields;
}): StateModel<Fields> {
  const fields = {} as { [K in keyof Fields]: StateFieldRef };
  for (const key of Object.keys(options.fields) as Array<keyof Fields>) {
    const spec = options.fields[key]!;
    fields[key] = {
      segments: [String(key)],
      writable: spec.writable,
      serverOnly: spec.serverOnly === true,
    };
  }
  return { name: options.name, fields };
}

/** A read-only state reference in a prop position. */
export interface StateValueRef {
  readonly kind: "ui.stateValue";
  readonly path: {
    readonly segments: ReadonlyArray<string>;
    readonly writable: boolean;
  };
}

/** A two-way state binding in a prop position. */
export interface StateBindingRef {
  readonly kind: "ui.stateBinding";
  readonly path: {
    readonly segments: ReadonlyArray<string>;
    readonly writable: boolean;
  };
}

/** Reference a declared field's VALUE (one-way read). */
export function state(field: StateFieldRef): StateValueRef {
  return {
    kind: "ui.stateValue",
    path: { segments: [...field.segments], writable: field.writable },
  };
}

/** Bind a declared field TWO-WAY (requires a writable field to validate). */
export function bindState(field: StateFieldRef): StateBindingRef {
  return {
    kind: "ui.stateBinding",
    path: { segments: [...field.segments], writable: field.writable },
  };
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

export interface SlotSpec {
  readonly many: boolean;
}

export function slotSpec(options?: { readonly many?: boolean }): SlotSpec {
  return { many: options?.many === true };
}

export interface ComponentEntry {
  readonly name: string;
  readonly description: string;
  readonly props: Schema.Top;
  readonly slots: Readonly<Record<string, SlotSpec>>;
}

export function componentEntry(options: ComponentEntry): ComponentEntry {
  return options;
}

export interface ComponentCatalog {
  readonly entries: Readonly<Record<string, ComponentEntry>>;
}

export function componentCatalog(
  entries: Readonly<Record<string, ComponentEntry>>,
): ComponentCatalog {
  return { entries };
}

// ─── Tree nodes ──────────────────────────────────────────────────────────────

export interface TextNode {
  readonly kind: "ui.text";
  /** Content is DATA, never interpreted — there is no `html` field. */
  readonly value: string;
}

export type PropValue = string | number | boolean | StateValueRef | StateBindingRef;

export interface ActionBindingSpec {
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface EventBinding {
  readonly event: string;
  readonly action: ActionBindingSpec;
}

export interface ElementNode {
  readonly kind: "ui.element";
  readonly component: string;
  readonly props: Readonly<Record<string, PropValue>>;
  readonly slots: Readonly<Record<string, ReadonlyArray<SpecNode>>>;
  readonly events?: ReadonlyArray<EventBinding>;
}

export type SpecNode = ElementNode | TextNode;

export interface ViewTree {
  readonly kind: "ui.viewTree";
  readonly root: SpecNode;
}

export function text(value: string): TextNode {
  return { kind: "ui.text", value };
}

export function element(
  component: string,
  options: {
    readonly props: Readonly<Record<string, PropValue>>;
    readonly slots: Readonly<Record<string, ReadonlyArray<SpecNode>>>;
    readonly events?: ReadonlyArray<EventBinding>;
  },
): ElementNode {
  return {
    kind: "ui.element",
    component,
    props: options.props,
    slots: options.slots,
    ...(options.events === undefined ? {} : { events: options.events }),
  };
}

export function viewTree(root: SpecNode): ViewTree {
  return { kind: "ui.viewTree", root };
}

export function action(
  name: string,
  params: Readonly<Record<string, unknown>>,
): ActionBindingSpec {
  return { name, params };
}

export function on(event: string, binding: ActionBindingSpec): EventBinding {
  return { event, action: binding };
}

// ─── decodeSpec — the trust boundary ─────────────────────────────────────────

/**
 * Sanitize a value for inclusion in a refusal message: short identifier-like
 * strings pass through (so "unknown kind `ui.html`" stays explainable);
 * anything else — attacker-shaped content included — is described, never
 * echoed.
 */
function describeKind(value: unknown): string {
  if (typeof value === "string" && /^[a-zA-Z0-9._-]{1,64}$/.test(value)) {
    return `"${value}"`;
  }
  return typeof value === "string" ? "a non-identifier string" : `a ${typeof value}`;
}

function fail(message: string, path: string): Effect.Effect<never, ViewSpecDecodeError> {
  return Effect.fail(new ViewSpecDecodeError({ message, path }));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  record: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
  path: string,
): ViewSpecDecodeError | undefined {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      // An undeclared field is REJECTED, not stripped: silently dropping it
      // would let a smuggled `html` field ride along unnoticed until some
      // later consumer honoured it.
      return new ViewSpecDecodeError({
        message: `Undeclared field ${describeKind(key)} is not part of the spec IR.`,
        path,
      });
    }
  }
  return undefined;
}

function decodeStateRef(
  value: Record<string, unknown>,
  kind: "ui.stateValue" | "ui.stateBinding",
  path: string,
): StateValueRef | StateBindingRef | ViewSpecDecodeError {
  const excess = checkKeys(value, ["kind", "path"], path);
  if (excess !== undefined) return excess;
  const pathRecord = value.path;
  if (!isPlainObject(pathRecord)) {
    return new ViewSpecDecodeError({ message: "State reference has no path record.", path });
  }
  const segments = pathRecord.segments;
  if (
    !Array.isArray(segments)
    || segments.length === 0
    || segments.some((segment) => typeof segment !== "string")
  ) {
    return new ViewSpecDecodeError({
      message: "State reference path segments must be a non-empty string array.",
      path,
    });
  }
  return {
    kind,
    path: {
      segments: segments as ReadonlyArray<string>,
      writable: pathRecord.writable === true,
    },
  };
}

function decodePropValue(
  value: unknown,
  path: string,
): PropValue | ViewSpecDecodeError {
  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (isPlainObject(value)) {
    if (value.kind === "ui.stateValue" || value.kind === "ui.stateBinding") {
      return decodeStateRef(value, value.kind, path);
    }
    return new ViewSpecDecodeError({
      message: `Prop value kind ${describeKind(value.kind)} is not a member of the spec IR.`,
      path,
    });
  }
  return new ViewSpecDecodeError({
    message: `Prop values are primitives or state references, received a ${typeof value}.`,
    path,
  });
}

function decodeNode(
  value: unknown,
  path: string,
): Effect.Effect<SpecNode, ViewSpecDecodeError> {
  return Effect.gen(function* () {
    if (!isPlainObject(value)) {
      return yield* fail(`A spec node must be an object, received a ${typeof value}.`, path);
    }
    const kind = value.kind;
    if (kind === "ui.text") {
      // Text carries `value`, never `html` (DQ-090's second half): the one
      // node kind that carries a string must not become markup's re-entry
      // point, so an extra field fails the DECODE rather than being ignored.
      const excess = checkKeys(value, ["kind", "value"], path);
      if (excess !== undefined) return yield* Effect.fail(excess);
      if (typeof value.value !== "string") {
        return yield* fail("A text node requires a string `value`.", path);
      }
      return { kind: "ui.text", value: value.value } satisfies TextNode;
    }
    if (kind === "ui.element") {
      const excess = checkKeys(
        value,
        ["kind", "component", "props", "slots", "events"],
        path,
      );
      if (excess !== undefined) return yield* Effect.fail(excess);
      if (typeof value.component !== "string") {
        return yield* fail("An element node requires a string `component`.", path);
      }
      if (!isPlainObject(value.props)) {
        return yield* fail("An element node requires a `props` record.", path);
      }
      if (!isPlainObject(value.slots)) {
        return yield* fail("An element node requires a `slots` record.", path);
      }
      const props: Record<string, PropValue> = {};
      for (const [name, propValue] of Object.entries(value.props)) {
        const decoded = decodePropValue(propValue, `${path}.props.${name}`);
        if (decoded instanceof ViewSpecDecodeError) return yield* Effect.fail(decoded);
        props[name] = decoded;
      }
      const slots: Record<string, ReadonlyArray<SpecNode>> = {};
      for (const [name, children] of Object.entries(value.slots)) {
        if (!Array.isArray(children)) {
          return yield* fail(
            `Slot ${describeKind(name)} must hold an array of nodes.`,
            `${path}.slots`,
          );
        }
        const decodedChildren: Array<SpecNode> = [];
        for (let index = 0; index < children.length; index += 1) {
          decodedChildren.push(
            yield* decodeNode(children[index], `${path}.slots.${name}[${index}]`),
          );
        }
        slots[name] = decodedChildren;
      }
      let events: Array<EventBinding> | undefined;
      if (value.events !== undefined) {
        if (!Array.isArray(value.events)) {
          return yield* fail("`events` must be an array.", path);
        }
        events = [];
        for (let index = 0; index < value.events.length; index += 1) {
          const entry = value.events[index];
          const entryPath = `${path}.events[${index}]`;
          if (!isPlainObject(entry)) {
            return yield* fail("An event binding must be an object.", entryPath);
          }
          const entryExcess = checkKeys(entry, ["event", "action"], entryPath);
          if (entryExcess !== undefined) return yield* Effect.fail(entryExcess);
          if (typeof entry.event !== "string") {
            return yield* fail("An event binding requires a string `event`.", entryPath);
          }
          const binding = entry.action;
          if (!isPlainObject(binding)) {
            return yield* fail("An event binding requires an `action` record.", entryPath);
          }
          const bindingExcess = checkKeys(binding, ["name", "params"], entryPath);
          if (bindingExcess !== undefined) return yield* Effect.fail(bindingExcess);
          if (typeof binding.name !== "string") {
            return yield* fail("An action binding requires a string `name`.", entryPath);
          }
          if (!isPlainObject(binding.params)) {
            return yield* fail("An action binding requires a `params` record.", entryPath);
          }
          events.push({
            event: entry.event,
            action: { name: binding.name, params: binding.params },
          });
        }
      }
      return {
        kind: "ui.element",
        component: value.component,
        props,
        slots,
        ...(events === undefined ? {} : { events }),
      } satisfies ElementNode;
    }
    // The refusal is about the KIND — explainable, and pointedly not a
    // catalog story: adding `ui.html` to a catalog must never be a
    // workaround, because the union it would have to inhabit has no such
    // member. Field contents are never echoed.
    return yield* fail(
      `Node kind ${describeKind(kind)} is not a member of the spec IR (kinds: ${NodeKinds.join(", ")}).`,
      path,
    );
  });
}

/**
 * Decode an untrusted (agent-emitted) value into a `ViewTree`. This is the
 * boundary DQ-090's unrepresentability claim lives at: a markup-bearing
 * node fails the SCHEMA — before any validator runs — and the rejected
 * content does not travel back out through the error.
 */
export function decodeSpec(
  input: unknown,
): Effect.Effect<ViewTree, ViewSpecDecodeError> {
  return Effect.gen(function* () {
    if (!isPlainObject(input)) {
      return yield* fail(`A view spec must be an object, received a ${typeof input}.`, "$");
    }
    if (input.kind !== "ui.viewTree") {
      return yield* fail(
        `A view spec's kind must be "ui.viewTree", received ${describeKind(input.kind)}.`,
        "$",
      );
    }
    const excess = checkKeys(input, ["kind", "root"], "$");
    if (excess !== undefined) return yield* Effect.fail(excess);
    const root = yield* decodeNode(input.root, "$.root");
    return { kind: "ui.viewTree", root };
  });
}

// ─── validate ────────────────────────────────────────────────────────────────

export type ViewSpecDiagnosticCode =
  | "ui:unknown-node-kind"
  | "ui:unknown-catalog-component"
  | "ui:component-unknown-slot"
  | "ui:two-way-binding-readonly"
  | "ui:server-only-field-bound-to-client"
  | "ui:unknown-state-path"
  | "ui:action-not-registered";

export interface ViewSpecDiagnostic {
  readonly code: ViewSpecDiagnosticCode;
  readonly severity: "error";
  readonly message: string;
  readonly path: string;
}

export interface ValidateOptions {
  readonly catalog: ComponentCatalog;
  readonly state?: StateModel;
  /** Positive allowlist: an action absent from it is refused even if the app has it. */
  readonly actions?: ReadonlyArray<string>;
}

interface ModelField {
  readonly writable: boolean;
  readonly serverOnly: boolean;
}

function modelFieldOf(
  model: StateModel | undefined,
  segments: ReadonlyArray<string>,
): ModelField | undefined {
  if (model === undefined) return undefined;
  if (segments.length !== 1) return undefined;
  const field = model.fields[segments[0]!];
  return field === undefined
    ? undefined
    : { writable: field.writable, serverOnly: field.serverOnly };
}

/**
 * Validate a tree against the app's catalog, state model, and action
 * allowlist. Verdicts come from the OPTIONS, never from claims a ref
 * carries — a forged `writable: true` changes nothing.
 */
export function validate(
  tree: ViewTree,
  options: ValidateOptions,
): Effect.Effect<ReadonlyArray<ViewSpecDiagnostic>> {
  return Effect.sync(() => {
    const diagnostics: Array<ViewSpecDiagnostic> = [];
    const report = (
      code: ViewSpecDiagnosticCode,
      message: string,
      path: string,
    ): void => {
      diagnostics.push({ code, severity: "error", message, path });
    };

    const visitRef = (
      ref: StateValueRef | StateBindingRef,
      path: string,
    ): void => {
      const field = modelFieldOf(options.state, ref.path.segments);
      if (field === undefined) {
        // "Does not exist" and "exists but is server-only" are different
        // refusals: collapsing them would tell an agent a secret field is
        // merely misspelled, or vice versa.
        report(
          "ui:unknown-state-path",
          `State path ${describeKind(ref.path.segments.join("."))} is not declared by the state model.`,
          path,
        );
        return;
      }
      if (field.serverOnly) {
        report(
          "ui:server-only-field-bound-to-client",
          `State path ${describeKind(ref.path.segments.join("."))} never leaves the server and cannot appear in a client spec.`,
          path,
        );
        return;
      }
      if (ref.kind === "ui.stateBinding" && !field.writable) {
        report(
          "ui:two-way-binding-readonly",
          `State path ${describeKind(ref.path.segments.join("."))} is read-only; a two-way binding requires a writable field.`,
          path,
        );
      }
    };

    const visitNode = (node: SpecNode, path: string): void => {
      const record = node as unknown as Record<string, unknown>;
      if (record.kind === "ui.text") return;
      if (record.kind !== "ui.element") {
        // A hand-constructed node that bypassed `decodeSpec` (the deliberate
        // dynamic escape hatch) is refused here too — defense in depth, not
        // the load-bearing check.
        report(
          "ui:unknown-node-kind",
          `Node kind ${describeKind(record.kind)} is not a member of the spec IR.`,
          path,
        );
        return;
      }
      const elementNode = node as ElementNode;
      const entry = options.catalog.entries[elementNode.component];
      if (entry === undefined) {
        report(
          "ui:unknown-catalog-component",
          `Component ${describeKind(elementNode.component)} is not in the catalog.`,
          path,
        );
        return;
      }
      for (const [name, value] of Object.entries(elementNode.props)) {
        if (
          isPlainObject(value)
          && (value.kind === "ui.stateValue" || value.kind === "ui.stateBinding")
        ) {
          visitRef(value as StateValueRef | StateBindingRef, `${path}.props.${name}`);
        }
      }
      for (const [slotName, children] of Object.entries(elementNode.slots)) {
        if (entry.slots[slotName] === undefined) {
          report(
            "ui:component-unknown-slot",
            `Component ${describeKind(elementNode.component)} declares no slot ${describeKind(slotName)}.`,
            `${path}.slots`,
          );
          continue;
        }
        children.forEach((child, index) => {
          visitNode(child, `${path}.slots.${slotName}[${index}]`);
        });
      }
      for (const binding of elementNode.events ?? []) {
        if (!(options.actions ?? []).includes(binding.action.name)) {
          report(
            "ui:action-not-registered",
            `Action ${describeKind(binding.action.name)} is not on the allowlist for this spec.`,
            `${path}.events`,
          );
        }
      }
    };

    visitNode(tree.root, "$.root");
    return diagnostics;
  });
}
