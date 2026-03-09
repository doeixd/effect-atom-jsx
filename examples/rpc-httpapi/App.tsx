import { Effect, Layer, ServiceMap } from "effect";
import { AtomRpc, AtomHttpApi, MatchTag, mount } from "effect-atom-jsx";

// ─── AtomRpc Example ──────────────────────────────────────────────────────────

type AppRpcs = {
  getUser: { payload: { id: string }; success: { id: string; name: string }; error: string };
  updateUser: { payload: { id: string; name: string }; success: { ok: boolean }; error: string };
};

const RpcService = ServiceMap.Service<AtomRpc.AtomRpcClient<AppRpcs>>("RpcService");

const mockRpcBackend = async (method: string, payload: any) => {
  await new Promise((r) => setTimeout(r, 600)); // fake delay
  if (method === "getUser") return { id: payload.id, name: `User ${payload.id}` };
  if (method === "updateUser") return { ok: true };
  throw new Error("Not found");
};

const RpcClient = AtomRpc.Tag()<"RpcClient", AppRpcs>("RpcClient", {
  call: (tag, payload) => Effect.tryPromise({
    try: () => mockRpcBackend(tag, payload),
    catch: (e) => String(e),
  }) as any,
});

function RpcApp() {
  const userQuery = RpcClient.query("getUser", { id: "42" });
  const mutateUser = RpcClient.mutation("updateUser");

  const submit = (e: Event) => {
    e.preventDefault();
    const data = new FormData(e.target as HTMLFormElement);
    Effect.runPromise(mutateUser({ id: "42", name: data.get("name") as string }))
      .then(() => RpcClient.refresh("getUser", { id: "42" }));
  };

  return (
    <div style="border: 1px solid #ccc; padding: 1rem; border-radius: 8px;">
      <h2>AtomRpc Demo</h2>
      <MatchTag
        value={userQuery}
        cases={{
          Initial: () => <p>Loading user...</p>,
          Failure: (err) => <p style="color: red;">Error: {err.error}</p>,
          Success: (res) => (
            <div>
              <p>Current Name: <strong>{res.value.name}</strong> {res.waiting ? "(refreshing...)" : ""}</p>
              <form onSubmit={submit}>
                <input name="name" placeholder="New Name" required />
                <button type="submit">Update & Refresh</button>
              </form>
            </div>
          ),
        }}
      />
    </div>
  );
}

// ─── AtomHttpApi Example ──────────────────────────────────────────────────────

type AppHttpApi = {
  todos: {
    list: { request: { limit: number }; success: { items: string[] }; error: never };
  };
};

const HttpApiService = ServiceMap.Service<AtomHttpApi.AtomHttpApiClient<AppHttpApi>>("HttpApiService");

const HttpApiClient = AtomHttpApi.Tag()<"HttpApiClient", AppHttpApi>("HttpApiClient", {
  call: (group, endpoint, request) => Effect.tryPromise({
    try: async () => {
      await new Promise((r) => setTimeout(r, 400));
      const req = request as any;
      return { items: Array(req.limit).fill(0).map((_, i) => `Todo ${i + 1}`) };
    },
    catch: () => "error",
  }) as any,
});

function HttpApiApp() {
  const todosQuery = HttpApiClient.query("todos", "list", { limit: 3 });

  return (
    <div style="border: 1px solid #ccc; padding: 1rem; border-radius: 8px;">
      <h2>AtomHttpApi Demo</h2>
      <MatchTag
        value={todosQuery}
        cases={{
          Initial: () => <p>Loading todos...</p>,
          Success: (res) => (
            <div>
              <ul>
                {res.value.items.map((item) => <li>{item}</li>)}
              </ul>
              <button onClick={() => HttpApiClient.refresh("todos", "list", { limit: 3 })}>
                {res.waiting ? "Refreshing..." : "Refresh List"}
              </button>
            </div>
          ),
        }}
      />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function App() {
  return (
    <div style="display: flex; flex-direction: column; gap: 1rem; max-width: 400px; font-family: sans-serif;">
      <h1>Advanced API Examples</h1>
      <RpcApp />
      <HttpApiApp />
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  const AppLayer = Layer.succeed(RpcService, RpcClient).pipe(
    Layer.provideMerge(Layer.succeed(HttpApiService, HttpApiClient)),
  );
  mount(() => <App />, root, AppLayer);
}
