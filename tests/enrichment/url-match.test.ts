import { describe, it, expect } from "vitest";
import {
  canonicalizeForMatch,
  indexByCanonicalUrl,
  toggleTrailingSlash,
} from "../../src/enrichment/url-match.js";

describe("canonicalizeForMatch", () => {
  it("lowercases scheme and host but preserves path case", () => {
    expect(canonicalizeForMatch("HTTPS://EXAMPLE.com/Foo")).toBe("https://example.com/Foo");
  });

  it("drops the URL fragment", () => {
    expect(canonicalizeForMatch("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("drops common tracking parameters", () => {
    expect(
      canonicalizeForMatch("https://example.com/x?utm_source=newsletter&id=42&fbclid=abc"),
    ).toBe("https://example.com/x?id=42");
  });

  it("sorts remaining query parameters for stable matching", () => {
    expect(canonicalizeForMatch("https://example.com/x?b=2&a=1")).toBe(
      "https://example.com/x?a=1&b=2",
    );
  });

  it("drops default ports", () => {
    expect(canonicalizeForMatch("https://example.com:443/x")).toBe("https://example.com/x");
    expect(canonicalizeForMatch("http://example.com:80/x")).toBe("http://example.com/x");
  });

  it("returns the input verbatim when not a valid URL", () => {
    expect(canonicalizeForMatch("not a url")).toBe("not a url");
  });
});

describe("indexByCanonicalUrl", () => {
  it("inserts both canonical and trailing-slash-toggled forms", () => {
    const map = indexByCanonicalUrl([["https://example.com/blog/foo", { v: 1 }]]);
    expect(map.get("https://example.com/blog/foo")).toEqual({ v: 1 });
    expect(map.get("https://example.com/blog/foo/")).toEqual({ v: 1 });
  });

  it("does not toggle slash for the root path", () => {
    const map = indexByCanonicalUrl([["https://example.com/", { v: 1 }]]);
    expect(map.get("https://example.com/")).toEqual({ v: 1 });
    expect(map.size).toBe(1);
  });
});

describe("toggleTrailingSlash", () => {
  it("adds a trailing slash when absent", () => {
    expect(toggleTrailingSlash("https://example.com/foo")).toBe("https://example.com/foo/");
  });

  it("removes a trailing slash when present", () => {
    expect(toggleTrailingSlash("https://example.com/foo/")).toBe("https://example.com/foo");
  });

  it("returns null for the root path", () => {
    expect(toggleTrailingSlash("https://example.com/")).toBeNull();
  });
});
