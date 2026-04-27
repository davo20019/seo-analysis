import { describe, expect, it } from "vitest";
import {
  findOrphans,
  findStalePriorities,
  findStatusMismatches,
} from "../../src/logs/findings.js";
import type { AggResult, UrlAgg } from "../../src/logs/aggregate.js";
import type { SiteReport } from "../../src/types.js";

function urlAgg(over: Partial<UrlAgg>): UrlAgg {
  return {
    hits: 1,
    bots: new Set(["googlebot"]),
    statusCounts: new Map([[200, 1]]),
    firstSeen: "2026-04-25T10:00:00Z",
    lastSeen: "2026-04-25T10:00:00Z",
    ...over
  };
}

function aggOf(urls: Record<string, UrlAgg>): AggResult {
  return {
    urls: new Map(Object.entries(urls)),
    bots: [],
    timeWindow: { earliest: "2026-04-25T00:00:00Z", latest: "2026-04-26T00:00:00Z", durationHours: 24 },
  };
}

function crawlOf(pages: Array<{ url: string; status?: number; pageRank?: number }>): SiteReport {
  return {
    startUrl: "https://example.com/",
    pages: pages.map((p) => ({
      url: p.url,
      finalUrl: p.url,
      status: p.status ?? 200,
      contentType: "text/html",
      redirectChain: [],
      checks: {} as never,
      issues: [],
      discoveredLinks: [],
      ...(p.pageRank !== undefined ? { linkGraph: { pageRank: p.pageRank, incomingInternalLinks: 0, outgoingInternalLinks: 0, wordCount: 0 } } : {}),
    })),
    summary: {} as never,
    infrastructure: {} as never,
    lighthouse: [],
  } as unknown as SiteReport;
}

describe("findOrphans", () => {
  it("returns URLs in agg not in crawl", () => {
    const agg = aggOf({
      "https://example.com/in":  urlAgg({ hits: 5 }),
      "https://example.com/out": urlAgg({ hits: 3 }),
    });
    const crawl = crawlOf([{ url: "https://example.com/in" }]);
    const out = findOrphans(agg, crawl, true);
    expect(out.findings.map((f) => f.url)).toEqual(["https://example.com/out"]);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].code).toBe("LOG_ORPHAN_PAGE");
    expect(out.issues[0].severity).toBe("low");
  });

  it("ranks by hit count descending and caps at 200", () => {
    const urls: Record<string, UrlAgg> = {};
    for (let i = 0; i < 250; i++) {
      urls[`https://example.com/p${i}`] = urlAgg({ hits: i });
    }
    const out = findOrphans(aggOf(urls), crawlOf([]), true);
    expect(out.findings).toHaveLength(200);
    expect(out.findings[0].hits).toBe(249);
  });
});

describe("findStalePriorities", () => {
  it("flags top-PageRank URLs not seen in window", () => {
    const crawl = crawlOf([
      { url: "https://example.com/hot",  pageRank: 0.5 },
      { url: "https://example.com/cold", pageRank: 0.4 },
    ]);
    const agg = aggOf({
      "https://example.com/hot": urlAgg({ lastSeen: "2026-04-25T10:00:00Z" }),
    });
    const out = findStalePriorities(agg, crawl, "2026-04-26T00:00:00Z");
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({
      url: "https://example.com/cold",
      daysSinceLastCrawl: null,
    });
    expect(out.issues[0].code).toBe("LOG_STALE_PRIORITY_PAGE");
  });

  it("flags URLs whose last visit is > 30 days before window end", () => {
    const crawl = crawlOf([{ url: "https://example.com/old", pageRank: 0.5 }]);
    const agg = aggOf({
      "https://example.com/old": urlAgg({ lastSeen: "2026-02-01T00:00:00Z" }),
    });
    const out = findStalePriorities(agg, crawl, "2026-04-26T00:00:00Z");
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].daysSinceLastCrawl).toBeGreaterThan(30);
  });

  it("does NOT flag freshly-crawled top URLs", () => {
    const crawl = crawlOf([{ url: "https://example.com/fresh", pageRank: 0.5 }]);
    const agg = aggOf({
      "https://example.com/fresh": urlAgg({ lastSeen: "2026-04-25T23:00:00Z" }),
    });
    const out = findStalePriorities(agg, crawl, "2026-04-26T00:00:00Z");
    expect(out.findings).toHaveLength(0);
    expect(out.issues).toHaveLength(0);
  });
});

describe("findStatusMismatches", () => {
  it("flags 200-in-crawl with 5xx in logs", () => {
    const agg = aggOf({
      "https://example.com/x": urlAgg({
        hits: 4,
        statusCounts: new Map([[200, 1], [503, 3]]),
      }),
    });
    const crawl = crawlOf([{ url: "https://example.com/x", status: 200 }]);
    const out = findStatusMismatches(agg, crawl);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toMatchObject({
      url: "https://example.com/x",
      crawlStatus: 200,
      worstStatus: 503,
    });
    expect(out.issues[0].code).toBe("LOG_STATUS_MISMATCH");
  });

  it("does NOT flag URLs with only 200s in logs", () => {
    const agg = aggOf({
      "https://example.com/x": urlAgg({ statusCounts: new Map([[200, 5]]) }),
    });
    const crawl = crawlOf([{ url: "https://example.com/x", status: 200 }]);
    const out = findStatusMismatches(agg, crawl);
    expect(out.findings).toHaveLength(0);
  });

  it("does NOT flag URLs that crawled non-200", () => {
    const agg = aggOf({
      "https://example.com/x": urlAgg({ statusCounts: new Map([[503, 3]]) }),
    });
    const crawl = crawlOf([{ url: "https://example.com/x", status: 404 }]);
    const out = findStatusMismatches(agg, crawl);
    expect(out.findings).toHaveLength(0);
  });
});
