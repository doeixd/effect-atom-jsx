/**
 * AsyncExample — demonstrates atomEffect with typed errors and Effect-TS
 * structured concurrency.
 *
 * Shows how async state flows through the reactive graph as a Result
 * instead of thrown exceptions, with automatic cancellation of stale requests
 * when the user-id atom changes.
 */
import { Atom, atomEffect, Async } from "effect-atom-jsx";
import { Effect, pipe } from "effect";

// ─── Domain types ─────────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
}

class FetchError {
  readonly _tag = "FetchError";
  constructor(readonly message: string, readonly status: number) {}
}

// ─── Effect-based data fetching ───────────────────────────────────────────────

function fetchUser(id: number): Effect.Effect<User, FetchError> {
  return pipe(
    Effect.tryPromise({
      try: () =>
        fetch(`https://jsonplaceholder.typicode.com/users/${id}`).then((r) => {
          if (!r.ok) throw new FetchError("Not found", r.status);
          return r.json() as Promise<User>;
        }),
      catch: (e) =>
        e instanceof FetchError ? e : new FetchError(String(e), 0),
    }),
    // Simulate network latency for demo purposes
    Effect.delay("500 millis"),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AsyncUserCard() {
  const userId = Atom.make<number>(1);

  // atomEffect creates an accessor driven by an Effect computation.
  // When userId() changes, the previous Effect fiber is interrupted and a
  // new one starts — structured concurrency, no manual AbortController needed.
  const userResult = atomEffect(() => fetchUser(userId()));

  return (
    <div class="counter">
      <h2>Async User (Effect-TS)</h2>
      <p>
        User ID: <strong>{userId()}</strong>
      </p>
      <button onClick={() => userId.update((id: number) => Math.max(1, id - 1))}>Prev</button>
      <button onClick={() => userId.update((id: number) => id + 1)}>Next</button>

      {/* Pattern-match on Result — no try/catch, typed errors */}
        <Async
          result={userResult()}
          loading={() => <p>Loading user {userId()}...</p>}
        error={(e: FetchError) => (
          <p style="color:red">
            ✗ {e.message} (HTTP {e.status})
          </p>
        )}
        success={(user: User) => (
          <dl>
            <dt>Name</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
          </dl>
        )}
      />
    </div>
  );
}
