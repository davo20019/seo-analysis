import { describe, it, expect } from "vitest";
import { diffSiteReports } from "../src/diff.js";
import type { SiteReport } from "../src/types.js";

function fixture(overrides: Partial<SiteReport>): SiteReport {
  const base: SiteReport = {
    startUrl: "https://x/",
    infrastructure: {
      robotsTxt: { url: "", present: true, status: 200, sitemaps: [], blocksAllCrawlers: false },
      sitemap: { url: "", present: true, status: 200, urlCount: 0, knownUrls: 0, coverageLimited: false, isIndex: false },
      llmsTxt: { url: "", present: false, status: 404, isEmpty: false },
      issues: [],
    },
    summary: {
      crawledPages: 0,
      issueTotals: { high: 0, medium: 0, low: 0 },
      pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 0,
      internalLinksChecked: 0, pagesWithBrokenInternalLinks: 0, pagesWithRedirectingInternalLinks: 0,
      pagesWithAnchorTextIssues: 0, pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
      pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
      topIssues: [], duplicateTitles: [], duplicateMetaDescriptions: [],
    },
    pages: [], lighthouse: [],
  };
  return { ...base, ...overrides };
}

function page(url: string, status: number, codes: string[] = []) {
  return {
    url, finalUrl: url, status, contentType: "text/html",
    redirectChain: [],
    checks: {
      title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0,
      canonical: null, htmlLang: null, expectedLocale: null, hreflang: [],
      robotsMeta: null, h1s: [], wordCount: 0,
      imagesTotal: 0, imagesMissingAlt: 0,
      internalLinks: 0, incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0, internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0, inSitemap: true,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: [], bodyText: null,
    },
    issues: codes.map((code) => ({ code, severity: "medium" as const, message: "", recommendation: "" })),
    discoveredLinks: [],
  };
}

describe("diffSiteReports", () => {
  it("detects added and removed pages", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200), page("https://x/b", 200)] });
    const newR = fixture({ pages: [page("https://x/a", 200), page("https://x/c", 200)] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.pageSet.added).toEqual(["https://x/c"]);
    expect(diff.pageSet.removed).toEqual(["https://x/b"]);
    expect(diff.pageSet.common).toBe(1);
  });

  it("detects new and resolved issue codes", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200, ["TITLE_MISSING"])] });
    const newR = fixture({ pages: [page("https://x/a", 200, ["IMAGES_MISSING_ALT"])] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.issuesByCode.new.map((d) => d.code)).toEqual(["IMAGES_MISSING_ALT"]);
    expect(diff.issuesByCode.resolved.map((d) => d.code)).toEqual(["TITLE_MISSING"]);
  });

  it("detects increased and decreased counts", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200, ["X"]), page("https://x/b", 200, ["Y", "Y"])] });
    const newR = fixture({ pages: [page("https://x/a", 200, ["X", "X", "X"]), page("https://x/b", 200, ["Y"])] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.issuesByCode.increased.map((d) => d.code)).toEqual(["X"]);
    expect(diff.issuesByCode.decreased.map((d) => d.code)).toEqual(["Y"]);
  });

  it("computes severity deltas from summaries", () => {
    const oldR = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 3, medium: 5, low: 10 } } });
    const newR = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 4, low: 10 } } });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.severityDelta).toEqual({ high: 2, medium: -1, low: 0 });
  });

  it("detects status code changes on common pages", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200), page("https://x/b", 200)] });
    const newR = fixture({ pages: [page("https://x/a", 404), page("https://x/b", 200)] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.statusChanges).toEqual([{ url: "https://x/a", oldStatus: 200, newStatus: 404 }]);
  });

  it("returns empty deltas for identical reports", () => {
    const sameR = fixture({ pages: [page("https://x/a", 200, ["X"])] });
    const diff = diffSiteReports(sameR, sameR);
    expect(diff.issuesByCode.new).toEqual([]);
    expect(diff.issuesByCode.resolved).toEqual([]);
    expect(diff.issuesByCode.increased).toEqual([]);
    expect(diff.issuesByCode.decreased).toEqual([]);
    expect(diff.pageSet.added).toEqual([]);
    expect(diff.pageSet.removed).toEqual([]);
    expect(diff.statusChanges).toEqual([]);
  });
});

import { renderDiffText, renderDiffJson } from "../src/diff.js";

describe("renderDiffText", () => {
  it("highlights regressions with - and improvements with +", () => {
    const oldR = fixture({
      pages: [page("https://x/a", 200, ["FOO"])],
      summary: { ...fixture({}).summary, issueTotals: { high: 1, medium: 0, low: 0 } },
    });
    const newR = fixture({
      pages: [page("https://x/a", 200, ["FOO", "FOO", "BAR"])],
      summary: { ...fixture({}).summary, issueTotals: { high: 3, medium: 0, low: 0 } },
    });
    const diff = diffSiteReports(oldR, newR);
    const text = renderDiffText(diff);
    expect(text).toContain("New issues");
    expect(text).toContain("BAR");
    expect(text).toContain("Increased");
    expect(text).toContain("FOO");
    expect(text).toContain("high: +2");
  });

  it("reports a healthy diff cleanly", () => {
    const sameR = fixture({});
    const diff = diffSiteReports(sameR, sameR);
    const text = renderDiffText(diff);
    expect(text).toContain("No regressions");
  });
});

describe("renderDiffJson", () => {
  it("returns a valid JSON string round-trippable to the diff", () => {
    const oldR = fixture({});
    const newR = fixture({ pages: [page("https://x/new", 200)] });
    const diff = diffSiteReports(oldR, newR);
    const json = renderDiffJson(diff);
    expect(JSON.parse(json)).toEqual(diff);
  });
});

import { evaluateFailOn } from "../src/diff.js";

describe("evaluateFailOn", () => {
  it("does not fail when previous is null (first run)", () => {
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, null, "high");
    expect(decision.shouldFail).toBe(false);
    expect(decision.reason).toMatch(/skipping/i);
    expect(decision.delta).toBe(0);
  });

  it("does not fail when severity delta is zero", () => {
    const previous = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 2, medium: 0, low: 0 } } });
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 2, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, previous, "high");
    expect(decision.shouldFail).toBe(false);
    expect(decision.delta).toBe(0);
  });

  it("fails when severity delta is positive (regression)", () => {
    const previous = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 2, medium: 0, low: 0 } } });
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, previous, "high");
    expect(decision.shouldFail).toBe(true);
    expect(decision.delta).toBe(3);
    expect(decision.reason).toMatch(/3 more high/i);
  });

  it("does not fail when severity delta is negative (improvement)", () => {
    const previous = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 0, low: 0 } } });
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 3, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, previous, "high");
    expect(decision.shouldFail).toBe(false);
    expect(decision.delta).toBe(-2);
  });
});
