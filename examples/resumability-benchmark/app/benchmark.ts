import { Effect, Exit, Schema, Scope } from "effect";
import { hydrateRoot, renderToString } from "effect-atom-jsx";
import * as Component from "effect-atom-jsx/Component";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import {
  insert,
  setAttribute,
  template,
} from "effect-atom-jsx/runtime";
import {
  bindStructuralExpression,
  expr,
  structuralExpressionCode,
} from "effect-atom-jsx/portable-extract";
import { browserState } from "../shared/browser-state.js";
import {
  BuildId,
  type BenchmarkDensity,
} from "../shared/build.js";

const browser = browserState();
if (browser !== undefined) {
  browser.appImports += 1;
}

const sectionTemplate = template(
  '<section data-testid="benchmark-root">',
);
const outputTemplate = template("<output>");

function instrumentSetup(): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    const state = browserState();
    if (state === undefined) return;
    state.setupRuns += 1;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        state.componentResources += 1;
      }),
      () =>
        Effect.sync(() => {
          state.componentResources -= 1;
          state.componentDisposals += 1;
        }),
    );
  });
}

function resumableText(
  label: string,
  dependency: Component.StateAtom<number>,
) {
  return expr(
    (captures, [value]) => `${captures.label}: ${value}`,
    {
      captures: Schema.Struct({ label: Schema.String }),
      bind: { label },
      dependencies: Schema.Tuple([Schema.Number]),
      deps: [dependency],
    },
  );
}

/**
 * DQ-030 measurement lane. When `AF_BENCH_ROW_MARKERS=1`, every resumable row
 * is wrapped in a comment pair shaped like the per-row markers option
 * (`<!--af:row:<id>:s-->` / `:e`). This is the only way to price that option
 * against the 1.10 slope ceiling before building it: the ratified alternative,
 * `data-af-key`, is already represented by the `data-expression-index`
 * attribute these rows carry.
 *
 * It measures the *marker* cost only -- DOM comment nodes and their payload
 * bytes -- not the per-row `Scope` that both options need equally, so the
 * result is a lower bound on the true difference.
 */
const rowMarkersEnabled = (): boolean => {
  const env = (globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } })
    .process?.env;
  return env?.["AF_BENCH_ROW_MARKERS"] === "1";
};

function row(
  index: number,
  key: "shared" | "independent",
  value: string | number | (() => string | number),
  markers = false,
): Element | ReadonlyArray<unknown> {
  const output = outputTemplate();
  setAttribute(output, "data-expression-index", String(index));
  setAttribute(output, "data-expression-key", key);
  insert(output, value);
  if (!markers || !rowMarkersEnabled()) return output;
  const doc = globalThis.document;
  return [
    doc.createComment(`af:row:x${index}:s`),
    output,
    doc.createComment(`af:row:x${index}:e`),
  ];
}

function instrumentView(): Element {
  const state = browserState();
  if (state !== undefined) state.viewRuns += 1;
  return sectionTemplate();
}

const MinimalResumable = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>()
    .doEffect(() => instrumentSetup())
    .bind("shared", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    }),
  (_props, bindings) => {
    const section = instrumentView();
    insert(section, row(0, "shared", resumableText("shared-0", bindings.shared), true));
    return section;
  },
);

const BoundaryOnlyResumable = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>()
    .doEffect(() => instrumentSetup())
    .bind("shared", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    }),
  () => instrumentView(),
);

const RealisticResumable = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>()
    .doEffect(() => instrumentSetup())
    .bind("shared", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent0", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent1", () => Component.state(2), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent2", () => Component.state(3), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent3", () => Component.state(4), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent4", () => Component.state(5), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent5", () => Component.state(6), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent6", () => Component.state(7), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent7", () => Component.state(8), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent8", () => Component.state(9), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent9", () => Component.state(10), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent10", () => Component.state(11), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("independent11", () => Component.state(12), {
      resume: Resume.snapshotState(Schema.Number),
    }),
  (_props, bindings) => {
    const section = instrumentView();
    const independents = [
      bindings.independent0,
      bindings.independent1,
      bindings.independent2,
      bindings.independent3,
      bindings.independent4,
      bindings.independent5,
      bindings.independent6,
      bindings.independent7,
      bindings.independent8,
      bindings.independent9,
      bindings.independent10,
      bindings.independent11,
    ];
    for (let index = 0; index < 12; index += 1) {
      insert(
        section,
        row(
          index,
          "shared",
          resumableText(`shared-${index}`, bindings.shared),
          true,
        ),
      );
    }
    for (let index = 0; index < independents.length; index += 1) {
      insert(
        section,
        row(
          index + 12,
          "independent",
          resumableText(`independent-${index}`, independents[index]!),
          true,
        ),
      );
    }
    return section;
  },
);

/**
 * Milestone 8d item 6: the real-rows lane. One authored structural list
 * expression renders `count` keyed text rows off the shared binding — the
 * per-row Scope, marker pair, map entry, and text node are all real, so the
 * density delta prices what the 2026-08-11 marker measurement could not: the
 * markers-only 35 B/row figure priced comments alone, and the per-row `Scope`
 * cancelled out of that paired delta.
 *
 * Report-only (`benchmarks/resumability/structural.mjs`); the gated density
 * lane keeps its 24-scalar-expression shape so the pinned baseline stays
 * comparable.
 */
export const StructuralRowsExpression = structuralExpressionCode({
  id: "af.benchmark.structural-rows",
  buildId: BuildId,
  mode: "list",
  captures: Schema.Struct({ count: Schema.Number }),
  dependencies: Schema.Tuple([Schema.Number]),
  render: (captures, [value]) =>
    Array.from({ length: captures.count }, (_, index) => ({
      key: `r${index}`,
      text: `shared-${index}: ${value}`,
    })),
});

function makeStructuralComponent(count: number) {
  return Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>()
      .doEffect(() => instrumentSetup())
      .bind("shared", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
    (_props, bindings) => {
      const section = instrumentView();
      insert(
        section,
        bindStructuralExpression(StructuralRowsExpression, { count }, [
          bindings.shared,
        ]),
      );
      return section;
    },
  );
}

const MinimalStructural = makeStructuralComponent(1);
const RealisticStructural = makeStructuralComponent(24);

export function renderStructuralServer(
  density: BenchmarkDensity,
): Resume.CollectionResult {
  const scope = Scope.makeUnsafe();
  try {
    return Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(
                density === 1 ? MinimalStructural : RealisticStructural,
                {},
              ).pipe(Scope.provide(scope)),
            )
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
  } finally {
    Effect.runSync(Scope.close(scope, Exit.void));
  }
}

interface EagerController {
  readonly shared: Component.StateAtom<number>;
  readonly independents: ReadonlyArray<Component.StateAtom<number>>;
}

let eagerController: EagerController | undefined;

const MinimalEager = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>()
    .doEffect(() => instrumentSetup())
    .bind("shared", () => Component.state(1)),
  (_props, bindings) => {
    const section = instrumentView();
    eagerController = { shared: bindings.shared, independents: [] };
    insert(
      section,
      row(0, "shared", () => `shared-0: ${bindings.shared()}`),
    );
    return section;
  },
);

const RealisticEager = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>()
    .doEffect(() => instrumentSetup())
    .bind("shared", () => Component.state(1))
    .bind("independent0", () => Component.state(1))
    .bind("independent1", () => Component.state(2))
    .bind("independent2", () => Component.state(3))
    .bind("independent3", () => Component.state(4))
    .bind("independent4", () => Component.state(5))
    .bind("independent5", () => Component.state(6))
    .bind("independent6", () => Component.state(7))
    .bind("independent7", () => Component.state(8))
    .bind("independent8", () => Component.state(9))
    .bind("independent9", () => Component.state(10))
    .bind("independent10", () => Component.state(11))
    .bind("independent11", () => Component.state(12)),
  (_props, bindings) => {
    const section = instrumentView();
    const independents = [
      bindings.independent0,
      bindings.independent1,
      bindings.independent2,
      bindings.independent3,
      bindings.independent4,
      bindings.independent5,
      bindings.independent6,
      bindings.independent7,
      bindings.independent8,
      bindings.independent9,
      bindings.independent10,
      bindings.independent11,
    ];
    eagerController = {
      shared: bindings.shared,
      independents,
    };
    for (let index = 0; index < 12; index += 1) {
      insert(
        section,
        row(
          index,
          "shared",
          () => `shared-${index}: ${bindings.shared()}`,
        ),
      );
    }
    for (let index = 0; index < independents.length; index += 1) {
      const dependency = independents[index]!;
      insert(
        section,
        row(
          index + 12,
          "independent",
          () => `independent-${index}: ${dependency()}`,
        ),
      );
    }
    return section;
  },
);

function componentFor(
  density: BenchmarkDensity,
  mode: "eager" | "resumable",
) {
  if (mode === "resumable") {
    return density === 1 ? MinimalResumable : RealisticResumable;
  }
  return density === 1 ? MinimalEager : RealisticEager;
}

function renderComponent(
  density: BenchmarkDensity,
  mode: "eager" | "resumable",
): unknown {
  const scope = Scope.makeUnsafe();
  try {
    return Effect.runSync(
      Component.renderEffect(componentFor(density, mode), {}).pipe(
        Scope.provide(scope),
      ),
    );
  } finally {
    Effect.runSync(Scope.close(scope, Exit.void));
  }
}

export function renderResumableServer(
  density: BenchmarkDensity,
): Resume.CollectionResult {
  return Effect.runSync(
    Resume.collect(
      () =>
        renderToString(() =>
          renderComponent(density, "resumable")
        ),
      { buildId: BuildId },
    ).pipe(Effect.provide(Serialization.layer)),
  );
}

export function renderBoundaryOnlyServer(): Resume.CollectionResult {
  const scope = Scope.makeUnsafe();
  try {
    return Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() =>
            Effect.runSync(
              Component.renderEffect(BoundaryOnlyResumable, {}).pipe(
                Scope.provide(scope),
              ),
            )
          ),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
  } finally {
    Effect.runSync(Scope.close(scope, Exit.void));
  }
}

export function renderEagerServer(
  density: BenchmarkDensity,
): string {
  return renderToString(() => renderComponent(density, "eager"));
}

export interface EagerMount {
  readonly startupNodeReused: boolean;
  readonly writeShared: (value: number) => void;
  readonly writeIndependent: (index: number, value: number) => void;
  readonly dispose: () => void;
}

export function mountEager(
  density: BenchmarkDensity,
  root: HTMLElement,
): EagerMount {
  const scope = Scope.makeUnsafe();
  const serverNode = root.firstElementChild;
  const disposeRoot = hydrateRoot(
    () =>
      Effect.runSync(
        Component.renderEffect(
          componentFor(density, "eager"),
          {},
        ).pipe(Scope.provide(scope)),
      ),
    root,
  );
  let disposed = false;
  return {
    startupNodeReused: root.firstElementChild === serverNode,
    writeShared: (value) => {
      if (disposed || eagerController === undefined) return;
      eagerController.shared.set(value);
    },
    writeIndependent: (index, value) => {
      if (disposed || eagerController === undefined) return;
      eagerController.independents[index]?.set(value);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      eagerController = undefined;
      disposeRoot();
      Effect.runSync(Scope.close(scope, Exit.void));
    },
  };
}
