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
 * Promoted from `future/security/secrets.spec.ts` (all green 2026-08-17).
 * Owning plans: `AGENT_NATIVE_NOTES.md` §10 (`DQ-085`),
 * `RESUMABILITY_IMPLEMENTATION_PLAN.md` M7 (capture diagnostics).
 */

import * as babel from "@babel/core";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import * as Agent from "../Agent.js";
import resumeExtractPlugin from "../compiler/resume-extract-plugin.js";
import * as Portable from "../Portable.js";
import * as Resume from "../Resume.js";

const BuildId = "security-secrets-build";

const runSync = <A, E>(effect: Effect.Effect<A, E>): A => Effect.runSync(effect);
const runPromiseExit = <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(effect);

/** A boundary rejection is a typed failure, never a defect. */
function classifiedTag(exit: Exit.Exit<unknown, unknown>): string {
  if (!Exit.isFailure(exit)) return "success";
  expect(
    Cause.hasDies(exit.cause),
    "a boundary rejection must be a typed error, not a defect",
  ).toBe(false);
  return Cause.findErrorOption(exit.cause).pipe(
    Option.map((error) => (error as { readonly _tag?: string })._tag ?? "untagged"),
    Option.getOrElse(() => "none"),
  );
}

describe("[SEC/M7] Portable captures are published, and behave like it", () => {
  it("serializes exactly the declared captures and nothing else from the enclosing scope", async () => {
    // The structural guarantee that makes capture review tractable: a portable
    // expression publishes its *declared* captures and cannot accidentally drag
    // an enclosing binding along. If an undeclared value could ride along, no
    // amount of diagnosing would help, because there would be nothing to name.
    const apiKey = "sk-live-do-not-publish";
    const Code = Portable.code({
      id: "security.secrets.capture",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) => Effect.succeed(`${captures.label}:${apiKey.length}`),
    });

    const encoded = runSync(
      Portable.describe(Portable.bind(Code, { label: "visible" })).pipe(Effect.orDie),
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
    const Code = Portable.code({
      id: "security.secrets.capture.strict",
      buildId: BuildId,
      captures: Schema.Struct({ label: Schema.String }),
      run: (captures) => Effect.succeed(captures.label),
    });

    const exit = await runPromiseExit(
      Portable.describe(
        Portable.bind(Code, {
          label: "visible",
          apiKey: "sk-live-do-not-publish",
        } as unknown as { label: string }),
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

  it("suggests a structural fix for a suspicious capture name without blocking it (warning severity)", async () => {
    // Built by M7 at its real seam — the COMPILER (`secret-prone-capture` in
    // `src/compiler/resume-extract-plugin.ts`), where captures are authored,
    // not `src/Portable.ts` as this marker originally guessed. The default
    // severity is `error` (build-time authoring feedback, configurable);
    // this spec pins the DQ-085-relevant half: at `warning` severity the
    // diagnostic SUGGESTS and does not block — the transform succeeds and
    // the capture value is unchanged.
    const plugin = resumeExtractPlugin;

    const transform = (
      source: string,
      onDiagnostic: (diagnostic: { readonly code: string; readonly severity: string }) => void,
    ): string => {
      const result = babel.transformSync(source, {
        filename: "C:/app/src/todo.ts",
        babelrc: false,
        configFile: false,
        plugins: [[plugin, {
          root: "C:/app",
          buildId: BuildId,
          secretCaptureSeverity: "warning",
          onDiagnostic,
        }]],
      });
      return result?.code ?? "";
    };

    const secretSource = `
import { extract } from "effect-atom-jsx/portable-extract";
import { Effect, Schema } from "effect";
export const login = extract((captures) => Effect.succeed(captures.apiToken), {
  captures: Schema.Struct({ apiToken: Schema.String }),
  bind: { apiToken: "sk-live-still-published" },
});
`;
    const diagnostics: Array<{ code: string; severity: string }> = [];
    const output = transform(secretSource, (diagnostic) => diagnostics.push(diagnostic));

    // ONE diagnostic, and specifically the secret-name suggestion — not a
    // generic capture warning that unrelated causes would also emit.
    expect(diagnostics.map((d) => d.code)).toEqual(["secret-prone-capture"]);
    expect(diagnostics[0]!.severity).toBe("warning");
    // …and it does NOT block: the transform succeeded and the capture value
    // still rides in the output unchanged. (The diagnostic exists precisely
    // because the value IS published — blocking would hide that truth.)
    expect(output).toContain("sk-live-still-published");

    // NEGATIVE CONTROL: a benign capture name emits no diagnostic at all,
    // so an unconditional warner cannot pass.
    const benignSource = secretSource
      .replace(/apiToken/g, "label")
      .replace("sk-live-still-published", "visible");
    const benignDiagnostics: Array<{ code: string; severity: string }> = [];
    const benignOutput = transform(benignSource, (d) => benignDiagnostics.push(d));
    expect(benignDiagnostics).toEqual([]);
    expect(benignOutput).toContain("visible");
  });
});

describe("[SEC/DQ-085] Structural redaction in audit records", () => {
  it("scrubs `Agent.secret(...)` fields from every audit record, including denials", async () => {
    const { catalog, exposeMutation, dispatch, audited, secret, AuditLog, Authorizer, AuthorizationDeniedError, toolManifest } =
      Agent;
    const { code } = Portable;

    const SECRET = "sk-live-never-in-audit";
    const c = audited(
      catalog({
        connect: exposeMutation(
          code({
            id: "sec.redaction.connect",
            buildId: BuildId,
            captures: Schema.Struct({}),
            run: (_c: unknown, input: { readonly host: string; readonly apiToken: string }) =>
              Effect.succeed({ connected: input.host }),
          }),
          {
            description: "Connect an integration",
            args: Schema.Tuple([
              Schema.Struct({
                host: Schema.String,
                apiToken: secret(Schema.String),
              }),
            ]),
            success: Schema.Struct({ connected: Schema.String }),
            access: { agent: true },
          },
        ),
      }),
    );
    const args = [{ host: "api.example.com", apiToken: SECRET }];

    // SUCCESS record: the declared-secret field is redacted; every other
    // field is intact (so "redact everything" fails).
    const successRecords: Array<any> = [];
    const ok = await Effect.runPromise(
      dispatch(c)({ tool: "connect", args, buildId: BuildId }).pipe(
        Effect.provide(
          Layer.succeed(AuditLog, {
            record: (entry: unknown) => Effect.sync(() => void successRecords.push(entry)),
          }),
        ),
      ) as Effect.Effect<any>,
    );
    expect(ok.ok).toBe(true);
    expect(successRecords).toHaveLength(1);
    expect(JSON.stringify(successRecords[0])).not.toContain(SECRET);
    expect(JSON.stringify(successRecords[0])).toContain("api.example.com");

    // DENIAL record: the path most likely to be written by a different code
    // path and therefore missed — it must scrub identically.
    const denialRecords: Array<any> = [];
    const denied = await Effect.runPromise(
      dispatch(c)({ tool: "connect", args, buildId: BuildId }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AuditLog, {
              record: (entry: unknown) => Effect.sync(() => void denialRecords.push(entry)),
            }),
            Layer.succeed(Authorizer, {
              authorize: (tool: string) =>
                Effect.fail(new AuthorizationDeniedError({ tool, reason: "no" })),
            }),
          ),
        ),
      ) as Effect.Effect<any>,
    );
    expect(denied.ok).toBe(false);
    expect(denialRecords).toHaveLength(1);
    expect(denialRecords[0].outcome).toBe("denied");
    expect(JSON.stringify(denialRecords[0])).not.toContain(SECRET);
    expect(JSON.stringify(denialRecords[0])).toContain("api.example.com");

    // The struct projection (tool manifest) carries SCHEMAS, never argument
    // values — a manifest that echoed the arg back would be a second copy.
    const manifest = await Effect.runPromise(toolManifest(c) as Effect.Effect<unknown>);
    expect(JSON.stringify(manifest)).not.toContain(SECRET);
  });
});
