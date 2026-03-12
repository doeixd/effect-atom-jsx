import { Effect } from "effect";
import * as Behavior from "./Behavior.js";
import * as Component from "./Component.js";
import * as Atom from "./Atom.js";
import type * as Element from "./Element.js";

type KeyLikeEvent = { readonly key?: string };

export const disclosure = Behavior.make<{
  readonly trigger: Element.Interactive;
  readonly content: Element.Container;
}, {
  readonly isOpen: Atom.WritableAtom<boolean>;
  readonly open: () => void;
  readonly close: () => void;
  readonly toggle: () => void;
}, never, never>((elements) =>
  Effect.gen(function* () {
    const bindings = yield* createDisclosureBindings();

    yield* elements.trigger.on("press", () => {
      bindings.toggle();
    });

    yield* elements.trigger.setAttr("aria-expanded", () => bindings.isOpen());
    yield* elements.content.setAttr("aria-hidden", () => !bindings.isOpen());

    return bindings;
  }));

function createDisclosureBindings() {
  return Effect.gen(function* () {
    const isOpen = yield* Component.state(false);
    return {
      isOpen,
      open: () => isOpen.set(true),
      close: () => isOpen.set(false),
      toggle: () => isOpen.update((v) => !v),
    };
  });
}

export const selection = <T>(options?: {
  readonly multiple?: boolean;
  readonly equals?: (a: T, b: T) => boolean;
}) => Behavior.make<{
  readonly items: Element.Collection<Element.Interactive>;
  readonly getItem: (index: number) => T | undefined;
}, {
  readonly selected: Atom.WritableAtom<ReadonlyArray<T>>;
  readonly toggle: (item: T) => void;
  readonly isSelected: (item: T) => boolean;
  readonly clear: () => void;
}, never, never>((elements) =>
  Effect.gen(function* () {
    const bindings = yield* createSelectionBindings<T>(options);

    yield* elements.items.observeEach((itemEl, index) =>
      Effect.gen(function* () {
        const off = yield* itemEl.listen("press", () => {
          const item = elements.getItem(index);
          if (item !== undefined) {
            bindings.toggle(item);
          }
        });
        yield* itemEl.setAttr("aria-selected", () => {
          const item = elements.getItem(index);
          return item === undefined ? false : bindings.isSelected(item);
        });
        return () => {
          off();
        };
      }));

    return bindings;
  }));

function createSelectionBindings<T>(options?: {
  readonly multiple?: boolean;
  readonly equals?: (a: T, b: T) => boolean;
}) {
  return Effect.gen(function* () {
    const eq = options?.equals ?? ((a: T, b: T) => Object.is(a, b));
    const selected = yield* Component.state<ReadonlyArray<T>>([]);

    const isSelected = (item: T): boolean => selected().some((s) => eq(s, item));

    const toggle = (item: T): void => {
      if (isSelected(item)) {
        selected.update((prev) => prev.filter((s) => !eq(s, item)));
        return;
      }
      if (options?.multiple) {
        selected.update((prev) => [...prev, item]);
      } else {
        selected.set([item]);
      }
    };

    return {
      selected,
      toggle,
      isSelected,
      clear: () => selected.set([]),
    };
  });
}

export const searchFilter = <T>(options: {
  readonly filter: (item: T, query: string) => boolean;
}) => Behavior.make<{
  readonly input: Element.Interactive;
  readonly items: () => ReadonlyArray<T>;
}, {
  readonly query: Atom.WritableAtom<string>;
  readonly filtered: Atom.ReadonlyAtom<ReadonlyArray<T>>;
  readonly hasResults: Atom.ReadonlyAtom<boolean>;
  readonly resultCount: Atom.ReadonlyAtom<number>;
  readonly clear: () => void;
}, never, never>((elements) =>
  Effect.gen(function* () {
    const query = yield* Component.state("");
    const filtered = yield* Component.derived(() => {
      const q = query();
      const all = elements.items();
      if (!q) return all;
      return all.filter((item) => options.filter(item, q));
    });
    const hasResults = yield* Component.derived(() => filtered().length > 0);
    const resultCount = yield* Component.derived(() => filtered().length);

    yield* elements.input.on("input", (next) => {
      if (typeof next === "string") {
        query.set(next);
      }
    });

    return {
      query,
      filtered,
      hasResults,
      resultCount,
      clear: () => query.set(""),
    };
  }));

export const keyboardNav = <T>(options?: {
  readonly wrap?: boolean;
  readonly orientation?: "vertical" | "horizontal";
  readonly onSelect?: (item: T) => void;
}) => Behavior.make<{
  readonly container: Element.Interactive;
  readonly items: () => ReadonlyArray<T>;
}, {
  readonly activeIndex: Atom.WritableAtom<number>;
  readonly activeItem: Atom.ReadonlyAtom<T | undefined>;
  readonly next: () => void;
  readonly prev: () => void;
  readonly first: () => void;
  readonly last: () => void;
  readonly select: () => void;
  readonly isActive: (index: number) => boolean;
  readonly handleKeyDown: (event: KeyLikeEvent) => void;
}, never, never>((elements) =>
  Effect.gen(function* () {
    const activeIndex = yield* Component.state(0);

    const clamp = (index: number): number => {
      const len = elements.items().length;
      if (len === 0) return 0;
      if (options?.wrap) return ((index % len) + len) % len;
      return Math.max(0, Math.min(index, len - 1));
    };

    const next = (): void => activeIndex.update((i) => clamp(i + 1));
    const prev = (): void => activeIndex.update((i) => clamp(i - 1));
    const first = (): void => activeIndex.set(0);
    const last = (): void => activeIndex.set(Math.max(0, elements.items().length - 1));
    const select = (): void => {
      const item = elements.items()[activeIndex()];
      if (item !== undefined) options?.onSelect?.(item);
    };

    const vertical = options?.orientation !== "horizontal";
    const handleKeyDown = (event: KeyLikeEvent): void => {
      const key = event.key;
      if (key === undefined) return;
      if (key === (vertical ? "ArrowDown" : "ArrowRight")) {
        next();
      } else if (key === (vertical ? "ArrowUp" : "ArrowLeft")) {
        prev();
      } else if (key === "Home") {
        first();
      } else if (key === "End") {
        last();
      } else if (key === "Enter" || key === " ") {
        select();
      }
    };

    yield* elements.container.on("keydown", (event) => handleKeyDown(event as KeyLikeEvent));
    yield* elements.container.setAttr("aria-activedescendant", () => `item-${activeIndex()}`);

    return {
      activeIndex,
      activeItem: yield* Component.derived(() => elements.items()[activeIndex()]),
      next,
      prev,
      first,
      last,
      select,
      isActive: (index: number) => activeIndex() === index,
      handleKeyDown,
    };
  }));

export const pagination = (options?: {
  readonly initialPage?: number;
  readonly pageSize?: number;
  readonly total?: () => number;
}) => Behavior.make<{}, {
  readonly page: Atom.WritableAtom<number>;
  readonly pageSize: Atom.WritableAtom<number>;
  readonly totalPages: Atom.ReadonlyAtom<number>;
  readonly hasNext: Atom.ReadonlyAtom<boolean>;
  readonly hasPrev: Atom.ReadonlyAtom<boolean>;
  readonly next: () => void;
  readonly prev: () => void;
  readonly goTo: (page: number) => void;
  readonly first: () => void;
  readonly last: () => void;
}, never, never>(() =>
  Effect.gen(function* () {
    const page = yield* Component.state(options?.initialPage ?? 0);
    const pageSize = yield* Component.state(options?.pageSize ?? 20);
    const totalPages = yield* Component.derived(() => {
      const total = options?.total?.();
      if (total === undefined) return Number.POSITIVE_INFINITY;
      return Math.max(1, Math.ceil(total / Math.max(1, pageSize())));
    });

    const clamp = (value: number): number => {
      const max = totalPages();
      if (!Number.isFinite(max)) return Math.max(0, value);
      return Math.max(0, Math.min(value, max - 1));
    };

    return {
      page,
      pageSize,
      totalPages,
      hasNext: yield* Component.derived(() => page() < totalPages() - 1),
      hasPrev: yield* Component.derived(() => page() > 0),
      next: () => page.update((p) => clamp(p + 1)),
      prev: () => page.update((p) => clamp(p - 1)),
      goTo: (value: number) => page.set(clamp(value)),
      first: () => page.set(0),
      last: () => page.set(clamp(Number.POSITIVE_INFINITY)),
    };
  }));

export const focusTrap = () => Behavior.make<{
  readonly container: Element.Interactive;
}, {
  readonly active: Atom.WritableAtom<boolean>;
  readonly activate: () => void;
  readonly deactivate: () => void;
  readonly handleKeyDown: (event: KeyLikeEvent) => void;
}, never, never>((elements) =>
  Effect.gen(function* () {
    const active = yield* Component.state(false);
    const handleKeyDown = (_event: KeyLikeEvent): void => {
      if (!active()) return;
    };

    yield* elements.container.on("keydown", (event) => {
      handleKeyDown(event as KeyLikeEvent);
    });

    return {
      active,
      activate: () => active.set(true),
      deactivate: () => active.set(false),
      handleKeyDown,
    };
  }));

export const combobox = <T>(options: {
  readonly items: () => ReadonlyArray<T>;
  readonly filter: (item: T, query: string) => boolean;
  readonly multiple?: boolean;
}) => Behavior.make<{
  readonly input: Element.Interactive;
  readonly listbox: Element.Interactive;
  readonly trigger: Element.Interactive;
  readonly content: Element.Container;
  readonly optionElements: Element.Collection<Element.Interactive>;
}, {
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
  readonly handleInputKeyDown: (event: KeyLikeEvent) => void;
  readonly clearSelection: () => void;
}, never, never>((elements) =>
  Effect.gen(function* () {
    const disclosureBindings = yield* disclosure.run({
      trigger: elements.trigger,
      content: elements.content,
    });

    const trapBindings = yield* focusTrap().run({
      container: elements.content,
    });

    const searchBindings = yield* searchFilter<T>({
      filter: options.filter,
    }).run({
      input: elements.input,
      items: options.items,
    });

    const getFiltered = (): ReadonlyArray<T> => searchBindings.filtered();

    const selectionBindings = yield* selection<T>({
      multiple: options.multiple,
    }).run({
      items: elements.optionElements,
      getItem: (index) => getFiltered()[index],
    });

    const navBindings = yield* keyboardNav<T>({
      onSelect: (item) => {
        selectionBindings.toggle(item);
        if (!options.multiple) {
          disclosureBindings.close();
          trapBindings.deactivate();
        }
      },
    }).run({
      container: elements.listbox,
      items: getFiltered,
    });

    const open = (): void => {
      disclosureBindings.open();
      trapBindings.activate();
    };

    const close = (): void => {
      disclosureBindings.close();
      trapBindings.deactivate();
      searchBindings.clear();
      navBindings.activeIndex.set(0);
    };

    const handleInputKeyDown = (event: KeyLikeEvent): void => {
      const key = event.key;
      if (key === "Escape") {
        close();
        return;
      }
      if (key === "ArrowDown" && !disclosureBindings.isOpen()) {
        open();
        return;
      }
      navBindings.handleKeyDown(event);
    };

    yield* elements.input.on("keydown", (event) => {
      handleInputKeyDown(event as KeyLikeEvent);
    });

    return {
      isOpen: disclosureBindings.isOpen,
      query: searchBindings.query,
      filtered: searchBindings.filtered,
      selected: selectionBindings.selected,
      activeIndex: navBindings.activeIndex,
      isSelected: selectionBindings.isSelected,
      open,
      close,
      toggle: () => disclosureBindings.isOpen() ? close() : open(),
      select: navBindings.select,
      handleInputKeyDown,
      clearSelection: selectionBindings.clear,
    };
  }));
