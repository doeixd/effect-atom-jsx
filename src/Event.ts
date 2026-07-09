import { Effect, Layer, PubSub, Schema, ServiceMap, Stream } from "effect";

export const EventChannelTypeId: unique symbol = Symbol.for("effect-atom-jsx/EventChannel") as typeof EventChannelTypeId;

interface ChannelService<Name extends string> {
  readonly _eventChannel: Name;
}

type ChannelTag<Name extends string, A> = ServiceMap.Key<ChannelService<Name>, PubSub.PubSub<A>>;

export interface EventChannel<Name extends string, A> {
  readonly [EventChannelTypeId]: typeof EventChannelTypeId;
  readonly name: Name;
  readonly tag: ChannelTag<Name, A>;
  readonly schema?: Schema.Schema<A>;
  pipe(): EventChannel<Name, A>;
  pipe<B>(fn: (self: EventChannel<Name, A>) => B): B;
  pipe(...fns: ReadonlyArray<(self: EventChannel<Name, A>) => unknown>): unknown;
}

export interface SchemaEventChannel<Name extends string, A> extends EventChannel<Name, A> {
  readonly schema: Schema.Schema<A>;
}

export type PayloadOf<T> = T extends EventChannel<any, infer A> ? A : never;
export type NameOf<T> = T extends EventChannel<infer Name, any> ? Name : never;

export type LayerOptions =
  | { readonly strategy: "bounded" | "dropping" | "sliding"; readonly capacity: number }
  | { readonly strategy: "unbounded" };

export function channel<const Name extends string>(name: Name): EventChannel<Name, unknown> {
  const event: EventChannel<Name, unknown> = {
    [EventChannelTypeId]: EventChannelTypeId,
    name,
    tag: ServiceMap.Service<ChannelService<Name>, PubSub.PubSub<unknown>>(`Event/${name}`),
    pipe: ((...fns: ReadonlyArray<(self: EventChannel<Name, unknown>) => unknown>) => {
      return fns.reduce<unknown>((value, fn) => fn(value as EventChannel<Name, unknown>), event);
    }) as EventChannel<Name, unknown>["pipe"],
  };
  return event;
}

export function schema<A>(schema: Schema.Schema<A>): <Name extends string>(
  channel: EventChannel<Name, unknown>,
) => SchemaEventChannel<Name, A>;
export function schema<A>(schema: Schema.Schema<A>) {
  return <Name extends string>(event: EventChannel<Name, unknown>): SchemaEventChannel<Name, A> => ({
    ...event,
    schema,
    tag: event.tag as ChannelTag<Name, A>,
    pipe: event.pipe as SchemaEventChannel<Name, A>["pipe"],
  });
}

export function layer<Name extends string, A>(
  event: EventChannel<Name, A>,
  options: LayerOptions,
): Layer.Layer<ChannelService<Name>> {
  const pubsub = options.strategy === "unbounded"
    ? PubSub.unbounded<A>()
    : options.strategy === "sliding"
    ? PubSub.sliding<A>(options.capacity)
    : options.strategy === "dropping"
    ? PubSub.dropping<A>(options.capacity)
    : PubSub.bounded<A>(options.capacity);
  return Layer.effect(event.tag)(pubsub);
}

export function publish<Name extends string, A>(
  event: EventChannel<Name, A>,
  payload: A,
): Effect.Effect<boolean, never, ChannelService<Name>> {
  return Effect.service(event.tag).pipe(Effect.flatMap((pubsub) => PubSub.publish(pubsub, payload)));
}

export function ingest<Name extends string, A>(
  event: SchemaEventChannel<Name, A>,
  input: unknown,
): Effect.Effect<boolean, Schema.SchemaError, ChannelService<Name>> {
  const decode = Schema.decodeUnknownEffect(event.schema)(input) as Effect.Effect<A, Schema.SchemaError, never>;
  return decode.pipe(
    Effect.flatMap((payload) => publish(event, payload)),
  );
}

export function stream<Name extends string, A>(event: EventChannel<Name, A>): Stream.Stream<A, never, ChannelService<Name>> {
  return Stream.unwrap(
    Effect.service(event.tag).pipe(Effect.map((pubsub) => Stream.fromPubSub(pubsub))),
  );
}

export const Event = {
  TypeId: EventChannelTypeId,
  channel,
  schema,
  layer,
  publish,
  ingest,
  stream,
} as const;
