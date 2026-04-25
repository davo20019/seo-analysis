import { describe, it, expect } from "vitest";
import { countOccurrences } from "../src/keywords.js";

describe("countOccurrences", () => {
  it("counts non-overlapping case-insensitive matches", () => {
    expect(countOccurrences("SEO seo SEO", "seo")).toBe(3);
  });

  it("returns 0 when keyword is empty", () => {
    expect(countOccurrences("some text", "")).toBe(0);
  });

  it("returns 0 when keyword is not present", () => {
    expect(countOccurrences("hello world", "seo")).toBe(0);
  });
});
