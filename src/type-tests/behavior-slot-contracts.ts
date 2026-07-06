import { Effect } from "effect";
import * as Behavior from "../Behavior.js";
import * as Element from "../Element.js";
import * as MetadataToken from "../MetadataToken.js";
import * as View from "../View.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const Commit = View.Event.make("commit");
const InputSlot = View.Slot.make("input", {
  capability: Element.Capability.TextInput,
  allowedEvents: [View.Event.Input, Commit],
});
const InputSlots = View.Slots.make({
  input: View.Slot.bind(InputSlot, Element.textInput()),
});

const NeedsInput = Behavior.events({
  input: [View.Event.Input, Commit],
})(
  Behavior.make<
    { readonly input: Element.TextInput },
    {},
    never,
    never
  >(() => Effect.succeed({})),
);

type InputEvents = NonNullable<Behavior.EventRequirementsOf<typeof NeedsInput>["input"]>;
type _InputLiteralNames = Expect<Equal<
  MetadataToken.NameOf<InputEvents[number]>,
  "input" | "commit"
>>;

Behavior.validateAttachmentBySlots(
  NeedsInput,
  { input: "input" },
  View.fromSlots(InputSlots, null),
);
