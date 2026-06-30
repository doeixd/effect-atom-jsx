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
  View.make(
    { input: Element.textInput() },
    null,
    {
      slotMetadata: {
        input: View.slot("input", {
          allowedEvents: [View.Event.Input, Commit],
        }),
      },
    },
  ),
);
