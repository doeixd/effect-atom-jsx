import { Effect, Schema, ServiceMap } from "effect";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";

interface ApiService {
  readonly save: (prefix: string, id: number) => Effect.Effect<string, SaveError>;
}

interface SaveError {
  readonly _tag: "SaveError";
  readonly message: string;
}

const Api = ServiceMap.Service<ApiService>("PortableActionTypeTest/Api");

const SaveCode = Portable.code<
  { readonly prefix: string },
  { readonly prefix: string },
  readonly [id: number],
  string,
  SaveError,
  ApiService
>({
  id: "type-test.save",
  buildId: "type-test-build",
  captures: Schema.Struct({ prefix: Schema.String }),
  run: (captures, id) =>
    Effect.gen(function* () {
      const api = yield* Api;
      return yield* api.save(captures.prefix, id);
    }),
});

const bound = Portable.bind(SaveCode, { prefix: "item" });

const execution: Effect.Effect<string, SaveError, ApiService> =
  Portable.execute(bound, 1);
const description: Effect.Effect<
  Portable.Descriptor<readonly [id: number], string, SaveError, ApiService>,
  Portable.PortableCaptureEncodeError
> = Portable.describe(bound);
const componentAction: Effect.Effect<
  Component.ComponentAction<readonly [id: number], string, SaveError>,
  never,
  ApiService
> = Component.action(bound);

void execution;
void description;
void componentAction;

// @ts-expect-error captures are checked against the code's capture schema type
Portable.bind(SaveCode, { prefix: 1 });

// @ts-expect-error portable execution preserves the argument tuple
Portable.execute(bound, "wrong");
