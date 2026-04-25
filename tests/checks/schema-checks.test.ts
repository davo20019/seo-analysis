import { describe, it, expect } from "vitest";
import { parseJsonLd } from "../../src/checks/schema-checks.js";

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
