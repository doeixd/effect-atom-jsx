import { describe, expect, it } from "vitest";
import { Effect, Layer, ServiceMap } from "effect";
import { createSignal, createMemo } from "../api.js";
import * as Component from "../Component.js";
import * as Element from "../Element.js";
import { defineQuery, defineMutation, useService } from "../effect-ts.js";
import * as Style from "../Style.js";
import {
  attrOf,
  behaviorDriver,
  expectAttr,
  expectScenarioOk,
  expectStyle,
  mockService,
  render,
  renderWithLayer,
  resolveAction,
  resolveQuery,
  Result,
  scenario,
  scene,
  step,
  story,
  styleOf,
  withTestLayer,
} from "../testing.js";
import * as View from "../View.js";

interface Api {
  fetchData(): Effect.Effect<string, Error>;
  saveData(n: number): Effect.Effect<void, Error>;
}
const Api = ServiceMap.Service<Api>("Api");

describe("testing.ts harness", () => {
  it("withTestLayer executes logic inside a reactive root with layer services", async () => {
    const ApiMock = mockService(Api, {
      fetchData: () => Effect.succeed("mocked data"),
      saveData: () => Effect.void,
    });

    const harness = withTestLayer(ApiMock);

    // Run logic inside the harness's boundary
    const result = harness.run(() => {
      return defineQuery(() => useService(Api).fetchData()).result;
    });

    // Effect.succeed resolves synchronously, so the result is immediately Success
    // (no Loading state for sync effects).
    await harness.tick();

    const settled = result();
    expect(settled._tag).toBe("Success");
    if (settled._tag === "Success") {
      expect(settled.value).toBe("mocked data");
    }

    await harness.dispose();
  });

  it("renderWithLayer runs the ui block immediately", async () => {
    let savedValue = 0;
    const ApiMock = mockService(Api, {
      fetchData: () => Effect.succeed(""),
      saveData: (n) => Effect.sync(() => { savedValue = n; }),
    });

    const harness = renderWithLayer(ApiMock, () => {
      const save = defineMutation((n: number) => useService(Api).saveData(n));
      save.run(42);
    });

    await harness.tick();
    expect(savedValue).toBe(42);

    await harness.dispose();
  });

  it("cleans up running effects on dispose", async () => {
    let started = false;
    let interrupted = false;
    const ApiMock = mockService(Api, {
      fetchData: () => Effect.gen(function* () {
        started = true;
        yield* Effect.sleep("1 hour");
        return "done";
      }).pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))),
      saveData: () => Effect.void,
    });

    const harness = renderWithLayer(ApiMock, () => {
      defineQuery(() => useService(Api).fetchData());
    });

    await harness.tick();
    expect(started).toBe(true);
    expect(interrupted).toBe(false);

    await harness.dispose();
    expect(interrupted).toBe(true);
  });

  it("renders a component View and returns typed slot handles with a behavior driver", async () => {
    const Slots = View.Slots.define({
      root: { capability: Element.Capability.Container },
      button: { capability: Element.Capability.Interactive },
    });
    let pressed = 0;
    const ButtonCard = Component.make<{}, never, never, { readonly slots: View.Slots.HandlesOf<typeof Slots> }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => {
        const slots = View.Slots.handles(Slots);
        return slots.button.on("press", () => {
          pressed += 1;
        }).pipe(Effect.as({ slots }));
      },
      () => View.fromSlots(Slots, null),
    ).pipe(
      Component.withSlots(Slots),
      Style.attachToSlots(
        Style.forSlots(Slots)({
          root: Style.slot({ opacity: 1 }),
        }),
        Slots,
      ),
    );

    const rendered = await render(ButtonCard, { props: {} });

    rendered.driver.press("button");
    expect(pressed).toBe(1);
    expect(rendered.slots.root.kind).toBe("Container");
    expect(rendered.driver.style("root", "opacity")).toBe(1);
    expect(styleOf(rendered.slots.root, "opacity")).toBe(1);
    expectStyle(rendered.slots.root, "opacity", 1);
  });

  it("behaviorDriver and attr helpers work directly on handle maps", () => {
    const root = Element.container();
    Effect.runSync(root.setAttr("role", "button"));
    const driver = behaviorDriver({ root });

    expect(driver.attr("root", "role")).toBe("button");
    expect(attrOf(root, "role")).toBe("button");
    expectAttr(root, "role", "button");
  });

  it("runs named scenarios and stops after the first failed step", async () => {
    const events: Array<string> = [];
    const result = await scenario("button flow", { events }, [
      step("press", ({ events }) => {
        events.push("press");
      }),
      step("assert", () => {
        throw new Error("boom");
      }),
      step("skipped", ({ events }) => {
        events.push("skipped");
      }),
    ]);

    expect(events).toEqual(["press"]);
    expect(result.steps.map((item) => item.name)).toEqual(["press", "assert"]);
    expect(result.steps.map((item) => item.ok)).toEqual([true, false]);
    expect(() => expectScenarioOk(result)).toThrow("button flow");
  });

  it("passes successful scenarios", async () => {
    const result = await scenario("empty", {}, [
      step("noop", () => undefined),
    ]);

    expectScenarioOk(result);
    expect(result.steps).toEqual([{ name: "noop", ok: true }]);
  });

  it("resolveQuery short-circuits a query Result without mock layers", async () => {
    const harness = withTestLayer(Layer.empty);
    const query = harness.run(() =>
      defineQuery(() => Effect.succeed("never-used"), { name: "todos" }),
    );

    resolveQuery(query, Result.success("scripted"));
    expect(query.result()).toMatchObject({ _tag: "Success", value: "scripted" });

    resolveQuery(query, Result.failure(new Error("boom")));
    expect(query.result()._tag).toBe("Failure");

    await harness.dispose();
  });

  it("resolveAction short-circuits a mutation Result", async () => {
    const harness = withTestLayer(Layer.empty);
    const save = harness.run(() =>
      defineMutation((_n: number) => Effect.succeed(undefined), { name: "save" }),
    );

    resolveAction(save, Result.loading);
    expect(save.result()._tag).toBe("Loading");
    // flush inside setResultForTest keeps pending in sync without awaiting a tick
    expect(save.pending()).toBe(true);

    resolveAction(save, Result.failure("nope"));
    expect(save.result()).toMatchObject({ _tag: "Failure", error: "nope" });
    expect(save.pending()).toBe(false);

    resolveAction(save, Result.success(undefined));
    expect(save.result()._tag).toBe("Success");
    expect(save.pending()).toBe(false);

    await harness.dispose();
  });

  it("behaviorDriver supports keyboard and collection flows", () => {
    const optionA = Element.interactive();
    const optionB = Element.interactive();
    const trigger = Element.interactive();
    const keys: Array<string> = [];
    const pressed: Array<number> = [];
    const triggerKeys: Array<string> = [];

    // listen() does not require a reactive owner (unlike on()).
    Effect.runSync(optionA.listen("keydown", (event) => {
      keys.push(String((event as { key?: string }).key));
    }));
    Effect.runSync(optionA.listen("press", () => {
      pressed.push(0);
    }));
    Effect.runSync(optionB.listen("press", () => {
      pressed.push(1);
    }));
    Effect.runSync(trigger.listen("keydown", (event) => {
      triggerKeys.push(String((event as { key?: string }).key));
    }));

    const options = Element.collection([optionA, optionB]);
    const driver = behaviorDriver({ options, trigger });

    driver.keydown("trigger", "ArrowDown");
    driver.keydownItem("options", 0, "Enter");
    driver.pressItem("options", 1);

    expect(driver.collectionSize("options")).toBe(2);
    expect(triggerKeys).toEqual(["ArrowDown"]);
    expect(keys).toEqual(["Enter"]);
    expect(pressed).toEqual([1]);
    expect((driver.item("options", 0) as Element.Interactive).kind).toBe("Interactive");
  });

  it("story and scene taxonomy wrappers set kind and stop on failure", async () => {
    const storyResult = await story("save flow", { n: 1 }, [
      step("seed", (ctx) => {
        expect(ctx.n).toBe(1);
      }),
      step("fail", () => {
        throw new Error("nope");
      }),
      step("skipped", () => undefined),
    ]);
    expect(storyResult.kind).toBe("story");
    expect(storyResult.steps.map((item) => item.ok)).toEqual([true, false]);
    expect(() => expectScenarioOk(storyResult)).toThrow("Story");

    const sceneResult = await scene("press button", {}, [
      step("press", () => undefined),
    ]);
    expect(sceneResult.kind).toBe("scene");
    expectScenarioOk(sceneResult);
  });
});
