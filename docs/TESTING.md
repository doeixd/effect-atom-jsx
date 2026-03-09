# Testing Guide

DOM-free test harness for `effect-atom-jsx`. Works in vitest's default Node environment — no jsdom required.

## Installation

```ts
import { withTestLayer, renderWithLayer, mockService } from "effect-atom-jsx/testing";
```

## API

### `mockService(tag, impl)`

Build a `Layer` from a single mock service implementation.

```ts
const ApiMock = mockService(Api, {
  load: () => Effect.succeed(42),
  save: (n) => Effect.succeed(undefined),
});
```

### `withTestLayer(layer)`

Create a `TestHarness` with the given Layer. The harness provides:

- **`runtime`** — the `ManagedRuntime` powering the test
- **`run(fn)`** — execute a function inside the harness's reactive root with services available
- **`tick(ms?)`** — flush microtasks / wait `ms` milliseconds
- **`dispose()`** — dispose the reactive root and runtime (cleanup)

```ts
const harness = withTestLayer(ApiMock);

const result = harness.run(() => {
  return queryEffect(() => useService(Api).load());
});

await harness.tick();
// result() is now Success(42)

await harness.dispose();
```

### `renderWithLayer(layer, ui)`

Shorthand — creates a harness and immediately runs the `ui` callback inside it.

```ts
const harness = renderWithLayer(ApiMock, () => {
  const save = mutationEffect((n: number) => useService(Api).save(n));
  save.run(42);
});

await harness.tick();
await harness.dispose();
```

## Patterns

### Testing queries

```ts
it("loads user data", async () => {
  const UserApiMock = mockService(UserApi, {
    getUser: (id) => Effect.succeed({ id, name: "Alice" }),
  });

  const harness = withTestLayer(UserApiMock);
  const result = harness.run(() => queryEffect(() => useService(UserApi).getUser(1)));

  await harness.tick();

  const settled = result();
  expect(settled._tag).toBe("Success");
  if (settled._tag === "Success") {
    expect(settled.value.name).toBe("Alice");
  }

  await harness.dispose();
});
```

### Testing mutations

```ts
it("saves data via mutation", async () => {
  let savedValue = 0;
  const ApiMock = mockService(Api, {
    save: (n) => Effect.sync(() => { savedValue = n; }),
  });

  const harness = renderWithLayer(ApiMock, () => {
    const save = mutationEffect((n: number) => useService(Api).save(n));
    save.run(42);
  });

  await harness.tick();
  expect(savedValue).toBe(42);

  await harness.dispose();
});
```

### Testing cleanup / interruption

```ts
it("interrupts fibers on dispose", async () => {
  let interrupted = false;
  const ApiMock = mockService(Api, {
    load: () => Effect.gen(function* () {
      yield* Effect.sleep("1 hour");
      return "done";
    }).pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))),
  });

  const harness = renderWithLayer(ApiMock, () => {
    queryEffect(() => useService(Api).load());
  });

  await harness.tick();
  await harness.dispose();
  expect(interrupted).toBe(true);
});
```

### Composing multiple mock services

```ts
const TestLayer = Layer.mergeAll(
  mockService(UserApi, { getUser: () => Effect.succeed({ name: "Bob" }) }),
  mockService(AuthApi, { getToken: () => Effect.succeed("test-token") }),
);

const harness = withTestLayer(TestLayer);
```

## Notes

- `Effect.succeed` resolves synchronously — the result is immediately `Success` (no `Loading` state).
- For async effects (e.g., `Effect.sleep`), call `await harness.tick()` to let microtasks flush.
- Always call `await harness.dispose()` at the end of each test to clean up resources.
