import { Exit, Schema } from "effect";
import * as Atom from "../Atom.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;

const numberById = Atom.family(
  (id: string) => Atom.value(id.length),
  { schema: Schema.Int },
);

const result = numberById("abc");

type _FamilyMember = Expect<Equal<
  Atom.ValueOf<typeof result>,
  Exit.Exit<number, Schema.SchemaError>
>>;

const structural = Atom.family(
  (key: { readonly id: string }) => Atom.value(key.id),
  {
    schema: Schema.String,
    equals: (a, b) => a[0].id === b[0].id,
  },
);

type _StructuralMember = Expect<Equal<
  Atom.ValueOf<ReturnType<typeof structural>>,
  Exit.Exit<string, Schema.SchemaError>
>>;
