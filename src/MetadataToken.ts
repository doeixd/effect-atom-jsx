export const MetadataTokenTypeId: unique symbol = Symbol.for("effect-atom-jsx/MetadataToken");

export interface MetadataToken<Kind extends string, Name extends string> {
  readonly [MetadataTokenTypeId]: {
    readonly Kind: Kind;
    readonly Name: Name;
  };
  readonly kind: Kind;
  readonly name: Name;
}

export type Any = MetadataToken<string, string>;

export type NameOf<T> =
  T extends MetadataToken<any, infer Name> ? Name
    : T extends string ? T
      : never;

export type KindOf<T> =
  T extends MetadataToken<infer Kind, any> ? Kind
    : never;

export type NamesOf<T extends readonly unknown[]> = NameOf<T[number]>;

export function make<const Kind extends string, const Name extends string>(
  kind: Kind,
  name: Name,
): MetadataToken<Kind, Name> {
  return {
    [MetadataTokenTypeId]: {
      Kind: undefined as unknown as Kind,
      Name: undefined as unknown as Name,
    },
    kind,
    name,
  };
}

export function isMetadataToken(value: unknown): value is Any {
  return typeof value === "object"
    && value !== null
    && MetadataTokenTypeId in value;
}

export function nameOf(value: string | Any): string {
  return isMetadataToken(value) ? value.name : value;
}

export const MetadataToken = {
  TypeId: MetadataTokenTypeId,
  make,
  isMetadataToken,
  nameOf,
} as const;
