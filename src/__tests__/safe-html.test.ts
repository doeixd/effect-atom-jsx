/**
 * K1 / typed-view foundations — `SafeHtml` branding.
 *
 * Owning doc: `docs/COMPONENT_KIT_PLAN.md`: *"Any widget that emits raw markup
 * (rich tooltip content, markdown rendering) must do so through `SafeHtml`'s
 * branding — unbranded strings render as text, never as HTML, by
 * construction."* The plan itself flags this as claimed but **exercised
 * nowhere** (mandated coverage item 8), and `KIT_LAYER_SPEC_FINDINGS.md` §3.2
 * confirms it is asserted nowhere in the repo.
 *
 * "By construction" is a two-sided claim, so both sides are specified here:
 *
 *   - an unbranded string in a markup position **escapes** (the XSS guarantee);
 *   - a `SafeHtml.make(...)` value in the same position renders as **markup**
 *     (the escape hatch actually works — otherwise the guarantee is vacuously
 *     satisfied by a renderer that escapes everything).
 *
 * The differential pair is the point: each half is the other's negative
 * control.
 */
import { describe, expect, it } from "vitest";
import * as domModule from "../dom.js";
import * as SafeHtmlModule from "../SafeHtml.js";
import * as ViewModule from "../View.js";

/** An XSS-shaped payload: nothing here may survive as live markup. */
const PAYLOAD = `<img src=x onerror="alert(1)">&<script>bad()</script>`;

describe("SafeHtml: unbranded strings are text", () => {
  it("[K1] an unbranded string inserted as a child escapes to entities", async () => {
    const { renderToString, insert } = domModule;

    // Rendered through the same child-insertion path a widget uses for dynamic
    // content — the real injection surface, not a string helper.
    const html: string = renderToString(() => {
      const host = (globalThis as any).document.createElement("div");
      insert(host, PAYLOAD);
      return host;
    });

    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    // The three things that make it an exploit: a live tag, an event handler
    // attribute, and a script element. None may appear unescaped.
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=\"alert(1)\"");
  });

  it("[K1] a reactive accessor returning a string is escaped on every update, not just the first", async () => {
    const { renderToString, insert } = domModule;

    // The dangerous shape is the dynamic one: escaping must live in the
    // insertion path, not in a one-off sanitize at authoring time.
    const html: string = renderToString(() => {
      const host = (globalThis as any).document.createElement("div");
      insert(host, () => PAYLOAD);
      return host;
    });

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it("[K1] the brand cannot be forged by shape: only the constructor produces SafeHtml", async () => {
    const { make, isSafeHtml, unwrap } = SafeHtmlModule;

    // Negative control first: the real thing is accepted, and round-trips.
    const safe = make("<strong>trusted</strong>");
    expect(isSafeHtml(safe)).toBe(true);
    expect(unwrap(safe)).toBe("<strong>trusted</strong>");

    // Everything that merely *looks* like SafeHtml is not SafeHtml. A widget
    // that forwards caller-supplied data into a markup position is the whole
    // threat model, so structural look-alikes must not pass the guard.
    for (const impostor of [
      PAYLOAD,
      { html: PAYLOAD },
      { html: PAYLOAD, safe: true },
      [PAYLOAD],
      null,
      undefined,
    ]) {
      expect(isSafeHtml(impostor)).toBe(false);
    }
  });

  it("[K1] View.html fails closed on an unbranded string instead of minting an html hole", async () => {
    const htmlHole = ViewModule.html;
    const { make, isSafeHtml } = SafeHtmlModule;

    // Negative control: the branded value is accepted, cleanly, and the hole
    // carries the brand through — this is what "accepted" looks like.
    const good = htmlHole(make("<em>ok</em>"));
    expect(good.kind).toBe("view.hole.html");
    expect(isSafeHtml(good.value)).toBe(true);

    // `View.html` is the generated/dynamic escape hatch's entry point: the type
    // says `SafeHtml`, but a JSON-driven or codegen caller reaches it with
    // `unknown`. The cast is deliberate — it documents taking that path so the
    // *runtime* guard can be specified. (The compile-time half belongs in
    // `src/type-tests/view.ts`, where it already holds.)
    //
    // Expected RED: `View.html` performs no runtime check today, so a raw
    // string becomes an html hole indistinguishable from a trusted one.
    let hole: any;
    let threw = false;
    try {
      hole = htmlHole(PAYLOAD as any);
    } catch {
      threw = true;
    }
    // Either fail closed loudly, or refuse to produce a raw-markup hole. What
    // must never happen is silently minting one.
    expect(threw || !isSafeHtml(hole?.value)).toBe(true);
    expect(hole?.value).not.toBe(PAYLOAD);
  });
});

describe("SafeHtml: branded values are markup", () => {
  it("[K1] the same insertion position renders SafeHtml as markup and its unbranded twin as text", async () => {
    const { renderToString, insert } = domModule;
    const { make } = SafeHtmlModule;

    const markup = "<strong>trusted</strong>";

    const rendered: string = renderToString(() => {
      const host = (globalThis as any).document.createElement("div");
      insert(host, make(markup));
      return host;
    });
    const escaped: string = renderToString(() => {
      const host = (globalThis as any).document.createElement("div");
      insert(host, markup);
      return host;
    });

    // The differential IS the guarantee. A renderer that escapes everything
    // passes the specs above but fails here; one that escapes nothing passes
    // here but fails those. Only branding-aware rendering satisfies both.
    //
    // Expected RED: no renderer consumes `SafeHtml` or `view.hole.html` yet —
    // `grep view.hole` finds no consumer outside `View.ts` — so the branded
    // value currently stringifies to `[object Object]`. Which mechanism carries
    // it (child insertion, as asserted here, versus html-hole rendering in the
    // typed view tree) is K1's to decide; the asserted outcome is the same
    // either way.
    expect(rendered).toContain("<strong>trusted</strong>");
    expect(escaped).toContain("&lt;strong&gt;");
    expect(escaped).not.toContain("<strong>");
    // …and it is inserted once, not duplicated as both text and markup.
    expect(rendered.match(/trusted/g)?.length).toBe(1);
  });
});
