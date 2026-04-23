import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { checkImageDimensions } from "../../src/checks/image-checks.js";

describe("checkImageDimensions", () => {
  it("flags images missing both width and height", () => {
    const $ = load(`<html><body>
      <img src="a.jpg">
      <img src="b.jpg" width="100" height="50">
    </body></html>`);
    const issues = checkImageDimensions($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("IMAGES_MISSING_DIMENSIONS");
    expect(issues[0].severity).toBe("low");
  });

  it("returns no issues when every image has dimensions", () => {
    const $ = load(`<img src="a.jpg" width="1" height="1">`);
    expect(checkImageDimensions($)).toEqual([]);
  });

  it("returns no issues when there are no images", () => {
    const $ = load(`<html><body><p>no images</p></body></html>`);
    expect(checkImageDimensions($)).toEqual([]);
  });
});
