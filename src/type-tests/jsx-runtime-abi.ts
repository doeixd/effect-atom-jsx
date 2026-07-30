import {
  insert,
  setStyleProperty,
  use,
} from "../dom.js";
import { mergeProps } from "../api.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const dynamic = () => ({
  title: "live",
  count: 1,
});
const merged = mergeProps(
  dynamic,
  {
    id: "root",
    get label() {
      return `${dynamic().title}:${dynamic().count}`;
    },
  },
);

type _MergedTitle = Expect<Equal<typeof merged.title, string>>;
type _MergedCount = Expect<Equal<typeof merged.count, number>>;
type _MergedId = Expect<Equal<typeof merged.id, "root">>;
type _MergedLabel = Expect<Equal<typeof merged.label, string>>;

const nullableMerged = mergeProps(
  { id: "kept" as const },
  null,
  undefined,
);
type _NullableMerged = Expect<Equal<typeof nullableMerged.id, "kept">>;

declare const button: HTMLButtonElement;
use(
  (element, value: () => number) => {
    element.disabled = value() === 0;
  },
  button,
  () => merged.count,
);

setStyleProperty(button, "--count", merged.count);

declare const compilerProducedView: unknown;
insert(button, compilerProducedView);
