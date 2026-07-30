import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ResumeExtractEntry } from "../compiler/resume-extract-plugin.js";
import {
  resolverEntriesModule,
  resumeExtract,
  virtualEntriesId,
} from "../compiler/resume-extract-vite.js";
import * as Portable from "../Portable.js";

const fixture = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const save = extract((captures) => Effect.succeed(captures.label), {
  captures: Schema.Struct({ label: Schema.String }),
  bind: { label: "Save" },
});
`;

interface TransformResult {
  readonly code: string;
  readonly map: unknown;
}

type TransformHook = (
  code: string,
  id: string,
) => Promise<TransformResult | null>;

function hooksOf(plugin: ReturnType<typeof resumeExtract>): {
  readonly transform: TransformHook;
  readonly resolveId: (source: string) => string | undefined;
  readonly load: (id: string) => Promise<string | undefined>;
  readonly entries: () => ReadonlyArray<ResumeExtractEntry>;
  readonly configResolved: (config: { readonly root: string }) => void;
} {
  return {
    transform: plugin.transform as unknown as TransformHook,
    resolveId: plugin.resolveId as unknown as (
      source: string,
    ) => string | undefined,
    load: plugin.load as unknown as (
      id: string,
    ) => Promise<string | undefined>,
    entries: (plugin.api as { entries: () => ReadonlyArray<ResumeExtractEntry> })
      .entries,
    configResolved: plugin.configResolved as unknown as (
      config: { readonly root: string },
    ) => void,
  };
}

describe("resume-extract Vite plugin", () => {
  it("transforms marker modules and aggregates build-manifest entries", async () => {
    const plugin = resumeExtract({ buildId: "build-1", root: "C:/app" });
    const hooks = hooksOf(plugin);

    const result = await hooks.transform(fixture, "C:/app/src/todo.ts");
    expect(result?.code).toContain('id: "src/todo.ts#save"');
    expect(result?.map).toBeDefined();
    expect(hooks.entries()).toMatchObject([
      { id: "src/todo.ts#save", moduleId: "src/todo.ts" },
    ]);
  });

  it("skips non-marker modules without invoking Babel semantics", async () => {
    const plugin = resumeExtract({ buildId: "build-1" });
    const hooks = hooksOf(plugin);
    expect(
      await hooks.transform("export const x = 1;", "C:/app/src/plain.ts"),
    ).toBeNull();
    expect(
      await hooks.transform(fixture, "C:/app/node_modules/dep/index.ts"),
    ).toBeNull();
    expect(hooks.entries()).toEqual([]);
  });

  it("replaces a module's entries on re-transform instead of duplicating them", async () => {
    const plugin = resumeExtract({ buildId: "build-1", root: "C:/app" });
    const hooks = hooksOf(plugin);
    await hooks.transform(fixture, "C:/app/src/todo.ts");
    await hooks.transform(fixture, "C:/app/src/todo.ts");
    expect(hooks.entries()).toHaveLength(1);

    const withoutMarker = `export const save = 1;`;
    await hooks.transform(
      `${withoutMarker}\n// portable-extract mention only`,
      "C:/app/src/todo.ts",
    );
    expect(hooks.entries()).toEqual([]);

    await hooks.transform(fixture, "C:/app/src/todo.ts");
    await hooks.transform(withoutMarker, "C:/app/src/todo.ts");
    expect(hooks.entries()).toEqual([]);
  });

  it("handles stateful include patterns deterministically", async () => {
    const include = Object.freeze(/\.ts$/g);
    const plugin = resumeExtract({
      buildId: "build-1",
      root: "C:/app",
      include,
    });
    const hooks = hooksOf(plugin);
    expect(await hooks.transform(fixture, "C:/app/src/one.ts")).not.toBeNull();
    expect(await hooks.transform(fixture, "C:/app/src/two.ts")).not.toBeNull();
    expect(hooks.entries()).toHaveLength(2);
    expect(include.lastIndex).toBe(0);
  });

  it("uses Vite's resolved root for stable module identities by default", async () => {
    const plugin = resumeExtract({ buildId: "build-1" });
    const hooks = hooksOf(plugin);
    hooks.configResolved({ root: "C:/app" });
    const result = await hooks.transform(
      fixture,
      "C:/app/features/todo.ts",
    );
    expect(result?.code).toContain('id: "features/todo.ts#save"');
  });

  it("fails the contributing transform on a cross-module identity collision", async () => {
    const plugin = resumeExtract({ buildId: "build-1" });
    const hooks = hooksOf(plugin);
    await hooks.transform(fixture, "C:/one/todo.ts");
    await expect(
      hooks.transform(fixture, "C:/two/todo.ts"),
    ).rejects.toThrow(/Portable code identity .* is emitted by both/);
  });

  it("rejects an empty build identity when the plugin is configured", () => {
    expect(() => resumeExtract({ buildId: "" })).toThrow(
      /requires a non-empty `buildId`/,
    );
  });

  it("serves the virtual resolver-entries module", async () => {
    const plugin = resumeExtract({ buildId: "build-1", root: "C:/app" });
    const hooks = hooksOf(plugin);
    await hooks.transform(fixture, "C:/app/src/todo.ts");

    const resolved = hooks.resolveId(virtualEntriesId);
    expect(resolved).toBe(`\0${virtualEntriesId}`);
    expect(hooks.resolveId("./elsewhere.js")).toBeUndefined();

    const moduleSource = await hooks.load(resolved!);
    expect(moduleSource).toContain('import { Effect } from "effect";');
    expect(moduleSource).toContain('"src/todo.ts#save": () => Effect.promise(');
    expect(moduleSource).toContain('import("C:/app/src/todo.ts")');
  });
});

describe("resolverEntriesModule", () => {
  const entry: ResumeExtractEntry = {
    id: "src/todo.ts#save",
    exportName: "_afCode$save",
    moduleId: "src/todo.ts",
    filename: "C:\\app\\src\\todo.ts",
  };

  it("emits normalized default import paths and custom mappings", () => {
    expect(resolverEntriesModule([entry])).toContain(
      'import("C:/app/src/todo.ts")',
    );
    expect(
      resolverEntriesModule([entry], (target) => `/src/${target.moduleId}`),
    ).toContain('import("/src/src/todo.ts")');
  });

  it("rejects duplicate portable identities instead of silently overwriting a loader", () => {
    expect(() =>
      resolverEntriesModule([
        entry,
        {
          ...entry,
          filename: "C:\\app\\src\\other.ts",
        },
      ])
    ).toThrow(/Portable code identity .* is emitted by both/);
  });

  it("emits loaders compatible with Portable.makeResolver", async () => {
    // Evaluate the generated loader shape directly: a thunk returning
    // Effect.promise(...) that resolves the generated export.
    const generated = resolverEntriesModule([entry]);
    expect(generated).toMatch(
      /"src\/todo\.ts#save": \(\) => Effect\.promise\(\(\) => import\("C:\/app\/src\/todo\.ts"\)\.then\(\(module\) => module\["_afCode\$save"\]\)\),/,
    );

    // Behavior proof with an equivalent in-memory loader: makeResolver
    // accepts the same thunk shape and memoizes it.
    const code = Portable.code({
      id: "src/todo.ts#save",
      buildId: "build-1",
      captures: (await import("effect")).Schema.Struct({}),
      run: () => Effect.succeed("ok"),
    });
    let loads = 0;
    const resolver = await Effect.runPromise(
      Portable.makeResolver({
        "src/todo.ts#save": () =>
          Effect.promise(() =>
            Promise.resolve().then(() => {
              loads += 1;
              return code;
            })
          ),
      }),
    );
    const first = await Effect.runPromise(
      resolver.load(code.id),
    );
    const second = await Effect.runPromise(
      resolver.load(code.id),
    );
    expect(first).toBe(code);
    expect(second).toBe(code);
    expect(loads).toBe(1);
  });
});

describe("resume-extract Vite plugin HMR", () => {
  interface FakeModuleGraph {
    invalidated: unknown[];
    getModuleById: (id: string) => unknown;
    invalidateModule: (module: unknown) => void;
  }

  function fakeContext(file: string): {
    readonly context: { file: string; server: { moduleGraph: FakeModuleGraph } };
    readonly graph: FakeModuleGraph;
  } {
    const virtualModule = { id: `\0${virtualEntriesId}` };
    const graph: FakeModuleGraph = {
      invalidated: [],
      getModuleById: (id) =>
        id === `\0${virtualEntriesId}` ? virtualModule : undefined,
      invalidateModule(module) {
        this.invalidated.push(module);
      },
    };
    return { context: { file, server: { moduleGraph: graph } }, graph };
  }

  it("invalidates the virtual entries module when an eligible file changes", async () => {
    const plugin = resumeExtract({ buildId: "build-1", root: "C:/app" });
    const hooks = hooksOf(plugin);
    await hooks.transform(fixture, "C:/app/src/todo.ts");

    const handleHotUpdate = plugin.handleHotUpdate as unknown as (
      context: unknown,
    ) => void;
    const changed = fakeContext("C:\\app\\src\\todo.ts");
    handleHotUpdate(changed.context);
    expect(changed.graph.invalidated).toHaveLength(1);

    const fresh = fakeContext("C:/app/src/new-module.ts");
    handleHotUpdate(fresh.context);
    expect(fresh.graph.invalidated).toHaveLength(1);

    const irrelevant = fakeContext("C:/app/node_modules/dep/index.ts");
    handleHotUpdate(irrelevant.context);
    expect(irrelevant.graph.invalidated).toHaveLength(0);

    const nonScript = fakeContext("C:/app/README.md");
    handleHotUpdate(nonScript.context);
    expect(nonScript.graph.invalidated).toHaveLength(0);
  });
});
