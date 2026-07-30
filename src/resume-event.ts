import { Schema } from "effect";
import * as Portable from "./Portable.js";

export const EventHandlerTypeId: unique symbol = Symbol.for(
  "effect-atom-jsx/Resume/EventHandler",
);

export const DeferredNoArgs = "deferred-no-args" as const;
export const ActivationProjection = "activation-projection" as const;
export type EventInvocation =
  | typeof DeferredNoArgs
  | typeof ActivationProjection;

export const EventTargetKey = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9_.:-]*$/),
);
export type EventTargetKey = typeof EventTargetKey.Type;

export const MouseEventProjectionSchema = Schema.Struct({
  kind: Schema.Literal("mouse-v1"),
  altKey: Schema.Boolean,
  button: Schema.Finite,
  buttons: Schema.Finite,
  clientX: Schema.Finite,
  clientY: Schema.Finite,
  ctrlKey: Schema.Boolean,
  metaKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
});
export type MouseEventProjection = typeof MouseEventProjectionSchema.Type;

export interface EventProjection<Id extends string, Value> {
  readonly id: Id;
  readonly schema: Schema.Codec<Value, unknown>;
  /**
   * Whether this projection has a faithful capture contract for an event
   * type. Collection and installation both enforce this before handoff.
   */
  readonly supportsEventType: (eventType: string) => boolean;
  readonly capture: (event: Event) => Value;
}

const mouseProjectionEventTypes = new Set([
  "auxclick",
  "click",
  "contextmenu",
  "dblclick",
  "drag",
  "dragend",
  "dragenter",
  "dragexit",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "mousedown",
  "mouseenter",
  "mouseleave",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "pointercancel",
  "pointerdown",
  "pointerenter",
  "pointerleave",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "wheel",
]);

/**
 * The first predefined activation handoff projection. It is deliberately
 * small, JSON-safe, and independent of the native Event lifetime.
 */
export const MouseEventProjection: EventProjection<
  "mouse-v1",
  MouseEventProjection
> = Object.freeze({
  id: "mouse-v1",
  schema: MouseEventProjectionSchema,
  supportsEventType: (eventType: string) =>
    mouseProjectionEventTypes.has(eventType),
  capture: (event: Event) => {
    if (!mouseProjectionEventTypes.has(event.type)) {
      throw new TypeError(
        `[effect-atom-jsx] MouseEventProjection cannot capture the "${event.type}" event type.`,
      );
    }
    const mouse = event as MouseEvent;
    return Schema.decodeUnknownSync(MouseEventProjectionSchema)({
      kind: "mouse-v1",
      altKey: Boolean(mouse.altKey),
      button: Number(mouse.button ?? 0),
      buttons: Number(mouse.buttons ?? 0),
      clientX: Number(mouse.clientX ?? 0),
      clientY: Number(mouse.clientY ?? 0),
      ctrlKey: Boolean(mouse.ctrlKey),
      metaKey: Boolean(mouse.metaKey),
      shiftKey: Boolean(mouse.shiftKey),
    });
  },
});

export type AnyEventProjection = typeof MouseEventProjection;
export type ActivationProjectionValue = MouseEventProjection;

export type EventAttachment =
  | {
    readonly kind: "portable";
    readonly invocation: typeof DeferredNoArgs;
    readonly unsupportedReason?: string;
    readonly inspection: Portable.ExecutableInspection<
      readonly [],
      unknown,
      unknown,
      unknown
    >;
  }
  | {
    readonly kind: "activation";
    readonly invocation: typeof ActivationProjection;
    readonly targetKey: EventTargetKey;
    readonly projection: AnyEventProjection;
    readonly replay: (projection: ActivationProjectionValue) => unknown;
  };

export interface EventHandler extends EventListener {
  readonly [EventHandlerTypeId]: () => EventAttachment;
}

/**
 * Mark a zero-argument portable action as an independently executable event.
 *
 * The wrapper deliberately discards the native Event during ordinary client
 * execution, matching the dormant dispatch path after an asynchronous load.
 */
export function event<A, E, R>(
  action: (() => void) & Portable.InspectableExecutable<readonly [], A, E, R>,
): EventHandler {
  const inspection = Portable.inspectExecutable(action);
  const execution = inspection.kind === "portable"
    ? inspection.execution
    : undefined;
  const unsupported: string[] = [];
  if (execution?.kind === "component-action") {
    if (execution.hasReactivityKeys) unsupported.push("reactivityKeys");
    if (execution.hasTransitionObserver) unsupported.push("onTransition");
    if (execution.concurrency !== undefined) unsupported.push("concurrency");
    if (execution.detached) unsupported.push("detached");
  }
  const attachment: EventAttachment = Object.freeze({
    kind: "portable",
    invocation: DeferredNoArgs,
    ...(unsupported.length === 0
      ? {}
      : {
        unsupportedReason:
          `Resume.event does not yet preserve Component.action options: ${unsupported.join(", ")}.`,
      }),
    inspection,
  });
  const handler = ((_event: Event) => {
    action();
  }) as EventHandler;
  Object.defineProperty(handler, EventHandlerTypeId, {
    enumerable: false,
    value: () => attachment,
  });
  return Object.freeze(handler);
}

/**
 * Mark an event as activation-required and define its exact replay contract.
 *
 * `targetKey` is stable within the owning component boundary. The native Event
 * is projected synchronously; only the schema-backed plain value crosses the
 * asynchronous activation boundary.
 */
export function activationEvent(
  targetKeyValue: string,
  projection: AnyEventProjection,
  handler: (projection: ActivationProjectionValue) => unknown,
): EventHandler {
  const targetKey = Schema.decodeUnknownSync(EventTargetKey)(targetKeyValue);
  const replay = (value: ActivationProjectionValue): unknown =>
    handler(Schema.decodeUnknownSync(projection.schema)(value));
  const attachment: EventAttachment = Object.freeze({
    kind: "activation",
    invocation: ActivationProjection,
    targetKey,
    projection,
    replay,
  });
  const eventHandler = ((nativeEvent: Event) => {
    replay(projection.capture(nativeEvent));
  }) as EventHandler;
  Object.defineProperty(eventHandler, EventHandlerTypeId, {
    enumerable: false,
    value: () => attachment,
  });
  return Object.freeze(eventHandler);
}

export function inspectEventHandler(
  value: unknown,
): EventAttachment | undefined {
  if (
    typeof value === "function"
    && EventHandlerTypeId in value
  ) {
    return (value as EventHandler)[EventHandlerTypeId]();
  }
  return undefined;
}

const activationTargets = new WeakMap<
  object,
  Map<string, Map<EventTargetKey, EventHandler>>
>();

export function replayTargetAttribute(eventType: string): string {
  return `data-af-replay-${eventType}`;
}

/** Register an activation handler installed by the DOM runtime. */
export function registerActivationEventTarget(
  target: object,
  eventType: string,
  handler: unknown,
): EventTargetKey | undefined {
  let attachment: EventAttachment | undefined;
  try {
    attachment = inspectEventHandler(handler);
  } catch {
    // Collection owns inspection diagnostics. Runtime registration must not
    // turn optional metadata into a render failure.
    return undefined;
  }
  if (attachment?.kind !== "activation") return undefined;
  let byType = activationTargets.get(target);
  if (byType === undefined) {
    byType = new Map();
    activationTargets.set(target, byType);
  }
  let byKey = byType.get(eventType);
  if (byKey === undefined) {
    byKey = new Map();
    byType.set(eventType, byKey);
  }
  byKey.set(attachment.targetKey, handler as EventHandler);
  return attachment.targetKey;
}

/** Replay one already-decoded projection through the committed listener. */
export function replayActivationEvent(
  target: object,
  eventType: string,
  targetKey: EventTargetKey,
  projection: ActivationProjectionValue,
): boolean {
  const handler = activationTargets.get(target)?.get(eventType)?.get(targetKey);
  const attachment = handler === undefined
    ? undefined
    : inspectEventHandler(handler);
  if (attachment?.kind !== "activation") return false;
  attachment.replay(projection);
  return true;
}
