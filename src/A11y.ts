import * as Diagnostics from "./Diagnostics.js";
import * as Element from "./Element.js";
import * as View from "./View.js";

/** Diagnostic codes produced by accessibility pattern validation. */
export type A11yDiagnosticCode =
  | "a11y:missing-pattern-slot"
  | "a11y:slot-capability-mismatch"
  | "a11y:missing-slot-event";

/**
 * Accessibility pattern contract.
 *
 * A pattern names a semantic UI behavior (dialog, tabs, tooltip, etc.) and the
 * structural slots required to support it. Validation checks a rendered
 * `View` against those slots; it does not claim full WCAG certification.
 */
export interface PatternContract<Slots extends View.Slots.Any> {
  readonly name: string;
  readonly slots: Slots;
}

/**
 * Create an accessibility pattern contract from a slot contract.
 *
 * @example
 * const Menu = A11y.pattern("menu", View.Slots.define({
 *   trigger: { capability: Element.Capability.Interactive },
 *   list: { capability: Element.Capability.Container },
 * }))
 */
export function pattern<const Slots extends View.Slots.Any>(
  name: string,
  slots: Slots,
): PatternContract<Slots> {
  return { name, slots };
}

function diagnostic(
  code: A11yDiagnosticCode,
  message: string,
  options?: {
    readonly slot?: string;
    readonly event?: string;
    readonly details?: unknown;
  },
): Diagnostics.Diagnostic {
  return {
    source: "a11y",
    severity: "error",
    code,
    message,
    slot: options?.slot,
    event: options?.event,
    details: options?.details,
  };
}

/**
 * Validate that a rendered view satisfies a pattern contract.
 *
 * The validator checks slot existence, capability compatibility, and required
 * events declared by the pattern slots.
 */
export function validate<Slots extends View.Slots.Any, ViewSlots>(
  contract: PatternContract<Slots>,
  view: View.View<ViewSlots>,
): readonly Diagnostics.Diagnostic[] {
  const diagnostics: Diagnostics.Diagnostic[] = [];
  const renderedSlots = view.slots as Record<string, unknown>;
  const renderedMetadata = view.slotMetadata as Record<string, View.SlotMetadata | undefined> | undefined;

  for (const [slotName, bound] of Object.entries(contract.slots.bound)) {
    const slot = bound.slot;
    if (!(slot.name in renderedSlots)) {
      diagnostics.push(diagnostic(
        "a11y:missing-pattern-slot",
        `Pattern ${contract.name} requires slot ${slot.name}.`,
        { slot: slot.name, details: { pattern: contract.name } },
      ));
      continue;
    }

    const requiredCapability = slot.metadata.capability;
    const renderedCapability = renderedMetadata?.[slot.name]?.capability ?? View.capabilityOf(renderedSlots[slot.name]);
    if (
      requiredCapability !== undefined
      && renderedCapability !== undefined
      && !View.extendsCapability(renderedCapability, requiredCapability)
    ) {
      diagnostics.push(diagnostic(
        "a11y:slot-capability-mismatch",
        `Pattern ${contract.name} slot ${slot.name} requires ${View.nameOfCapability(requiredCapability)}, but the View renders ${View.nameOfCapability(renderedCapability)}.`,
        { slot: slot.name, details: { pattern: contract.name } },
      ));
    }

    const requiredEvents = slot.metadata.allowedEvents ?? [];
    if (requiredEvents.length > 0) {
      const allowedEvents = renderedMetadata?.[slot.name]?.allowedEvents ?? [];
      for (const event of requiredEvents) {
        const eventName = View.nameOfEvent(event);
        if (allowedEvents.some((allowed) => View.nameOfEvent(allowed) === eventName)) continue;
        diagnostics.push(diagnostic(
          "a11y:missing-slot-event",
          `Pattern ${contract.name} slot ${slot.name} requires event ${eventName}.`,
          { slot: slot.name, event: eventName, details: { pattern: contract.name } },
        ));
      }
    }
  }

  return diagnostics;
}

/** Slot contract required by the built-in dialog pattern. */
export const DialogSlots = View.Slots.define({
  root: {
    capability: Element.Capability.Container,
  },
  trigger: {
    capability: Element.Capability.Interactive,
    allowedEvents: [View.Event.Press],
  },
  content: {
    capability: Element.Capability.Container,
  },
});

/** Built-in dialog pattern contract. */
export const Dialog = pattern("dialog", DialogSlots);

/** Two-tier taxonomy (F7): stateful patterns vs pure attachment helpers. */
export type PatternTier = "stateful" | "stateless";

/** Catalog entry for built-in accessibility pattern discovery. */
export interface CatalogEntry<Slots extends View.Slots.Any = View.Slots.Any> {
  readonly contract: PatternContract<Slots>;
  readonly tier: PatternTier;
  readonly roles?: ReadonlyArray<string>;
}

/** Slot contract required by the built-in tooltip pattern. */
export const TooltipSlots = View.Slots.define({
  trigger: { capability: Element.Capability.Interactive, allowedEvents: [View.Event.Hover, View.Event.Focus] },
  content: { capability: Element.Capability.Container },
});
/** Built-in tooltip pattern contract. */
export const Tooltip = pattern("tooltip", TooltipSlots);

/** Slot contract required by the built-in popover pattern. */
export const PopoverSlots = View.Slots.define({
  trigger: { capability: Element.Capability.Interactive, allowedEvents: [View.Event.Press] },
  content: { capability: Element.Capability.Container },
});
/** Built-in popover pattern contract. */
export const Popover = pattern("popover", PopoverSlots);

/** Slot contract required by the built-in tabs pattern. */
export const TabsSlots = View.Slots.define({
  list: { capability: Element.Capability.Container },
  tab: { capability: Element.Capability.Interactive, allowedEvents: [View.Event.Press] },
  panel: { capability: Element.Capability.Container },
});
/** Built-in tabs pattern contract. */
export const Tabs = pattern("tabs", TabsSlots);

/** Slot contract required by the built-in slider pattern. */
export const SliderSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  thumb: { capability: Element.Capability.Interactive, allowedEvents: [View.Event.Press] },
  track: { capability: Element.Capability.Container },
});
/** Built-in slider pattern contract. */
export const Slider = pattern("slider", SliderSlots);

/** Slot contract required by the built-in calendar pattern. */
export const CalendarSlots = View.Slots.define({
  root: { capability: Element.Capability.Container },
  grid: { capability: Element.Capability.Container },
  day: { capability: Element.Capability.Interactive, allowedEvents: [View.Event.Press] },
});
/** Built-in calendar pattern contract. */
export const Calendar = pattern("calendar", CalendarSlots);

/** Slot contract required by the built-in drag-and-drop pattern. */
export const DragAndDropSlots = View.Slots.define({
  source: { capability: Element.Capability.Draggable },
  target: { capability: Element.Capability.Container },
});
/** Built-in drag-and-drop pattern contract. */
export const DragAndDrop = pattern("drag-and-drop", DragAndDropSlots);

/** Built-in pattern catalog for tooling and diagnostics UIs. */
export const catalog: readonly CatalogEntry[] = [
  { contract: Dialog, tier: "stateful", roles: ["dialog", "button"] },
  { contract: Tooltip, tier: "stateless", roles: ["tooltip"] },
  { contract: Popover, tier: "stateful", roles: ["dialog"] },
  { contract: Tabs, tier: "stateful", roles: ["tablist", "tab", "tabpanel"] },
  { contract: Slider, tier: "stateful", roles: ["slider"] },
  { contract: Calendar, tier: "stateful", roles: ["grid", "gridcell"] },
  { contract: DragAndDrop, tier: "stateful", roles: ["listitem"] },
];

export const A11y = {
  pattern,
  validate,
  catalog,
  DialogSlots,
  Dialog,
  TooltipSlots,
  Tooltip,
  PopoverSlots,
  Popover,
  TabsSlots,
  Tabs,
  SliderSlots,
  Slider,
  CalendarSlots,
  Calendar,
  DragAndDropSlots,
  DragAndDrop,
} as const;
