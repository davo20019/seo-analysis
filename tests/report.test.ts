import { describe, it, expect } from "vitest";
import { renderHtmlReport, escapeHtml, renderPdfReport } from "../src/report.js";
import type { SiteReport } from "../src/types.js";

const minimalReport: SiteReport = {
  startUrl: "https://example.com/",
  infrastructure: {
    robotsTxt: { url: "https://example.com/robots.txt", present: true, status: 200, sitemaps: [], blocksAllCrawlers: false },
    sitemap: { url: "https://example.com/sitemap.xml", present: true, status: 200, urlCount: 5, knownUrls: 5, coverageLimited: false, isIndex: false },
    llmsTxt: { url: "https://example.com/llms.txt", present: false, status: 404, isEmpty: false },
    issues: [
      { code: "ROBOTS_NO_SITEMAP", severity: "low", message: "robots.txt does not list a sitemap.", recommendation: "Declare the sitemap in robots.txt." },
    ],
  },
  summary: {
    crawledPages: 2,
    issueTotals: { high: 1, medium: 2, low: 3 },
    pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 1,
    internalLinksChecked: 10, pagesWithBrokenInternalLinks: 0, pagesWithRedirectingInternalLinks: 0,
    pagesWithAnchorTextIssues: 0, pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
    pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
    topIssues: [
      { code: "META_DESCRIPTION_MISSING", count: 1 },
      { code: "IMAGES_MISSING_LAZY_LOADING", count: 2 },
    ],
    duplicateTitles: [], duplicateMetaDescriptions: [],
  },
  pages: [
    {
      url: "https://example.com/", finalUrl: "https://example.com/", status: 200, contentType: "text/html",
      redirectChain: [],
      checks: {
        title: "Hello", titleLength: 5, metaDescription: null, metaDescriptionLength: 0,
        canonical: null, htmlLang: "en", expectedLocale: null, hreflang: [],
        robotsMeta: null, h1s: ["Hello"], wordCount: 100,
        imagesTotal: 1, imagesMissingAlt: 0,
        internalLinks: 1, incomingInternalLinks: 0,
        internalLinksWithoutAnchorText: 0, internalLinksWithNonDescriptiveAnchorText: 0,
        externalLinks: 0, inSitemap: true,
        openGraph: { title: null, description: null, image: null },
        schemaTypes: [], bodyText: "Hello world",
      },
      issues: [
        { code: "META_DESCRIPTION_MISSING", severity: "high", message: "No meta description.", recommendation: "Add one." },
      ],
      discoveredLinks: [],
    },
  ],
  lighthouse: [],
};

describe("escapeHtml", () => {
  it("escapes <, >, &, \", '", () => {
    expect(escapeHtml(`<a href="x">a&b'c</a>`)).toBe(`&lt;a href=&quot;x&quot;&gt;a&amp;b&#39;c&lt;/a&gt;`);
  });
});

describe("renderHtmlReport", () => {
  const html = renderHtmlReport(minimalReport);

  it("returns a standalone HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("includes site URL and page count in the header", () => {
    expect(html).toContain("https://example.com/");
    expect(html).toContain("2");
  });

  it("renders severity counts", () => {
    expect(html).toContain("high");
    expect(html).toContain("medium");
    expect(html).toContain("low");
  });

  it("lists top issue codes", () => {
    expect(html).toContain("META_DESCRIPTION_MISSING");
    expect(html).toContain("IMAGES_MISSING_LAZY_LOADING");
  });

  it("includes infrastructure issues", () => {
    expect(html).toContain("ROBOTS_NO_SITEMAP");
  });

  it("escapes HTML in user-provided content", () => {
    const tainted: SiteReport = {
      ...minimalReport,
      pages: [
        {
          ...minimalReport.pages[0],
          checks: { ...minimalReport.pages[0].checks, title: `<script>alert(1)</script>` },
        },
      ],
    };
    const out = renderHtmlReport(tainted);
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === "1";
const maybeDescribe = RUN_BROWSER_TESTS ? describe : describe.skip;

maybeDescribe("renderPdfReport (integration)", () => {
  it("produces a non-empty PDF buffer starting with %PDF", async () => {
    const buf = await renderPdfReport(minimalReport);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  }, 60000);
});

describe("renderHtmlReport with v0.5 sections", () => {
  it("renders the Content duplicates section when report.contentDedup is present", () => {
    const report: SiteReport = {
      startUrl: "https://example.com",
      infrastructure: {
        robotsTxt: { url: "", present: false, status: null, sitemaps: [], blocksAllCrawlers: false },
        sitemap: { url: "", present: false, status: null, urlCount: 0, knownUrls: 0, coverageLimited: false, isIndex: false },
        llmsTxt: { url: "", present: false, status: null, isEmpty: true },
        issues: [],
      },
      summary: {
        crawledPages: 0,
        issueTotals: { high: 0, medium: 0, low: 0 },
        pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 0,
        internalLinksChecked: 0, pagesWithBrokenInternalLinks: 0,
        pagesWithRedirectingInternalLinks: 0, pagesWithAnchorTextIssues: 0,
        pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
        pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
        topIssues: [], duplicateTitles: [], duplicateMetaDescriptions: [],
      },
      pages: [],
      lighthouse: [],
      contentDedup: {
        clusters: [
          {
            representativeUrl: "https://example.com/a",
            members: [
              { url: "https://example.com/a", similarityToRepresentative: 1.0 },
              { url: "https://example.com/b", similarityToRepresentative: 0.92 },
            ],
            shingleSize: 5,
            threshold: 0.85,
          },
        ],
        totalNearDuplicatePages: 2,
        pagesAnalyzed: 2,
        pagesSkipped: 0,
      },
    };
    const html = renderHtmlReport(report);
    expect(html).toContain("<h2>Content duplicates</h2>");
    expect(html).toContain("https://example.com/a");
    expect(html).toContain("0.92");
  });

  it("renders the Internal link equity section when report.linkGraph is present", () => {
    const report: SiteReport = {
      startUrl: "https://example.com",
      infrastructure: {
        robotsTxt: { url: "", present: false, status: null, sitemaps: [], blocksAllCrawlers: false },
        sitemap: { url: "", present: false, status: null, urlCount: 0, knownUrls: 0, coverageLimited: false, isIndex: false },
        llmsTxt: { url: "", present: false, status: null, isEmpty: true },
        issues: [],
      },
      summary: {
        crawledPages: 0,
        issueTotals: { high: 0, medium: 0, low: 0 },
        pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 0,
        internalLinksChecked: 0, pagesWithBrokenInternalLinks: 0,
        pagesWithRedirectingInternalLinks: 0, pagesWithAnchorTextIssues: 0,
        pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
        pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
        topIssues: [], duplicateTitles: [], duplicateMetaDescriptions: [],
      },
      pages: [],
      lighthouse: [],
      linkGraph: {
        pagesAnalyzed: 5, edges: 8, iterations: 20, damping: 0.85,
        topPages: [
          { url: "https://example.com/", pageRank: 0.42, wordCount: 1500, incomingInternalLinks: 4 },
        ],
        underLinkedImportantPages: [
          { url: "https://example.com/big", pageRank: 0.05, wordCount: 3000, incomingInternalLinks: 1 },
        ],
      },
    };
    const html = renderHtmlReport(report);
    expect(html).toContain("<h2>Internal link equity</h2>");
    expect(html).toContain("0.4200");
    expect(html).toContain("Underlinked important pages");
    expect(html).toContain("https://example.com/big");
  });
});

describe("renderHtmlReport with GA4", () => {
  it("renders an Analytics section and a GA4 column when ga4 metrics are present", () => {
    const report: SiteReport = {
      startUrl: "https://example.com",
      infrastructure: {
        robotsTxt: { url: "", present: false, status: null, sitemaps: [], blocksAllCrawlers: false },
        sitemap: { url: "", present: false, status: null, urlCount: 0, knownUrls: 0, coverageLimited: false, isIndex: false },
        llmsTxt: { url: "", present: false, status: null, isEmpty: true },
        issues: [],
      },
      summary: {
        crawledPages: 1,
        issueTotals: { high: 0, medium: 0, low: 0 },
        pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 0,
        internalLinksChecked: 0, pagesWithBrokenInternalLinks: 0,
        pagesWithRedirectingInternalLinks: 0, pagesWithAnchorTextIssues: 0,
        pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
        pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
        topIssues: [], duplicateTitles: [], duplicateMetaDescriptions: [],
      },
      pages: [
        {
          url: "https://example.com/a",
          finalUrl: "https://example.com/a",
          status: 200, contentType: "text/html",
          redirectChain: [], discoveredLinks: [],
          checks: {
            title: "x", titleLength: 1, metaDescription: null, metaDescriptionLength: 0,
            canonical: null, htmlLang: null, expectedLocale: null, hreflang: [],
            robotsMeta: null, h1s: [], wordCount: 0, imagesTotal: 0, imagesMissingAlt: 0,
            internalLinks: 0, incomingInternalLinks: 0,
            internalLinksWithoutAnchorText: 0, internalLinksWithNonDescriptiveAnchorText: 0,
            externalLinks: 0, inSitemap: false,
            openGraph: { title: null, description: null, image: null },
            schemaTypes: [], bodyText: null,
          },
          issues: [],
          metrics: { ga4: { sessions: 10, screenPageViews: 20, totalUsers: 8, engagementRate: 0.6 } },
        },
      ],
      lighthouse: [],
      ga4: {
        property: "properties/123",
        startDate: "2026-01-25",
        endDate: "2026-04-25",
        totalRows: 1,
        matchedPages: 1,
        unmatchedRows: 0,
        error: null,
      },
    };
    const html = renderHtmlReport(report);
    expect(html).toContain("<h2>Analytics</h2>");
    expect(html).toContain("properties/123");
    expect(html).toContain("<th>GA4</th>");
    expect(html).toContain("10 sess");
  });
});
