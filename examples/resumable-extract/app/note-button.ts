/**
 * Server component authored with the resume-extract compiler marker.
 *
 * The `extract(...)` call below is rewritten at build time into a hoisted,
 * exported `Portable.code` definition with the generated identity
 * `app/note-button.ts#$0` and a `Portable.bind` call at this site. Nothing in
 * this file hand-writes a code id, buildId, or resolver export.
 */
import { Effect, Exit, Schema, Scope } from "effect";
import * as Component from "effect-atom-jsx/Component";
import * as Resume from "effect-atom-jsx/Resume";
import * as Serialization from "effect-atom-jsx/Serialization";
import { addEventListener, insert, template } from "effect-atom-jsx/runtime";
import { renderToString } from "effect-atom-jsx";
import { expr, extract } from "effect-atom-jsx/portable-extract";
import { browserState } from "../shared/browser-state.js";
import { BuildId } from "../shared/build.js";
import { NoteService } from "../shared/note-service.js";

const state = browserState();
if (state !== undefined) {
  state.appImports += 1;
}

const buttonTemplate = template(
  '<button type="button" data-testid="extract-note">Note',
);
const countTemplate = template(
  '<span data-testid="extract-count">',
);
const parentTemplate = template(
  '<section data-testid="extract-parent">',
);
const siblingTemplate = template(
  '<aside data-testid="extract-sibling">Sibling',
);

const NoteButton = Component.make(
  Component.props<{ readonly label: string }>(),
  Component.require<NoteService>(),
  Component.setup<{ readonly label: string }>()
    .doEffect(() =>
      Effect.sync(() => {
        const browser = browserState();
        if (browser !== undefined) browser.setupRuns += 1;
      })
    )
    .bind("count", () => Component.state(1), {
      resume: Resume.snapshotState(Schema.Number),
    })
    .bind("note", ({ props }) =>
      Component.action(
        extract(
          (captures: { readonly label: string }) =>
            Effect.gen(function* () {
              const notes = yield* NoteService;
              yield* notes.record(captures.label);
            }),
          {
            captures: Schema.Struct({ label: Schema.String }),
            bind: { label: props.label },
          },
        ),
      )
    ),
  (_props, bindings) => {
    const browser = browserState();
    if (browser !== undefined) browser.viewRuns += 1;
    const count = countTemplate();
    const countText = expr(
      (_captures, [value]) => `Count: ${value}`,
      {
        captures: Schema.Struct({}),
        bind: {},
        dependencies: Schema.Tuple([Schema.Number]),
        deps: [bindings.count],
      },
    );
    insert(count, countText);
    const button = buttonTemplate();
    addEventListener(button, "click", Resume.event(bindings.note), true);
    return [count, button];
  },
);

const Parent = Component.make(
  Component.props<{ readonly child: unknown }>(),
  Component.require<never>(),
  Component.setup<{ readonly child: unknown }>()
    .doEffect(() =>
      Effect.sync(() => {
        const browser = browserState();
        if (browser !== undefined) browser.parentSetupRuns += 1;
      })
    )
    .bind("marker", () => Component.state("parent"), {
      resume: Resume.snapshotState(Schema.String),
    }),
  ({ child }) => {
    const browser = browserState();
    if (browser !== undefined) browser.parentViewRuns += 1;
    const parent = parentTemplate();
    insert(parent, child);
    return parent;
  },
);

const Sibling = Component.make(
  Component.props<{}>(),
  Component.require<never>(),
  Component.setup<{}>()
    .doEffect(() =>
      Effect.sync(() => {
        const browser = browserState();
        if (browser !== undefined) browser.siblingSetupRuns += 1;
      })
    )
    .bind("marker", () => Component.state("sibling"), {
      resume: Resume.snapshotState(Schema.String),
    }),
  () => {
    const browser = browserState();
    if (browser !== undefined) browser.siblingViewRuns += 1;
    return siblingTemplate();
  },
);

export function renderNoteButton(): Resume.CollectionResult {
  const scope = Scope.makeUnsafe();
  const serverService: NoteService = {
    record: () => Effect.die("The server note action must never execute."),
  };
  try {
    return Effect.runSync(
      Resume.collect(
        () =>
          renderToString(() => {
            const child = Effect.runSync(
              Component.renderEffect(NoteButton, {
                label: "extracted-from-browser",
              }).pipe(
                Scope.provide(scope),
                Effect.provideService(NoteService, serverService),
              ),
            );
            const parent = Effect.runSync(
              Component.renderEffect(Parent, { child }).pipe(
                Scope.provide(scope),
              ),
            );
            const sibling = Effect.runSync(
              Component.renderEffect(Sibling, {}).pipe(
                Scope.provide(scope),
              ),
            );
            return [parent, sibling];
          }),
        { buildId: BuildId },
      ).pipe(Effect.provide(Serialization.layer)),
    );
  } finally {
    Effect.runSync(Scope.close(scope, Exit.void));
  }
}
