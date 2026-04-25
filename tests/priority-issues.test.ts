import { describe, it, expect } from "vitest";
import type { PageReport } from "../src/types.js";
import { buildPriorityIssues } from "../src/analyzer.js";

function makePage(url: string, opts: {
  issues?: PageReport["issues"];
  metrics?: PageReport["metrics"];
} = {}): PageReport {
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    redirectChain: [],
    discoveredLinks: [],
    checks: {
      title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0,
      canonical: null, htmlLang: null, expectedLocale: null, hreflang: [],
      robotsMeta: null, h1s: [], wordCount: 0, imagesTotal: 0, imagesMissingAlt: 0,
      internalLinks: 0, incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0, internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0, inSitemap: false,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: [], bodyText: null,
    },
    issues: opts.issues ?? [],
    metrics: opts.metrics,
  };
}

describe("buildPriorityIssues", () => {
  it("ranks GSC pages by impressions when GSC metrics are present", () => {
    const pages = [
      makePage("https://example.com/a", {
        issues: [{ code: "TITLE_MISSING", severity: "high", message: "x", recommendation: "y" }],
        metrics: { gsc: { clicks: 0, impressions: 50, ctr: 0, position: 22 } },
      }),
      makePage("https://example.com/b", {
        issues: [{ code: "TITLE_MISSING", severity: "high", message: "x", recommendation: "y" }],
        metrics: { gsc: { clicks: 0, impressions: 200, ctr: 0, position: 18 } },
      }),
    ];
    const result = buildPriorityIssues(pages);
    expect(result[0].url).toBe("https://example.com/b");
    expect(result[0].rankedBy).toBe("gsc");
    expect(result[0].rankValue).toBe(200);
    // backwards-compat fields populated
    expect(result[0].impressions).toBe(200);
    expect(result[0].clicks).toBe(0);
  });

  it("falls back to GA4 sessions when GSC is absent", () => {
    const pages = [
      makePage("https://example.com/a", {
        issues: [{ code: "TITLE_MISSING", severity: "high", message: "x", recommendation: "y" }],
        metrics: { ga4: { sessions: 100, screenPageViews: 200, totalUsers: 80, engagementRate: 0.6 } },
      }),
    ];
    const result = buildPriorityIssues(pages);
    expect(result).toHaveLength(1);
    expect(result[0].rankedBy).toBe("ga4");
    expect(result[0].rankValue).toBe(100);
  });

  it("prefers GSC when both GSC and GA4 are present", () => {
    const pages = [
      makePage("https://example.com/a", {
        issues: [{ code: "TITLE_MISSING", severity: "high", message: "x", recommendation: "y" }],
        metrics: {
          gsc: { clicks: 0, impressions: 500, ctr: 0, position: 18 },
          ga4: { sessions: 50, screenPageViews: 100, totalUsers: 40, engagementRate: 0.5 },
        },
      }),
    ];
    const result = buildPriorityIssues(pages);
    expect(result[0].rankedBy).toBe("gsc");
    expect(result[0].rankValue).toBe(500);
  });

  it("skips pages with neither metrics nor positive impressions/sessions", () => {
    const pages = [
      makePage("https://example.com/a", {
        issues: [{ code: "TITLE_MISSING", severity: "high", message: "x", recommendation: "y" }],
        metrics: { gsc: { clicks: 0, impressions: 0, ctr: 0, position: 0 } },
      }),
      makePage("https://example.com/b", {
        issues: [{ code: "TITLE_MISSING", severity: "high", message: "x", recommendation: "y" }],
      }),
    ];
    const result = buildPriorityIssues(pages);
    expect(result).toHaveLength(0);
  });
});
