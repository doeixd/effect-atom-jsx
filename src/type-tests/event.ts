import { Effect, Layer, Schema, Stream } from "effect";
import * as Event from "../Event.js";

const Dropped = Event.channel("file.dropped").pipe(
  Event.schema(Schema.Struct({ id: Schema.String })),
);

const name: "file.dropped" = Dropped.name;
const payload: Event.PayloadOf<typeof Dropped> = { id: "upload-1" };
void name;
void payload;

const live = Event.layer(Dropped, { strategy: "sliding", capacity: 16 });
const published: Effect.Effect<boolean, never, unknown> = Event.publish(Dropped, { id: "upload-1" });
const events: Stream.Stream<{ readonly id: string }, never, unknown> = Event.stream(Dropped);
void live;
void published;
void events;

Event.ingest(Dropped, { id: "upload-1" }).pipe(Effect.provide(live));
Event.publish(Dropped, { id: "upload-1" }).pipe(Effect.provide(live));

// @ts-expect-error published payloads use the schema's decoded payload type
Event.publish(Dropped, { id: 42 });
// @ts-expect-error ingress is available only on schema-bearing channels
Event.ingest(Event.channel("plain"), "value");
// @ts-expect-error bounded strategies require capacity
Event.layer(Dropped, { strategy: "bounded" });

void Layer;
