/**
 * AN-4 — result rendering through addressable components, promoted from
 * `future/agent/result-rendering.spec.ts` once every spec passed
 * (DQ-097's ratification discharged the file's last marker).
 *
 * A catalog entry's `render:` names an ADDRESSABLE component, and the
 * decoded success value is validated by that component's activation props
 * descriptor before anything mounts. The fragment path yields a dormant,
 * zero-JS widget that activates lazily and disposes exactly once.
 */
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";

const BUILD = "agent-render-test-build";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);
const runFail = async <A, E>(effect: Effect.Effect<A, E>): Promise<E> => {
  const flipped = await Effect.runPromiseExit(effect.pipe(Effect.flip));
  if (flipped._tag !== "Success") {
    throw new Error("expected a typed failure, but the effect succeeded");
  }
  return flipped.value;
};

const TodoProps = Schema.Struct({ id: Schema.String, text: Schema.String });

/** A catalog whose single entry renders its result with an addressable card. */
function makeRenderingCatalog(successValue: { readonly id: string; readonly text: string }, idSuffix = "") {
  const mounts: Array<unknown> = [];
  const TodoCard = Resume.addressable({
    id: `widget.todoCard${idSuffix}`,
    buildId: BUILD,
    props: TodoProps,
  })(
    Component.make(
      Component.setup(),
      (props: { readonly id: string; readonly text: string }) => {
        mounts.push(props);
        return `<article data-todo="${props.id}">${props.text}</article>`;
      },
    ),
  );

  const Save = Portable.code({
    id: `todo.save${idSuffix}`,
    buildId: BUILD,
    captures: Schema.Struct({}),
    run: () => Effect.succeed(successValue),
  });

  return {
    mounts,
    TodoCard,
    catalog: Agent.catalog({
      saveTodo: Agent.expose(Save, {
        description: "Save a todo",
        args: Schema.Tuple([]),
        success: TodoProps,
        render: TodoCard,
        reactivityKeys: ["todos"],
        access: { agent: true },
      }),
    }),
  };
}

describe("AN-4 result rendering", () => {
  it("renders a result through the named addressable component with the decoded success value", async () => {
    const { mounts, catalog } = makeRenderingCatalog({ id: "t1", text: "milk" }, ".r1");

    const response = await run(
      Agent.dispatch(catalog)({ tool: "saveTodo", args: [], buildId: BUILD }).pipe(
        Effect.orDie,
      ),
    );
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const rendered = await run(
      Agent.renderResult(catalog, "saveTodo", response.payload.mutation).pipe(
        Effect.orDie,
      ),
    );

    // The success value reached the component as props, decoded.
    expect(mounts).toEqual([{ id: "t1", text: "milk" }]);
    expect(rendered.html).toContain('data-todo="t1"');
    expect(rendered.html).toContain("milk");
    // The render target is the addressable activation id — not a new identity.
    expect(rendered.activationId).toBe("widget.todoCard.r1");
    expect(rendered.buildId).toBe(BUILD);
  });

  it("a success value that fails the activation props descriptor never mounts", async () => {
    const bad = makeRenderingCatalog({ id: "t1", text: "milk" }, ".r2");

    // A chat host handing over an unvalidated blob is the realistic threat.
    const error = await runFail(
      Agent.renderResult(bad.catalog, "saveTodo", { id: 7, text: null }),
    );
    expect(error._tag).toBe("AgentRenderPropsError");
    expect(bad.mounts).toEqual([]);

    // NEGATIVE CONTROL. Without this, a `renderResult` that refuses
    // everything — or never mounts at all — satisfies the assertions above
    // forever. Fresh fixture so the two phases share no mount log.
    const good = makeRenderingCatalog({ id: "t1", text: "milk" }, ".r3");
    const rendered = await run(
      Agent.renderResult(good.catalog, "saveTodo", { id: "t1", text: "milk" }).pipe(
        Effect.orDie,
      ),
    );
    expect(good.mounts).toEqual([{ id: "t1", text: "milk" }]);
    expect(rendered.html).toContain("milk");
  });

  it("DQ-087: `render:` naming a non-addressable component throws at catalog construction", () => {
    const Save = Portable.code({
      id: "todo.save.render.dq087",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ id: "t1", text: "milk" }),
    });
    const entry = (render: Agent.RenderTarget<{ readonly id: string; readonly text: string }>) => ({
      description: "Save a todo",
      args: Schema.Tuple([]),
      success: TodoProps,
      render,
      access: { agent: true },
    });

    // A plain component: renderable in a page, but NOT addressable — no
    // activation id, no props descriptor. The compile-time refusal is pinned
    // in `type-tests/agent-catalog.ts`; the runtime one covers dynamically
    // assembled entries.
    const PlainCard = Component.make(
      Component.setup(),
      (props: { readonly id: string; readonly text: string }) =>
        `<article>${props.text}</article>`,
    );

    // Throws — synchronously, at construction, not on first render — naming
    // the entry and the fix.
    let thrown: unknown;
    try {
      Agent.catalog({
        saveTodo: Agent.expose(Save, entry(PlainCard as never)),
      });
    } catch (error) {
      thrown = error;
    }
    expect(String(thrown)).toMatch(/saveTodo/);
    expect(String(thrown)).toMatch(/addressable/i);

    // NEGATIVE CONTROL 1: the addressable component is accepted, cleanly.
    const TodoCard = Resume.addressable({
      id: "widget.todoCard.dq087",
      buildId: BUILD,
      props: TodoProps,
    })(PlainCard);
    expect(
      Agent.catalog({ saveTodo: Agent.expose(Save, entry(TodoCard)) }),
    ).toBeDefined();

    // NEGATIVE CONTROL 2: an entry with no `render:` at all is also accepted
    // — the check is about a *named* target being non-addressable, not about
    // requiring one.
    expect(
      Agent.catalog({
        saveTodo: Agent.expose(Save, {
          description: "Save a todo",
          args: Schema.Tuple([]),
          success: TodoProps,
          access: { agent: true },
        }),
      }),
    ).toBeDefined();
  });

  it("the fragment path yields a dormant zero-JS widget that activates lazily, exactly once", async () => {
    const { mounts, TodoCard, catalog } = makeRenderingCatalog(
      { id: "t1", text: "milk" },
      ".r4",
    );

    const fragment = await run(
      Agent.renderResultFragment(catalog, "saveTodo", { id: "t1", text: "milk" }).pipe(
        Effect.orDie,
      ),
    );

    // Server-rendered markup plus a manifest — and nothing else.
    expect(fragment.html).toContain("milk");
    expect(JSON.parse(JSON.stringify(fragment.manifest))).toEqual(fragment.manifest);

    // Dormant: installing the fragment loads no component code at all.
    const loaded: Array<string> = [];
    const activation = Resume.activationOf(TodoCard);
    const resolver = await run(
      Portable.makeResolver({
        [activation.id]: () =>
          Effect.sync(() => {
            loaded.push(activation.id);
            return activation;
          }),
      }),
    );

    const handle = await run(
      Resume.installFragment(fragment.html, fragment.manifest).pipe(
        Effect.provideService(Portable.Resolver, resolver),
        Effect.orDie,
      ),
    );
    expect(loaded).toEqual([]);
    // Only the one server-side render; installing markup mounts nothing.
    expect(mounts).toHaveLength(1);

    // Activation is lazy and loads exactly the one entry it needs.
    await run(handle.activate().pipe(Effect.orDie));
    expect(loaded).toEqual([activation.id]);

    // Second activation is a no-op: exact-once, not "usually once".
    await run(handle.activate().pipe(Effect.orDie));
    expect(loaded).toEqual([activation.id]);
  });

  it("a dormant result widget disposes exactly once", async () => {
    const { catalog } = makeRenderingCatalog({ id: "t1", text: "milk" }, ".r5");

    const fragment = await run(
      Agent.renderResultFragment(catalog, "saveTodo", { id: "t1", text: "milk" }).pipe(
        Effect.orDie,
      ),
    );
    const handle = await run(
      Resume.installFragment(fragment.html, fragment.manifest).pipe(Effect.orDie),
    );

    await run(handle.activate().pipe(Effect.orDie));
    await run(handle.dispose());
    await run(handle.dispose());

    expect(await run(handle.disposeCount())).toBe(1);
    expect(await run(handle.isActive())).toBe(false);
  });

  it("DQ-097: a kit-shipped suggestion is inert until the app supplies the exposure decision", () => {
    const Save = Portable.code({
      id: "todo.save.suggested",
      buildId: BUILD,
      captures: Schema.Struct({}),
      run: () => Effect.succeed({ id: "t1", text: "milk" }),
    });

    // The kit's half: everything except exposure.
    const suggestion = Agent.suggested(Save, {
      description: "Save a todo",
      args: Schema.Tuple([]),
      success: TodoProps,
      reactivityKeys: ["todos"],
    });
    expect(Agent.isSuggested(suggestion)).toBe(true);
    expect(JSON.stringify(suggestion)).not.toContain('"access"');

    // Inert: the catalog refuses a raw suggestion — exposure cannot arrive
    // by kit default, and the refusal names the fix.
    expect(() =>
      Agent.catalog({ saveTodo: suggestion as unknown as Agent.CatalogEntry }),
    ).toThrow(/app decision/i);

    // A suggestion that tries to smuggle exposure is refused loudly at the
    // KIT's call site, not silently honoured at the app's.
    expect(() =>
      Agent.suggested(Save, {
        description: "Save a todo",
        args: Schema.Tuple([]),
        success: TodoProps,
        access: { agent: true },
      } as never)
    ).toThrow(/app decision/i);

    // The app's half: exactly the exposure decision. The completed entry is
    // an ordinary catalog entry carrying the kit's metadata.
    const completed = Agent.expose(suggestion, { access: { agent: true } });
    const c = Agent.catalog({ saveTodo: completed });
    expect(c.entries.saveTodo.description).toBe("Save a todo");
    expect(c.entries.saveTodo.reactivityKeys).toEqual(["todos"]);
    expect(c.entries.saveTodo.access).toEqual({ agent: true });
    // DQ-084 composes: mutation stays a constructor declaration.
    expect(c.entries.saveTodo.mutation).toBe(false);
    expect(
      Agent.exposeMutation(suggestion, { access: { agent: true } }).mutation,
    ).toBe(true);
  });
});
