import type { CheerioAPI } from "cheerio";
import type { Issue } from "../types.js";

export function checkImageDimensions($: CheerioAPI): Issue[] {
  const offenders = $("img").toArray().filter((el) => {
    const hasWidth = !!$(el).attr("width");
    const hasHeight = !!$(el).attr("height");
    return !hasWidth && !hasHeight;
  });
  if (offenders.length === 0) return [];
  return [{
    code: "IMAGES_MISSING_DIMENSIONS",
    severity: "low",
    message: `${offenders.length} image(s) are missing explicit width/height attributes.`,
    recommendation: "Add width and height attributes so the browser can reserve layout space and avoid CLS.",
  }];
}

export function checkImageLazyLoading($: CheerioAPI): Issue[] {
  const offenders = $("img").toArray().filter((el) => !$(el).attr("loading"));
  if (offenders.length === 0) return [];
  return [{
    code: "IMAGES_MISSING_LAZY_LOADING",
    severity: "low",
    message: `${offenders.length} image(s) have no loading attribute (set loading="lazy" for below-the-fold images).`,
    recommendation: 'Add loading="lazy" to non-critical images to defer off-screen loading.',
  }];
}
