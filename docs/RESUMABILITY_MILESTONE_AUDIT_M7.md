# Milestone audit — M7 (2026-07-30)

Adversarial audit of Milestone 7 (compiler-generated identities and closure
extraction). Probed empirically: the plugin was bundled with esbuild and driven
directly against `@babel/core`, and the failure shapes were **executed**, not
reasoned about.

## The headline result is a negative one, and it matters

**No identity-stability failure survives a deploy.** buildId is enforced at the
manifest, descriptor, executor, activation, and query-snapshot levels
(`Resume.ts:1569, 1614, 1688, 1773, 1912, 3854`; `Portable.ts:617`). A cached page
from an old deploy fails the manifest buildId check and falls back — it **cannot
silently address a moved identity**. The worst outcome this milestone could
produce is prevented, and the auditor could not construct a counterexample.

Identity stability holds where the policy promises it: whitespace, comments, and
string/number literal *form* (`"a"`/`'a'`, `1`/`1.0`/`0x1`/`1e0`) all hash equal,
because `extra`/`raw` is stripped. **Adding an earlier unassigned call leaves a
later identity byte-identical** — the headline claim is true. `bind` genuinely
participates in the hash, so the deliberate trade is real. And the `~n`
disambiguation is **benign by construction**: since `bind` is inside the hash, two
colliding calls are *wholly identical source*, so which gets `~1` is semantically
irrelevant.

## True status

The plan's M7 prose is **stale on two points**: it still describes `#$ordinal`
(line 985) and claims the fixture identity is `app/note-button.ts#$0` (line 1028).
The real fixture identity is `app/note-button.ts#$vj57is3vtrv6`. Status should
read **substantially complete, items 5 and 7 partial**.

**Item 5 was never done** — "pass optional source metadata through the
characterized helper ABI". `Portable.CodeOptions` has only
`id`/`buildId`/`captures`/`run`; no file/line/source field exists anywhere on the
portable ABI, and source metadata reaches only the out-of-band `onCode` build
hook. This is the third instance today of the M1/M4 shape: **a work item skipped
inside a milestone that reads as done.**

**Item 3 partial** — only the generic `extract`/`expr` markers exist; nothing is
action/query/behavior-specific, and there is no query or behavior fixture.
**Item 7 partial** — oversized and secret-prone diagnostics work (confirmed firing
on `apiKey`, silent on `label`, suppressible via `secretCaptureSeverity: "off"`),
but **non-const has no diagnostic at all** and unserializable captures have no
build-time diagnostic (deferred to render time, which *is* documented).

---

## Defects, ranked

### D1 — Nested marker calls emit an orphaned manifest entry *and* an untransformed call site (highest)

`plugin.ts:1313-1317` clones the option nodes into the new call **before** any
inner marker is processed, so the inner lowering mutates an orphaned AST node.
Probed in all three positions (`run`, `captures`, `bind`):

```js
export const o = extract(() => Effect.succeed(1), {
  captures: Schema.Struct({}),
  bind: { inner: extract(() => Effect.succeed(2), { captures: Schema.Struct({}), bind: {} }) },
});
```

Output keeps the literal `extract(...)` at the call site **and** emits a
`_afPortableCode` definition plus an `onCode` entry. Consequence: a resolver entry
and dynamic-import chunk for an id **nothing ever binds** — a genuinely orphaned
manifest entry — plus a hard throw at module evaluation from
`portable-extract.ts:107`. This should be a compile error. It fails closed at
runtime, so severity is bounded, but it is the one path that manufactures an
orphan.

### D2 — TDZ crash in the deferred function-nested case — **FIXED 2026-08-11**

`plugin.ts:1421-1423` appends deferred definitions with `pushContainer`, i.e.
after *all* statements. If any statement invokes the enclosing function during
module evaluation:

```js
export function make() { return _afPortableBind(_afCode$anon, {}); }
export const first = make();                        // runs here
export const _afCode$anon = _afPortableCode({...});  // initialized here
```

Executed: `ReferenceError: Cannot access '_afCode$anon' before initialization`.
The factory-at-module-scope pattern (`const save = makeSave()`) hits this, as does
`function f(p = extract(...))` called at module scope.

**The existing test asserts only `definitionIndex > schemaIndex`** — it never
invokes anything, so no change to the deferral logic that preserves that ordering
could fail it. Classic pass-for-the-wrong-reason. The plan's claim that deferral
is safe "where all module bindings are initialized" is true of the definition's
own dependencies and **false of its callers**.

> **Confirmed independently by execution (2026-07-30, test audit).** The test
> audit built an `evaluateTransformed` harness — transform, lower to CJS, run
> under a `require` serving the real `Portable` runtime — and reproduced the
> `ReferenceError` rather than reasoning to it. Both order tests now execute the
> module and assert the captures schema *decodes*, which proves the definition
> closed over an initialized binding rather than merely appearing later in the
> file. Verified to have teeth by replacing the bind captures with `{}`: both
> tests fail, and neither could have before.

**Fix (2026-08-11).** Each deferred definition is now placed **immediately after
its last module-scope dependency** rather than after the whole body — the
earliest legal position, so the largest number of callers work. Dependencies are
found by walking the definition for referenced identifiers and keeping only
those whose binding resolves to the *program* scope, so anything shadowed inside
the definition does not constrain placement.

Two things this surfaced that were not obvious from the audit:

- **Relative order matters.** Two definitions sharing one anchor are each
  inserted directly after it, so the last placed ends up first — reversing
  source order and breaking the `~1` identity disambiguation, which resolves
  collisions *in source order*. The loop walks `deferred` backwards to restore
  it. Caught by two previously-passing auto-capture tests, not by reasoning.
- **The mirror case cannot be fixed and should not be.** When a dependency
  genuinely follows the module-scope caller, no placement satisfies both. The
  definition still follows its dependency and the **author's** evaluation order
  throws — papering over it would mean capturing an uninitialized binding. Pinned
  by a test asserting the `ReferenceError`.

### D3 — Vite: stale entries survive file deletion and rename

`entriesByModule` is plugin-instance state with **no `buildStart` or
`watchChange` hook**. Entries are removed only from *inside* `transform`, so a
deleted or renamed marker module — never transformed again — keeps its entries
forever in watch/dev, and the regenerated virtual module emits
`import("…/deleted-file.ts")`.

The claim "removal of stale resolver entries when markers disappear" is true only
for the *edit-out-the-import* path, generalized to all. What makes the cache
correct — *"every key is re-validated because its module is re-transformed"* — is
never written down and is **false for deletion**.

### D4 — Vite: `sourceModules` first-build discovery is build-only, with zero coverage

`resume-extract-vite.ts:149-160` reaches for `this.resolve`/`this.load` through
optional chaining. `this.load` is unavailable in Vite's dev-serve plugin
container, so the loop **silently no-ops** and the virtual module is generated
from whatever happened to be transformed. The doc comment does not say
*build-only*. `sourceModules` appears in **zero tests** — its only proof is the
Chromium fixture, which runs in build mode.

> **Now covered (2026-07-30, test audit).** Four tests drive `load.call` against
> a container running the real transform: force-load happens, duplicate
> specifiers collapse (asserted as exact arrays, not counts), unresolvable
> specifiers are tolerated, and nothing loads when the option is unset. The
> no-`this.load` path is pinned by an explicitly-labelled **known-defect** test —
> "emits an EMPTY resolver module when the container exposes no this.load" —
> carrying a comment that it records rather than endorses the behaviour. Invert
> or delete that test when the source is fixed; leaving it green after a fix
> would be the bug.

### D5 — Vite HMR: invalidation without a re-request, plus a load/transform race

`handleHotUpdate` invalidates the virtual module and returns `undefined`. The
virtual module is not in the changed module's HMR propagation branch, so **nothing
re-requests it** — in practice a newly added `extract` does not reach the client
until a full reload. And if it *is* re-requested, `load` calls `allEntries()`
whichever way the race falls. The HMR test asserts only that `invalidateModule`
was called on a fake graph, so it can never observe either problem.

### D6 — Non-semantic edits outside the stated policy churn identities

`structuralKey` sorts *AST node keys* but preserves `ObjectExpression.properties`
order, so `{ captures, bind }` and `{ bind, captures }` hash differently (probed:
`$ldcxa91b3ninr` vs `$1oaf2npsx5jmb`). Renaming a purely local parameter does too.
An autofixer such as `sort-keys`, or a rename refactor, silently churns
chunk/prefetch identity for unchanged behaviour. Within policy as written — but
the policy comment advertises formatting-insensitivity in a way that reads
broader than it is.

### D7 — `structuralKey` serialization is unescaped (theoretical)

Joins with bare `,` and `:` and stringifies leaves as `${typeof}:${String(value)}`,
so a string containing `,b:` could in principle alias a different structure. No
actual collision could be constructed — one `JSON.stringify` away from provably
sound.

### D8 — Stale `#$0` in the example

`examples/resumable-extract/shared/build.ts:3` still exports
`NoteCodeId = "app/note-button.ts#$0"` (dead, zero references, but wrong under the
new scheme), and `app/note-button.ts:6` repeats it in prose.

---

## Probed and found clean

- **The rejector is not over-broad.** Every allowed case still compiles and lowers
  (`class`, `className`, `attr:title`, bare `title`, `style:opacity`, text child,
  and two expressions on one element grouping into a single directive with `~1`
  disambiguation). Every rejection fires **with a code frame**: `onClick`,
  `on:click`, `oncapture:click`, whole `style`, `classList`, spread, `href`/`src`,
  `prop:*`, `ref`, component prop, member elements, and `expr` nested in a larger
  attribute expression. This is not a naive suite.
- **Authored-ref composition is correct.** Object refs are `typeof`-guarded and
  skipped — which *matches* the runtime (`dom.ts:394-397` also honours only
  function refs), so it is not a silent drop. Variable-assignment and shorthand
  refs are compile errors. Two behaviour notes, neither a bug: the directive now
  runs *before* the authored ref, and the ref expression is evaluated lazily inside
  the callback rather than at element construction.
- **Hoist placement is sound** in every statement position tried — multi-declarator
  `const` split correctly; braceless `if`/`for-of`/`switch case`/labelled block all
  climb to the enclosing top-level statement rather than injecting an illegal
  `export` into a block.
- **`this`/`super`/`arguments` rejection is precisely scoped** — a nested
  non-arrow function, an object method, and `class … extends Base { m() { super.m() } }`
  inside the extracted body are all allowed. Only bindings resolving *outside* the
  extracted expression error.
- **Allowlist parity tests would fail on divergence** — sorted sets plus regex
  source *and* flags, a negative control, and a guard asserting every plugin
  `import` line is `import type`. One gap: that guard's regex misses
  `export … from` and dynamic `await import(...)`, neither currently used.
- **`style:--custom` is documented dead code, not an oversight** — Babel throws on
  `style:--my-var` since JSX identifiers cannot begin with `-`, so that branch is
  reachable only via `dom.exprStyleProperty`.
- **No module-level state in the Babel plugin** — all counters are per-`Program`.
- **Normal JSX without the transform is untouched** — the plugin returns early when
  no marker import and again when no marker call is found.

## Minor, unranked

`<div title={cond ? expr(…) : "x"}/>` is a compile error, but
`<div>{cond ? expr(…) : "x"}</div>` compiles and falls through to text lowering.
The "nesting hides the target" reasoning applies to both; the child path relies on
SSR collection failing closed instead.
