import * as Element from "../Element.js";
import * as View from "../View.js";

type Slots = {
  readonly root: Element.Container;
  readonly trigger: Element.Interactive;
};

const root = Element.container();
const trigger = Element.interactive();

const view = View.make(
  { root, trigger },
  null,
  {
    slotMetadata: {
      root: View.slot("root", { capability: "Container" }),
      trigger: View.hidden("trigger", { capability: "Interactive" }),
    },
    slotRemaps: [
      View.remap<Slots>("root", "root"),
    ],
  },
);

type ViewSlots = View.SlotsOf<typeof view>;

const _root: ViewSlots["root"] = root;
const _trigger: ViewSlots["trigger"] = trigger;

View.remap<Slots>("root", "trigger");

// @ts-expect-error unknown source slot
View.remap<Slots>("missing", "trigger");

// @ts-expect-error unknown target slot
View.remap<Slots>("root", "missing");

View.validateSlotTargets(view, ["root", "trigger"]);

