import { describe, it, expect } from "vitest";
import { extractHeaderMap } from "../src/analyzer.js";

describe("extractHeaderMap", () => {
  it("lowercases header names and returns a plain object", () => {
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    });
    expect(extractHeaderMap(headers)).toEqual({
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    });
  });

  it("returns an empty object for empty headers", () => {
    expect(extractHeaderMap(new Headers())).toEqual({});
  });
});
