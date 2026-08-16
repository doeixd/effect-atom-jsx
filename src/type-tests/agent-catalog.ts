/**
 * Pins the agent-surface inference guarantees (AN-1/AN-2/AN-4): end users
 * never cast, and the mismatches that used to surface at dispatch/render
 * time fail at the `expose`/`catalog` call instead. If a block here stops
 * compiling (or a `@ts-expect-error` stops erroring), a guarantee regressed.
 */
import { Effect, Schema } from "effect";
import * as Agent from "../Agent.js";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import { Key } from "../Reactivity.js";
import { applyPushedInvalidation, makeReactivityBroadcast } from "../reactivity-push.js";
import * as Resume from "../Resume.js";

const BUILD = "type-tests";
const TodoProps = Schema.Struct({ id: Schema.String, text: Schema.String });

// ─── `Component.make(setup, view)` shorthand infers props from the view ─────
// A bare `setup()` is `Setup<{}, …>` and must compose with any richer
// view-props type without a cast; the component's Props axis comes from the
// view parameter.
const Card = Component.make(
  Component.setup(),
  (props: { readonly id: string; readonly text: string }) =>
    `<article>${props.text}</article>`,
);
const _cardProps: Component.Component<
  { readonly id: string; readonly text: string },
  never,
  never,
  {}
> = Card;

// ─── `addressable` accepts the shorthand component without casts ────────────
const TodoCard = Resume.addressable({
  id: "type.todoCard",
  buildId: BUILD,
  props: TodoProps,
})(Card);

// ─── `expose` ties args, success, and render to the code's own axes ─────────
const Save = Portable.code({
  id: "type.todo.save",
  buildId: BUILD,
  captures: Schema.Struct({}),
  run: (_captures, text: string) => Effect.succeed({ id: "t1", text }),
});

const _catalog = Agent.catalog({
  saveTodo: Agent.expose(Save, {
    description: "Save a todo",
    args: Schema.Tuple([Schema.String]),
    success: TodoProps,
    render: TodoCard,
    reactivityKeys: ["todos", Key.make("todo-list")],
    access: { agent: true },
  }),
});

// A wrong-arity args schema no longer typechecks: the code takes one string.
Agent.expose(Save, {
  description: "Save a todo",
  // @ts-expect-error — the args tuple must decode what `run` accepts
  args: Schema.Tuple([Schema.Number]),
  success: TodoProps,
});

// A success schema that cannot encode the run result is refused. Pinned as
// an assignment so the failure site is stable (in the call form TS may
// report the mismatch on either argument).
type SaveSuccessSchema = Agent.ExposeOptions<
  [text: string],
  { id: string; text: string }
>["success"];
const _successOk: SaveSuccessSchema = TodoProps;
// @ts-expect-error — `run` returns { id, text }, not { count }
const _successBad: SaveSuccessSchema = Schema.Struct({ count: Schema.Number });

// DQ-087 at compile time: a render target must be ADDRESSABLE…
const PlainCard = Component.make(
  Component.setup(),
  (props: { readonly id: string; readonly text: string }) =>
    `<p>${props.text}</p>`,
);
Agent.expose(Save, {
  description: "Save a todo",
  args: Schema.Tuple([Schema.String]),
  success: TodoProps,
  // @ts-expect-error — not addressable: no activation identity
  render: PlainCard,
});

// …and its props must BE the success value.
const NumberCard = Resume.addressable({
  id: "type.numberCard",
  buildId: BUILD,
  props: Schema.Struct({ count: Schema.Number }),
})(
  Component.make(
    Component.setup(),
    (props: { readonly count: number }) => `<b>${props.count}</b>`,
  ),
);
Agent.expose(Save, {
  description: "Save a todo",
  args: Schema.Tuple([Schema.String]),
  success: TodoProps,
  // @ts-expect-error — render props disagree with the success schema
  render: NumberCard,
});

// ─── Authored render helpers take catalog-typed tool names ──────────────────
const _rendered: Effect.Effect<
  Agent.RenderedResult,
  Agent.RenderResultError
> = Agent.renderResult(_catalog, "saveTodo", { id: "t1", text: "milk" });
// @ts-expect-error — "nope" is not a tool of this catalog
Agent.renderResult(_catalog, "nope", {});
// @ts-expect-error — fragment path is equally typed
Agent.renderResultFragment(_catalog, "nope", {});
const _tools: "saveTodo" = null as unknown as Agent.ToolsOf<typeof _catalog>;

// ─── Broadcast bus: listeners and scoped connections are fully typed ────────
const _bus = Effect.gen(function* () {
  const bus = yield* makeReactivityBroadcast();
  yield* bus.connectScoped((keys: ReadonlyArray<string>) => void keys);
  const disconnect = yield* bus.connect((keys) => {
    const _first: string | undefined = keys[0];
  });
  yield* bus.publish(["todos", Key.make("todo-list")]);
  yield* disconnect();
  yield* bus.flush();
});

// `applyPushedInvalidation` needs the Reactivity service — R is not `never`.
const _apply: Effect.Effect<
  void,
  never,
  import("../Reactivity.js").ReactivityService
> = applyPushedInvalidation(["todos"]);
