# Resumability: SSR lifecycle and fallback contract

Status: ratified from observed behaviour (Milestone 0, items 3–6).

Everything in this document is **characterization**: it describes what the code
does today, verified by executable tests, not what a plan says it should do.
Where the implementation plan's prose and the code disagree, **the code wins**
and the disagreement is called out explicitly below.

Executable source of truth:

- [`src/__tests__/ssr-characterization.test.ts`](../src/__tests__/ssr-characterization.test.ts)
  — the pinned lifecycle sequences, exception paths, and fallback behaviour.
- [`src/__tests__/resume.test.ts`](../src/__tests__/resume.test.ts) — the
  collect/install/dispatch behaviour this document cross-references.
- [`src/__tests__/ssr.test.ts`](../src/__tests__/ssr.test.ts) — the pre-existing
  global save/restore-on-throw assertions.

The full diagnostic catalogue is **not** duplicated here. It lives in
[`docs/RESUMABILITY_GUIDE.md` § "Diagnostics reference"](RESUMABILITY_GUIDE.md#diagnostics-reference),
which is the authority for the collect-vs-client split and for every code's
meaning. This document only records *what falls back to what*, and *when*.

## 1. The SSR lifecycle order

Observed order for a single `renderToString(() => Effect.runSync(Component.renderEffect(C, {})))`:

```
setup step 1
setup step 2            ← all setup steps run to completion first
view enter              ← bindings are fully committed before the view is entered
event attached          ← handlers registered during view execution
view exit
serialize               ← toHTML() runs after the view returns
root dispose            ← the reactive root is disposed last
```

Load-bearing consequences:

1. **Bindings are committed before the view runs.** The view never observes a
   half-built binding record.
2. **Serialization strictly precedes root disposal.** `renderToString` computes
   `serverValueToHTML(result)` inside its `try`; disposal happens in the
   `finally`. Any resume collection that reads the virtual tree therefore sees a
   live tree, and any cleanup registered with `onCleanup` runs *after* the HTML
   exists. Reversing this would break collection silently.
3. **Event attachment is a no-op on the server.** `ServerNode.addEventListener`
   does nothing; the only server-side effect of `addEventListener` is
   `registerActivationEventTarget`, which is what writes the
   `data-af-event-*` marker attribute during collection. Handlers are never
   invoked during SSR.
4. **Each setup step and the view execute exactly once per render.** Pinned as a
   count, not as final state, because double-execution is invisible to
   final-state assertions.

### Effect Scope

There is **no ambient Effect `Scope`** during SSR. `Effect.serviceOption(Scope.Scope)`
inside component setup is `None` unless the caller provides one explicitly:

```ts
Effect.runSync(Component.renderEffect(C, {}).pipe(Scope.provide(scope)))
```

When a caller does provide one, the observed order is:

```
setup → view → root dispose → (HTML available) → caller closes Scope → finalizers
```

Scope finalization is therefore **not** part of the render; it is a caller
obligation that happens strictly after the render returns. This is how the
resume query tests acquire query snapshots.

> **The per-component `Scope` mechanism is absent during SSR, but it is not dead
> code.** `src/component-scope.ts` exposes `ComponentScopeContext`,
> `forkComponentScope`, and `bindScopeCleanup`. The root is established on the
> **client mount path**: `mountWithManagedRuntime` creates
> `rootScope = options?.scope ?? Scope.makeUnsafe()` (`src/effect-ts.ts:1704`)
> and installs it with `withComponentScope(rootScope, fn)` (`:1742`).
> `createComponent` then forks a child per component (`src/dom.ts:225–227`).
>
> `renderToString` establishes no such root, so during SSR
> `currentComponentScope()` is `null`, `forkComponentScope(null)` returns
> `null`, and the `if (componentScope !== null)` branches — including the
> route-head unsubscribe finalizer in `src/Component.ts` — do not run.
>
> That is the correct reading. An earlier draft of this document concluded the
> mechanism was globally dead and that those subscriptions therefore leak; that
> conclusion was **wrong**, and is recorded here so it is not rediscovered. It
> generalised from SSR to the whole runtime without checking the mount path.
> On the client the finalizer does run; during SSR there is nothing to unsubscribe
> from that outlives the request, since R2 made the head store per-request.

### `Route.renderRequest`

```
request event installed → setup (sees the request) → view → request event restored
```

`renderRequest` saves the previous request event, installs its own, and restores
it in a `finally`. Per-request head store and loader cache are allocated inside
`renderRequest`, so sequential (and concurrent) renders cannot see each other's
state.

## 2. Nested renders and exceptions

**Nesting works.** A `renderToString` inside a `renderToString` gets its own
virtual document; the inner root is disposed before the outer render continues,
and the outer render's `globalThis.document` is restored to the outer virtual
document — not to the real/absent one — when the inner render returns:

```
outer enter → inner enter → inner exit → inner dispose → outer document restored → outer exit → outer dispose
```

**Exceptions do not leak state.** For a failing setup, a throwing view, or a
throwing render callback:

- The exception propagates to the caller of `renderToString` unchanged.
- A setup failure means the view **never** runs.
- The reactive root is disposed on both the success and failure paths.
- `globalThis.document` and `globalThis.Node` are restored to their exact prior
  presence/absence — including deleting them when they were absent. Confirmed;
  this matches the earlier spec's claim.
- `Route.renderRequest` restores the previous request event through its
  `finally`, so a throwing render leaves no ambient request behind.

## 3. The fallback contract

The governing rule, observed throughout: **the runtime always falls back toward
a working page.** Nothing opaque is silently claimed as resumable, and nothing
that fails to resume is left broken — it degrades to ordinary client behaviour.

| Situation | Where it is detected | Observed behaviour | Diagnostic |
| --- | --- | --- | --- |
| **Opaque setup** (raw setup function; `setupPlan.kind === "opaque"`) | Server, `Resume.collect` | The component renders normally and contributes **no** snapshot. The manifest stays at v1 with no `components` key. **No diagnostic is emitted.** Restoration of such a component fails with `ResumeComponentPlanUnsupportedError`, and the component falls back to activation. | *(none — silent)* |
| **Opaque event handler** (inline closure instead of `Resume.event(...)` over portable code) | Server, `Resume.collect` | HTML is emitted **without** a `data-af-event-*` marker; the manifest has no entry. The button still renders and works via ordinary client hydration/activation. | `opaque-event-handler` |
| **Unknown code ID** | Client. `decodeManifest` **accepts it** — decode validates shape, not resolvability. It surfaces only when the event fires and the resolver has no entry. | The interaction is dropped; the page and every other interaction keep working. The dispatch fiber is observed, not orphaned. | `dispatch-resolution-failure` |
| **Capture decode failure** (manifest captures fail the code's `captures` schema) | Client, at dispatch | Same shape as an unresolvable code: the dispatch is abandoned and reported. Notably this is classified as a *resolution* failure, not an execution failure — the code never runs. | `dispatch-resolution-failure` |
| **Build mismatch** (manifest `buildId` ≠ client `expectedBuildId`) | Client, `decodeManifest` | Fails closed, before any listener is installed. Nothing resumes; the page falls back entirely to client-side behaviour. | `ResumeClientBuildMismatchError` |

Adjacent decode-time failures, for completeness: a malformed manifest yields
`ResumeManifestDecodeError`, an oversized payload yields
`ResumePayloadTooLargeError`, and an invalid `maxPayloadBytes` yields
`ResumeConfigurationError`. All three fail before installation.

Two properties worth stating separately because they are easy to regress:

- **Byte-invisibility.** With no active collector, resume markers are not
  emitted at all: `renderToString(() => makeButton(Resume.event(action)))`
  produces exactly `<button>Save</button>`. Resumability costs zero bytes on
  pages that do not collect.
- **Silence is the exception, not the rule.** Opaque *setup* is the one case in
  the table that produces no diagnostic. Everything else announces itself.
  Treat that asymmetry as a known gap rather than a design statement.

## 4. Milestone 0 item 6: superseded

Item 6 asked for "an intentionally failing end-to-end resume test that proves
the desired client behaviour and becomes the red baseline", with the acceptance
criterion "the red test fails because the resume SPI is **absent**".

**That item is satisfied by obsolescence and should not be implemented.** It was
written before the resume SPI existed. The SPI now exists
(`Resume.collect`, `Resume.decodeManifest`, `Resume.installClient`,
`Resume.restoreStateBindings`, …), the behaviour it was meant to hold a place
for is green — `src/__tests__/resume.test.ts` and the Chromium
production-bundle proof both pass — and its stated failure mode ("fails because
the SPI is absent") is no longer reachable. Adding a test engineered to fail
would pin nothing and would break the green-tree constraint.

The successor coverage is this document's executable half: the ordering and
fallback characterization in
[`src/__tests__/ssr-characterization.test.ts`](../src/__tests__/ssr-characterization.test.ts).
It serves the purpose item 6 was reaching for — a baseline that fails loudly if
the SSR/resume contract moves — without a deliberately red test.
