import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { checkImageDimensions, checkImageLazyLoading, checkImageFormats } from "../../src/checks/image-checks.js";

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

describe("checkImageLazyLoading", () => {
  it("flags images without loading=lazy", () => {
    const $ = load(`<img src="a.jpg"><img src="b.jpg" loading="lazy">`);
    const issues = checkImageLazyLoading($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("IMAGES_MISSING_LAZY_LOADING");
  });

  it("does not flag when all images opt into lazy or eager loading", () => {
    const $ = load(`<img src="a.jpg" loading="lazy"><img src="b.jpg" loading="eager">`);
    expect(checkImageLazyLoading($)).toEqual([]);
  });
});

describe("checkImageFormats", () => {
  it("flags legacy formats (.jpg/.jpeg/.png/.gif)", () => {
    const $ = load(`<img src="/a.jpg"><img src="/b.webp"><img src="/c.PNG">`);
    const issues = checkImageFormats($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("IMAGES_LEGACY_FORMAT");
    expect(issues[0].message).toContain("2");
  });

  it("ignores non-image src values (data: URIs, missing src)", () => {
    const $ = load(`<img src="data:image/svg+xml;base64,PHN2Zy8+"><img>`);
    expect(checkImageFormats($)).toEqual([]);
  });

  it("does not flag webp/avif", () => {
    const $ = load(`<img src="/a.webp"><img src="/b.avif">`);
    expect(checkImageFormats($)).toEqual([]);
  });
});
