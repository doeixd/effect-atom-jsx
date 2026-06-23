import * as Element from "../Element.js";
import * as SafeHtml from "../SafeHtml.js";
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
View.validatePlatform(view, {
  name: "web",
  capabilities: ["Container", "Interactive"],
  events: ["click"],
  attributes: ["aria-label"],
  requirements: [],
});

View.text("label");
View.text(1);
View.text(false);
View.className(["root", { active: true, disabled: false }]);
View.style({ color: "red", opacity: 0.5 });
View.event<MouseEvent>((event) => {
  event.preventDefault();
});
View.children([View.text("child")]);

const safe = SafeHtml.make("<strong>trusted</strong>");
View.html(safe);

// @ts-expect-error raw strings are not accepted for HTML holes
View.html("<strong>unsafe</strong>");

// @ts-expect-error arbitrary objects are not accepted for HTML holes
View.html({ html: "<strong>unsafe</strong>" });

// @ts-expect-error style hole values must be primitive CSS values
View.style({ color: { nested: true } });
