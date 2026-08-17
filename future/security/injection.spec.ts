/**
 * Injection — an unbranded string never becomes markup.
 *
 * Four separate channels get a string from outside the process onto the page,
 * and each is a distinct seam:
 *
 * 1. SSR text (`dom.renderToString`) — must escape, always;
 * 2. `SafeHtml` — the *only* thing that renders as markup, and only because it
 *    is branded;
 * 3. serialized payloads that live inside `<script>` (the resume manifest and
 *    the deferred loader scripts) — must be `</script>`-safe;
 * 4. the generated-UI spec IR — where `DQ-090` decided the property is true by
 *    **construction**: there is no markup-bearing node kind at all, so a
 *    `ui.html`-shaped node is rejected at the schema boundary because the kind
 *    does not exist, not because a validator caught it.
 *
 * Plus one negative guarantee across all of them: no inline event handler
 * attribute is ever emitted.
 *
 * Owning plans: `AGENT_NATIVE_NOTES.md` §10 (`DQ-090`), AF-UI contract
 * (`SafeHtml`), `ROUTER_CONSOLIDATION_PLAN.md` R2 (loader scripts).
 */

import { Exit } from "effect";
import { describe, expect, it } from "vitest";
import { fromSrc, unbuilt } from "../harness.js";
import {
  classifiedTag,
  containsLiveMarkup,
  quoteCount,
  runPromiseExit,
  ScriptBreakoutPayload,
  XssPayload,
} from "./support.js";

describe("[SEC/AF-UI] SSR text escaping", () => {
  it("escapes an XSS-shaped string in text position and still renders it as visible text", async () => {
    // This property already holds. It is asserted anyway because it is the one
    // place a regression would be catastrophic and silent: a future
    // `insert`/`toHTML` fast path that skips `escapeHTML` for "plain strings"
    // would pass every existing rendering test.
    const dom = await fromSrc("dom", "renderToString", "template", "insert");
    const html = dom.renderToString(() => {
      const span = dom.template("<span>")();
      dom.insert(span, XssPayload);
      return span;
    });
    expect(containsLiveMarkup(html)).toBe(false);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");

    // NEGATIVE CONTROL: an ordinary string still reaches the page unmangled, so
    // this is not satisfied by an escaper that drops content.
    const plain = dom.renderToString(() => {
      const span = dom.template("<span>")();
      dom.insert(span, "hello & goodbye");
      return span;
    });
    expect(plain).toContain("hello &amp; goodbye");
  });

  it("escapes an XSS-shaped string in attribute position, including a quote breakout", async () => {
    const dom = await fromSrc("dom", "renderToString", "template", "setAttribute");
    const breakout = `" onmouseover="globalThis.__afuiPwned=1`;
    const html = dom.renderToString(() => {
      const span = dom.template("<span>")();
      dom.setAttribute(span, "title", breakout);
      return span;
    });
    // The attacker's goal is a *second* attribute, reached by closing the
    // first one's quotes. So the property is quote arithmetic: the serialized
    // element must carry exactly one attribute, hence exactly two quotes.
    // (A `/\sonmouseover=/` regex is the wrong check — it matches the
    // perfectly-escaped `title="&quot; onmouseover=&quot;y"` too.)
    expect(quoteCount(html)).toBe(2);
    expect(html).toContain("&quot;");

    // NEGATIVE CONTROL: a benign attribute value still round-trips.
    const plain = dom.renderToString(() => {
      const span = dom.template("<span>")();
      dom.setAttribute(span, "title", "plain title");
      return span;
    });
    expect(plain).toContain(`title="plain title"`);
  });

  it("emits no inline event handler attributes for a delegated listener", async () => {
    // Event wiring must never become an `on*` attribute in serialized HTML: an
    // inline handler is both an injection surface and incompatible with any
    // strict CSP the host may set.
    const dom = await fromSrc("dom", "renderToString", "template", "addEventListener");
    const html = dom.renderToString(() => {
      const button = dom.template("<button>")();
      dom.addEventListener(button, "click", () => {});
      return button;
    });
    expect(/\son[a-z]+\s*=/i.test(html)).toBe(false);
    expect(html).toContain("<button");
  });
});

describe("[SEC/AF-UI] SafeHtml is the only markup channel", () => {
  it("renders branded SafeHtml as markup and refuses a look-alike that is not branded", async () => {
    const SafeHtml = await fromSrc("SafeHtml", "make", "isSafeHtml", "unwrap");
    const View = await fromSrc("View", "html");

    // The brand is a symbol, so a plain object cannot forge it by structure.
    const forged = { html: "<b>forged</b>", [Symbol.for("not-the-real-one")]: true };
    expect(SafeHtml.isSafeHtml(forged)).toBe(false);
    expect(SafeHtml.isSafeHtml(XssPayload)).toBe(false);

    // NEGATIVE CONTROL: the genuine article is recognised and round-trips.
    const branded = SafeHtml.make("<b>trusted</b>");
    expect(SafeHtml.isSafeHtml(branded)).toBe(true);
    expect(SafeHtml.unwrap(branded)).toBe("<b>trusted</b>");
    expect(View.html(branded).value).toBe(branded);

    // The renderer half. `View.html(...)` produces a `view.hole.html` node that
    // `src/dom.ts` has no branch for today, so a `SafeHtml` hole silently
    // renders as nothing. That is fail-closed, which is the right default — but
    // it means the *only* markup channel in the design is currently
    // unimplemented, and the day it is implemented is the day the brand check
    // becomes load-bearing at runtime rather than only at the type level.
    unbuilt("renderer branch for View.html / SafeHtml holes", "COMPONENT_KIT_PLAN.md");
  });
});

describe("[SEC/R2] Serialized payloads inside <script>", () => {
  it("keeps a `</script>` breakout out of anything the Serialization seam encodes", async () => {
    // `Serialization` is the single string layer under both the resume manifest
    // `<script type="application/json">` block and the streamed loader scripts.
    // Any attacker-controlled string that reaches component state or a loader
    // result reaches this encoder, so `</script>` must not survive it — and the
    // escaped form must still be valid JSON, or the fix would break hydration.
    const Serialization = await fromSrc("Serialization", "encodeSync", "escapeJsonForHtml");
    const { Schema } = await import("effect");

    const encoded = Serialization.encodeSync(
      Schema.Struct({ note: Schema.String }),
      { note: ScriptBreakoutPayload },
    );
    expect(encoded).not.toContain("</script>");
    expect(encoded).not.toContain("<");
    // Still parses, so escaping did not corrupt the payload.
    expect(JSON.parse(encoded).note).toBe(ScriptBreakoutPayload);
    // U+2028/U+2029 terminate a JS string literal without terminating a JSON
    // one — the classic way an escaper that only handles `<` still breaks out.
    const withSeparators = "a b c";
    const separators = Serialization.escapeJsonForHtml(
      JSON.stringify({ note: withSeparators }),
    );
    expect(separators).not.toContain(" ");
    expect(separators).not.toContain(" ");
    expect(JSON.parse(separators).note).toBe(withSeparators);

    // NEGATIVE CONTROL: a benign value survives intact, so this is not
    // satisfied by an encoder that strips content it does not like.
    const benign = Serialization.encodeSync(
      Schema.Struct({ note: Schema.String }),
      { note: "ordinary note" },
    );
    expect(JSON.parse(benign).note).toBe("ordinary note");
  });

  it("keeps a `</script>` breakout out of the streamed deferred loader scripts", async () => {
    const Route = await fromSrc("Route", "streamDeferredLoaderScripts");
    const hostile = Route.streamDeferredLoaderScripts([
      {
        routeId: "items",
        params: {},
        result: { _tag: "Success", value: ScriptBreakoutPayload },
      },
    ]);
    const joined = hostile.join("");
    // The scripts legitimately open and close one `<script>` element each; what
    // must not appear is a *closing* tag inside the JSON payload, which is what
    // an odd number of closers would indicate.
    const openers = (joined.match(/<script/gi) ?? []).length;
    const closers = (joined.match(/<\/script/gi) ?? []).length;
    expect(closers).toBe(openers);
    expect(joined).not.toContain(ScriptBreakoutPayload);

    // NEGATIVE CONTROL: a benign entry still streams, and still carries its
    // value, so this is not satisfied by emitting nothing.
    const benign = Route.streamDeferredLoaderScripts([
      { routeId: "items", params: {}, result: { _tag: "Success", value: "ordinary" } },
    ]).join("");
    expect(benign).toContain("ordinary");
    expect(benign).toContain("<script");
  });
});

describe("[SEC/DQ-090] The generated-UI spec IR has no markup node kind", () => {
  it("rejects a `ui.html`-shaped node because the kind does not exist", async () => {
    // `DQ-090` is the strongest form of this guarantee available: not "raw
    // HTML is validated away" but "raw HTML is unrepresentable". Built as
    // `src/ViewSpec.ts` (names ratified by `DQ-094`).
    const { decodeSpec } = await fromSrc("ViewSpec", "decodeSpec");

    // A markup kind — whatever name a contributor might reach for — fails
    // with the IR's UNKNOWN-KIND refusal, the same one an outright typo
    // produces. A bespoke "html is forbidden" error would prove a validator
    // exists rather than that the kind does not.
    const kinds = ["ui.html", "afui.html", "ui.txet"];
    const errors: Array<string> = [];
    for (const kind of kinds) {
      const exit = await runPromiseExit(
        decodeSpec({ kind: "ui.viewTree", root: { kind, html: XssPayload } }),
      );
      expect(classifiedTag(exit)).toBe("ViewSpecDecodeError");
      if (Exit.isFailure(exit)) {
        errors.push(JSON.stringify(exit));
      }
    }
    // Same refusal shape for the markup kinds as for the typo…
    expect(errors[0]!.replace("ui.html", "X")).toBe(errors[2]!.replace("ui.txet", "X"));
    // …and the payload never travels back out through any of them.
    for (const serialized of errors) {
      expect(serialized).not.toContain("onerror");
    }

    // A text node carrying `html:` instead of `value:` fails the decode too
    // — the field is rejected, never silently stripped.
    const smuggled = await runPromiseExit(
      decodeSpec({ kind: "ui.viewTree", root: { kind: "ui.text", html: XssPayload } }),
    );
    expect(classifiedTag(smuggled)).toBe("ViewSpecDecodeError");

    // NEGATIVE CONTROL: a text node carrying markup as its VALUE decodes
    // cleanly — the payload is only ever text, never interpreted.
    const benign = await runPromiseExit(
      decodeSpec({ kind: "ui.viewTree", root: { kind: "ui.text", value: XssPayload } }),
    );
    expect(classifiedTag(benign)).toBe("success");
  });
});
