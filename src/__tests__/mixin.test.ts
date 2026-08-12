/**
 * K0c — `Mixin.create` + fragments + `toBehavior` (`DQ-065` ratified).
 *
 * The acceptance bar is the plan's desugaring checklist: a Mixin
 * materialization must be OBSERVATIONALLY EQUIVALENT to a hand-written
 * Schema factory — same options defaults, same bindings keys, same
 * `provides` metadata, same element requirements, same composition rules.
 * The golden pair here is the real `press` factory vs a Mixin `Press`.
 */
import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import * as Mixin from "../Mixin.js";
import { press, PressOptions } from "../behaviors/press.js";

/** The golden Mixin definition, mirroring the hand-written press factory. */
const Press = Mixin.create(
  Mixin.tag("press"),
  Mixin.options(PressOptions),
  Mixin.props<{ readonly onPress?: () => void }>(),
  Mixin.elements<{ readonly target: Element.Interactive }>(),
  Mixin.provides({
    isPressed: Behavior.binding<"isPressed", Atom.WritableAtom<boolean>>("isPressed"),
  }),
  Mixin.effect(
    (ctx: Mixin.EffectContext<
      typeof PressOptions.Type,
      { readonly onPress?: () => void },
      { readonly target: Element.Interactive },
      {}
    >) =>
      Effect.gen(function* () {
        const isPressed = yield* Component.state(false);
        let down = false;
        yield* ctx.elements.target.on("pointerdown", () => {
          down = true;
          if (ctx.options.trackPressed) isPressed.set(true);
        });
        yield* ctx.elements.target.on("pointerup", () => {
          if (!down) return;
          down = false;
          if (ctx.options.trackPressed) isPressed.set(false);
          ctx.props.onPress?.();
        });
        return {
          isPressed,
          press: () => {
            ctx.props.onPress?.();
          },
        };
      }),
  ),
);
const mixinPress = Mixin.toBehavior(Press);

describe("Mixin golden parity with the hand-written factory", () => {
  it("same defaults, same bindings keys, same provides metadata, same fixture behavior", () => {
    let handPresses = 0;
    let mixinPresses = 0;
    const attachBoth = () => {
      const handTarget = Element.interactive();
      const mixinTarget = Element.interactive();
      const hand = Effect.runSync(
        Behavior.attachScoped(press({ onPress: () => { handPresses += 1; } }), {
          target: handTarget,
        }),
      );
      const viaMixin = Effect.runSync(
        Behavior.attachScoped(
          mixinPress({ onPress: () => { mixinPresses += 1; } }),
          { target: mixinTarget },
        ),
      );
      return { handTarget, mixinTarget, hand, viaMixin };
    };
    const { handTarget, mixinTarget, hand, viaMixin } = attachBoth();

    // Checklist 3: same provides metadata.
    expect(Object.keys(mixinPress().metadata?.provides ?? {})).toEqual(
      Object.keys(press().metadata?.provides ?? {}),
    );
    // Checklist 2: same bindings keys.
    expect(Object.keys(viaMixin.bindings)).toEqual(Object.keys(hand.bindings));

    // Checklist 1: same Schema decode defaults (trackPressed true) — both
    // track a press on the same fixture sequence.
    for (const [target, attached] of [
      [handTarget, hand],
      [mixinTarget, viaMixin],
    ] as const) {
      expect(attached.bindings.isPressed()).toBe(false);
      target.emit("pointerdown", { button: 0, pointerId: 1 });
      expect(attached.bindings.isPressed()).toBe(true);
      target.emit("pointerup", { button: 0, pointerId: 1 });
      expect(attached.bindings.isPressed()).toBe(false);
    }
    expect(handPresses).toBe(1);
    expect(mixinPresses).toBe(1);

    Effect.runSync(hand.dispose);
    Effect.runSync(viaMixin.dispose);
  });

  it("config splits by the Schema's own field names: knobs decode, props never do", () => {
    // trackPressed is a Schema field; onPress is a prop. A malformed KNOB
    // fails closed at attach exactly like the hand-written factory…
    const malformed = mixinPress({
      trackPressed: "yes" as unknown as boolean,
      onPress: () => {},
    });
    const exit = Effect.runSyncExit(
      Behavior.attachScoped(malformed, { target: Element.interactive() }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    const error = Cause.findErrorOption(exit.cause).pipe(
      Option.getOrElse(() => undefined),
    );
    expect(error?._tag).toBe("BehaviorOptionsError");
    if (error?._tag !== "BehaviorOptionsError") return;
    // …and the error names the definition's tag.
    expect(error.behavior).toBe("press");
  });

  it("checklist 5: Mixin-materialized behaviors compose exactly like factories", () => {
    const extra = Behavior.make((_e: { readonly target: Element.Interactive }) =>
      Effect.succeed({ extra: true })
    );
    const stacked = Behavior.compose(mixinPress(), extra);
    const target = Element.interactive();
    const attached = Effect.runSync(Behavior.attachScoped(stacked, { target }));
    expect(Object.keys(attached.bindings).sort()).toEqual(["extra", "isPressed", "press"]);
    expect(Behavior.inspectAttachment(stacked).kind).toBe("opaque");
    Effect.runSync(attached.dispose);
  });
});

describe("Mixin specialization and guardrails", () => {
  it("a prior definition as first fragment specializes: inherited unless overridden", () => {
    const Silent = Mixin.create(
      Press,
      Mixin.options(
        Mixin.mergeSchemas(
          PressOptions,
          Schema.Struct({
            silent: Schema.Boolean.pipe(
              Schema.withDecodingDefault(Effect.succeed(false)),
            ),
          }),
        ),
      ),
    );
    // tag, elements, provides, effect all inherited.
    expect(Silent.tag).toBe("press");
    expect(Object.keys(Silent.provides ?? {})).toEqual(["isPressed"]);
    const factory = Mixin.toBehavior(Silent);
    const attached = Effect.runSync(
      Behavior.attachScoped(factory({ silent: true }), {
        target: Element.interactive(),
      }),
    );
    expect(attached.bindings.isPressed()).toBe(false);
    Effect.runSync(attached.dispose);

    // The base definition is immutable — specialization never mutates it.
    expect(Object.keys((Press.options as typeof PressOptions).fields)).toEqual(
      Object.keys(PressOptions.fields),
    );
  });

  it("a behavior definition without an effect fails at materialize time, loudly", () => {
    const NoBody = Mixin.create(Mixin.tag("no-body"));
    expect(() => Mixin.toBehavior(NoBody)).toThrow(/no effect fragment/);
    const Recipeish = Mixin.create(Mixin.tag("r"), Mixin.kind("recipe"));
    expect(() => Mixin.toBehavior(Recipeish as never)).toThrow(/kind "recipe"/);
  });
});
