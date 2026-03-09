/**
 * SSR Example — demonstrates server-side rendering and hydration.
 *
 * This example shows:
 * 1. `renderToString()` to produce HTML on the server
 * 2. `hydrateRoot()` to attach reactivity to server-rendered HTML
 * 3. `isServer` for environment detection
 * 4. `setRequestEvent()` / `getRequestEvent()` for SSR request context
 * 5. `Hydration.dehydrate()` / `Hydration.hydrate()` for atom state transfer
 */
import {
  Atom,
  Registry,
  Hydration,
  isServer,
  renderToString,
  hydrateRoot,
  setRequestEvent,
  render,
} from "effect-atom-jsx";

// ─── Shared component ─────────────────────────────────────────────────────────

function Greeting() {
  const registry = Registry.make();
  const name = Atom.make<string>("World");

  return (
    <div class="card">
      <h2>Hello, {registry.get(name)}!</h2>
      <input
        type="text"
        value={registry.get(name)}
        onInput={(e: Event) => registry.set(name, (e.currentTarget as HTMLInputElement).value)}
        placeholder="Enter your name"
      />
    </div>
  );
}

function Counter() {
  const registry = Registry.make();
  const count = Atom.make<number>(0);

  return (
    <div class="card">
      <h2>Counter: {registry.get(count)}</h2>
      <button onClick={() => registry.update(count, (c) => c - 1)}>-</button>
      <button onClick={() => registry.set(count, 0)}>Reset</button>
      <button onClick={() => registry.update(count, (c) => c + 1)}>+</button>
    </div>
  );
}

function AppContent() {
  return (
    <main>
      <h1>SSR Example</h1>
      <Greeting />
      <Counter />
    </main>
  );
}

// ─── SSR demo (runs in the browser to demonstrate the API) ───────────────────

export function App() {
  const registry = Registry.make();
  const ssrHtml = Atom.make<string>("");

  return (
    <main>
      <h1>SSR + Hydration Demo</h1>
      <p>
        Environment: <strong>{isServer ? "Server" : "Client"}</strong>
      </p>

      <div class="card">
        <h2>1. Server-side render</h2>
        <p>Click to render the component tree to an HTML string:</p>
        <button onClick={() => {
          // Simulate setting request context (like a server would)
          setRequestEvent({ url: "/demo", method: "GET" });
          const html = renderToString(() => <AppContent />);
          setRequestEvent(undefined);
          registry.set(ssrHtml, html);
        }}>
          renderToString()
        </button>
        {registry.get(ssrHtml) ? (
          <div>
            <h3>Raw HTML output:</h3>
            <pre>{registry.get(ssrHtml)}</pre>
          </div>
        ) : null}
      </div>

      <div class="card">
        <h2>2. Live component (client-rendered)</h2>
        <p>This is the same component rendered normally on the client:</p>
        <AppContent />
      </div>

      <div class="card">
        <h2>3. Hydration API</h2>
        <p>
          In a real SSR app, the server sends the HTML from step 1, and the
          client calls <code>hydrateRoot()</code> to attach reactivity to the
          existing DOM without re-creating nodes.
        </p>
        <pre>{`// Server
const html = renderToString(() => <App />);
res.send(html);

// Client
hydrateRoot(() => <App />, container);`}</pre>
      </div>

      <div class="card">
        <h2>4. Atom State Transfer</h2>
        <p>
          Use <code>Hydration.dehydrate()</code> on the server to serialize
          atom values, and <code>Hydration.hydrate()</code> on the client to
          restore them.
        </p>
        <pre>{`// Server
const state = Hydration.dehydrate(registry, [
  ["count", countAtom],
  ["user", userAtom],
]);
// Embed in HTML: window.__STATE__ = state

// Client
Hydration.hydrate(registry, window.__STATE__, {
  count: countAtom,
  user: userAtom,
});`}</pre>
      </div>
    </main>
  );
}
