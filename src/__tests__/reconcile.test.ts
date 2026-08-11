import { describe, expect, it } from "vitest";
import { reconcileArrays, renderToString, template } from "../dom.js";

/**
 * Keyed reconciliation is the prerequisite for any fine-grained structural
 * expression target: if a keyed update *replaced* nodes, a resumed list region
 * could never preserve the DOM identity its subscribers hold.
 *
 * Identity is the assertion throughout. Comparing rendered text would pass for
 * a renderer that rebuilt every node on every update, which is exactly the
 * implementation these tests exist to reject.
 */
describe("dom.reconcileArrays", () => {
  it("reuses surviving nodes across reorder, insertion, and removal", () => {
    const seen: Array<ReadonlyArray<unknown>> = [];
    let nodes: Record<string, unknown> = {};
    // Node has no global `document`; `renderToString` installs the server one,
    // so the whole exercise runs inside a render pass.
    renderToString(() => {
      const parent = template("<ul>")() as unknown as Element;
      const row = (label: string) => {
        const item = template("<li>")() as unknown as Element;
        item.textContent = label;
        return item;
      };
      const a = row("a");
      const b = row("b");
      const c = row("c");
      const d = row("d");
      nodes = { a, b, c, d };

      reconcileArrays(parent, [], [a, b, c], null);
      seen.push([...parent.childNodes]);
      reconcileArrays(parent, [a, b, c], [c, a], null);
      seen.push([...parent.childNodes]);
      reconcileArrays(parent, [c, a], [c, d, a], null);
      seen.push([...parent.childNodes]);
      reconcileArrays(parent, [c, d, a], [c, d, a], null);
      seen.push([...parent.childNodes]);
      return parent as never;
    });

    const { a, b, c, d } = nodes as Record<string, Node>;
    expect(seen[0]).toEqual([a, b, c]);
    // The reorder keeps both survivors and their identity.
    expect(seen[1]).toEqual([c, a]);
    // The dropped node is detached, not merely reordered -- a retained `b` is
    // a leak, and leaks are what region ownership exists to settle.
    expect(seen[1]).not.toContain(b);
    expect(b.parentNode).toBe(null);
    // "Reuse nothing" fails the identity assertions; "reuse everything" fails
    // the removal; and a reconciler that cleared the parent whenever it was
    // called fails the final no-op step.
    expect(seen[2]).toEqual([c, d, a]);
    expect(seen[3]).toEqual([c, d, a]);
  });

  it("performs no DOM mutation when the lists are identical", () => {
    // The no-op case is where a rebuild-everything implementation is cheapest
    // to write and most expensive at runtime, so assert the absence of work
    // rather than the presence of the right result.
    let mutations = 0;
    renderToString(() => {
      const parent = template("<ul>")() as unknown as Element;
      const rows = ["a", "b", "c"].map((label) => {
        const item = template("<li>")() as unknown as Element;
        item.textContent = label;
        return item as Node;
      });
      reconcileArrays(parent, [], rows, null);

      const realInsert = parent.insertBefore.bind(parent);
      const realRemove = parent.removeChild.bind(parent);
      (parent as unknown as Record<string, unknown>)["insertBefore"] = (
        node: Node,
        ref: Node | null,
      ) => {
        mutations += 1;
        return realInsert(node, ref);
      };
      (parent as unknown as Record<string, unknown>)["removeChild"] = (
        node: Node,
      ) => {
        mutations += 1;
        return realRemove(node);
      };
      reconcileArrays(parent, rows, rows, null);
      return parent as never;
    });
    expect(mutations).toBe(0);
  });

  it("keeps nodes ordered before a trailing marker", () => {
    // `insert` reconciles against a marker so an expression's nodes stay in
    // their own region; ignoring the marker would let rows escape past it.
    let observed: ReadonlyArray<unknown> = [];
    let markerNode: Node | undefined;
    renderToString(() => {
      const parent = template("<ul>")() as unknown as Element;
      const marker = template("<li>")() as unknown as Element;
      marker.textContent = "marker";
      parent.appendChild(marker);
      markerNode = marker;

      const row = (label: string) => {
        const item = template("<li>")() as unknown as Element;
        item.textContent = label;
        return item as Node;
      };
      const a = row("a");
      const b = row("b");
      reconcileArrays(parent, [], [a, b], marker);
      reconcileArrays(parent, [a, b], [b, a], marker);
      observed = [...parent.childNodes];
      return parent as never;
    });
    expect(observed[observed.length - 1]).toBe(markerNode);
    expect(observed).toHaveLength(3);
  });
});
