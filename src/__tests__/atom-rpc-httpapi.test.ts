import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { createRoot } from "../api.js";
import * as AtomRpc from "../AtomRpc.js";
import * as AtomHttpApi from "../AtomHttpApi.js";
import * as Result from "../Result.js";

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("AtomRpc", () => {
  it("supports typed query/mutation and refresh", async () => {
    type Defs = {
      getUser: { payload: { id: string }; success: { id: string; name: string }; error: never };
      renameUser: { payload: { id: string; name: string }; success: { ok: true }; error: string };
    };

    let queryCount = 0;
    const client = AtomRpc.Tag()<"RpcClient", Defs>("RpcClient", {
      call: (tag, payload) => {
        if (tag === "getUser") {
          queryCount += 1;
          return Effect.succeed({ id: (payload as any).id, name: `user-${queryCount}` }).pipe(Effect.delay("10 millis")) as any;
        }
        if ((payload as { name: string }).name.length === 0) {
          return Effect.fail("name required") as any;
        }
        return Effect.succeed({ ok: true }) as any;
      },
    });

    let user!: () => Result.Result<{ id: string; name: string }, never>;
    createRoot(() => {
      user = client.query("getUser", { id: "1" });
    });

    expect(Result.isInitial(user())).toBe(true);
    await tick(25);
    expect(Result.isSuccess(user())).toBe(true);
    const first = user();
    if (Result.isSuccess(first)) {
      expect(first.value.name).toBe("user-1");
    }

    client.refresh("getUser", { id: "1" });
    await tick(25);
    expect(Result.isSuccess(user())).toBe(true);
    const second = user();
    if (Result.isSuccess(second)) {
      expect(second.value.name).toBe("user-2");
    }

    const mutate = client.mutation("renameUser");
    const ok = await Effect.runPromise(mutate({ id: "1", name: "ok" }));
    expect(ok.ok).toBe(true);
  });

  it("supports reactivityKeys invalidation via action", async () => {
    type Defs = {
      getUser: { payload: { id: string }; success: { id: string; name: string }; error: never };
      renameUser: { payload: { id: string; name: string }; success: { ok: true }; error: string };
    };

    let queryCount = 0;
    const client = AtomRpc.Tag()<"RpcClient2", Defs>("RpcClient2", {
      call: (tag, payload) => {
        if (tag === "getUser") {
          queryCount += 1;
          return Effect.succeed({ id: (payload as any).id, name: `user-${queryCount}` }).pipe(Effect.delay("5 millis")) as any;
        }
        return Effect.succeed({ ok: true }) as any;
      },
    });

    let user!: () => Result.Result<{ id: string; name: string }, never>;
    createRoot(() => {
      user = client.query("getUser", { id: "1" }, { reactivityKeys: ["users"] });
    });

    await tick(20);
    const first = user();
    expect(Result.isSuccess(first)).toBe(true);

    const rename = client.action("renameUser", { reactivityKeys: ["users"] });
    rename({ id: "1", name: "next" });

    await tick(20);
    const second = user();
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isSuccess(second)) {
      expect(second.value.name).toBe("user-2");
    }
  });
});

describe("AtomHttpApi", () => {
  it("supports grouped endpoint query/mutation and refresh", async () => {
    type Defs = {
      users: {
        get: { request: { id: string }; success: { id: string; name: string }; error: never };
        rename: { request: { id: string; name: string }; success: { ok: true }; error: string };
      };
    };

    let queryCount = 0;
    const client = AtomHttpApi.Tag()<"HttpClient", Defs>("HttpClient", {
      call: (group, endpoint, request) => {
        if (group === "users" && endpoint === "get") {
          queryCount += 1;
          return Effect.succeed({ id: (request as any).id, name: `name-${queryCount}` }).pipe(Effect.delay("10 millis")) as any;
        }
        if ((request as { name: string }).name.length === 0) {
          return Effect.fail("invalid") as any;
        }
        return Effect.succeed({ ok: true }) as any;
      },
    });

    let user!: () => Result.Result<{ id: string; name: string }, never>;
    createRoot(() => {
      user = client.query("users", "get", { id: "a" });
    });

    expect(Result.isInitial(user())).toBe(true);
    await tick(25);
    expect(Result.isSuccess(user())).toBe(true);
    const first = user();
    if (Result.isSuccess(first)) {
      expect(first.value.name).toBe("name-1");
    }

    client.refresh("users", "get", { id: "a" });
    await tick(25);
    expect(Result.isSuccess(user())).toBe(true);
    const second = user();
    if (Result.isSuccess(second)) {
      expect(second.value.name).toBe("name-2");
    }

    const rename = client.mutation("users", "rename");
    const out = await Effect.runPromise(rename({ id: "a", name: "next" }));
    expect(out.ok).toBe(true);
  });

  it("supports reactivityKeys invalidation via action", async () => {
    type Defs = {
      users: {
        get: { request: { id: string }; success: { id: string; name: string }; error: never };
        rename: { request: { id: string; name: string }; success: { ok: true }; error: string };
      };
    };

    let queryCount = 0;
    const client = AtomHttpApi.Tag()<"HttpClient2", Defs>("HttpClient2", {
      call: (group, endpoint, request) => {
        if (group === "users" && endpoint === "get") {
          queryCount += 1;
          return Effect.succeed({ id: (request as any).id, name: `name-${queryCount}` }).pipe(Effect.delay("5 millis")) as any;
        }
        return Effect.succeed({ ok: true }) as any;
      },
    });

    let user!: () => Result.Result<{ id: string; name: string }, never>;
    createRoot(() => {
      user = client.query("users", "get", { id: "a" }, { reactivityKeys: ["users"] });
    });

    await tick(20);
    const first = user();
    expect(Result.isSuccess(first)).toBe(true);

    const rename = client.action("users", "rename", { reactivityKeys: ["users"] });
    rename({ id: "a", name: "next" });

    await tick(20);
    const second = user();
    expect(Result.isSuccess(second)).toBe(true);
    if (Result.isSuccess(second)) {
      expect(second.value.name).toBe("name-2");
    }
  });
});
