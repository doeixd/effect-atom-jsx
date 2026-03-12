import { Effect } from "effect";
import * as Component from "./Component.js";
import * as Element from "./Element.js";
import * as Behaviors from "./behaviors.js";
import type * as Atom from "./Atom.js";

export type ComboboxBindings<T> = {
  readonly slots: {
    readonly trigger: Element.Interactive;
    readonly input: Element.Interactive;
    readonly listbox: Element.Interactive;
    readonly content: Element.Container;
    readonly optionElements: Element.Collection<Element.Interactive>;
  };
  readonly trigger: Element.Interactive;
  readonly input: Element.Interactive;
  readonly listbox: Element.Interactive;
  readonly content: Element.Container;
  readonly getOptionHandle: (index: number) => Element.Interactive;
  readonly optionHandles: Atom.ReadonlyAtom<ReadonlyArray<Element.Interactive>>;
  readonly isOpen: Atom.WritableAtom<boolean>;
  readonly query: Atom.WritableAtom<string>;
  readonly filtered: Atom.ReadonlyAtom<ReadonlyArray<T>>;
  readonly selected: Atom.WritableAtom<ReadonlyArray<T>>;
  readonly activeIndex: Atom.WritableAtom<number>;
  readonly isSelected: (item: T) => boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly toggle: () => void;
  readonly select: () => void;
  readonly handleInputKeyDown: (event: { readonly key?: string }) => void;
  readonly clearSelection: () => void;
};

export function createCombobox<T>(options: {
  readonly filter: (item: T, query: string) => boolean;
  readonly multiple?: boolean;
}) {
  return Component.headless<
    {
      readonly items: ReadonlyArray<T>;
    },
    never,
    never,
    ComboboxBindings<T>
  >(
    Component.props<{ readonly items: ReadonlyArray<T> }>(),
    Component.require<never>(),
    (props) => Effect.gen(function* () {
      const trigger = yield* Component.slotInteractive();
      const input = yield* Component.slotInteractive();
      const listbox = yield* Component.slotInteractive();
      const content = yield* Component.slotContainer();

      const optionHandles = yield* Component.state<ReadonlyArray<Element.Interactive>>([]);
      const optionElements = Element.collection<Element.Interactive>([]);

      const getOptionHandle = (index: number): Element.Interactive => {
        const current = optionHandles();
        const existing = current[index];
        if (existing !== undefined) return existing;

        const next = current.slice();
        while (next.length <= index) {
          next.push(Element.interactive());
        }
        optionHandles.set(next);
        optionElements.set(next);
        return next[index] as Element.Interactive;
      };

      const combo = yield* Behaviors.combobox<T>({
        items: () => props.items,
        filter: options.filter,
        multiple: options.multiple,
      }).run({
        input,
        listbox,
        trigger,
        content,
        optionElements,
      });

      return {
        slots: {
          trigger,
          input,
          listbox,
          content,
          optionElements,
        },
        trigger,
        input,
        listbox,
        content,
        getOptionHandle,
        optionHandles,
        ...combo,
      };
    }),
  );
}

export const Composables = {
  createCombobox,
} as const;
