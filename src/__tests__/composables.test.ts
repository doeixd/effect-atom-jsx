import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import * as Component from "../Component.js";
import * as Behavior from "../Behavior.js";
import * as Element from "../Element.js";
import * as Behaviors from "../behaviors.js";
import * as Composables from "../composables.js";

describe("composables behavior system", () => {
  it("attaches disclosure behavior to element slots", () => {
    const Base = Component.make<{}, never, never, {
      readonly trigger: Element.Interactive;
      readonly content: Element.Container;
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const trigger = yield* Component.slotInteractive();
        const content = yield* Component.slotContainer();
        return { trigger, content };
      }),
      () => null,
    );

    const WithDisclosure = Base.pipe(
      Component.withBehavior(
        Behaviors.disclosure,
        (bindings: { readonly trigger: Element.Interactive; readonly content: Element.Container }) => ({
          trigger: bindings.trigger,
          content: bindings.content,
        }),
      ),
    );

    const bindings = Effect.runSync(
      Component.setupEffect(WithDisclosure, {}) as Effect.Effect<
        {
          readonly trigger: Element.Interactive;
          readonly content: Element.Container;
          readonly isOpen: ReturnType<typeof Component.state<boolean>> extends Effect.Effect<infer S, any, any> ? S : never;
          readonly open: () => void;
          readonly close: () => void;
          readonly toggle: () => void;
        },
        never,
        never
      >,
    );

    expect(bindings.isOpen()).toBe(false);
    bindings.trigger.emit("press");
    expect(bindings.isOpen()).toBe(true);
  });

  it("attaches selection behavior to a collection", () => {
    const Base = Component.make<
      { readonly items: ReadonlyArray<string> },
      never,
      never,
      {
        readonly handles: ReadonlyArray<Element.Interactive>;
        readonly list: Element.Collection<Element.Interactive>;
        readonly items: ReadonlyArray<string>;
      }
    >(
      Component.props<{ readonly items: ReadonlyArray<string> }>(),
      Component.require<never>(),
      ({ items }) => Effect.gen(function* () {
        const handles = items.map(() => Element.interactive());
        const list = Element.collection(handles);
        return { handles, list, items };
      }),
      () => null,
    );

    const WithSelection = Base.pipe(
      Component.withBehavior(
        Behaviors.selection<string>({ multiple: true }),
        (bindings: {
          readonly handles: ReadonlyArray<Element.Interactive>;
          readonly list: Element.Collection<Element.Interactive>;
          readonly items: ReadonlyArray<string>;
        }) => ({
          items: bindings.list,
          getItem: (index: number) => bindings.items[index] ?? "",
        }),
      ),
    );

    const bindings = Effect.runSync(Component.setupEffect(WithSelection, { items: ["a", "b"] }) as Effect.Effect<
      {
        readonly handles: ReadonlyArray<Element.Interactive>;
        readonly list: Element.Collection<Element.Interactive>;
        readonly items: ReadonlyArray<string>;
        readonly selected: ReturnType<typeof Component.state<ReadonlyArray<string>>> extends Effect.Effect<infer S, any, any> ? S : never;
        readonly toggle: (item: string) => void;
        readonly isSelected: (item: string) => boolean;
        readonly clear: () => void;
      },
      never,
      never
    >);
    bindings.handles[0]?.emit("press");
    bindings.handles[1]?.emit("press");

    expect(bindings.selected()).toEqual(["a", "b"]);
  });

  it("supports attachBySlots mapping with slots object", () => {
    const Base = Component.make<{}, never, never, {
      readonly slots: {
        readonly trigger: Element.Interactive;
        readonly content: Element.Container;
      };
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const trigger = yield* Component.slotInteractive();
        const content = yield* Component.slotContainer();
        return { slots: { trigger, content } };
      }),
      () => null,
    );

    const Enhanced = Base.pipe(
      Behavior.attachBySlots(Behaviors.disclosure, {
        trigger: "trigger",
        content: "content",
      }),
    );

    const bindings = Effect.runSync(Component.setupEffect(Enhanced, {}) as unknown as Effect.Effect<
      {
        readonly slots: {
          readonly trigger: Element.Interactive;
          readonly content: Element.Container;
        };
        readonly isOpen: any;
        readonly toggle: () => void;
      },
      never,
      never
    >);

    expect(bindings.isOpen()).toBe(false);
    bindings.slots.trigger.emit("press");
    expect(bindings.isOpen()).toBe(true);
  });

  it("composes search + keyboard nav behaviors", () => {
    const selected: Array<string> = [];
    const rows = ["alpha", "beta", "gamma"] as const;

    const Base = Component.make<{}, never, never, {
      readonly input: Element.Interactive;
      readonly listbox: Element.Interactive;
      readonly rows: ReadonlyArray<string>;
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const input = yield* Component.slotInteractive();
        const listbox = yield* Component.slotInteractive();
        return { input, listbox, rows };
      }),
      () => null,
    );

    const Enhanced = Base.pipe(
      Behavior.attach(Behaviors.searchFilter<string>({
        filter: (item, q) => item.includes(q.toLowerCase()),
      }), {
        select: (bindings: any) => ({
          input: bindings.input,
          items: () => bindings.rows,
        }),
      }),
      Behavior.attach(Behaviors.keyboardNav<string>({
        onSelect: (item) => {
          selected.push(item);
        },
      }), {
        select: (bindings: any) => ({
          container: bindings.listbox,
          items: () => bindings.filtered(),
        }),
      }),
    );

    const bindings = Effect.runSync(Component.setupEffect(Enhanced, {}) as Effect.Effect<any, never, never>);
    bindings.input.emit("input", "a");
    expect(bindings.filtered()).toEqual(["alpha", "beta", "gamma"]);
    bindings.listbox.emit("keydown", { key: "ArrowDown" });
    bindings.listbox.emit("keydown", { key: "Enter" });
    expect(selected.length).toBe(1);
  });

  it("rebinds selection listeners when collection items change", () => {
    const Base = Component.make<{}, never, never, {
      readonly list: Element.Collection<Element.Interactive>;
      readonly handles: {
        readonly first: Element.Interactive;
        readonly second: Element.Interactive;
      };
      readonly values: {
        readonly current: ReadonlyArray<string>;
        set(next: ReadonlyArray<string>): void;
      };
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const first = Element.interactive();
        const second = Element.interactive();
        const list = Element.collection([first]);
        let current: ReadonlyArray<string> = ["a"];
        return {
          list,
          handles: { first, second },
          values: {
            current,
            set(next: ReadonlyArray<string>) {
              current = next;
              this.current = next;
            },
          },
        };
      }),
      () => null,
    );

    const Enhanced = Base.pipe(
      Behavior.attach(Behaviors.selection<string>({ multiple: true }), {
        select: (bindings: any) => ({
          items: bindings.list,
          getItem: (index: number) => bindings.values.current[index] ?? "",
        }),
      }),
    );

    const bindings = Effect.runSync(Component.setupEffect(Enhanced, {}) as Effect.Effect<any, never, never>);

    bindings.handles.first.emit("press");
    expect(bindings.selected()).toEqual(["a"]);

    bindings.list.set([bindings.handles.second]);
    bindings.values.set(["b"]);

    bindings.handles.first.emit("press");
    expect(bindings.selected()).toEqual(["a"]);

    bindings.handles.second.emit("press");
    expect(bindings.selected()).toEqual(["a", "b"]);
  });

  it("composes combobox behavior flow", () => {
    const items = ["alpha", "beta", "gamma"] as const;
    const optionElements = items.map(() => Element.interactive());

    const Base = Component.make<{}, never, never, {
      readonly input: Element.Interactive;
      readonly listbox: Element.Interactive;
      readonly trigger: Element.Interactive;
      readonly content: Element.Container;
      readonly optionElements: Element.Collection<Element.Interactive>;
      readonly items: ReadonlyArray<string>;
    }>(
      Component.props<{}>(),
      Component.require<never>(),
      () => Effect.gen(function* () {
        const input = yield* Component.slotInteractive();
        const listbox = yield* Component.slotInteractive();
        const trigger = yield* Component.slotInteractive();
        const content = yield* Component.slotContainer();
        return {
          input,
          listbox,
          trigger,
          content,
          optionElements: Element.collection(optionElements),
          items,
        };
      }),
      () => null,
    );

    const Enhanced = Base.pipe(
      Behavior.attach(Behaviors.combobox<string>({
        items: () => items,
        filter: (item, query) => item.includes(query.toLowerCase()),
      }), {
        select: (bindings: any) => ({
          input: bindings.input,
          listbox: bindings.listbox,
          trigger: bindings.trigger,
          content: bindings.content,
          optionElements: bindings.optionElements,
        }),
      }),
    );

    const bindings = Effect.runSync(Component.setupEffect(Enhanced, {}) as Effect.Effect<any, never, never>);

    expect(bindings.isOpen()).toBe(false);
    bindings.trigger.emit("press");
    expect(bindings.isOpen()).toBe(true);

    bindings.input.emit("input", "a");
    expect(bindings.filtered()).toEqual(["alpha", "beta", "gamma"]);

    bindings.listbox.emit("keydown", { key: "ArrowDown" });
    bindings.listbox.emit("keydown", { key: "Enter" });

    expect(bindings.selected().length).toBe(1);
    expect(bindings.isOpen()).toBe(false);
  });

  it("provides headless createCombobox factory bindings", () => {
    const Combo = Composables.createCombobox<string>({
      filter: (item, query) => item.includes(query.toLowerCase()),
    });

    const bindings = Effect.runSync(Component.setupEffect(Combo, {
      items: ["alpha", "beta", "gamma"],
    }) as Effect.Effect<any, never, never>);

    bindings.open();
    expect(bindings.isOpen()).toBe(true);

    bindings.input.emit("input", "be");
    expect(bindings.filtered()).toEqual(["beta"]);

    const option = bindings.getOptionHandle(0);
    option.emit("press");
    expect(bindings.selected()).toEqual(["beta"]);
  });
});
