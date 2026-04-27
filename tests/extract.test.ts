import { describe, expect, it } from "vitest";
import { parseSelectorGrammar } from "../src/extract.js";

describe("parseSelectorGrammar", () => {
  it("returns selector only for plain text grammar", () => {
    expect(parseSelectorGrammar("h1")).toEqual({ selector: "h1" });
    expect(parseSelectorGrammar(".product .price")).toEqual({ selector: ".product .price" });
  });

  it("parses @attr suffix", () => {
    expect(parseSelectorGrammar("meta[name=author]@content")).toEqual({
      selector: "meta[name=author]",
      attr: "content"
    });
  });

  it("ignores @ and # inside attribute selector brackets", () => {
    expect(parseSelectorGrammar('a[href$=".pdf"]@href')).toEqual({
      selector: 'a[href$=".pdf"]',
      attr: "href"
    });
    expect(parseSelectorGrammar('a[href*="#section"]')).toEqual({
      selector: 'a[href*="#section"]'
    });
  });

  it("parses #html suffix", () => {
    expect(parseSelectorGrammar("article > p:first-of-type#html")).toEqual({
      selector: "article > p:first-of-type",
      html: true
    });
  });

  it("preserves hyphens and dots in attribute names", () => {
    expect(parseSelectorGrammar("div@data-product-id")).toEqual({
      selector: "div",
      attr: "data-product-id"
    });
  });

  it("rejects empty attribute name", () => {
    expect(() => parseSelectorGrammar("div@")).toThrow(/empty attribute name/);
  });

  it("rejects unsupported # suffix", () => {
    expect(() => parseSelectorGrammar("div#text")).toThrow(/Unsupported "#" suffix/);
  });

  it("rejects combined @attr and #html", () => {
    expect(() => parseSelectorGrammar("a@href#html")).toThrow(/Cannot combine/);
  });

  it("rejects empty selector before suffix", () => {
    expect(() => parseSelectorGrammar("@href")).toThrow(/empty/);
  });
});

import { parseExtractionRules } from "../src/extract.js";

describe("parseExtractionRules", () => {
  it("returns empty object for null/undefined/empty", () => {
    expect(parseExtractionRules(null)).toEqual({});
    expect(parseExtractionRules(undefined)).toEqual({});
    expect(parseExtractionRules({})).toEqual({});
  });

  it("normalizes string shorthand", () => {
    const out = parseExtractionRules({ h1: "h1", price: "[itemprop=price]@content" });
    expect(out).toEqual({
      h1: { selector: "h1" },
      price: { selector: "[itemprop=price]", attr: "content" }
    });
  });

  it("accepts a JSON string at the top level", () => {
    const out = parseExtractionRules('{"h1":"h1"}');
    expect(out).toEqual({ h1: { selector: "h1" } });
  });

  it("normalizes object form with all + required", () => {
    const out = parseExtractionRules({
      faqQuestions: { selector: ".faq h3", all: true },
      title: { selector: "title", required: true }
    });
    expect(out).toEqual({
      faqQuestions: { selector: ".faq h3", all: true },
      title: { selector: "title", required: true }
    });
  });

  it("merges grammar with object-form flags", () => {
    const out = parseExtractionRules({
      images: { selector: "img@src", all: true }
    });
    expect(out).toEqual({
      images: { selector: "img", attr: "src", all: true }
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseExtractionRules(42)).toThrow(/must be a JSON object/);
    expect(() => parseExtractionRules([1, 2])).toThrow(/must be a JSON object/);
  });

  it("rejects invalid JSON string", () => {
    expect(() => parseExtractionRules("{ not json")).toThrow(/Invalid extraction JSON/);
  });

  it("rejects invalid field names", () => {
    expect(() => parseExtractionRules({ "my.field": "h1" })).toThrow(/Invalid extraction field name/);
    expect(() => parseExtractionRules({ "price tag": "h1" })).toThrow(/Invalid extraction field name/);
    expect(() => parseExtractionRules({ "1abc": "h1" })).toThrow(/Invalid extraction field name/);
  });

  it("rejects object form missing selector", () => {
    expect(() => parseExtractionRules({ x: { all: true } })).toThrow(/missing string "selector"/);
  });

  it("rejects non-string-non-object values", () => {
    expect(() => parseExtractionRules({ x: 42 })).toThrow(/must be a string or object/);
    expect(() => parseExtractionRules({ x: null })).toThrow(/must be a string or object/);
  });
});
