/**
 * Collection behavior — ordered registry over `Element.Collection`.
 *
 * Runtime-only (no snapshot of element handles). DOM/order source is the
 * collection handle; metadata (disabled) is held beside it.
 *
 * @see docs/kit-research/behaviors/collection.md
 */
import { Effect, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import type * as Element from "../Element.js";

export const CollectionOptions = Schema.Struct({
  /**
   * When false, `enabledItems` / navigation helpers skip disabled entries.
   * Disabled items remain in `items` for index stability.
   */
  trackDisabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ),
  /** When true, set aria-posinset / aria-setsize on each item. */
  setPosInSet: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
});

export type CollectionOptions = typeof CollectionOptions.Type;

/** Caller-facing config: every Schema knob optional (defaults decode in). */
export type CollectionConfig = typeof CollectionOptions.Encoded;

export type CollectionItemMeta = {
  readonly disabled?: boolean;
  readonly id?: string;
};

export type CollectionBindings<E extends Element.Handle = Element.Handle> = {
  /** Live ordered handles from the collection (same identity as elements.items). */
  readonly items: Atom.ReadonlyAtom<ReadonlyArray<E>>;
  readonly size: Atom.ReadonlyAtom<number>;
  readonly getByIndex: (index: number) => E | undefined;
  readonly indexOf: (item: E) => number;
  readonly isDisabled: (item: E) => boolean;
  readonly setDisabled: (item: E, disabled: boolean) => void;
  /** Indices that navigation should visit (skips disabled when trackDisabled). */
  readonly enabledIndices: () => ReadonlyArray<number>;
  readonly enabledItems: () => ReadonlyArray<E>;
};

/**
 * Expose ordered access + skippable metadata over an `Element.Collection`.
 *
 * Parent code still owns `collection.set([...])`; this behavior tracks
 * changes reactively and optional per-item disabled flags.
 *
 * Options decode against `CollectionOptions` at attach time: defaults come
 * from the Schema, and a malformed config fails the attach Effect with a
 * typed `Behavior.BehaviorOptionsError` — the factory itself never throws.
 */
export const collection = <E extends Element.Handle = Element.Handle>(
  config: CollectionConfig = {},
) =>
  Behavior.make<
    { readonly items: Element.Collection<E> },
    CollectionBindings<E>,
    never,
    Behavior.BehaviorOptionsError
  >((elements) =>
    Effect.gen(function* () {
      const options = yield* Behavior.decodeOptions(
        "collection",
        CollectionOptions,
        config,
      );
      const version = yield* Component.state(0);
      const disabled = new WeakMap<Element.Handle, boolean>();

      const bump = (): void => {
        version.update((n) => n + 1);
      };

      // Re-run when the underlying collection is replaced.
      yield* elements.items.observeEach(() =>
        Effect.sync(() => {
          bump();
          return undefined;
        }),
      );

      const readItems = (): ReadonlyArray<E> => {
        version(); // track
        return elements.items.items();
      };

      const items = yield* Component.derived(() => readItems());
      const size = yield* Component.derived(() => readItems().length);

      const isDisabled = (item: E): boolean => disabled.get(item) === true;

      const setDisabled = (item: E, value: boolean): void => {
        if (value) disabled.set(item, true);
        else disabled.delete(item);
        bump();
      };

      const enabledIndices = (): ReadonlyArray<number> => {
        const list = readItems();
        if (!options.trackDisabled) {
          return list.map((_, i) => i);
        }
        const out: number[] = [];
        for (let i = 0; i < list.length; i += 1) {
          const item = list[i];
          if (item !== undefined && !isDisabled(item)) out.push(i);
        }
        return out;
      };

      const enabledItems = (): ReadonlyArray<E> => {
        const list = readItems();
        return enabledIndices().flatMap((i) => {
          const item = list[i];
          return item === undefined ? [] : [item];
        });
      };

      if (options.setPosInSet) {
        yield* elements.items.observeEach((item, index) =>
          Effect.gen(function* () {
            const total = () => elements.items.items().length;
            yield* item.setAttr("aria-posinset", () => index + 1);
            yield* item.setAttr("aria-setsize", total);
          }),
        );
      }

      return {
        items,
        size,
        getByIndex: (index: number) => readItems()[index],
        indexOf: (item: E) => readItems().indexOf(item),
        isDisabled,
        setDisabled,
        enabledIndices,
        enabledItems,
      } satisfies CollectionBindings<E>;
    })
  ).pipe(
    Behavior.provides({
      items: Behavior.binding<"items", Atom.ReadonlyAtom<ReadonlyArray<E>>>("items"),
      size: Behavior.binding<"size", Atom.ReadonlyAtom<number>>("size"),
    }),
  );
