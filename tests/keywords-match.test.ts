import { describe, it, expect } from "vitest";
import { matchKeywordsOnPage, type PageTextContent } from "../src/keywords.js";

describe("matchKeywordsOnPage", () => {
  it("counts occurrences per location and totals them", () => {
    const content: PageTextContent = {
      title: "SEO guide",
      metaDescription: "A short SEO description",
      h1Text: "SEO",
      bodyText: "SEO is about SEO fundamentals.",
    };

    const result = matchKeywordsOnPage(["seo"], content);

    expect(result).toEqual([
      {
        keyword: "seo",
        locations: { title: 1, h1: 1, metaDescription: 1, body: 2 },
        totalOccurrences: 5,
      },
    ]);
  });

  it("returns zero counts for a keyword that does not appear", () => {
    const content: PageTextContent = {
      title: "About us",
      metaDescription: "Company profile",
      h1Text: "About",
      bodyText: "We are a company.",
    };

    const result = matchKeywordsOnPage(["seo"], content);

    expect(result).toEqual([
      {
        keyword: "seo",
        locations: { title: 0, h1: 0, metaDescription: 0, body: 0 },
        totalOccurrences: 0,
      },
    ]);
  });
});
