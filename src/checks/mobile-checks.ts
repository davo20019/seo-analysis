import type { CheerioAPI } from "cheerio";
import type { Issue } from "../types.js";

export function checkViewportMeta($: CheerioAPI): Issue[] {
  const content = $('meta[name="viewport"]').attr("content");

  if (!content) {
    return [{
      code: "MOBILE_VIEWPORT_MISSING",
      severity: "medium",
      message: "Page has no viewport meta tag — mobile browsers will render at desktop width.",
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
    }];
  }

  const normalized = content.toLowerCase().replace(/\s+/g, "");
  const issues: Issue[] = [];

  if (!normalized.includes("width=device-width")) {
    issues.push({
      code: "MOBILE_VIEWPORT_WEAK",
      severity: "medium",
      message: "Viewport meta is missing width=device-width — page will not scale to the device.",
      recommendation: 'Use content="width=device-width, initial-scale=1".',
    });
  }

  if (normalized.includes("user-scalable=no") || normalized.includes("maximum-scale=1")) {
    issues.push({
      code: "MOBILE_VIEWPORT_LOCKS_ZOOM",
      severity: "medium",
      message: "Viewport disables zoom, which is an accessibility problem (WCAG 1.4.4).",
      recommendation: "Remove user-scalable=no and maximum-scale to let users zoom.",
    });
  }

  return issues;
}
