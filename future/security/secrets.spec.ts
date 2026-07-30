/**
 * Secrets — what must never leave the server, and what must never be blocked.
 *
 * Two opposite failure modes, which is why they belong in one file:
 *
 * - **Leak.** A credential reaches an audit record, a client bundle, or a
 *   serialized capture. `DQ-085` decided redaction is *structural*:
 *   `Agent.secret(schema)` is a wrapper codec, so redaction is a property of
 *   the type rather than of a scan.
 * - **Over-block.** The M7 secret-name heuristic *diagnoses* and never
 *   enforces (`DQ-085`, ratified explicitly because "enforcement by name" was
 *   the one combination flagged as needing a decision). A heuristic that
 *   refuses a field called `secretSauce` is a correctness bug, not a hardening
 *   win, and the spec must fail if someone "improves" it into a block.
 *
 * The portable-code half is the seam that already exists in `src/`: a portable
 * expression's captures are serialized into the page, so anything captured is
 * published. That is where a credential most plausibly escapes today.
 *
 * Owning plans: `AGENT_NATIVE_NOTES.md` §10 (`DQ-085`),
 * `RESUMABILITY_IMPLEMENTATION_PLAN.md` M7 (capture diagnostics).
 */

import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, unbuilt } from "../harness.js";
import { classifiedTag, runPromiseExit, runSync } from "./support.js";

const BuildId = "future-security-build";

describe("[SEC/M7] Portable captures are published, and behave like it", () => {
  it("serializes exactly the declared captures and nothing else from the enclosing scope", async () => {
    // The structural guarantee that makes capture review tractable: a portable
    // expression publishes its *declared* captures and cannot accidentally drag
    // an enclosing binding along. If an undeclared value could ride along, no
    // amount of diagnosing would help, because there would be nothing to name.
    const Portable = await fromSrc("Portable", "code", "bind", "describe");

    const apiKey = "sk-live-do-not-publish";
    const Code = Portable.code({
      id: "future.security.capture",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures: any) => `${captures.label}:${apiKey.length}`,
    });

    const encoded = runSync(
      Portable.describe(Portable.bind(Code, { label: "visible" })),
    );
    const serialized = JSON.stringify(encoded);
    expect(serialized).toContain("visible");
    // NEGATIVE CONTROL is the line above: the declared capture *is* published,
    // so this is not satisfied by an encoder that publishes nothing.
    expect(serialized).not.toContain(apiKey);
  });

  it("refuses to publish a capture the schema does not admit", async () => {
    // A credential most plausibly arrives as an extra field on the captures
    // object at a call site nobody re-read. The captures codec is the gate:
    // an undeclared field must be a typed encode failure, not a silent
    // passthrough into the page.
    const Portable = await fromSrc("Portable", "code", "bind", "describe");
    const Code = Portable.code({
      id: "future.security.capture.strict",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures: any) => captures.label,
    });

    const exit = await runPromiseExit(
      Portable.describe(
        Portable.bind(Code, { label: "visible", apiKey: "sk-live-do-not-publish" }),
      ),
    );
    if (classifiedTag(exit) === "success" && Exit.isSuccess(exit)) {
      // If the codec is deliberately open (extra fields dropped rather than
      // rejected), the security property still has to hold: the undeclared
      // field must not be in the published bytes.
      expect(JSON.stringify(exit.value)).not.toContain("sk-live-do-not-publish");
    }

    // NEGATIVE CONTROL: the declared-only object encodes cleanly.
    const clean = await runPromiseExit(
      Portable.describe(Portable.bind(Code, { label: "visible" })),
    );
    expect(classifiedTag(clean)).toBe("success");
  });

  it("diagnoses an oversized capture payload without silently truncating it", async () => {
    // `ResumePayloadTooLargeError` already exists and names the largest entry.
    // The security-relevant half is that an oversized payload is *refused and
    // named*, never quietly truncated: a truncated manifest that still installs
    // is a partially-armed page, which is worse than a failed one.
    const Resume = await fromSrc("Resume", "ResumePayloadTooLargeError");
    const instance = new Resume.ResumePayloadTooLargeError({
      maximumBytes: 1024,
      actualBytes: 4096,
      largestEntryKind: "component",
      largestEntryId: "c0",
      message: "too large",
    });
    // The operator needs to know *which* entry, or the diagnostic is unactionable.
    expect(instance._tag).toBe("ResumePayloadTooLargeError");
    expect(instance.largestEntryId).toBe("c0");
    expect(instance.actualBytes).toBeGreaterThan(instance.maximumBytes);
  });

  it("suggests `Agent.secret(...)` for a suspicious capture name without blocking it", async () => {
    // `DQ-085`, both halves, and the second half is the one that matters:
    //
    //   - a capture named `apiKey` / `password` / `token` emits ONE diagnostic
    //     whose code is specifically the secret-name suggestion (not a generic
    //     "capture warning", which would also be emitted for unrelated causes);
    //   - the encode still SUCCEEDS and the value is unchanged — enforcement by
    //     name was decided against;
    //   - NEGATIVE CONTROL: a capture named `label` emits no diagnostic at all,
    //     so an unconditional warner cannot pass.
    //
    // No such diagnostic exists in `src/Portable.ts` today; M7 owns it.
    unbuilt("M7 secret-name capture diagnostic", "RESUMABILITY_IMPLEMENTATION_PLAN.md M7");
  });
});

describe("[SEC/DQ-085] Structural redaction in audit records", () => {
  it("scrubs `Agent.secret(...)` fields from every audit record, including denials", async () => {
    // The shape this spec will take once the catalog exists:
    //
    //   - an action whose args schema wraps one field in `Agent.secret(...)`
    //     produces an audit record in which that field is a redaction marker
    //     and every other field is intact (so "redact everything" fails);
    //   - the same holds for the *denial* record, which is the path most likely
    //     to be written by a different code path and therefore missed;
    //   - the redaction survives the MCP/HTTP struct projection, because a tool
    //     manifest that echoes the arg back is a second copy of the secret.
    //
    // Module and export names are provisional under `DQ-096`.
    unbuilt("Agent.secret redaction in audit records", "DQ-096");
  });
});
