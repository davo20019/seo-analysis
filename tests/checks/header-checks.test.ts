import { describe, it, expect } from "vitest";
import {
  checkContentEncoding,
  checkLinkCanonicalHeader,
  checkVaryAcceptEncoding,
  checkXRobotsTag,
  parseLinkHeader,
} from "../../src/checks/header-checks.js";

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

describe("parseLinkHeader", () => {
  it("parses a single link with rel", () => {
    const links = parseLinkHeader('<https://example.com/canonical>; rel="canonical"');
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com/canonical");
    expect(links[0].rel).toEqual(["canonical"]);
  });

  it("parses multiple comma-separated links", () => {
    const links = parseLinkHeader(
      '<https://example.com/a>; rel="canonical", <https://example.com/b>; rel="alternate"; hreflang="es"',
    );
    expect(links).toHaveLength(2);
    expect(links[0].rel).toEqual(["canonical"]);
    expect(links[1].rel).toEqual(["alternate"]);
    expect(links[1].params.hreflang).toBe("es");
  });

  it("returns an empty array for an empty header", () => {
    expect(parseLinkHeader(undefined)).toEqual([]);
    expect(parseLinkHeader("")).toEqual([]);
  });
});

describe("checkLinkCanonicalHeader", () => {
  it("flags a Link canonical that disagrees with the HTML canonical", () => {
    const issues = checkLinkCanonicalHeader(
      { link: '<https://example.com/header-canonical>; rel="canonical"' },
      "https://example.com/html-canonical",
      "https://example.com/page",
    );
    expect(issues.map((i) => i.code)).toContain("HEADER_LINK_CANONICAL_HTML_MISMATCH");
  });

  it("does not flag when both canonicals agree", () => {
    const issues = checkLinkCanonicalHeader(
      { link: '<https://example.com/canon>; rel="canonical"' },
      "https://example.com/canon",
      "https://example.com/page",
    );
    expect(issues).toEqual([]);
  });

  it("flags when multiple canonical Link values are advertised", () => {
    const issues = checkLinkCanonicalHeader(
      {
        link:
          '<https://example.com/a>; rel="canonical", <https://example.com/b>; rel="canonical"',
      },
      null,
      "https://example.com/page",
    );
    expect(issues.map((i) => i.code)).toContain("HEADER_LINK_CANONICAL_MULTIPLE");
  });

  it("returns no issues when no Link header is present", () => {
    expect(
      checkLinkCanonicalHeader({}, "https://example.com/canon", "https://example.com/page"),
    ).toEqual([]);
  });
});

describe("checkContentEncoding", () => {
  it("flags HTML responses without compression", () => {
    const issues = checkContentEncoding({}, "text/html; charset=utf-8");
    expect(issues.map((i) => i.code)).toContain("HEADER_CONTENT_ENCODING_MISSING");
  });

  it("does not flag HTML responses with gzip", () => {
    const issues = checkContentEncoding({ "content-encoding": "gzip" }, "text/html");
    expect(issues).toEqual([]);
  });

  it("does not flag non-HTML responses", () => {
    expect(checkContentEncoding({}, "application/json")).toEqual([]);
    expect(checkContentEncoding({}, null)).toEqual([]);
  });

  it("treats `identity` as missing compression", () => {
    const issues = checkContentEncoding({ "content-encoding": "identity" }, "text/html");
    expect(issues.map((i) => i.code)).toContain("HEADER_CONTENT_ENCODING_MISSING");
  });
});

describe("checkVaryAcceptEncoding", () => {
  it("flags compressed responses without Vary: Accept-Encoding", () => {
    const issues = checkVaryAcceptEncoding({ "content-encoding": "br" });
    expect(issues.map((i) => i.code)).toContain("HEADER_VARY_ACCEPT_ENCODING_MISSING");
  });

  it("does not flag when Vary includes Accept-Encoding", () => {
    expect(
      checkVaryAcceptEncoding({ "content-encoding": "gzip", vary: "Accept-Encoding" }),
    ).toEqual([]);
  });

  it("does not flag when Vary is `*`", () => {
    expect(checkVaryAcceptEncoding({ "content-encoding": "br", vary: "*" })).toEqual([]);
  });

  it("does not flag uncompressed responses", () => {
    expect(checkVaryAcceptEncoding({})).toEqual([]);
  });
});

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
