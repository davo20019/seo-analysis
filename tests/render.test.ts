import { describe, it, expect } from "vitest";
import { renderPage } from "../src/render.js";

describe("renderPage", () => {
  it("is exported as an async function", () => {
    expect(typeof renderPage).toBe("function");
    expect(renderPage.constructor.name).toBe("AsyncFunction");
  });
});

import { chromium } from "playwright";

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === "1";
const maybeDescribe = RUN_BROWSER_TESTS ? describe : describe.skip;

maybeDescribe("renderPage (integration)", () => {
  it("renders example.com and returns populated FetchResult", async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    try {
      const result = await renderPage(
        "https://example.com/",
        { timeoutMs: 30000, userAgent: "Mozilla/5.0 (test)" },
        context,
      );
      expect(result.status).toBe(200);
      expect(result.finalUrl).toMatch(/example\.com/);
      expect(result.text).toContain("<html");
      expect(result.headers["content-type"]).toMatch(/text\/html/i);
      expect(result.contentType).toMatch(/text\/html/i);
    } finally {
      await browser.close();
    }
  }, 60000);
});
