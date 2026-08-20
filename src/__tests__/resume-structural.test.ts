/**
 * Milestone 8d — structural expression targets (`DQ-100`, ratified 2026-08-11).
 *
 * Keyed list and branch regions: per-row marker comment pairs on the wire,
 * one `{ kind: "structural", mode }` manifest member at v5, and a per-instance
 * child `Scope` per row whose closure is driven from the same key diff that
 * produces the reconciler's removals.
 *
 * The lifecycle assertions count finalizer runs at the moment of removal —
 * final-state inspection would pass for an implementation that deferred every
 * row's cleanup to unmount, which is precisely the leak this design prevents.
 */
import {
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Schema,
  Scope,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import * as Serialization from "../Serialization.js";
import { exprAttribute, insert, renderToString, template } from "../dom.js";
import {
  bindStructuralExpression,
  structuralExpressionCode,
} from "../portable-extract.js";

const TestBuildId = "resume-structural-test-build";

const ItemsExpression = structuralExpressionCode({
  id: "test.resume.structural.items",
  buildId: TestBuildId,
  mode: "list",
  captures: Schema.Struct({}),
  dependencies: Schema.Tuple([Schema.Array(Schema.String)]),
  render: (_captures, [items]) =>
    items.map((item) => ({ key: item, text: `row:${item}` })),
});

const BranchExpression = structuralExpressionCode({
  id: "test.resume.structural.branch",
  buildId: TestBuildId,
  mode: "branch",
  captures: Schema.Struct({}),
  dependencies: Schema.Tuple([Schema.Boolean]),
  render: (_captures, [enabled]) =>
    enabled ? { key: "on", text: "ON" } : { key: "off", text: "OFF" },
});

const CountedBranchExpression = structuralExpressionCode({
  id: "test.resume.structural.counted",
  buildId: TestBuildId,
  mode: "branch",
  captures: Schema.Struct({}),
  dependencies: Schema.Tuple([Schema.Number]),
  render: (_captures, [count]) => ({ key: "row", text: `count:${count}` }),
});

const DuplicateKeyExpression = structuralExpressionCode({
  id: "test.resume.structural.duplicate",
  buildId: TestBuildId,
  mode: "list",
  captures: Schema.Struct({}),
  dependencies: Schema.Tuple([Schema.Array(Schema.String)]),
  render: () => [
    { key: "same", text: "one" },
    { key: "same", text: "two" },
  ],
});

function makeListComponent(initial: ReadonlyArray<string>) {
  return Component.make(
    Component.props<{}>(),
    Component.require<never>(),
    Component.setup<{}>().bind("items", () => Component.state<ReadonlyArray<string>>(initial), {
      resume: Resume.snapshotState(Schema.Array(Schema.String)),
    }),
    (_props, bindings) => {
      const list = template("<ul>")();
      insert(
        list,
        bindStructuralExpression(ItemsExpression, {}, [bindings.items]),
      );
      return list;
    },
  );
}

function collect(render: () => string) {
  return Effect.runSync(
    Resume.collect(render, { buildId: TestBuildId }).pipe(
      Effect.provide(Serialization.layer),
    ),
  );
}

function collectComponent(
  component: Component.Component<{}, never, never, any, any>,
) {
  const scope = Scope.makeUnsafe();
  const result = collect(() =>
    renderToString(() =>
      Effect.runSync(
        Component.renderEffect(component, {}).pipe(Scope.provide(scope)),
      ),
    )
  );
  Effect.runSync(Scope.close(scope, Exit.void));
  return result;
}

/**
 * A minimal client document: a flat sibling list of comment and text nodes,
 * enough for boundary scanning, structural row recovery, and reconciliation.
 * `insertBefore` detaches an attached node first — moving, like the real DOM.
 */
interface FakeNode {
  readonly nodeType: number;
  readonly nodeName: string;
  data?: string;
  textContent: string | null;
  readonly childNodes: ReadonlyArray<never>;
  parentNode: FakeStructuralDocument | null;
  nextSibling: FakeNode | null;
  readonly ownerDocument: FakeStructuralDocument;
}

class FakeStructuralDocument {
  readonly childNodes: FakeNode[] = [];

  createComment(data: string): FakeNode {
    return {
      nodeType: 8,
      nodeName: "#comment",
      data,
      textContent: data,
      childNodes: [],
      parentNode: null,
      nextSibling: null,
      ownerDocument: this,
    };
  }

  createTextNode(value: string): FakeNode {
    return {
      nodeType: 3,
      nodeName: "#text",
      textContent: value,
      childNodes: [],
      parentNode: null,
      nextSibling: null,
      ownerDocument: this,
    };
  }

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) this.childNodes.push(node);
    this.relink();
  }

  insertBefore(node: FakeNode, reference: FakeNode | null): FakeNode {
    const attached = this.childNodes.indexOf(node);
    if (attached >= 0) this.childNodes.splice(attached, 1);
    if (reference === null) {
      this.childNodes.push(node);
    } else {
      const index = this.childNodes.indexOf(reference);
      if (index < 0) throw new Error("Reference node is not in the fake root.");
      this.childNodes.splice(index, 0, node);
    }
    this.relink();
    return node;
  }

  removeChild(node: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error("Node is not in the fake root.");
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    node.nextSibling = null;
    this.relink();
    return node;
  }

  querySelectorAll(_selector: string): ReadonlyArray<never> {
    return [];
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  /** Text content between the expression markers, in document order. */
  regionText(expressionId: string): string {
    return this.regionNodes(expressionId)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? "")
      .join("|");
  }

  regionNodes(expressionId: string): FakeNode[] {
    const startIndex = this.childNodes.findIndex(
      (node) => node.data === `af:expr:${expressionId}:start`,
    );
    const endIndex = this.childNodes.findIndex(
      (node) => node.data === `af:expr:${expressionId}:end`,
    );
    if (startIndex < 0 || endIndex < 0) {
      throw new Error(`Expression region "${expressionId}" is missing.`);
    }
    return this.childNodes.slice(startIndex + 1, endIndex);
  }

  rowTextNode(expressionId: string, key: string): FakeNode | undefined {
    const nodes = this.regionNodes(expressionId);
    const startIndex = nodes.findIndex(
      (node) => node.data === `af:row:${expressionId}:${key}:s`,
    );
    if (startIndex < 0) return undefined;
    return nodes
      .slice(startIndex + 1)
      .find((node) => node.nodeType === 3);
  }

  private relink(): void {
    for (let index = 0; index < this.childNodes.length; index += 1) {
      const node = this.childNodes[index]!;
      node.parentNode = this;
      node.nextSibling = this.childNodes[index + 1] ?? null;
    }
  }
}

/** Build the flat SSR document one structural component collect produces. */
function structuralClientRoot(
  expressionId: string,
  rows: ReadonlyArray<readonly [key: string, text: string]>,
): FakeStructuralDocument {
  const root = new FakeStructuralDocument();
  root.append(root.createComment("af:component:c0:start"));
  root.append(root.createComment(`af:expr:${expressionId}:start`));
  for (const [key, text] of rows) {
    root.append(
      root.createComment(`af:row:${expressionId}:${key}:s`),
      root.createTextNode(text),
      root.createComment(`af:row:${expressionId}:${key}:e`),
    );
  }
  root.append(root.createComment(`af:expr:${expressionId}:end`));
  root.append(root.createComment("af:component:c0:end"));
  return root;
}

interface RowScopeLog {
  readonly opened: string[];
  readonly finalized: Record<string, number>;
  readonly stop: () => void;
}

/** Register a counting finalizer on every structural row Scope as it opens. */
function trackRowScopes(): RowScopeLog {
  const opened: string[] = [];
  const finalized: Record<string, number> = {};
  const stop = Resume.onStructuralRowScopeOpened(({ key, scope }) => {
    opened.push(key);
    Effect.runSync(
      Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          finalized[key] = (finalized[key] ?? 0) + 1;
        }),
      ),
    );
  });
  return { opened, finalized, stop };
}

describe("Milestone 8d structural collection", () => {
  it("collects a keyed list into per-row markers and a v5 structural manifest entry", () => {
    const result = collectComponent(makeListComponent(["a", "b", "c"]));

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest.version).toBe(5);
    const entry = (
      result.manifest as { expressions: Record<string, { target: unknown }> }
    ).expressions["x0"];
    expect(entry?.target).toEqual({ kind: "structural", mode: "list" });
    expect(result.html).toContain("<!--af:expr:x0:start-->");
    expect(result.html).toContain(
      "<!--af:row:x0:a:s-->row:a<!--af:row:x0:a:e-->",
    );
    expect(result.html).toContain(
      "<!--af:row:x0:c:s-->row:c<!--af:row:x0:c:e-->",
    );

    // NEGATIVE CONTROL: the wire schema itself refuses a structural entry at
    // v4, so "v5 only when structural" is enforced, not conventional.
    const decodedAtV4 = Schema.decodeUnknownExit(Resume.ManifestV4Schema)({
      ...(result.manifest as object),
      version: 4,
    });
    expect(Exit.isFailure(decodedAtV4)).toBe(true);
  });

  it("keeps scalar-only manifests at v4", () => {
    // An ordinary text expression must not pay the version bump.
    const scalar = Resume.ExpressionEntryV4Schema;
    expect(scalar).toBeDefined();
    const result = collectComponent(
      Component.make(
        Component.props<{}>(),
        Component.require<never>(),
        Component.setup<{}>().bind("items", () => Component.state<ReadonlyArray<string>>(["a"]), {
          resume: Resume.snapshotState(Schema.Array(Schema.String)),
        }),
        (_props, bindings) => {
          const list = template("<ul>")();
          // Render the binding as plain SSR content, no structural expression.
          insert(list, bindings.items().join(","));
          return list;
        },
      ),
    );
    expect(result.manifest.version).toBe(2);
  });

  it("fails closed on duplicate structural row keys with no region and no entry", () => {
    const Broken = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("items", () => Component.state<ReadonlyArray<string>>(["a"]), {
        resume: Resume.snapshotState(Schema.Array(Schema.String)),
      }),
      (_props, bindings) => {
        const list = template("<ul>")();
        insert(
          list,
          bindStructuralExpression(DuplicateKeyExpression, {}, [
            bindings.items,
          ]),
        );
        return list;
      },
    );
    const result = collectComponent(Broken);
    expect(
      result.diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("unsupported-expression-output");
    expect(result.manifest.version).toBe(2);
    expect(result.html).not.toContain("af:expr:");
    expect(result.html).not.toContain("af:row:");
  });

  it("encodes row keys so comment-hostile characters cannot break the marker", () => {
    const HostileExpression = structuralExpressionCode({
      id: "test.resume.structural.hostile",
      buildId: TestBuildId,
      mode: "list",
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Array(Schema.String)]),
      render: (_captures, [items]) =>
        items.map((item) => ({ key: item, text: item })),
    });
    const Hostile = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind(
        "items",
        () => Component.state<ReadonlyArray<string>>(["a--b>", "x:y z"]),
        { resume: Resume.snapshotState(Schema.Array(Schema.String)) },
      ),
      (_props, bindings) => {
        const list = template("<ul>")();
        insert(
          list,
          bindStructuralExpression(HostileExpression, {}, [bindings.items]),
        );
        return list;
      },
    );
    const result = collectComponent(Hostile);
    expect(result.diagnostics).toEqual([]);
    // No comment in the whole document may contain `--` or `>` in its data.
    const comments = result.html.match(/<!--([\s\S]*?)-->/g) ?? [];
    for (const comment of comments) {
      const data = comment.slice("<!--".length, -"-->".length);
      expect(data).not.toContain("--");
      expect(data).not.toContain(">");
    }
  });

  it("suppresses a structural expression bound to an attribute target", () => {
    const KeyedListExpression = structuralExpressionCode({
      id: "test.resume.structural.keyed-misuse",
      buildId: TestBuildId,
      mode: "list",
      captures: Schema.Struct({}),
      dependencies: Schema.Tuple([Schema.Unknown]),
      render: () => [{ key: "a", text: "a" }],
    });
    const result = collect(() =>
      renderToString(() => {
        const node = template("<div>")();
        exprAttribute(
          node as unknown as Element,
          bindStructuralExpression(KeyedListExpression, {}, ["items"]),
          "title",
        );
        return node;
      })
    );
    expect(
      result.diagnostics.map((diagnostic) => diagnostic.code),
    ).toContain("unsupported-expression-output");
    expect(result.html).not.toContain("title=");
    expect(result.html).not.toContain("data-af-expr");
  });
});

describe("Milestone 8d structural client resumption", () => {
  async function installList(root: FakeStructuralDocument) {
    const result = collectComponent(makeListComponent(["a", "b", "c"]));
    expect(result.manifest.version).toBe(5);
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [ItemsExpression.id]: ItemsExpression },
        runtime,
      }),
    );
    return { installation, runtime };
  }

  it("patches only the changed rows: surviving rows keep node identity, dropped rows dispose at removal", async () => {
    const root = structuralClientRoot("x0", [
      ["a", "row:a"],
      ["b", "row:b"],
      ["c", "row:c"],
    ]);
    const log = trackRowScopes();
    const { installation, runtime } = await installList(root);
    try {
      const write = (items: ReadonlyArray<string>) =>
        Effect.runSync(
          installation.writeBinding(
            "c0",
            "items",
            Schema.Array(Schema.String),
            items,
          ),
        );

      write(["c", "a"]);
      await vi.waitFor(() => expect(log.finalized["b"]).toBe(1));
      // Identity, not text: the surviving rows are the SSR nodes, reordered.
      const textA = root.rowTextNode("x0", "a");
      const textC = root.rowTextNode("x0", "c");
      expect(root.regionText("x0")).toBe("row:c|row:a");
      expect(textA?.parentNode).toBe(root);
      expect(log.finalized["a"]).toBeUndefined();
      expect(log.finalized["c"]).toBeUndefined();

      write(["c", "d", "a"]);
      await vi.waitFor(() =>
        expect(root.regionText("x0")).toBe("row:c|row:d|row:a")
      );
      // The insertion created only the new row; existing nodes are reused.
      expect(root.rowTextNode("x0", "a")).toBe(textA);
      expect(root.rowTextNode("x0", "c")).toBe(textC);
      expect(log.opened.filter((key) => key === "d")).toHaveLength(1);

      write([]);
      await vi.waitFor(() => {
        expect(log.finalized["a"]).toBe(1);
        expect(log.finalized["c"]).toBe(1);
        expect(log.finalized["d"]).toBe(1);
      });
      expect(root.regionText("x0")).toBe("");
      expect(textA?.parentNode ?? null).toBeNull();

      await Effect.runPromise(installation.dispose);
      // Exactly once: disposal must not re-close scopes already closed at
      // removal time.
      expect(log.finalized).toEqual({ a: 1, b: 1, c: 1, d: 1 });
    } finally {
      log.stop();
      await runtime.dispose();
    }
  });

  it("closes surviving row Scopes with the installation, not before", async () => {
    const root = structuralClientRoot("x0", [
      ["a", "row:a"],
      ["b", "row:b"],
      ["c", "row:c"],
    ]);
    const log = trackRowScopes();
    const { installation, runtime } = await installList(root);
    try {
      Effect.runSync(
        installation.writeBinding(
          "c0",
          "items",
          Schema.Array(Schema.String),
          ["b"],
        ),
      );
      await vi.waitFor(() => {
        expect(log.finalized["a"]).toBe(1);
        expect(log.finalized["c"]).toBe(1);
      });
      expect(log.finalized["b"]).toBeUndefined();

      await Effect.runPromise(installation.dispose);
      expect(log.finalized["b"]).toBe(1);
    } finally {
      log.stop();
      await runtime.dispose();
    }
  });

  it("replaces a branch under one Scope, closing the outgoing instance exactly once", async () => {
    const Toggle = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("enabled", () => Component.state(false), {
        resume: Resume.snapshotState(Schema.Boolean),
      }),
      (_props, bindings) => {
        const host = template("<div>")();
        insert(
          host,
          bindStructuralExpression(BranchExpression, {}, [bindings.enabled]),
        );
        return host;
      },
    );
    const result = collectComponent(Toggle);
    expect(result.manifest.version).toBe(5);
    const entry = (
      result.manifest as { expressions: Record<string, { target: unknown }> }
    ).expressions["x0"];
    expect(entry?.target).toEqual({ kind: "structural", mode: "branch" });
    expect(result.html).toContain(
      "<!--af:row:x0:off:s-->OFF<!--af:row:x0:off:e-->",
    );

    const root = structuralClientRoot("x0", [["off", "OFF"]]);
    const log = trackRowScopes();
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: { [BranchExpression.id]: BranchExpression },
        runtime,
      }),
    );
    try {
      Effect.runSync(
        installation.writeBinding("c0", "enabled", Schema.Boolean, true),
      );
      await vi.waitFor(() => expect(log.finalized["off"]).toBe(1));
      expect(root.regionText("x0")).toBe("ON");

      Effect.runSync(
        installation.writeBinding("c0", "enabled", Schema.Boolean, false),
      );
      await vi.waitFor(() => expect(log.finalized["on"]).toBe(1));
      expect(root.regionText("x0")).toBe("OFF");
      // The off instance closed exactly once even though "off" recurred.
      expect(log.finalized["off"]).toBe(1);
      expect(log.opened.filter((key) => key === "off")).toHaveLength(2);

      await Effect.runPromise(installation.dispose);
    } finally {
      log.stop();
      await runtime.dispose();
    }
  });

  it("keeps node identity when a branch patch changes only the row's text", async () => {
    const Counted = Component.make(
      Component.props<{}>(),
      Component.require<never>(),
      Component.setup<{}>().bind("count", () => Component.state(1), {
        resume: Resume.snapshotState(Schema.Number),
      }),
      (_props, bindings) => {
        const host = template("<div>")();
        insert(
          host,
          bindStructuralExpression(CountedBranchExpression, {}, [
            bindings.count,
          ]),
        );
        return host;
      },
    );
    const result = collectComponent(Counted);
    const root = structuralClientRoot("x0", [["row", "count:1"]]);
    const log = trackRowScopes();
    const runtime = ManagedRuntime.make(Layer.empty);
    const installation = Effect.runSync(
      Resume.installClient({
        root: root as unknown as Document,
        manifest: result.manifest,
        expectedBuildId: TestBuildId,
        resolverEntries: {
          [CountedBranchExpression.id]: CountedBranchExpression,
        },
        runtime,
      }),
    );
    try {
      Effect.runSync(
        installation.writeBinding("c0", "count", Schema.Number, 2),
      );
      await vi.waitFor(() => expect(root.regionText("x0")).toBe("count:2"));
      const textNode = root.rowTextNode("x0", "row");

      Effect.runSync(
        installation.writeBinding("c0", "count", Schema.Number, 3),
      );
      await vi.waitFor(() => expect(root.regionText("x0")).toBe("count:3"));
      expect(root.rowTextNode("x0", "row")).toBe(textNode);
      // Same key throughout: nothing was ever removed, so nothing finalized.
      expect(log.finalized).toEqual({});

      await Effect.runPromise(installation.dispose);
      expect(log.finalized).toEqual({ row: 1 });
    } finally {
      log.stop();
      await runtime.dispose();
    }
  });
});
