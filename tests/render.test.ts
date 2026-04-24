import { describe, it, expect } from "vitest";
import { renderPage } from "../src/render.js";

describe("renderPage", () => {
  it("is exported as an async function", () => {
    expect(typeof renderPage).toBe("function");
    expect(renderPage.constructor.name).toBe("AsyncFunction");
  });
});
