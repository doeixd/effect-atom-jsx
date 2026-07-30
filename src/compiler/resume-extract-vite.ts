/**
 * Vite integration for the resume-extract transform (Milestone 7).
 *
 * `resumeExtract(options)` returns a Vite plugin that runs the Babel
 * closure-extraction transform over application modules, aggregates the
 * generated code entries into a build manifest, and serves a virtual module
 * (`virtual:af-resume-entries`) exporting lazy `Portable.ResolverEntries`
 * keyed by code identity:
 *
 *     import { resolverEntries } from "virtual:af-resume-entries";
 *     Resume.installClient({ resolverEntries, ... })
 *
 * `@babel/core` is loaded lazily inside the transform hook, so importing this
 * module (or shipping it in dist) adds no runtime Babel dependency; the
 * plugin only requires Babel when a build actually runs it.
 */
import type * as Babel from "@babel/core";
import type * as Vite from "vite";
import resumeExtractPlugin, {
  type ResumeExtractDiagnostic,
  type ResumeExtractEntry,
  type ResumeExtractOptions,
} from "./resume-extract-plugin.js";

export const virtualEntriesId = "virtual:af-resume-entries";
const resolvedVirtualEntriesId = `\0${virtualEntriesId}`;

export interface ResumeExtractViteOptions extends
  Omit<ResumeExtractOptions, "moduleId" | "onCode">
{
  /**
   * Files eligible for the transform. Defaults to script files outside
   * `node_modules`.
   */
  readonly include?: RegExp;
  /**
   * Maps a generated entry to the import specifier used in the virtual
   * resolver-entries module. Defaults to the entry's normalized filename.
   */
  readonly importPath?: (entry: ResumeExtractEntry) => string;
  /**
   * Modules (Vite specifiers, e.g. root-relative "/app/save.ts") that
   * contain `extract` markers but are reachable only through the virtual
   * entries module itself. They are force-loaded before the virtual module
   * is generated, so their entries exist on first build.
   */
  readonly sourceModules?: ReadonlyArray<string>;
}

const defaultInclude = /\.[cm]?[jt]sx?$/;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function testRegExp(pattern: RegExp, value: string): boolean {
  return pattern.global || pattern.sticky
    ? new RegExp(pattern.source, pattern.flags).test(value)
    : pattern.test(value);
}

function assertUniqueEntries(
  entries: ReadonlyArray<ResumeExtractEntry>,
): void {
  const seen = new Map<string, ResumeExtractEntry>();
  for (const entry of entries) {
    const previous = seen.get(entry.id);
    if (previous !== undefined) {
      throw new Error(
        `[resume-extract] Portable code identity "${entry.id}" is emitted by both "${
          previous.filename ?? previous.moduleId
        }" and "${entry.filename ?? entry.moduleId}". Configure a unique module identity; duplicate resolver keys are not deterministic.`,
      );
    }
    seen.set(entry.id, entry);
  }
}

/**
 * Render a resolver-entries module from collected build-manifest entries.
 *
 * Each entry becomes a lazy loader that dynamically imports the transformed
 * module and selects the generated export, wrapped in `Effect.promise` so
 * load failures surface as defects for `Portable.makeResolver` to normalize
 * into `PortableCodeLoadError`.
 */
export function resolverEntriesModule(
  entries: ReadonlyArray<ResumeExtractEntry>,
  importPath: (entry: ResumeExtractEntry) => string = (entry) =>
    normalizePath(entry.filename ?? entry.moduleId),
): string {
  assertUniqueEntries(entries);
  const lines = entries.map((entry) =>
    `  ${JSON.stringify(entry.id)}: () => Effect.promise(() => import(${
      JSON.stringify(importPath(entry))
    }).then((module) => module[${JSON.stringify(entry.exportName)}])),`
  );
  return [
    `import { Effect } from "effect";`,
    ``,
    `export const resolverEntries = {`,
    ...lines,
    `};`,
    ``,
  ].join("\n");
}

/**
 * Create the Vite plugin. Entries are tracked per source module, so
 * re-transforms during dev replace that module's entries instead of
 * duplicating them.
 */
export function resumeExtract(
  options: ResumeExtractViteOptions,
): Vite.Plugin {
  if (typeof options.buildId !== "string" || options.buildId.length === 0) {
    throw new Error(
      "[resume-extract] The Vite plugin requires a non-empty `buildId` option.",
    );
  }
  const include = options.include ?? defaultInclude;
  const markerSuffixes = options.markerSuffixes ?? ["portable-extract"];
  const entriesByModule = new Map<string, ReadonlyArray<ResumeExtractEntry>>();
  let projectRoot = options.root;

  const allEntries = (): ReadonlyArray<ResumeExtractEntry> => {
    const entries = [...entriesByModule.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .flatMap(([, entries]) => entries);
    assertUniqueEntries(entries);
    return entries;
  };

  return {
    name: "af-ui-resume-extract",
    enforce: "pre",
    configResolved(config) {
      projectRoot ??= normalizePath(config.root);
    },
    api: {
      /** Snapshot of the aggregated build manifest, sorted by module. */
      entries: allEntries,
    },
    resolveId(source: string) {
      return source === virtualEntriesId ? resolvedVirtualEntriesId : undefined;
    },
    async load(id: string) {
      if (id !== resolvedVirtualEntriesId) return undefined;
      const context = this as unknown as {
        readonly resolve?: (
          source: string,
        ) => Promise<{ readonly id: string } | null>;
        readonly load?: (options: { readonly id: string }) => Promise<unknown>;
      };
      for (const specifier of new Set(options.sourceModules ?? [])) {
        const resolved = await context.resolve?.(specifier);
        if (resolved != null) {
          await context.load?.({ id: resolved.id });
        }
      }
      return resolverEntriesModule(allEntries(), options.importPath);
    },
    handleHotUpdate(context: Vite.HmrContext) {
      // When a module that contributed (or newly contributes) extract
      // entries changes, the generated resolver-entries module is stale:
      // invalidate it so the next request regenerates from fresh entries.
      const changed = normalizePath(context.file);
      const contributed = entriesByModule.has(changed);
      const mightContribute = testRegExp(include, changed)
        && !changed.includes("/node_modules/");
      if (!contributed && !mightContribute) return;
      const graph = context.server.moduleGraph as {
        readonly getModuleById: (id: string) => unknown;
        readonly invalidateModule: (module: never) => void;
      };
      const virtualModule = graph.getModuleById(resolvedVirtualEntriesId);
      if (virtualModule != null) {
        graph.invalidateModule(virtualModule as never);
      }
    },
    async transform(code: string, id: string) {
      const [filename] = id.split("?");
      if (filename === undefined || !testRegExp(include, filename)) return null;
      if (filename.includes("/node_modules/")) return null;
      const normalizedFilename = normalizePath(filename);
      // Fast path: skip modules that cannot reference the marker.
      if (!markerSuffixes.some((suffix) => code.includes(suffix))) {
        // A hot update may have removed the last marker import. Forget the
        // previous contribution before taking the fast path, otherwise the
        // virtual resolver module keeps a loader for an export that no longer
        // exists.
        entriesByModule.delete(normalizedFilename);
        return null;
      }

      const babel = (await import("@babel/core")) as typeof Babel;
      const collected: ResumeExtractEntry[] = [];
      const warn = (this as { warn?: (message: string) => void } | undefined)
        ?.warn;
      const pluginOptions: ResumeExtractOptions = {
        buildId: options.buildId,
        ...(projectRoot === undefined ? {} : { root: projectRoot }),
        ...(options.runtimeModule === undefined
          ? {}
          : { runtimeModule: options.runtimeModule }),
        ...(options.expressionRuntimeModule === undefined
          ? {}
          : { expressionRuntimeModule: options.expressionRuntimeModule }),
        ...(options.secretCaptureSeverity === undefined
          ? {}
          : { secretCaptureSeverity: options.secretCaptureSeverity }),
        ...(options.secretNamePattern === undefined
          ? {}
          : { secretNamePattern: options.secretNamePattern }),
        ...(options.maxBindSourceLength === undefined
          ? {}
          : { maxBindSourceLength: options.maxBindSourceLength }),
        markerSuffixes,
        onCode: (entry) => collected.push(entry),
        onDiagnostic: (diagnostic: ResumeExtractDiagnostic) => {
          options.onDiagnostic?.(diagnostic);
          warn?.call(this, diagnostic.message);
        },
      };
      const result = await babel.transformAsync(code, {
        filename,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: {
          sourceType: "module",
          plugins: filename.endsWith(".tsx") || filename.endsWith(".jsx")
            ? ["typescript", "jsx"]
            : ["typescript"],
        },
        plugins: [[resumeExtractPlugin, pluginOptions]],
      });
      if (result?.code == null) return null;

      if (collected.length > 0) {
        entriesByModule.set(normalizedFilename, collected);
      } else {
        entriesByModule.delete(normalizedFilename);
      }
      // Detect cross-module identity collisions at the contributing transform,
      // rather than emitting a virtual module whose duplicate object keys
      // silently choose one loader.
      allEntries();
      return {
        code: result.code,
        map: result.map ?? null,
      };
    },
  };
}
