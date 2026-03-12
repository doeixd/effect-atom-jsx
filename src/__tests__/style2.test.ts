import { describe, expect, it } from "vitest";
import * as Style from "../Style.js";

describe("Style2 advanced descriptors", () => {
  it("builds selector helpers and nest nodes", () => {
    const selector = Style.child("a", "hover");
    expect(selector).toBe("> a:hover");

    const style = Style.make({
      root: Style.compose(
        Style.slot({ backgroundColor: "surface" }),
        Style.nest({
          [Style.child("a")]: { color: "text.link" },
          [Style.attr("data-active")]: { fontWeight: "bold" },
        }),
      ),
    });

    expect(style.slots.root).toBeDefined();
  });

  it("supports vars, media, supports, and container descriptors", () => {
    const style = Style.compose(
      Style.vars({ "--card-padding": "md" }),
      Style.media({ "(max-width: 600px)": Style.slot({ padding: "sm" }) }),
      Style.supports({ "(display: grid)": Style.slot({ display: "grid" }) }),
      Style.containerQuery("card", { "(max-width: 400px)": Style.slot({ padding: "xs" }) }),
      Style.containerType("card", "inline-size"),
    );

    expect(Array.isArray(style)).toBe(true);
  });

  it("supports keyframes, animate, lifecycle and grid descriptors", () => {
    const fadeIn = Style.keyframes("fadeIn", {
      from: { opacity: 0 },
      to: { opacity: 1 },
    });
    const anim = Style.animate(fadeIn, { duration: "normal" });
    const grid = Style.grid({
      template: {
        columns: ["1fr", "1fr"],
        rows: ["auto", "1fr"],
        areas: [["header", "header"], ["content", "aside"]] as const,
      },
    });

    const style = Style.compose(
      Style.enter(anim),
      Style.exit(anim),
      Style.enterStagger({ delay: (i) => i * 25, animation: anim }),
      Style.layoutAnimation({ duration: "normal" }),
      grid,
    );

    expect(Array.isArray(style)).toBe(true);
  });
});
