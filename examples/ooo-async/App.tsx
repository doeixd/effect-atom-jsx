import { Atom, Registry, Async, AsyncResult, Result, Loading, Errored } from "effect-atom-jsx";
import { Effect, Stream } from "effect";

type Chunk = Atom.StreamChunk<number>;

const chunkStream: Stream.Stream<Chunk> = Stream.make(
  { sequence: 1, items: [20, 21] },
  { sequence: 0, items: [10] },
  { sequence: 2, items: [30], done: true },
);

export function createOOOAsyncDemo() {
  const registry = Registry.make();
  const pullChunks = Atom.pull(chunkStream, { chunkSize: 1 });
  const forceError = Atom.make<boolean>(false);

  const mergedState = Atom.make((get): AsyncResult<Atom.OOOStreamState<number>, string> => {
    if (get(forceError)) {
      return AsyncResult.failure("Manually forced stream error");
    }

    const pulled = get(pullChunks);

    if (Result.isInitial(pulled)) {
      return AsyncResult.loading;
    }

    if (Result.isFailure(pulled)) {
      return AsyncResult.failure(String(pulled.error));
    }

    const chunks = pulled.value.items as ReadonlyArray<Chunk>;
    const state = chunks.reduce(
      (acc, chunk) => Atom.Stream.applyChunk(acc, chunk),
      Atom.Stream.emptyState<number>(),
    );

    return AsyncResult.success(state);
  });

  const pullNext = () => {
    Effect.runSync(Atom.set(undefined)(pullChunks));
  };

  const toggleError = () => {
    Effect.runSync(Atom.update(forceError, (v) => !v));
  };

  const getState = () => registry.get(mergedState);

  return {
    registry,
    pullChunks,
    forceError,
    mergedState,
    pullNext,
    toggleError,
    getState,
  };
}

const demo = createOOOAsyncDemo();

export function App() {
  const stream = demo.registry.get(demo.mergedState);

  return (
    <main>
      <h1>OOO Stream + Async</h1>
      <p>Pull out-of-order chunks and render ordered output through Async.</p>

      <p>
        <button onClick={demo.pullNext}>Pull next chunk</button>
        <button onClick={demo.toggleError}>Toggle forced error</button>
      </p>

      <Async
        result={stream}
        loading={() => <p>Loading chunks...</p>}
        error={(e) => <p style="color:red">Error: {String(e)}</p>}
        success={(state) => (
          <section>
            <p>
              Items: <strong>{state.items.join(", ") || "(none yet)"}</strong>
            </p>
            <p>
              nextSequence=<code>{String(state.nextSequence)}</code>
              {" "}complete=<code>{String(state.complete)}</code>
            </p>
            <p>
              buffered keys: <code>{Object.keys(state.buffered).join(", ") || "none"}</code>
            </p>
          </section>
        )}
      />

      <h2>Same state with Loading / Errored</h2>
      <Loading when={stream} fallback={() => <p>Loading boundary fallback...</p>}>
        <Errored result={stream} fallback={() => (
          <p>Not errored. Ready to render content.</p>
        )}>
          {(e) => <p style="color:red">Errored boundary: {typeof e === "object" && e !== null && "defect" in e ? e.defect : String(e)}</p>}
        </Errored>
      </Loading>
    </main>
  );
}
