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
