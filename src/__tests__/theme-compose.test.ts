/**
 * DQ-061 (ratified, option 1) — theme composition is a DEFINITION-time
 * operation producing one complete Layer, and semantic tokens resolve
 * through the raw palette level. Never merge-aware Layer semantics.
 */
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as Theme from "../Theme.js";

describe("Theme.compose (DQ-061)", () => {
  it("a semantic token resolves through the raw palette level", async () => {
    const palette = Theme.define({ color: { blue500: "#1d4ed8", zinc100: "#f4f4f5" } });
    const semantic = Theme.define({
      color: { brand: "color.blue500", bgSubtle: "color.zinc100" },
    });
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const theme = yield* Theme.Theme;
        return {
          raw: theme.resolve("blue500"),
          brand: theme.resolve("brand"),
          bgSubtle: theme.resolve("bgSubtle"),
        };
      }).pipe(Effect.provide(Theme.compose(palette, semantic).layer())),
    );
    expect(resolved).toEqual({
      raw: "#1d4ed8",
      brand: "#1d4ed8",
      bgSubtle: "#f4f4f5",
    });
  });

  it("independent categories compose; later definitions win per token; a cycle stays inert", async () => {
    const color = Theme.define({ color: { accent: "#111827" } });
    const spacing = Theme.define({ spacing: { md: 4 } });
    const override = Theme.define({ color: { accent: "#000000" } });
    const composed = Theme.compose(color, spacing, override);
    const theme = await Effect.runPromise(
      Effect.service(Theme.Theme).pipe(Effect.provide(composed.layer())),
    );
    expect(theme.resolve("accent")).toBe("#000000");
    expect(theme.resolve("md")).toBe("4");
    // Purity: the source definitions are untouched.
    expect(color.tokens.color.accent).toBe("#111827");

    // A self-referential token terminates (cycle guard) instead of spinning.
    const cyclic = Theme.define({ color: { a: "color.b", b: "color.a" } });
    // Terminates deterministically at the first revisited path.
    expect(Theme.resolveToken(cyclic.tokens, "a")).toBe("color.b");
  });
});
