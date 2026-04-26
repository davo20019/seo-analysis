import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostKeyFromUrl, resolveCrawlsDir, persistCrawl, loadCrawl } from "../src/persist.js";
import type { SiteReport } from "../src/types.js";

function fixtureReport(startUrl: string): SiteReport {
  return {
    startUrl,
    infrastructure: {
      robotsTxt: { url: "", present: true, status: 200, sitemaps: [], blocksAllCrawlers: false },
      sitemap: { url: "", present: true, status: 200, urlCount: 0, knownUrls: 0, coverageLimited: false, isIndex: false },
      llmsTxt: { url: "", present: false, status: 404, isEmpty: false },
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
    pages: [],
    lighthouse: [],
  };
}

describe("hostKeyFromUrl", () => {
  it("lowercases the hostname", () => {
    expect(hostKeyFromUrl("https://Example.COM/")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(hostKeyFromUrl("https://www.example.com/")).toBe("example.com");
  });

  it("preserves non-default ports as host_port", () => {
    expect(hostKeyFromUrl("http://localhost:3000")).toBe("localhost_3000");
    expect(hostKeyFromUrl("https://example.com:8443/")).toBe("example.com_8443");
  });

  it("strips default ports (80 over http, 443 over https)", () => {
    expect(hostKeyFromUrl("http://example.com:80")).toBe("example.com");
    expect(hostKeyFromUrl("https://example.com:443/")).toBe("example.com");
  });

  it("returns punycode form for IDN hosts", () => {
    expect(hostKeyFromUrl("https://例え.テスト/")).toBe("xn--r8jz45g.xn--zckzah");
  });

  it("throws on unparseable input", () => {
    expect(() => hostKeyFromUrl("not-a-url")).toThrow();
  });

  it("does not strip www inside the hostname (only leading)", () => {
    expect(hostKeyFromUrl("https://blog.www.example.com/")).toBe("blog.www.example.com");
  });
});

describe("resolveCrawlsDir", () => {
  let tmp: string;
  const ORIGINAL_ENV = process.env.SEO_AUDIT_CRAWLS_DIR;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "seo-audit-test-"));
  });

  afterEach(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env.SEO_AUDIT_CRAWLS_DIR;
    else process.env.SEO_AUDIT_CRAWLS_DIR = ORIGINAL_ENV;
    await rm(tmp, { recursive: true, force: true });
  });

  it("honors SEO_AUDIT_CRAWLS_DIR when set", () => {
    process.env.SEO_AUDIT_CRAWLS_DIR = tmp;
    expect(resolveCrawlsDir()).toBe(tmp);
  });

  it("defaults to ~/.config/seo-audit/crawls when env is unset", () => {
    delete process.env.SEO_AUDIT_CRAWLS_DIR;
    const result = resolveCrawlsDir();
    expect(result.endsWith(join(".config", "seo-audit", "crawls"))).toBe(true);
  });
});

describe("persistCrawl + loadCrawl", () => {
  let tmp: string;
  const ORIGINAL_ENV = process.env.SEO_AUDIT_CRAWLS_DIR;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "seo-audit-test-"));
    process.env.SEO_AUDIT_CRAWLS_DIR = tmp;
  });

  afterEach(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env.SEO_AUDIT_CRAWLS_DIR;
    else process.env.SEO_AUDIT_CRAWLS_DIR = ORIGINAL_ENV;
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes a JSON file under <crawlsDir>/<host>/", async () => {
    const report = fixtureReport("https://example.com/");
    const result = await persistCrawl(report);
    expect(result.path.startsWith(join(tmp, "example.com"))).toBe(true);
    expect(result.path.endsWith(".json")).toBe(true);
  });

  it("roundtrips: loadCrawl returns a report deep-equal to the original", async () => {
    const report = fixtureReport("https://example.com/");
    const result = await persistCrawl(report);
    const loaded = await loadCrawl(result.path);
    expect(loaded).toEqual(report);
  });

  it("returns isFirstForHost: true on the first persist for a host", async () => {
    const report = fixtureReport("https://example.com/");
    const result = await persistCrawl(report);
    expect(result.isFirstForHost).toBe(true);
    expect(result.previousPath).toBe(null);
  });

  it("returns isFirstForHost: false and previousPath on the second persist", async () => {
    const report = fixtureReport("https://example.com/");
    const first = await persistCrawl(report, { now: () => new Date("2026-04-25T12:00:00.000Z") });
    const second = await persistCrawl(report, { now: () => new Date("2026-04-25T12:00:01.000Z") });
    expect(second.isFirstForHost).toBe(false);
    expect(second.previousPath).toBe(first.path);
  });

  it("treats different hosts as independent (per-host first-run bookkeeping)", async () => {
    await persistCrawl(fixtureReport("https://example.com/"));
    const result = await persistCrawl(fixtureReport("https://other.com/"));
    expect(result.isFirstForHost).toBe(true);
  });

  it("creates the host directory with mode 0o700", async () => {
    const report = fixtureReport("https://example.com/");
    await persistCrawl(report);
    const hostDir = join(tmp, "example.com");
    const info = await stat(hostDir);
    // Mask file-type bits; compare permission bits only.
    expect(info.mode & 0o777).toBe(0o700);
  });

  it("appends a millisecond when a same-timestamp file already exists", async () => {
    const report = fixtureReport("https://example.com/");
    const frozen = new Date("2026-04-25T12:00:00.000Z");
    const first = await persistCrawl(report, { now: () => frozen });
    const second = await persistCrawl(report, { now: () => frozen });
    expect(second.path).not.toBe(first.path);
    // Both files exist; both load.
    expect((await loadCrawl(first.path)).startUrl).toBe(report.startUrl);
    expect((await loadCrawl(second.path)).startUrl).toBe(report.startUrl);
  });
});
