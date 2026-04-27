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
