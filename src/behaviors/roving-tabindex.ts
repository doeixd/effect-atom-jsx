/**
 * Roving tabindex — one tab stop; arrows move among collection items.
 *
 * @see docs/kit-research/behaviors/roving-tabindex.md
 */
import { Effect, Schema } from "effect";
import * as Atom from "../Atom.js";
import * as Behavior from "../Behavior.js";
import * as Component from "../Component.js";
import type * as Element from "../Element.js";

export const RovingTabindexOptions = Schema.Struct({
  orientation: Schema.optionalKey(
    Schema.Literals(["vertical", "horizontal", "both"]),
  ),
  loop: Schema.optionalKey(Schema.Boolean),
  /** When true, only update currentIndex (no element.focus). */
  virtual: Schema.optionalKey(Schema.Boolean),
  initialIndex: Schema.optionalKey(Schema.Number),
});

export type RovingTabindexOptions = typeof RovingTabindexOptions.Type;

export type RovingTabindexConfig = RovingTabindexOptions & {
  /** Optional filter: return false to skip an item (e.g. disabled). */
  readonly isItemDisabled?: (item: Element.Focusable, index: number) => boolean;
};

export type RovingTabindexBindings = {
  readonly currentIndex: Atom.WritableAtom<number>;
  readonly focus: (index: number) => void;
  readonly next: () => void;
  readonly prev: () => void;
  readonly first: () => void;
  readonly last: () => void;
  readonly handleKeyDown: (event: {
    readonly key?: string;
    readonly preventDefault?: () => void;
  }) => void;
};

// TODO(kit): widened so resolved options keep the full option unions
// (e.g. orientation) rather than the literal defaults; revisit when the kit
// settles its options contract.
const defaultOptions: Required<RovingTabindexOptions> = {
  orientation: "vertical",
  loop: true,
  virtual: false,
  initialIndex: 0,
};

function decodeOptions(config: RovingTabindexConfig): typeof defaultOptions {
  const partial = Schema.decodeUnknownSync(RovingTabindexOptions)({
    orientation: config.orientation,
    loop: config.loop,
    virtual: config.virtual,
    initialIndex: config.initialIndex,
  });
  return {
    orientation: partial.orientation ?? defaultOptions.orientation,
    loop: partial.loop ?? defaultOptions.loop,
    virtual: partial.virtual ?? defaultOptions.virtual,
    initialIndex: partial.initialIndex ?? defaultOptions.initialIndex,
  };
}

/**
 * Roving focus over a focusable collection.
 *
 * Requires a focusable collection and a container that receives keydown
 * (typically the group root). Sets tabIndex 0 on the current item and -1 on
 * others (non-virtual mode).
 */
export const rovingTabindex = (config: RovingTabindexConfig = {}) => {
  const options = decodeOptions(config);

  // TODO(kit): `Behavior` is not pipeable; use the applied `provides` form.
  return Behavior.provides({
    currentIndex: Behavior.binding<"currentIndex", Atom.WritableAtom<number>>(
      "currentIndex",
    ),
  })(
    Behavior.make<
    {
      readonly container: Element.Interactive;
      readonly items: Element.Collection<Element.Focusable>;
    },
    RovingTabindexBindings,
    never,
    never
  >((elements) =>
    Effect.gen(function* () {
      const currentIndex = yield* Component.state(options.initialIndex);

      const list = (): ReadonlyArray<Element.Focusable> => elements.items.items();

      const isDisabled = (item: Element.Focusable, index: number): boolean =>
        config.isItemDisabled?.(item, index) === true;

      const enabledIndices = (): number[] => {
        const items = list();
        const out: number[] = [];
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (item !== undefined && !isDisabled(item, i)) out.push(i);
        }
        return out;
      };

      const clampToEnabled = (index: number): number => {
        const enabled = enabledIndices();
        if (enabled.length === 0) return 0;
        if (enabled.includes(index)) return index;
        // nearest enabled
        let best = enabled[0]!;
        let bestDist = Math.abs(best - index);
        for (const i of enabled) {
          const d = Math.abs(i - index);
          if (d < bestDist) {
            best = i;
            bestDist = d;
          }
        }
        return best;
      };

      const applyTabIndices = (active: number): void => {
        if (options.virtual) return;
        const items = list();
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (item === undefined) continue;
          void Effect.runSync(
            item.setAttr("tabIndex", i === active && !isDisabled(item, i) ? 0 : -1),
          );
        }
      };

      const focusAt = (index: number): void => {
        const enabled = enabledIndices();
        if (enabled.length === 0) return;
        let next = clampToEnabled(index);
        if (!enabled.includes(next)) next = enabled[0]!;
        currentIndex.set(next);
        applyTabIndices(next);
        if (!options.virtual) {
          list()[next]?.focus();
        }
      };

      const move = (delta: number): void => {
        const enabled = enabledIndices();
        if (enabled.length === 0) return;
        const current = currentIndex();
        let pos = enabled.indexOf(current);
        if (pos < 0) pos = 0;
        let nextPos = pos + delta;
        if (options.loop) {
          nextPos = ((nextPos % enabled.length) + enabled.length) % enabled.length;
        } else {
          nextPos = Math.max(0, Math.min(nextPos, enabled.length - 1));
        }
        focusAt(enabled[nextPos]!);
      };

      const next = (): void => move(1);
      const prev = (): void => move(-1);
      const first = (): void => {
        const enabled = enabledIndices();
        if (enabled.length > 0) focusAt(enabled[0]!);
      };
      const last = (): void => {
        const enabled = enabledIndices();
        if (enabled.length > 0) focusAt(enabled[enabled.length - 1]!);
      };

      const handleKeyDown = (event: {
        readonly key?: string;
        readonly preventDefault?: () => void;
      }): void => {
        const key = event.key;
        if (key === undefined) return;
        const o = options.orientation;
        const vertical = o === "vertical" || o === "both";
        const horizontal = o === "horizontal" || o === "both";

        if (vertical && key === "ArrowDown") {
          event.preventDefault?.();
          next();
        } else if (vertical && key === "ArrowUp") {
          event.preventDefault?.();
          prev();
        } else if (horizontal && key === "ArrowRight") {
          event.preventDefault?.();
          next();
        } else if (horizontal && key === "ArrowLeft") {
          event.preventDefault?.();
          prev();
        } else if (key === "Home") {
          event.preventDefault?.();
          first();
        } else if (key === "End") {
          event.preventDefault?.();
          last();
        }
      };

      yield* elements.container.on("keydown", (event) => {
        handleKeyDown(event as { readonly key?: string; readonly preventDefault?: () => void });
      });

      // Initial tab indices when collection mutates
      yield* elements.items.observeEach(() =>
        Effect.sync(() => {
          applyTabIndices(clampToEnabled(currentIndex()));
          return undefined;
        }),
      );

      applyTabIndices(clampToEnabled(currentIndex()));

      return {
        currentIndex,
        focus: focusAt,
        next,
        prev,
        first,
        last,
        handleKeyDown,
      } satisfies RovingTabindexBindings;
    }),
    ),
  );
};
