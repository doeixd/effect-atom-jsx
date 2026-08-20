/**
 * Kit dialog — the designated no-machine-required example widget
 * (`docs/kit-research/widgets/dialog.md`), shipped as its SIX LAYERS
 * (K4 no-fork guarantee): tokens → recipe → anatomy (+A11y pattern) →
 * machine → behavior → assembled `Dialog`. Every customization is
 * recomposition of published layers over plain imports — if a reasonable
 * customization needs the widget's source, that is a kit API bug.
 *
 * The platform floor (K3): the dormant markup uses native `<dialog>` plus
 * the invoker-command attributes (`command="show-modal"` / `commandfor`),
 * so the FIRST open needs no JavaScript at all — the browser owns focus
 * trapping, escape-dismiss, inertness of the background, and the top
 * layer. Activation adds state (the `isOpen` binding, the machine) on top
 * of markup that already works.
 */
import { Effect, Schema } from "effect";
import * as A11y from "../A11y.js";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import { insert, setAttribute, template } from "../dom.js";
import * as Element from "../Element.js";
import * as Machine from "../Machine.js";
import * as Style from "../Style.js";
import * as Theme from "../Theme.js";
import * as View from "../View.js";

// ─── Platform floor (DQ-069: closed union, not stringly) ────────────────────

/** The concerns a native element can own so the widget does not have to. */
export type PlatformFloorConcern =
  | "focus-trap"
  | "escape-dismiss"
  | "inert"
  | "top-layer"
  | "backdrop";

export interface PlatformFloor {
  readonly element: string;
  readonly covers: ReadonlyArray<PlatformFloorConcern>;
  /** Feature-detection seam: what a host checks before trusting the floor. */
  readonly detect: string;
}

export const platformFloor: PlatformFloor = {
  element: "dialog",
  covers: ["focus-trap", "escape-dismiss", "inert", "top-layer", "backdrop"],
  detect: "typeof HTMLDialogElement !== 'undefined' && 'showModal' in HTMLDialogElement.prototype",
};

// ─── Layer 1: tokens ─────────────────────────────────────────────────────────

/** Swappable without touching the widget: a Theme layer like any other. */
export const tokens = Theme.define({
  color: {
    surface: Theme.lightDark("#ffffff", "#1c1c1e"),
    backdrop: "rgb(0 0 0 / 0.5)",
    text: Theme.lightDark("#1a1a1a", "#f2f2f4"),
  },
  radius: {
    dialog: "12px",
  },
});

// ─── Layer 2: anatomy + pattern ──────────────────────────────────────────────

/** The dialog anatomy — satisfies the A11y dialog pattern by construction. */
export const Anatomy = View.Slots.define({
  root: { capability: Element.Capability.Container },
  trigger: {
    capability: Element.Capability.Interactive,
    allowedEvents: [View.Event.Press],
  },
  content: { capability: Element.Capability.Container },
});

/** The ARIA pattern contract this widget is gated on (A11y as a gate). */
export const pattern = A11y.Dialog;

// ─── Layer 3: machine ────────────────────────────────────────────────────────

class Closed extends Schema.TaggedClass<Closed>()("DialogClosed", {}) {}
class Open extends Schema.TaggedClass<Open>()("DialogOpen", {}) {}
class OpenEvent extends Schema.TaggedClass<OpenEvent>()("DialogOpenEvent", {}) {}
class CloseEvent extends Schema.TaggedClass<CloseEvent>()("DialogCloseEvent", {}) {}

const states = Machine.defineStates({ Closed, Open });

/** Spawnable on its own: our machine with your DOM. */
export const machine = Machine.make({
  id: "kit-dialog",
  states: states.states,
  events: [OpenEvent, CloseEvent],
  initial: () => states.initial.Closed(new Closed()),
}).handle({
  Closed: {
    on: {
      DialogOpenEvent: ({ target }: { target: { full: { Open: (s: Open) => unknown } } }) =>
        Effect.succeed(target.full.Open(new Open({}))),
    },
  },
  Open: {
    on: {
      DialogCloseEvent: ({ target }: { target: { full: { Closed: (s: Closed) => unknown } } }) =>
        Effect.succeed(target.full.Closed(new Closed({}))),
    },
  },
});

// ─── Layer 4: behavior ───────────────────────────────────────────────────────

export type DialogBehaviorBindings = {
  readonly isOpen: Component.StateAtom<boolean>;
  readonly open: () => void;
  readonly close: () => void;
};

/**
 * Attachable to the anatomy's handles on its own. The trigger press opens;
 * `isOpen` is an atom so it composes with `Style.whenBinding` and resumes
 * for free.
 */
export const behavior = () =>
  Behavior.make<
    {
      readonly root: Element.Handle;
      readonly trigger: Element.Handle;
      readonly content: Element.Handle;
    },
    DialogBehaviorBindings
  >((elements) =>
    Effect.gen(function* () {
      const isOpen = yield* Component.state(false);
      const open = (): void => isOpen.set(true);
      const close = (): void => isOpen.set(false);
      yield* elements.trigger.on("click", open);
      yield* elements.root.on("keydown", (raw) => {
        const event = raw as { readonly key?: string };
        if (event.key === "Escape") close();
      });
      return { isOpen, open, close } satisfies DialogBehaviorBindings;
    })
  ).pipe(
    Behavior.provides({
      isOpen: Behavior.binding<"isOpen", Atom.WritableAtom<boolean>>("isOpen"),
    }),
  );

// ─── Layer 5: recipe (plain data) ────────────────────────────────────────────

/** Recipe DATA, not a closed function: selectable and extendable outside. */
export const recipe = {
  base: {
    root: Style.slot({ position: "relative" }),
    trigger: Style.slot({ cursor: "pointer" }),
    content: Style.slot({
      background: "color.surface",
      color: "color.text",
    }),
  },
  variants: {},
} as const;

// ─── Layer 6: the assembled component ────────────────────────────────────────

export interface DialogProps {
  readonly title: string;
}

let dialogOrdinal = 0;

const shell = template(
  '<div><button type="button" command="show-modal">Open</button><dialog><h2></h2><div></div></dialog></div>',
);

interface WalkableElement {
  readonly firstChild: WalkableElement | null;
  readonly nextSibling: WalkableElement | null;
}

/**
 * The assembled default — a component, not a factory of one. Dormant markup
 * first: the invoker-command pair opens the native dialog with zero script,
 * and no inline handler smuggles JS into the zero-JS claim.
 */
export const Dialog = Component.make(
  Component.props<DialogProps>(),
  Component.require<never>(),
  Component.setup<DialogProps>().value(
    "dialogId",
    () => `af-dialog-${dialogOrdinal++}`,
  ),
  (props, bindings) => {
    // Validation-only renders (the a11y gate iterating the kit registry) run
    // with no document and need only the slot contract; markup materializes
    // whenever a real document — client or SSR — is present.
    if (typeof document === "undefined") {
      return View.fromSlots(Anatomy, null);
    }
    const root = shell();
    const walkable = root as unknown as WalkableElement;
    const trigger = walkable.firstChild;
    const dialogElement = trigger?.nextSibling;
    const heading = dialogElement?.firstChild;
    const contentHost = heading?.nextSibling;
    if (trigger !== null && trigger !== undefined) {
      setAttribute(trigger as unknown as globalThis.Element, "commandfor", bindings.dialogId);
    }
    if (dialogElement !== null && dialogElement !== undefined) {
      setAttribute(dialogElement as unknown as globalThis.Element, "id", bindings.dialogId);
    }
    if (heading !== null && heading !== undefined) {
      insert(heading as unknown as globalThis.Element, props.title);
    }
    void contentHost;
    return View.fromSlots(Anatomy, root);
  },
).pipe(Component.withSlots(Anatomy));
