import {
  Duration,
  Effect,
  Schedule,
  Schema,
  Scope,
  Context,
} from "effect";
import * as Component from "../Component.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";
import type { Result } from "../effect-ts.js";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;
type SuccessOf<T> = T extends Effect.Effect<infer A, any, any> ? A : never;
type ErrorOf<T> = T extends Effect.Effect<any, infer E, any> ? E : never;
type ServicesOf<T> = T extends Effect.Effect<any, any, infer R> ? R : never;

declare const buildId: string;

const TodosCode = Portable.code<
  { readonly filter: string },
  { readonly filter: string },
  readonly [],
  ReadonlyArray<string>,
  never,
  never
>({
  id: "type-test.query.todos",
  buildId,
  captures: Schema.Struct({ filter: Schema.String }),
  run: () => Effect.succeed([]),
});

// The portable overload returns a QueryAtom carrying the executor's value/error axes.
const portableQuery = Component.query(Portable.bind(TodosCode, { filter: "all" }));
type _PortableQueryAtom = Expect<
  Equal<
    SuccessOf<typeof portableQuery>,
    Component.QueryAtom<ReadonlyArray<string>, never>
  >
>;

// The plain overload keeps working and also yields a QueryAtom.
const plainQuery = Component.query(() =>
  Effect.succeed(1).pipe(Effect.mapError(() => ({ _tag: "E" } as const)))
);
type _PlainQueryAtom = Expect<
  Equal<
    SuccessOf<typeof plainQuery>,
    Component.QueryAtom<number, { readonly _tag: "E" }>
  >
>;

interface RetryScheduleService {
  readonly delay: number;
}
const RetryScheduleService = Context.Service<RetryScheduleService>(
  "effect-atom-jsx/type-tests/RetryScheduleService",
);
const serviceRetrySchedule = Schedule.recurs(1).pipe(
  Schedule.addDelay(() =>
    Effect.gen(function* () {
      const service = yield* RetryScheduleService;
      return yield* service.delay > 0
        ? Effect.fail("retry-schedule-failed" as const)
        : Effect.succeed(Duration.millis(1));
    })
  ),
);
const scheduledQuery = Component.query(
  () =>
    Effect.fail("query-failed" as const).pipe(
      Effect.as(1),
    ),
  { retrySchedule: serviceRetrySchedule },
);
type _ScheduledQueryAtom = Expect<
  Equal<
    SuccessOf<typeof scheduledQuery>,
    Component.QueryAtom<
      number,
      "query-failed" | "retry-schedule-failed"
    >
  >
>;
type _ScheduledQueryRequirements = Expect<
  Equal<ServicesOf<typeof scheduledQuery>, RetryScheduleService>
>;

// snapshotQuery is accepted on query bindings; snapshotState is not.
const QuerySetup = Component.setup<{}>()
  .bind("todos", () => Component.query(Portable.bind(TodosCode, { filter: "all" })), {
    resume: Resume.snapshotQuery(Schema.Array(Schema.String)),
  });
type _QuerySetup = typeof QuerySetup;

Component.setup<{}>().bind(
  "todos",
  () => Component.query(Portable.bind(TodosCode, { filter: "all" })),
  {
    // @ts-expect-error a state snapshot policy is not valid for a query binding
    resume: Resume.snapshotState(Schema.Array(Schema.String)),
  },
);

// snapshotQuery is rejected on plain state bindings.
Component.setup<{}>().bind("count", () => Component.state(0), {
  // @ts-expect-error a query snapshot policy is not valid for a state binding
  resume: Resume.snapshotQuery(Schema.Number),
});

Component.setup<{}>().bind(
  "todos",
  () => Component.query(Portable.bind(TodosCode, { filter: "all" })),
  {
    // @ts-expect-error the query snapshot codec must encode the success type
    resume: Resume.snapshotQuery(Schema.Number),
  },
);

// QueryAtom remains a readable Result atom for views.
declare const todosAtom: Component.QueryAtom<ReadonlyArray<string>, never>;
const todosResult: Result<ReadonlyArray<string>, never> = todosAtom();
void todosResult;

// Restored bindings expose refresh handles that require the Portable resolver.
declare const restored: Resume.RestoredStateBindings<{
  readonly todos: Component.QueryAtom<ReadonlyArray<string>, never>;
}>;
const refresh = restored.queries["todos"]!.refresh;
type _RefreshRequiresResolver = Expect<
  Equal<
    ServicesOf<typeof refresh>,
    Portable.ResolverService
  >
>;
type _RefreshError = Expect<
  Equal<
    ErrorOf<typeof refresh>,
    Resume.RestoredQueryRefreshError
  >
>;

// ─── Portable behavior axes ─────────────────────────────────────────────────

import * as Behavior from "../Behavior.js";

interface PanelElements {
  readonly root: { readonly id: string };
}
interface PanelService {
  readonly _tag: "PanelService";
}

interface QueryService {
  readonly _tag: "QueryService";
}

declare const queryComponent: Component.Component<
  {},
  QueryService,
  never,
  { readonly todos: Component.QueryAtom<ReadonlyArray<string>, never> },
  unknown
>;
declare const manifest: Resume.Manifest;
const restoredWithRequirements = Resume.restoreStateBindings(
  queryComponent,
  manifest,
  "c0",
);
type _RestoredQueryRequirements = Expect<
  Equal<
    ServicesOf<
      SuccessOf<typeof restoredWithRequirements>["queries"][string]["refresh"]
    >,
    QueryService | Portable.ResolverService
  >
>;

declare const PanelAttachCode: Portable.Code<
  { readonly speed: number },
  { readonly speed: number },
  readonly [PanelElements],
  { readonly stop: () => void },
  { readonly _tag: "AttachError" },
  PanelService | Scope.Scope
>;

const panelBehavior = Behavior.portable(
  Portable.bind(PanelAttachCode, { speed: 2 }),
);
type _PanelElements = Expect<
  Equal<Behavior.ElementsOf<typeof panelBehavior>, PanelElements>
>;
type _PanelBindings = Expect<
  Equal<Behavior.BindingsOf<typeof panelBehavior>, { readonly stop: () => void }>
>;
type _PanelErrors = Expect<
  Equal<Behavior.ErrorsOf<typeof panelBehavior>, { readonly _tag: "AttachError" }>
>;
type _PanelReq = Expect<
  Equal<
    Behavior.RequirementsOf<typeof panelBehavior>,
    PanelService | Scope.Scope
  >
>;

// attachScoped satisfies the behavior Scope requirement with a fresh Scope.
declare const panelElements: PanelElements;
const attached = Behavior.attachScoped(panelBehavior, panelElements);
type _AttachedServices = Expect<
  Equal<ServicesOf<typeof attached>, PanelService>
>;
type _AttachedError = Expect<
  Equal<ErrorOf<typeof attached>, { readonly _tag: "AttachError" }>
>;
type _AttachedBindings = Expect<
  Equal<
    SuccessOf<typeof attached>,
    Behavior.AttachedBehavior<{ readonly stop: () => void }>
  >
>;
