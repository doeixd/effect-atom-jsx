import { Effect, Layer, Schema, ServiceMap } from "effect";
import { describe, expect, it } from "vitest";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";

interface MathService {
  readonly add: (left: number, right: number) => number;
}

const MathService = ServiceMap.Service<MathService>(
  "effect-atom-jsx/test/PortableMath",
);

const Captures = Schema.Struct({
  base: Schema.Number,
});

const AddCode = Portable.code<
  { readonly base: number },
  { readonly base: number },
  readonly [delta: number],
  number,
  never,
  MathService
>({
  id: "test.counter.add",
  buildId: "test-build-1",
  captures: Captures,
  run: (captures, delta) =>
    Effect.gen(function* () {
      const math = yield* MathService;
      return math.add(captures.base, delta);
    }),
});

const ClientMath = Layer.succeed(MathService, {
  add: (left, right) => left + right,
});

describe("Portable code", () => {
  it("round-trips a descriptor and resolves it in a fresh client runtime", () => {
    const bound = Portable.bind(AddCode, { base: 4 });
    const descriptor = Effect.runSync(Portable.describe(bound));
    const wire = JSON.parse(JSON.stringify(descriptor)) as unknown;
    const decoded = Effect.runSync(Portable.decodeDescriptor(wire)) as Portable.Descriptor<
      readonly [delta: number],
      number,
      never,
      MathService
    >;
    const resolved = Effect.runSync(
      Portable.resolve(decoded).pipe(
        Effect.provide(Portable.resolverLayer({
          [AddCode.id]: AddCode,
        })),
      ),
    );

    expect(descriptor).toEqual({
      version: 1,
      kind: "portable.code",
      id: "test.counter.add",
      buildId: "test-build-1",
      captures: { base: 4 },
    });
    expect(
      Effect.runSync(resolved.run(3).pipe(Effect.provide(ClientMath))),
    ).toBe(7);
  });

  it("integrates with Component.action while ordinary closures remain opaque", async () => {
    const bound = Portable.bind(AddCode, { base: 10 });
    const portableAction = Effect.runSync(
      Component.action(bound).pipe(Effect.provide(ClientMath)),
    );
    const ordinaryAction = Effect.runSync(
      Component.action((delta: number) => Effect.succeed(delta + 1)),
    );

    expect(await Effect.runPromise(portableAction.runEffect(5))).toBe(15);
    const inspection = Portable.inspectExecutable(portableAction);
    expect(inspection.kind).toBe("portable");
    if (inspection.kind === "portable") {
      expect(Effect.runSync(Portable.describe(inspection.executable))).toMatchObject({
        id: AddCode.id,
        captures: { base: 10 },
      });
    }
    expect(Portable.inspectExecutable(ordinaryAction)).toEqual({ kind: "opaque" });
    expect(Portable.inspectExecutable(() => undefined)).toEqual({ kind: "opaque" });
  });

  it("rejects stale builds before executing loaded code", () => {
    const descriptor = Effect.runSync(
      Portable.describe(Portable.bind(AddCode, { base: 1 })),
    );
    const NewBuild = Portable.code({
      id: "test.counter.add",
      buildId: "test-build-2",
      captures: Captures,
      run: (_captures, _delta: number) => Effect.succeed(0),
    });

    const error = Effect.runSync(
      Portable.resolve(descriptor).pipe(
        Effect.flip,
        Effect.provide(Portable.resolverLayer({
          [AddCode.id]: NewBuild,
        })),
      ),
    );

    expect(error._tag).toBe("PortableBuildMismatchError");
  });

  it("validates captures after loading the addressed code", () => {
    const descriptor = Effect.runSync(
      Portable.describe(Portable.bind(AddCode, { base: 1 })),
    );
    const invalid = {
      ...descriptor,
      captures: { base: "not-a-number" },
    };

    const error = Effect.runSync(
      Portable.resolve(invalid).pipe(
        Effect.flip,
        Effect.provide(Portable.resolverLayer({
          [AddCode.id]: AddCode,
        })),
      ),
    );

    expect(error._tag).toBe("PortableCaptureDecodeError");
  });

  it("reports unknown code identities without attempting execution", () => {
    const descriptor = Effect.runSync(
      Portable.describe(Portable.bind(AddCode, { base: 1 })),
    );
    const error = Effect.runSync(
      Portable.resolve(descriptor).pipe(
        Effect.flip,
        Effect.provide(Portable.resolverLayer({})),
      ),
    );

    expect(error._tag).toBe("PortableCodeNotFoundError");
  });

  it("memoizes lazy code loading within one resolver instance", () => {
    let loads = 0;
    const descriptor = Effect.runSync(
      Portable.describe(Portable.bind(AddCode, { base: 1 })),
    );
    const program = Effect.all(
      [
        Portable.resolve(descriptor),
        Portable.resolve(descriptor),
      ],
      { concurrency: "unbounded" },
    );

    Effect.runSync(
      program.pipe(
        Effect.provide(Portable.resolverLayer({
          [AddCode.id]: () =>
            Effect.sync(() => {
              loads += 1;
              return AddCode;
            }),
        })),
      ),
    );

    expect(loads).toBe(1);
  });

  it("rejects encoded captures that are not JSON-safe", () => {
    const UnsafeCode = Portable.code({
      id: "test.unsafe-capture",
      buildId: "test-build-1",
      captures: Schema.Unknown,
      run: () => Effect.void,
    });
    const error = Effect.runSync(
      Portable.describe(Portable.bind(UnsafeCode, 1n)).pipe(Effect.flip),
    );

    expect(error._tag).toBe("PortableCaptureEncodeError");
    expect(error.message).toContain("not JSON-safe");
  });
});
