import { describe, it, expect } from "vitest";
import { buildLinkGraphReport, PAGERANK_DAMPING, PAGERANK_ITERATIONS, TOP_N } from "../../src/checks/link-graph.js";
import type { PageReport } from "../../src/types.js";

function makePage(url: string, opts: {
  links?: string[];
  wordCount?: number;
  incoming?: number;
} = {}): PageReport {
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    redirectChain: [],
    discoveredLinks: opts.links ?? [],
    checks: {
      title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0,
      canonical: null, htmlLang: null, expectedLocale: null, hreflang: [],
      robotsMeta: null, h1s: [], wordCount: opts.wordCount ?? 0,
      imagesTotal: 0, imagesMissingAlt: 0,
      internalLinks: opts.links?.length ?? 0,
      incomingInternalLinks: opts.incoming ?? 0,
      internalLinksWithoutAnchorText: 0,
      internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0, inSitemap: false,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: [], bodyText: null,
    },
    issues: [],
  };
}

describe("buildLinkGraphReport — graph construction", () => {
  it("counts only edges where target is in the crawled set", () => {
    const pages = [
      makePage("https://x/a", { links: ["https://x/b", "https://x/c", "https://external.com/foo"] }),
      makePage("https://x/b"),
      makePage("https://x/c"),
    ];
    const r = buildLinkGraphReport(pages);
    expect(r.edges).toBe(2);  // a→b, a→c. external.com dropped.
  });

  it("drops self-loops", () => {
    const pages = [
      makePage("https://x/a", { links: ["https://x/a", "https://x/b"] }),
      makePage("https://x/b"),
    ];
    const r = buildLinkGraphReport(pages);
    expect(r.edges).toBe(1);  // a→b only.
  });
});

describe("buildLinkGraphReport — PageRank correctness", () => {
  it("4-node directed cycle converges to ~0.25 on each node", () => {
    const pages = [
      makePage("https://x/a", { links: ["https://x/b"] }),
      makePage("https://x/b", { links: ["https://x/c"] }),
      makePage("https://x/c", { links: ["https://x/d"] }),
      makePage("https://x/d", { links: ["https://x/a"] }),
    ];
    const r = buildLinkGraphReport(pages);
    for (const e of r.topPages) {
      expect(e.pageRank).toBeCloseTo(0.25, 3);
    }
  });

  it("dangling pages have rank distributed uniformly", () => {
    const pages = [
      makePage("https://x/a", { links: ["https://x/b", "https://x/c", "https://x/d"] }),
      makePage("https://x/b"),
      makePage("https://x/c"),
      makePage("https://x/d"),
    ];
    const r = buildLinkGraphReport(pages);
    // B, C, D should have equal rank (each receives equal share from A and dangling redistribution)
    const ranks = r.topPages.filter((e) => e.url !== "https://x/a").map((e) => e.pageRank);
    expect(ranks).toHaveLength(3);
    expect(ranks[0]).toBeCloseTo(ranks[1], 3);
    expect(ranks[1]).toBeCloseTo(ranks[2], 3);
  });

  it("star graph: hub has highest PageRank", () => {
    const pages = [
      makePage("https://x/hub"),
      ...Array.from({ length: 10 }, (_, i) => makePage(`https://x/leaf${i}`, { links: ["https://x/hub"] })),
    ];
    const r = buildLinkGraphReport(pages);
    expect(r.topPages[0].url).toBe("https://x/hub");
  });
});

describe("buildLinkGraphReport — edge cases", () => {
  it("handles empty input", () => {
    const r = buildLinkGraphReport([]);
    expect(r).toEqual({
      pagesAnalyzed: 0,
      edges: 0,
      iterations: PAGERANK_ITERATIONS,
      damping: PAGERANK_DAMPING,
      topPages: [],
      underLinkedImportantPages: [],
    });
  });

  it("handles single-page input", () => {
    const pages = [makePage("https://x/a")];
    const r = buildLinkGraphReport(pages);
    expect(r.pagesAnalyzed).toBe(1);
    expect(r.edges).toBe(0);
    expect(r.topPages).toHaveLength(1);
    expect(r.topPages[0].pageRank).toBeCloseTo(1.0, 3);
    expect(r.underLinkedImportantPages).toEqual([]);
  });

  it("handles two pages with mutual link", () => {
    const pages = [
      makePage("https://x/a", { links: ["https://x/b"] }),
      makePage("https://x/b", { links: ["https://x/a"] }),
    ];
    const r = buildLinkGraphReport(pages);
    expect(r.topPages).toHaveLength(2);
    expect(r.topPages[0].pageRank).toBeCloseTo(0.5, 3);
    expect(r.topPages[1].pageRank).toBeCloseTo(0.5, 3);
  });
});

describe("buildLinkGraphReport — per-page mutation", () => {
  it("attaches linkGraph.pageRank to each PageReport", () => {
    const pages = [
      makePage("https://x/a", { links: ["https://x/b"] }),
      makePage("https://x/b"),
    ];
    buildLinkGraphReport(pages);
    expect(pages[0].linkGraph).toBeDefined();
    expect(pages[1].linkGraph).toBeDefined();
    expect(pages[0].linkGraph!.pageRank).toBeGreaterThan(0);
    expect(pages[0].linkGraph!.pageRank).toBeLessThanOrEqual(1);
    const sum = pages.reduce((s, p) => s + (p.linkGraph?.pageRank ?? 0), 0);
    expect(sum).toBeCloseTo(1.0, 3);
  });
});

describe("buildLinkGraphReport — underlinked important pages heuristic", () => {
  it("returns high-content pages with low rank, sorted by wordCount desc", () => {
    // 10 pages: 5 high-content (1000+ words), 5 low-content (100 words)
    // Hub page (low content, high rank): https://x/hub gets all the inbound links
    // High-content underlinked: https://x/big1, https://x/big2, https://x/big3 (no inbound)
    // High-content well-linked: https://x/big4, https://x/big5 (linked from hub)
    const pages = [
      makePage("https://x/hub", { wordCount: 100, links: ["https://x/big4", "https://x/big5"] }),
      makePage("https://x/big1", { wordCount: 2000 }),
      makePage("https://x/big2", { wordCount: 1500 }),
      makePage("https://x/big3", { wordCount: 1200 }),
      makePage("https://x/big4", { wordCount: 1100 }),
      makePage("https://x/big5", { wordCount: 1000 }),
      makePage("https://x/small1", { wordCount: 50, links: ["https://x/hub"] }),
      makePage("https://x/small2", { wordCount: 50, links: ["https://x/hub"] }),
      makePage("https://x/small3", { wordCount: 50, links: ["https://x/hub"] }),
      makePage("https://x/small4", { wordCount: 50, links: ["https://x/hub"] }),
    ];
    const r = buildLinkGraphReport(pages);
    const urls = r.underLinkedImportantPages.map((e) => e.url);
    // big1, big2, big3 are above-median wordCount and below-median rank.
    // Order: big1 > big2 > big3 by wordCount desc.
    expect(urls).toContain("https://x/big1");
    expect(urls).toContain("https://x/big2");
    expect(urls).toContain("https://x/big3");
    // big4, big5 should NOT be there (well-linked).
    expect(urls).not.toContain("https://x/big4");
    expect(urls).not.toContain("https://x/big5");
    // small pages should NOT be there (below-median wordCount).
    expect(urls).not.toContain("https://x/small1");
    // Sorting: descending by wordCount.
    expect(urls.indexOf("https://x/big1")).toBeLessThan(urls.indexOf("https://x/big2"));
    expect(urls.indexOf("https://x/big2")).toBeLessThan(urls.indexOf("https://x/big3"));
  });

  it("returns empty underLinkedImportantPages when there are zero internal edges", () => {
    // 5 pages, all with no internal links → all dangling → all at median rank.
    // The heuristic would otherwise flood with false positives.
    const pages = [
      makePage("https://x/big1", { wordCount: 2000 }),
      makePage("https://x/big2", { wordCount: 1500 }),
      makePage("https://x/small1", { wordCount: 50 }),
      makePage("https://x/small2", { wordCount: 50 }),
      makePage("https://x/small3", { wordCount: 50 }),
    ];
    const r = buildLinkGraphReport(pages);
    expect(r.edges).toBe(0);
    expect(r.underLinkedImportantPages).toEqual([]);
  });
});

describe("buildLinkGraphReport — determinism", () => {
  it("returns equal results across two consecutive calls", () => {
    const buildPages = () => [
      makePage("https://x/a", { links: ["https://x/b", "https://x/c"] }),
      makePage("https://x/b", { links: ["https://x/c"] }),
      makePage("https://x/c"),
    ];
    const r1 = buildLinkGraphReport(buildPages());
    const r2 = buildLinkGraphReport(buildPages());
    expect(r1.topPages).toEqual(r2.topPages);
    expect(r1.edges).toEqual(r2.edges);
  });
});
