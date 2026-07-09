import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { createRoot } from "../api.js";
import * as Form from "../Form.js";

describe("Form", () => {
  it("resets an explicit undefined value as a new baseline", () => {
    const field = Form.field<string | undefined>("initial");

    field.set("changed");
    field.reset(undefined);

    expect(field.value()).toBeUndefined();
    expect(field.dirty()).toBe(false);

    field.set("changed-again");
    field.reset();

    expect(field.value()).toBeUndefined();
    expect(field.dirty()).toBe(false);
  });

  it("tracks field dirty/touched and validates schema on submit", async () => {
    let submitted: string | undefined;
    const dispose = createRoot((d) => {
      const form = Form.make(
        {
          title: { schema: Schema.String, initial: "" },
        },
        {
          name: "todo-form",
          onSubmit: (values) =>
            Effect.sync(() => {
              submitted = values.title;
            }),
        },
      );

      expect(form.dirty()).toBe(false);
      form.fields.title.set("hi");
      expect(form.dirty()).toBe(true);
      form.fields.title.touch();
      expect(form.touched()).toBe(true);

      const ok = Effect.runSync(form.validate());
      expect(ok.title).toBe("hi");

      form.submit.run(undefined);
      return d;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(submitted).toBe("hi");
    dispose();
  });

  it("applies server errors onto fields", () => {
    const dispose = createRoot((d) => {
      const form = Form.make(
        { email: { schema: Schema.String, initial: "a@b.c" } },
        { onSubmit: () => Effect.void },
      );
      Form.applyServerErrors(form, { email: "taken" });
      expect(form.fields.email.error()).toBe("taken");
      expect(form.fields.email.touched()).toBe(true);
      return d;
    });
    dispose();
  });

  it("supports optimistic update + rollback on submit failure", async () => {
    const overlay: string[] = [];
    const dispose = createRoot((d) => {
      const form = Form.make(
        { title: { schema: Schema.String, initial: "old" } },
        {
          name: "optimistic-form",
          onSubmit: () => Effect.fail("boom" as const),
          optimistic: (values) => {
            overlay.push(values.title);
          },
          rollback: () => {
            overlay.push("rolled-back");
          },
        },
      );
      form.fields.title.set("new");
      form.submit.run();
      return d;
    });

    await new Promise((r) => setTimeout(r, 40));
    expect(overlay[0]).toBe("new");
    expect(overlay).toContain("rolled-back");
    dispose();
  });

  it("accepts singleFlight options on submit (action path)", async () => {
    let ran = 0;
    const dispose = createRoot((d) => {
      const form = Form.make(
        { title: { schema: Schema.String, initial: "x" } },
        {
          name: "sf-form",
          // auto mode without transport falls through to local effect
          singleFlight: { mode: "auto" },
          onSubmit: () =>
            Effect.sync(() => {
              ran += 1;
            }),
        },
      );
      form.submit.run();
      return d;
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(ran).toBe(1);
    dispose();
  });
});
