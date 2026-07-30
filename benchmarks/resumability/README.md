# Milestone 8c.1 resumability benchmark

This harness compares the current dormant text-expression protocol with the
repository's honest eager-client comparator: startup activation followed by a
full rerender. It does not call the comparator hydration because Chromium
proved the pinned `hydratable: false` compiler path replaces the SSR node.

The primary four static fixtures use the same initial data and markup:

- eager rerender with one expression;
- dormant resumption with one expression;
- eager rerender with 24 expressions;
- dormant resumption with 24 expressions.

The realistic fixture has 12 expressions subscribed to one shared dependency
key and 12 expressions subscribed to independent keys. All 24 resumable
instances use one compiler-extracted code identity. This makes both fan-out and
single-flight behavior observable without conflating code duplication with
expression density.

Two additional eager fixtures construct the same otherwise-unused
`ManagedRuntime` as the dormant client. They isolate runtime ownership from
the protocol comparison instead of hiding that cost in either side.

The retained-heap attribution matrix uses fresh pages for densities 0, 1, and
24 and advances one stage at a time over the same imported module graph:
module baseline, managed runtime, serialization service, JSON parse, type-side
schema guard, schema decode, public manifest decode, runtime plus manifest,
portable resolver, DOM boundary scans, and full client installation. Density 0
still contains one component snapshot, so it measures fixed boundary/protocol
cost without expression controllers.

## Method

Each cold sample uses a new Chromium context with the network cache disabled.
Ordinary Chromium is authoritative for lifecycle, network, and timing. A
second interpreter-only (`--jitless`) Chromium process repeats the same
fixture lifecycle solely for forced-GC heap measurement. This separation is
intentional: `JSHeapUsedSize` includes V8-generated baseline/JIT code, and the
density-24 schema/scan path can cross a compilation threshold that density 1
does not. Counting that fixed generated code as linear expression ownership
made the slope gate report a leak even though comparative heap snapshots
localized the delta to `InstructionStream`/code nodes. The JIT-neutral lane
keeps the existing fixed-gap and 1.10 slope thresholds focused on retained
runtime objects; it is never used for latency claims.

The harness records requests completed before interaction, during the first
interaction, and during warm writes. The first shared write is the cold path;
subsequent shared writes measure fan-out and independent writes measure a
single-target warm path.

The fixture records lifecycle counters and the resumable runtime exposes a
detached `ClientInstallation.inspect()` snapshot. Controller, subscription,
loader, setup/view, resource, diagnostic, and disposal invariants are hard
failures. The eager counts describe the fixture's deliberately created logical
component/expression ownership; dormant counts come from the installation's
actual controller and subscription indexes. Startup root identity and patched
text-node identity are also hard assertions. Timing and forced-GC CDP heap
values are report-only until repeated CI-like runs establish honest budgets.
Each attribution stage also records its forced-GC delta from the same-density
module-only page. The type-side guard is an investigative control, not an
alternate wire decoder: it neither runs the injectable serializer's
transformations nor preserves structured schema decode failures.

Payload accounting reports the UTF-8 manifest JSON, durable expression comment
markers, their raw and gzip totals, and the final HTML document's raw and gzip
sizes. Network transfer uses Chromium's `Network.loadingFinished`
`encodedDataLength`.

Run:

```bash
npm run bench:resumability
```

For a quick local smoke run:

```bash
npm run build:resumability-benchmark
node benchmarks/resumability/run.mjs --runs 1 --warm 3
```

The versioned result is written to
`bench-results/resumability/latest.json` and checked by
`benchmarks/resumability/verify.mjs`. The JSON Schema documents the wire shape;
the verifier enforces cross-record and lifecycle invariants that JSON Schema
cannot express.

## Baseline and retention checkpoint

The checked-in five-run v2 baseline is
[`results/baseline-windows-chromium.json`](results/baseline-windows-chromium.json).
It was refreshed after manifest v4 ratification. At density 24, dormant startup
retained 2,507,440 bytes after forced GC versus 2,324,228 bytes for eager
activation—183,212 bytes (about 7.9%) more. The runtime-aligned eager comparator
retained 2,327,696 bytes, confirming that its
otherwise-unused `ManagedRuntime` explains only 3,468 bytes of the gap.
Payload, network, single-flight, warm-write, disposal, the calibrated 200 KB
fixed-gap ceiling, and the 1.10 relative-slope ceiling all passed.

The v2 baseline adds the aligned comparator and attribution matrix. It showed
that constructing a `ManagedRuntime` accounts for only a few kilobytes, while
schema/manifest decoding and fixed installation ownership dominate the
difference. The zero-expression installation retained 261,072 bytes above the
module-only page in the original v3 checkpoint; the refreshed v4 checkpoint is
277,208 bytes. From density 1 to 24, dormant retained heap grew by 99,156 bytes
(about 4,311 bytes per expression), versus eager rerender's 92,644-byte growth
(about 4,028 bytes per expression). The 1.0703 ratio is below the calibrated
1.10 ceiling, so the remaining headline gap is predominantly fixed protocol
cost in this deliberately tiny fixture, not an expression-density leak.

The runtime now treats a successfully decoded manifest as a trusted immutable
value: it deep-freezes the schema-owned object graph, remembers that exact
identity in a private `WeakSet`, and reuses it through boundary scans,
restoration, and client installation. Manually supplied values still cross the
full schema boundary, and opaque `Schema.Unknown` values cannot run accessors
during freezing. This removes repeated structural decoding without adding a
public validation token or weakening fail-closed behavior.

Browser scans use a native `TreeWalker` when available. The renderer-neutral
fallback still traverses structural `childNodes`, but browser scans avoid
materializing a retained live `NodeList` wrapper on every visited DOM node.

The retention review is closed. Milestone 8c.2 may widen the protocol while the
fixed gap remains at or below 200 KB, the density-1-to-24 dormant growth remains
at or below 110% of eager growth, and all deterministic lifecycle/network
invariants remain hard gates. The unfavorable absolute result stays visible;
the calibrated gates separate fixed protocol cost from per-expression scaling.

## Baseline re-pinned 2026-07-30 (post-8c widening)

The recorded baseline is now the **post-widening** run, taken after 8c.3–8c.6
landed attribute, class, and style-property targets.

**Why it was re-pinned, and what the old numbers do not mean.** The previous
baseline recorded **no `heapMeasurementMode`**; this one records
`jitless-forced-gc`. Jitless removes the density-triggered V8 JIT code that
M8c.1 found was being miscounted as expression slope — and it removes it from
**both** arms. So comparing *growth* figures across the two files is invalid, and
will make the widening look like a large improvement that it is not. Only
**within-run** figures (the dormant-vs-eager gap, and the slope ratio) are
comparable across runs.

8c.7 result on this baseline:

| Gate | Ceiling | Result |
| --- | --- | --- |
| density-24 dormant-vs-eager retained-heap gap | 204,800 B | **49,368 B** |
| density-1→24 dormant growth ÷ eager growth | 1.10× | **0.6659×** |

Dormant grows **more slowly per expression than eager** (1,138 B/expr vs
1,710 B/expr). The widening itself cost **288 raw / 11 gzip bytes at density 24**
(8,186 → 8,474 raw; 766 → 777 gzip).
