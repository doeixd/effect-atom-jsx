/**
 * AN-4 — rendering an action's result (`AGENT_NATIVE_NOTES.md` §4.1, §7 item 4).
 *
 * The claim: a catalog entry's `render:` names an *addressable component*, and
 * the decoded success value is validated by that component's activation props
 * descriptor before anything mounts. The server path (`Resume.mountFragment`,
 * M11b) yields a dormant, zero-JS widget that activates lazily and disposes
 * exactly once — the notes argue this is a strictly better chat-widget story
 * than a sandboxed iframe, which is only true if dormancy and exact-once
 * activation actually hold.
 *
 * RATIFIED (`AGENT_NATIVE_NOTES.md` §10):
 * - `DQ-087` — `Agent.catalog` **throws at construction** when `render:` names a
 *   non-addressable component. Otherwise there is no props descriptor to
 *   validate against and the failure surfaces only when a chat host tries to
 *   render. (Tighten to a type-level constraint once addressability metadata
 *   propagates reliably through wrappers — that half belongs in
 *   `src/type-tests/`.)
 * - `DQ-080` — the two-arm dispatch envelope; the "PROVISIONAL ENVELOPE"
 *   markers are retired.
 *
 * STILL PROVISIONAL, pending `DQ-096`: the module name `src/Agent.ts` and its
 * export names (`AGENT_NATIVE_NOTES.md` §9.10).
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, loadSrc, pick, unbuilt } from "../harness.js";
import { run, runFail, tagOf } from "./support.js";

const BUILD = "build-an4";

const TodoProps = Schema.Struct({ id: Schema.String, text: Schema.String });

/** A catalog whose single entry renders its result with an addressable card. */
const makeRenderingCatalog = async (successValue: unknown) => {
  const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
  const { code } = await fromSrc("Portable", "code");
  const { addressable } = await fromSrc("Resume", "addressable");
  const Component = await loadSrc("Component");
  const { make, setup } = pick(Component, "Component", "make", "setup");

  const mounts: Array<unknown> = [];
  const TodoCard = addressable({
    id: "widget.todoCard",
    buildId: BUILD,
    props: TodoProps,
  })(
    make(setup(), (props: any) => {
      mounts.push(props);
      return `<article data-todo="${props.id}">${props.text}</article>`;
    }),
  );

  const Save = code({
    id: "todo.save",
    buildId: BUILD,
    captures: Schema.Struct({}),
    run: () => Effect.succeed(successValue),
  });

  return {
    mounts,
    TodoCard,
    catalog: catalog({
      saveTodo: expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([]),
        success: TodoProps,
        render: TodoCard,
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    }),
  };
};

describe("AN-4 result rendering", () => {
  it("[AN-4] renders a result through the named addressable component with the decoded success value", async () => {
    const { dispatch, renderResult } = await fromSrc("Agent", "dispatch", "renderResult");
    const { mounts, catalog } = await makeRenderingCatalog({ id: "t1", text: "milk" });

    const response = await run(
      dispatch(catalog)({ tool: "saveTodo", args: [], buildId: BUILD }),
    );
    // Ratified two-arm envelope (DQ-080, AGENT_NATIVE_NOTES.md section 10).
    expect(response.ok).toBe(true);

    const rendered = await run(renderResult(catalog, "saveTodo", response.payload.mutation));

    // The success value reached the component as props, decoded.
    expect(mounts).toEqual([{ id: "t1", text: "milk" }]);
    expect(rendered.html).toContain('data-todo="t1"');
    expect(rendered.html).toContain("milk");
    // The render target is the addressable activation id — not a new identity.
    expect(rendered.activationId).toBe("widget.todoCard");
    expect(rendered.buildId).toBe(BUILD);
  });

  it("[AN-4] a success value that fails the activation props descriptor never mounts", async () => {
    const { renderResult } = await fromSrc("Agent", "renderResult");
    const bad = await makeRenderingCatalog({ id: "t1", text: "milk" });

    // A chat host handing over an unvalidated blob is the realistic threat.
    const error = await runFail(renderResult(bad.catalog, "saveTodo", { id: 7, text: null }));

    expect(tagOf(error)).toBe("AgentRenderPropsError");
    expect(bad.mounts).toEqual([]);

    // NEGATIVE CONTROL. Without this, a `renderResult` that refuses everything —
    // or never mounts at all — satisfies the assertions above forever. Fresh
    // fixture so the two phases share no mount log.
    const good = await makeRenderingCatalog({ id: "t1", text: "milk" });
    const rendered = await run(
      renderResult(good.catalog, "saveTodo", { id: "t1", text: "milk" }),
    );
    expect(good.mounts).toEqual([{ id: "t1", text: "milk" }]);
    expect(rendered.html).toContain("milk");
  });

  it("[AN-4] a catalog entry cannot name a non-addressable component", async () => {
    // Without an activation descriptor there is nothing to validate props with,
    // so this must be refused where it is authored, not at render time.
    const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
    const { code } = await fromSrc("Portable", "code");
    const { addressable } = await fromSrc("Resume", "addressable");
    const Component = await loadSrc("Component");
    const { make, setup } = pick(Component, "Component", "make", "setup");

    const Plain = make(setup(), (props: any) => `<p>${props.text}</p>`);
    const entry = (render: unknown) => () =>
      catalog({
        saveTodo: expose(
          code({
            id: "todo.save.plain",
            buildId: BUILD,
            captures: Schema.Struct({}),
            run: () => Effect.succeed({ text: "hi" }),
          }),
          {
            description: "Save a todo",
            args: Schema.Tuple([]),
            success: Schema.Struct({ text: Schema.String }),
            render,
            access: { agent: true },
          },
        ),
      });

    expect(entry(Plain)).toThrow(/addressable/i);

    // NEGATIVE CONTROL: the same authoring call with an addressable component
    // must be accepted. Without it, a `catalog` that throws on any `render:` at
    // all — i.e. one where result rendering is simply unimplemented — passes.
    const Addressed = addressable({
      id: "widget.plainCard",
      buildId: BUILD,
      props: Schema.Struct({ text: Schema.String }),
    })(Plain);
    expect(entry(Addressed)).not.toThrow();
  });

  it("[AN-4] the mountFragment path yields a dormant zero-JS widget that activates lazily", async () => {
    const { renderResultFragment } = await fromSrc("Agent", "renderResultFragment");
    const { installFragment } = await fromSrc("Resume", "installFragment");
    const { makeResolver, Resolver } = await fromSrc("Portable", "makeResolver", "Resolver");
    const { activationOf } = await fromSrc("Resume", "activationOf");
    const { mounts, TodoCard, catalog } = await makeRenderingCatalog({
      id: "t1",
      text: "milk",
    });

    const fragment = await run(
      renderResultFragment(catalog, "saveTodo", { id: "t1", text: "milk" }),
    );

    // Server-rendered markup plus a manifest — and nothing else.
    expect(fragment.html).toContain("milk");
    expect(JSON.parse(JSON.stringify(fragment.manifest))).toEqual(fragment.manifest);

    // Dormant: installing the fragment loads no component code at all.
    const loaded: Array<string> = [];
    const activation = activationOf(TodoCard);
    const resolver = await run(
      makeResolver({
        [activation.id]: () =>
          Effect.sync(() => {
            loaded.push(activation.id);
            return activation;
          }),
      }),
    );

    const handle = await run(
      installFragment(fragment.html, fragment.manifest).pipe(
        Effect.provideService(Resolver, resolver),
      ),
    );
    expect(loaded).toEqual([]);
    // Only the one server-side render; installing markup mounts nothing.
    expect(mounts).toHaveLength(1);

    // Activation is lazy and loads exactly the one entry it needs.
    await run(handle.activate());
    expect(loaded).toEqual([activation.id]);

    // Second activation is a no-op: exact-once, not "usually once".
    await run(handle.activate());
    expect(loaded).toEqual([activation.id]);
  });

  it("[AN-4] a dormant result widget disposes exactly once", async () => {
    const { renderResultFragment } = await fromSrc("Agent", "renderResultFragment");
    const { installFragment } = await fromSrc("Resume", "installFragment");
    const { catalog } = await makeRenderingCatalog({ id: "t1", text: "milk" });

    const fragment = await run(
      renderResultFragment(catalog, "saveTodo", { id: "t1", text: "milk" }),
    );
    const handle = await run(installFragment(fragment.html, fragment.manifest));

    await run(handle.activate());
    await run(handle.dispose());
    await run(handle.dispose());

    expect(await run(handle.disposeCount())).toBe(1);
    expect(await run(handle.isActive())).toBe(false);
  });

  it("[AN-4/DQ-087] `render:` naming a non-addressable component throws at catalog construction", async () => {
    // Ratified (§10, DQ-087). The failure this moves: without an authoring-time
    // refusal, a `render:` target with no activation props descriptor is only
    // discovered when a chat host tries to render it — i.e. in production, in
    // front of a user, with no way to validate the decoded success value.
    const { catalog, expose } = await fromSrc("Agent", "catalog", "expose");
    const { code } = await fromSrc("Portable", "code");
    const { addressable } = await fromSrc("Resume", "addressable");
    const ComponentMod = await loadSrc("Component");
    const { make, setup } = pick(ComponentMod, "Component", "make", "setup");

    const Save = code({
      id: "todo.save.render",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ id: "t1", text: "milk" }),
    });
    const entry = (render: unknown) => ({
      description: "Save a todo",
      args: Schema.Tuple([]),
      success: TodoProps,
      render,
      access: { agent: true },
    });

    // A plain component: renderable in a page, but NOT addressable — no
    // activation id, no props descriptor.
    const PlainCard = make(setup(), (props: any) => `<article>${props.text}</article>`);

    // Throws — synchronously, at construction, not on first render.
    expect(() => catalog({ saveTodo: expose(Save, entry(PlainCard)) })).toThrow();
    // …and the refusal says which entry and why, so the fix ("make it
    // addressable") is obvious from the message alone.
    let thrown: unknown;
    try {
      catalog({ saveTodo: expose(Save, entry(PlainCard)) });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toMatch(/saveTodo/);
    expect(String(thrown)).toMatch(/addressable/i);

    // NEGATIVE CONTROL 1: the addressable component is accepted, cleanly.
    // Without this, `catalog = () => { throw }` satisfies everything above.
    const TodoCard = addressable({
      id: "widget.todoCard.dq087",
      buildId: BUILD,
      props: TodoProps,
    })(PlainCard);
    const ok = catalog({ saveTodo: expose(Save, entry(TodoCard)) });
    expect(ok).toBeDefined();

    // NEGATIVE CONTROL 2: an entry with no `render:` at all is also accepted —
    // the check is about a *named* target being non-addressable, not about
    // requiring one.
    const noRender = catalog({
      saveTodo: expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([]),
        success: TodoProps,
        access: { agent: true },
      }),
    });
    expect(noRender).toBeDefined();
  });

  it("[AN-4] kit-shipped catalog entries", async () => {
    // Open design question DQ-097: whether kit widgets ship suggested catalog
    // entries, and who owns their exposure defaults.
    const mod = await loadSrc("Agent");
    pick(mod, "Agent", "catalog", "expose");
    unbuilt(
      "kit-shipped suggested catalog entries and who owns their exposure defaults",
      "DQ-097",
    );
  });
});
