import { describe, expect, it } from "vitest";
import * as Atom from "../Atom.js";
import * as Devtools from "../Devtools.js";
import * as Element from "../Element.js";
import * as Registry from "../Registry.js";
import * as View from "../View.js";

describe("Devtools", () => {
  it("records named timeline events and rewinds via MCP surface", () => {
    const session = Devtools.createSession({ keyframeInterval: 100 });
    session.record({ kind: "action", name: "save", phase: "start" });
    session.record({ kind: "action", name: "save", phase: "success" });
    const mid = session.timeline()[0]!.id;
    session.record({ kind: "query", name: "list", phase: "start" });
    expect(session.timeline().length).toBe(3);

    const rewound = session.mcp.rewindTo(mid);
    expect(rewound.length).toBe(1);
    expect(rewound[0]!.name).toBe("save");

    session.mcp.dispatchNamed("manual", () => undefined);
    expect(session.timeline().some((e) => e.name === "manual" && e.phase === "success")).toBe(true);
  });

  it("snapshots registry atoms and slot contract trees", () => {
    const session = Devtools.createSession();
    const count = Atom.make(3);
    const registry = Registry.make();
    const entries = Devtools.snapshotRegistry(registry, [{ name: "count", atom: count }]);
    expect(entries[0]).toMatchObject({ name: "count", value: 3 });
    session.snapshotAtoms(entries);
    expect(session.snapshots().length).toBe(1);

    const slots = View.Slots.define({ root: { capability: Element.Capability.Container } });
    const view = View.fromSlots(slots, null);
    const tree = Devtools.slotContractTree(view);
    expect(tree.slots).toContain("root");
    expect(view.tree).toBeDefined();
  });

  it("marks unnamed operations in observeToTimeline details", () => {
    const session = Devtools.createSession();
    Devtools.observeToTimeline(session, { kind: "action", phase: "start" });
    const event = session.timeline()[0]!;
    expect(event.name).toBe("<unnamed>");
    expect((event.details as { named: boolean }).named).toBe(false);

    Devtools.observeToTimeline(session, { kind: "action", name: "save-user", phase: "success" });
    expect((session.timeline()[1]!.details as { named: boolean }).named).toBe(true);
  });
});
