import { describe, it, expect } from "vitest";
import { checkXRobotsTag } from "../../src/checks/header-checks.js";

describe("checkXRobotsTag", () => {
  it("flags noindex in X-Robots-Tag", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "noindex" });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("HEADER_X_ROBOTS_NOINDEX");
    expect(issues[0].severity).toBe("high");
  });

  it("flags nofollow in X-Robots-Tag", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "nofollow" });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("HEADER_X_ROBOTS_NOFOLLOW");
  });

  it("parses comma-separated directives", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "noindex, nofollow" });
    expect(issues.map((i) => i.code).sort()).toEqual([
      "HEADER_X_ROBOTS_NOFOLLOW",
      "HEADER_X_ROBOTS_NOINDEX",
    ]);
  });

  it("ignores googlebot-scoped directives by default", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "googlebot: noindex" });
    expect(issues).toEqual([]);
  });

  it("returns no issues when header is absent", () => {
    expect(checkXRobotsTag({})).toEqual([]);
  });
});

import { checkResponseHeaders } from "../../src/checks/header-checks.js";

describe("checkResponseHeaders", () => {
  it("flags missing HSTS on HTTPS", () => {
    const issues = checkResponseHeaders("https://example.com/", { "content-type": "text/html" });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("HEADER_HSTS_MISSING");
  });

  it("does not flag HSTS on HTTP", () => {
    const issues = checkResponseHeaders("http://example.com/", { "content-type": "text/html" });
    expect(issues.map((i) => i.code)).not.toContain("HEADER_HSTS_MISSING");
  });

  it("flags missing content-type", () => {
    const issues = checkResponseHeaders("https://example.com/", { "strict-transport-security": "max-age=31536000" });
    expect(issues.map((i) => i.code)).toContain("HEADER_CONTENT_TYPE_MISSING");
  });

  it("flags no-cache for HTML but allows aggressive caching", () => {
    const issues = checkResponseHeaders("https://example.com/", {
      "content-type": "text/html",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "strict-transport-security": "max-age=31536000",
    });
    expect(issues.map((i) => i.code)).toContain("HEADER_CACHE_CONTROL_AGGRESSIVE_NOCACHE");
  });

  it("returns empty when all headers are healthy", () => {
    const issues = checkResponseHeaders("https://example.com/", {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
    });
    expect(issues).toEqual([]);
  });
});
