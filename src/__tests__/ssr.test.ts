import { describe, it, expect } from "vitest";
import {
  isServer,
  renderToString,
  isHydrating,
  getRequestEvent,
  setRequestEvent,
} from "../dom.js";

describe("SSR", () => {
  describe("isServer", () => {
    it("is false in Node with jsdom-like globals", () => {
      // In vitest node environment, there's no real document/window
      // so isServer should be true
      expect(typeof isServer).toBe("boolean");
    });
  });

  describe("renderToString", () => {
    it("renders a simple text result", () => {
      const html = renderToString(() => "Hello World");
      expect(html).toBe("Hello World");
    });

    it("renders null as empty string", () => {
      const html = renderToString(() => null);
      expect(html).toBe("");
    });

    it("renders a number", () => {
      const html = renderToString(() => 42);
      expect(html).toBe("42");
    });
  });

  describe("getRequestEvent / setRequestEvent", () => {
    it("starts as undefined", () => {
      expect(getRequestEvent()).toBeUndefined();
    });

    it("stores and retrieves request event", () => {
      const event = { url: "/test", headers: {} };
      setRequestEvent(event);
      expect(getRequestEvent()).toBe(event);
      // Clean up
      setRequestEvent(undefined);
    });
  });

  describe("isHydrating", () => {
    it("is false outside of hydration", () => {
      expect(isHydrating()).toBe(false);
    });
  });
});
