import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { checkViewportMeta } from "../../src/checks/mobile-checks.js";

describe("checkViewportMeta", () => {
  it("flags pages with no viewport meta", () => {
    const $ = load(`<html><head></head></html>`);
    const issues = checkViewportMeta($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MOBILE_VIEWPORT_MISSING");
    expect(issues[0].severity).toBe("medium");
  });

  it("flags viewport meta without width=device-width", () => {
    const $ = load(`<meta name="viewport" content="initial-scale=1">`);
    const issues = checkViewportMeta($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MOBILE_VIEWPORT_WEAK");
  });

  it("flags viewport that locks user-scalable", () => {
    const $ = load(`<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`);
    const issues = checkViewportMeta($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MOBILE_VIEWPORT_LOCKS_ZOOM");
    expect(issues[0].severity).toBe("medium");
  });

  it("accepts a standard responsive viewport", () => {
    const $ = load(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
    expect(checkViewportMeta($)).toEqual([]);
  });
});
