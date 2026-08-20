/**
 * AN-5 — the json-render target projection (`DQ-094` ratified name; the
 * `result-wire.ts` precedent: a target-format lowering in core).
 *
 * The core IR is target-neutral: state references are typed segment records,
 * slots are named, actions are `{name, params}` values. Only THIS module
 * knows json-render's wire dialect — `$state` / `$bindState` JSON Pointers,
 * `type`-keyed elements, and the v0.20.0 semantics recorded in
 * `docs/af-ui-json-render/JSON_RENDER_V0.20_UPSTREAM.md`:
 *
 * - named slots lower to `slots` VERBATIM (#320) — no flattening into
 *   `children`, no invented wrapper elements, no name loss;
 * - every element carries a `children` array, `[]` on leaves (#299 —
 *   upstream models omit the required field otherwise; a deterministic
 *   lowering is not allowed to reproduce that bug);
 * - action bindings lower WHOLE — `{event, action, params}` — so the
 *   allowlisted name and its arguments cannot drift apart on the wire
 *   (#307's `executeAction(ActionBinding)` contract);
 * - `visible` is omitted when there is no condition (optional as of #299).
 *
 * If a pre-0.20 target is ever needed, slot flattening becomes an explicit
 * downlevel option — never the default.
 */
import { Effect } from "effect";
import type {
  ActionBindingSpec,
  ElementNode,
  PropValue,
  SpecNode,
  ViewTree,
} from "./ViewSpec.js";

/** RFC 6901 JSON Pointer from typed path segments. */
function pointerOf(segments: ReadonlyArray<string>): string {
  return `/${segments.map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

type LoweredProp =
  | string
  | number
  | boolean
  | { readonly $state: string }
  | { readonly $bindState: string };

interface LoweredAction {
  readonly event: string;
  readonly action: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface LoweredElement {
  readonly type: string;
  readonly props: Readonly<Record<string, LoweredProp>>;
  /** Always present; `[]` on leaves (#299). */
  readonly children: ReadonlyArray<LoweredNode>;
  readonly slots?: Readonly<Record<string, ReadonlyArray<LoweredNode>>>;
  readonly actions?: ReadonlyArray<LoweredAction>;
}

/** Text lowers to a plain string — json-render's default-slot text form. */
type LoweredNode = LoweredElement | string;

export interface LoweredViewTree {
  readonly root: LoweredNode;
}

function lowerProp(value: PropValue): LoweredProp {
  if (typeof value === "object") {
    const pointer = pointerOf(value.path.segments);
    return value.kind === "ui.stateBinding"
      ? { $bindState: pointer }
      : { $state: pointer };
  }
  return value;
}

function lowerAction(binding: { readonly event: string; readonly action: ActionBindingSpec }): LoweredAction {
  return {
    event: binding.event,
    action: binding.action.name,
    params: binding.action.params,
  };
}

function lowerElement(node: ElementNode): LoweredElement {
  const props: Record<string, LoweredProp> = {};
  for (const [name, value] of Object.entries(node.props)) {
    props[name] = lowerProp(value);
  }
  const slots: Record<string, ReadonlyArray<LoweredNode>> = {};
  for (const [name, children] of Object.entries(node.slots)) {
    slots[name] = children.map(lowerNode);
  }
  const actions = (node.events ?? []).map(lowerAction);
  return {
    type: node.component,
    props,
    // v0.20 named slots do not inherit their owner's repeat scope and are
    // not the default slot: `children` stays the default channel and is
    // ALWAYS present, empty on a leaf.
    children: [],
    ...(Object.keys(slots).length === 0 ? {} : { slots }),
    ...(actions.length === 0 ? {} : { actions }),
  };
}

function lowerNode(node: SpecNode): LoweredNode {
  return node.kind === "ui.text" ? node.value : lowerElement(node);
}

/** Lower a validated core tree to the json-render v0.20 wire dialect. */
export function lower(tree: ViewTree): Effect.Effect<LoweredViewTree> {
  return Effect.sync(() => ({ root: lowerNode(tree.root) }));
}
