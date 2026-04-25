import { describe, it, expect } from "vitest";
import { renderPage, renderPageWithRetry } from "../src/render.js";
import type { BrowserContext } from "playwright";

describe("renderPage", () => {
  it("is exported as an async function", () => {
    expect(typeof renderPage).toBe("function");
    expect(renderPage.constructor.name).toBe("AsyncFunction");
  });
});

describe("renderPageWithRetry", () => {
  const fakeContext = {} as BrowserContext;
  const goodResult = {
    contentType: "text/html",
    finalUrl: "https://x/",
    redirectChain: [],
    status: 200,
    text: "<html></html>",
    headers: { "content-type": "text/html" },
  };

  it("returns immediately on success", async () => {
    let calls = 0;
    const renderImpl = async () => {
      calls++;
      return goodResult;
    };
    const result = await renderPageWithRetry(
      "https://x/",
      { timeoutMs: 1000, userAgent: "x" },
      fakeContext,
      3,
      renderImpl,
    );
    expect(result).toEqual(goodResult);
    expect(calls).toBe(1);
  });

  it("retries on thrown errors and eventually succeeds", async () => {
    let calls = 0;
    const renderImpl = async () => {
      calls++;
      if (calls < 3) throw new Error("timeout");
      return goodResult;
    };
    const result = await renderPageWithRetry(
      "https://x/",
      { timeoutMs: 1000, userAgent: "x" },
      fakeContext,
      3,
      renderImpl,
    );
    expect(result).toEqual(goodResult);
    expect(calls).toBe(3);
  });

  it("throws if all retries are exhausted", async () => {
    let calls = 0;
    const renderImpl = async () => {
      calls++;
      throw new Error("persistent failure");
    };
    await expect(
      renderPageWithRetry(
        "https://x/",
        { timeoutMs: 1000, userAgent: "x" },
        fakeContext,
        2,
        renderImpl,
      ),
    ).rejects.toThrow("persistent failure");
    expect(calls).toBe(3);
  });

  it("does not retry on a successful render with non-2xx status (status is a final answer)", async () => {
    let calls = 0;
    const errResult = { ...goodResult, status: 500 };
    const renderImpl = async () => {
      calls++;
      return errResult;
    };
    const result = await renderPageWithRetry(
      "https://x/",
      { timeoutMs: 1000, userAgent: "x" },
      fakeContext,
      3,
      renderImpl,
    );
    expect(result.status).toBe(500);
    expect(calls).toBe(1);
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
