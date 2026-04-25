import { describe, it, expect } from "vitest";
import { parseJsonLd, validateProduct, validateArticle, validateFaq, validateBreadcrumb } from "../../src/checks/schema-checks.js";

describe("parseJsonLd", () => {
  it("parses a single object script", () => {
    const result = parseJsonLd([`{"@context":"https://schema.org","@type":"Product","name":"X"}`]);
    expect(result).toHaveLength(1);
    expect(result[0]["@type"]).toBe("Product");
  });

  it("parses an array script (multiple objects in one tag)", () => {
    const result = parseJsonLd([`[{"@type":"Product","name":"A"},{"@type":"Article","headline":"B"}]`]);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o["@type"]).sort()).toEqual(["Article", "Product"]);
  });

  it("walks @graph wrappers", () => {
    const result = parseJsonLd([
      `{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"X"},{"@type":"FAQPage"}]}`,
    ]);
    expect(result.map((o) => o["@type"]).sort()).toEqual(["FAQPage", "Product"]);
  });

  it("ignores invalid JSON without throwing", () => {
    expect(parseJsonLd([`{not json`, `{"@type":"Product"}`])).toHaveLength(1);
  });

  it("returns an empty array when no scripts contain valid objects", () => {
    expect(parseJsonLd([])).toEqual([]);
    expect(parseJsonLd(["null", "42"])).toEqual([]);
  });
});

describe("validateProduct", () => {
  it("flags missing offers", () => {
    const issues = validateProduct({ "@type": "Product", name: "X", image: "https://x/img.jpg" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_PRODUCT_MISSING_OFFERS");
  });

  it("flags offers without price/priceCurrency", () => {
    const issues = validateProduct({
      "@type": "Product",
      name: "X",
      image: "https://x/img.jpg",
      offers: { "@type": "Offer" },
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_PRODUCT_OFFERS_MISSING_PRICE");
  });

  it("returns empty for a complete Product", () => {
    expect(validateProduct({
      "@type": "Product",
      name: "X",
      image: "https://x/img.jpg",
      offers: { "@type": "Offer", price: "9.99", priceCurrency: "USD" },
    })).toEqual([]);
  });
});

describe("validateArticle", () => {
  it("flags missing datePublished", () => {
    const issues = validateArticle({
      "@type": "Article",
      headline: "X",
      image: "https://x/img.jpg",
      author: { name: "A" },
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_ARTICLE_MISSING_DATE_PUBLISHED");
  });

  it("flags missing author", () => {
    const issues = validateArticle({
      "@type": "Article",
      headline: "X",
      image: "https://x/img.jpg",
      datePublished: "2024-01-01",
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_ARTICLE_MISSING_AUTHOR");
  });

  it("returns empty for a complete Article", () => {
    expect(validateArticle({
      "@type": "Article",
      headline: "X",
      image: "https://x/img.jpg",
      datePublished: "2024-01-01",
      author: { name: "A" },
    })).toEqual([]);
  });
});

describe("validateFaq", () => {
  it("flags FAQPage with no mainEntity", () => {
    const issues = validateFaq({ "@type": "FAQPage" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_FAQ_NO_QUESTIONS");
  });

  it("flags Q&A entries missing question text or answer", () => {
    const issues = validateFaq({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "" },
        { "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "" } },
      ],
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("SCHEMA_FAQ_QUESTION_INCOMPLETE");
  });

  it("returns empty for a valid FAQ", () => {
    expect(validateFaq({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } },
      ],
    })).toEqual([]);
  });
});

describe("validateBreadcrumb", () => {
  it("flags missing itemListElement", () => {
    const issues = validateBreadcrumb({ "@type": "BreadcrumbList" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_BREADCRUMB_NO_ITEMS");
  });

  it("flags items missing position or name or item", () => {
    const issues = validateBreadcrumb({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home" },
      ],
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_BREADCRUMB_ITEM_INCOMPLETE");
  });

  it("accepts a valid breadcrumb", () => {
    expect(validateBreadcrumb({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://x.com/" },
        { "@type": "ListItem", position: 2, name: "Products", item: "https://x.com/p" },
      ],
    })).toEqual([]);
  });
});
