/**
 * ADR-006 collapse pins: enhancer typing is arity- and order-independent.
 *
 * The historical gap: overload-intersection enhancers made `.pipe(...)`
 * chains type differently depending on how many ops one `pipe` call carried.
 * These pins hold the collapsed design: a single-op loader pipe, a two-op
 * pipe, and split pipes all produce the SAME callable sugar type.
 */
import { Effect, Schema } from "effect";
import * as Component from "../Component.js";
import * as Route from "../Route.js";

const Base = () => Component.from<{}>(() => null);

// Single-op pipe — the exact historical failure shape.
const SoloLoader = Base()
  .pipe(Component.route("/solo/:id", { params: Schema.Struct({ id: Schema.String }) }))
  .pipe(Route.loader((params: { readonly id: string }) => Effect.succeed({ id: params.id })));
// The sugar stays CALLABLE: the component facet survives a one-op pipe.
SoloLoader({});
// ...and the route facet is refreshed with the loader's data type.
type SoloData = Route.LoaderDataOf<typeof SoloLoader>;
declare const soloData: SoloData;
void soloData.id;

// Two ops at once — must agree with the split shape above.
const TwoOps = Base()
  .pipe(Component.route("/two/:id", { params: Schema.Struct({ id: Schema.String }) }))
  .pipe(
    Route.loader((params: { readonly id: string }) => Effect.succeed({ id: params.id })),
    Route.title("Two"),
  );
TwoOps({});

// Title BEFORE loader — order independence.
const TitleFirst = Base()
  .pipe(Component.route("/first"))
  .pipe(Route.title("First"))
  .pipe(Route.loader(() => Effect.succeed(1)));
TitleFirst({});

// renderEffect accepts the pipe-built loaderified sugar without a cast
// (the call site the old KNOWN INFERENCE GAP comment said needed one).
const rendered = Component.renderEffect(SoloLoader, {});
void rendered;

// seedLoader accepts it too — the loader pipe tags the sugar.
const seed = Route.seedLoader(SoloLoader);
void seed;

// Guards fold Req/E into the component facet without losing callability.
const Guarded = Base()
  .pipe(Component.route("/guarded"))
  .pipe(Route.guard(Effect.void));
Guarded({});

// Schema enhancers are single-op safe as well.
const WithParams = Base()
  .pipe(Component.route("/p/:userId"))
  .pipe(Route.paramsSchema(Schema.Struct({ userId: Schema.String })));
WithParams({});
