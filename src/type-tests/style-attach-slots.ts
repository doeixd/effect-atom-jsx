import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Style from "../Style.js";

const style = Style.make({
  root: Style.slot({ padding: "md" }),
  title: Style.slot({ fontSize: "heading.sm" }),
});

const Card = Component.make<
  {},
  never,
  never,
  {
    readonly slots: {
      readonly root: ReturnType<typeof Component.slotContainer> extends Effect.Effect<infer S, any, any> ? S : never;
      readonly title: ReturnType<typeof Component.slotInteractive> extends Effect.Effect<infer S, any, any> ? S : never;
    };
  }
>(
  Component.props<{}>(),
  Component.require<never>(),
  () => Effect.gen(function* () {
    const root = yield* Component.slotContainer();
    const title = yield* Component.slotInteractive();
    return { slots: { root, title } };
  }),
  () => null,
);

Card.pipe(
  Style.attachBySlots(style, {
    root: "root",
    title: "title",
  }),
);

const strictAttach = Style.attachBySlotsFor<Component.BindingsOf<typeof Card>>();

strictAttach(style, {
  root: "root",
  title: "title",
});

strictAttach(style, {
  root: "root",
  // @ts-expect-error missing component slot name
  title: "header",
});
