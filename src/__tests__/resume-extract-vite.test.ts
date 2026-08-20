import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ResumeExtractEntry } from "../compiler/resume-extract-plugin.js";
import {
  expandSourceModules,
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

describe("sourceModules force-loading", () => {
  /**
   * A minimal stand-in for Vite's plugin container `this`, recording what the
   * `load` hook asks of it. `loadModule` is optional so the dev-serve
   * container (which does not expose `this.load`) can be modelled too.
   */
  function pluginContext(
    plugin: ReturnType<typeof resumeExtract>,
    options: { readonly withLoad: boolean },
  ) {
    const resolved: string[] = [];
    const loaded: string[] = [];
    const hooks = hooksOf(plugin);
    const context: Record<string, unknown> = {
      resolve: async (source: string) => {
        resolved.push(source);
        return { id: `C:/app${source}` };
      },
    };
    if (options.withLoad) {
      context.load = async ({ id }: { readonly id: string }) => {
        loaded.push(id);
        // Vite would run the plugin container's transform pipeline here.
        await hooks.transform(fixture, id);
      };
    }
    return { context, resolved, loaded };
  }

  it("force-loads configured source modules before generating the virtual module", async () => {
    const plugin = resumeExtract({
      buildId: "build-1",
      root: "C:/app",
      sourceModules: ["/src/todo.ts", "/src/todo.ts"],
    });
    const load = plugin.load as unknown as (
      this: unknown,
      id: string,
    ) => Promise<string | undefined>;
    const { context, resolved, loaded } = pluginContext(plugin, {
      withLoad: true,
    });

    // Nothing has been transformed yet: without the discovery loop the
    // virtual module would be empty.
    const source = await load.call(context, `\0${virtualEntriesId}`);

    // Falsifiable counts, not just "it happened": duplicates are collapsed.
    expect(resolved).toEqual(["/src/todo.ts"]);
    expect(loaded).toEqual(["C:/app/src/todo.ts"]);
    expect(source).toContain('"src/todo.ts#save": () => Effect.promise(');
    expect(hooksOf(plugin).entries()).toHaveLength(1);
  });

  it("emits an EMPTY resolver module when the container exposes no `this.load`", async () => {
    // PIN OF A KNOWN DEFECT, not an endorsement. Vite's dev-serve plugin
    // container does not provide `this.load`, so the discovery loop resolves
    // the specifier and then silently no-ops — the virtual module ships with
    // zero loaders and every resume lookup misses at runtime. The build-mode
    // container does provide it (covered above), which is why the Chromium
    // fixture never sees this.
    const plugin = resumeExtract({
      buildId: "build-1",
      root: "C:/app",
      sourceModules: ["/src/todo.ts"],
    });
    const load = plugin.load as unknown as (
      this: unknown,
      id: string,
    ) => Promise<string | undefined>;
    const { context, resolved } = pluginContext(plugin, { withLoad: false });

    const source = await load.call(context, `\0${virtualEntriesId}`);
    expect(resolved).toEqual(["/src/todo.ts"]);
    expect(source).toContain("export const resolverEntries = {");
    expect(source).not.toContain("Effect.promise(");
  });

  it("tolerates a specifier that does not resolve", async () => {
    const plugin = resumeExtract({
      buildId: "build-1",
      root: "C:/app",
      sourceModules: ["/missing.ts"],
    });
    const load = plugin.load as unknown as (
      this: unknown,
      id: string,
    ) => Promise<string | undefined>;
    const loaded: string[] = [];
    const context = {
      resolve: async () => null,
      load: async ({ id }: { readonly id: string }) => {
        loaded.push(id);
      },
    };
    await expect(
      load.call(context, `\0${virtualEntriesId}`),
    ).resolves.toContain("export const resolverEntries = {");
    expect(loaded).toEqual([]);
  });

  it("does not force-load anything when sourceModules is unset", async () => {
    const plugin = resumeExtract({ buildId: "build-1", root: "C:/app" });
    const load = plugin.load as unknown as (
      this: unknown,
      id: string,
    ) => Promise<string | undefined>;
    const { context, resolved, loaded } = pluginContext(plugin, {
      withLoad: true,
    });
    await load.call(context, `\0${virtualEntriesId}`);
    expect(resolved).toEqual([]);
    expect(loaded).toEqual([]);
  });
});

describe("glob sourceModules discovery (M10 item 5)", () => {
  async function makeTree(): Promise<string> {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "af-glob-"));
    for (const file of [
      "app/pin.ts",
      "app/nested/deep.ts",
      "app/readme.md",
      "lib/other.ts",
      "node_modules/dep/index.ts",
      ".hidden/secret.ts",
    ]) {
      const absolute = path.join(root, file);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, "export {};\n");
    }
    return root.replace(/\\/g, "/");
  }

  it("expands globs against the root, skipping node_modules and dot-dirs", async () => {
    const root = await makeTree();
    expect(await expandSourceModules(["/app/**/*.ts"], root)).toEqual([
      "/app/nested/deep.ts",
      "/app/pin.ts",
    ]);
    // `*` stays within one segment; `**` crosses.
    expect(await expandSourceModules(["/app/*.ts"], root)).toEqual([
      "/app/pin.ts",
    ]);
    // Literal specifiers pass through untouched (unverified against disk),
    // and mix with glob matches.
    expect(
      await expandSourceModules(["/exact/entry.ts", "/lib/*.ts"], root),
    ).toEqual(["/exact/entry.ts", "/lib/other.ts"]);
    // A glob that matches nothing expands to nothing — never a literal path.
    expect(await expandSourceModules(["/missing/**/*.ts"], root)).toEqual([]);
    // Without a root, globs cannot expand; literals still pass.
    expect(
      await expandSourceModules(["/app/**/*.ts", "/exact.ts"], undefined),
    ).toEqual(["/exact.ts"]);
  });

  it("force-loads every glob-discovered module through the plugin load hook", async () => {
    const root = await makeTree();
    const plugin = resumeExtract({
      buildId: "build-1",
      root,
      sourceModules: ["/app/**/*.ts"],
    });
    const load = plugin.load as unknown as (
      this: unknown,
      id: string,
    ) => Promise<string | undefined>;
    const resolved: string[] = [];
    const loaded: string[] = [];
    const context = {
      resolve: async (source: string) => {
        resolved.push(source);
        return { id: `${root}${source}` };
      },
      load: async ({ id }: { readonly id: string }) => {
        loaded.push(id);
      },
    };
    await load.call(context, `\0${virtualEntriesId}`);
    expect(resolved).toEqual(["/app/nested/deep.ts", "/app/pin.ts"]);
    expect(loaded).toEqual([
      `${root}/app/nested/deep.ts`,
      `${root}/app/pin.ts`,
    ]);
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
    // Identity, not just arity: the *virtual entries* module is the one
    // invalidated, so invalidating some arbitrary module cannot pass.
    expect(changed.graph.invalidated).toEqual([
      { id: `\0${virtualEntriesId}` },
    ]);

    const fresh = fakeContext("C:/app/src/new-module.ts");
    handleHotUpdate(fresh.context);
    expect(fresh.graph.invalidated).toEqual([{ id: `\0${virtualEntriesId}` }]);

    const irrelevant = fakeContext("C:/app/node_modules/dep/index.ts");
    handleHotUpdate(irrelevant.context);
    expect(irrelevant.graph.invalidated).toEqual([]);

    const nonScript = fakeContext("C:/app/README.md");
    handleHotUpdate(nonScript.context);
    expect(nonScript.graph.invalidated).toEqual([]);
  });

  it("regenerates the virtual module from post-update entries after invalidation", async () => {
    // The invalidation call is only a means; what must hold is that the *next*
    // load reflects the edited module. Drive the full sequence rather than
    // asserting on the spy.
    const plugin = resumeExtract({ buildId: "build-1", root: "C:/app" });
    const hooks = hooksOf(plugin);
    const load = plugin.load as unknown as (
      this: unknown,
      id: string,
    ) => Promise<string | undefined>;
    const handleHotUpdate = plugin.handleHotUpdate as unknown as (
      context: unknown,
    ) => void;

    await hooks.transform(fixture, "C:/app/src/todo.ts");
    expect(await load.call({}, `\0${virtualEntriesId}`)).toContain(
      '"src/todo.ts#save"',
    );

    // The author renames the export; Vite re-transforms and fires HMR.
    const renamed = fixture.replace("export const save", "export const store");
    await hooks.transform(renamed, "C:/app/src/todo.ts");
    handleHotUpdate(fakeContext("C:/app/src/todo.ts").context);

    const regenerated = await load.call({}, `\0${virtualEntriesId}`);
    expect(regenerated).toContain('"src/todo.ts#store"');
    expect(regenerated).not.toContain('"src/todo.ts#save"');

    // …and removing the marker entirely drops the loader instead of leaving a
    // dangling import of a deleted export.
    await hooks.transform("export const store = 1;", "C:/app/src/todo.ts");
    handleHotUpdate(fakeContext("C:/app/src/todo.ts").context);
    expect(await load.call({}, `\0${virtualEntriesId}`)).not.toContain(
      "Effect.promise(",
    );
  });

  it("does not throw when the virtual module is absent from the graph", () => {
    const plugin = resumeExtract({ buildId: "build-1", root: "C:/app" });
    const handleHotUpdate = plugin.handleHotUpdate as unknown as (
      context: unknown,
    ) => void;
    const graph = {
      invalidated: [] as unknown[],
      getModuleById: () => undefined,
      invalidateModule(module: unknown) {
        this.invalidated.push(module);
      },
    };
    expect(() =>
      handleHotUpdate({
        file: "C:/app/src/todo.ts",
        server: { moduleGraph: graph },
      })
    ).not.toThrow();
    expect(graph.invalidated).toEqual([]);
  });
});
