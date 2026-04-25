import { describe, it, expect } from "vitest";
import { parseSitemapXml, parseSitemapIndex } from "../../src/checks/sitemap-checks.js";

describe("parseSitemapXml", () => {
  it("extracts loc + lastmod entries", () => {
    const xml = `
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://x.com/a</loc><lastmod>2025-01-01</lastmod></url>
        <url><loc>https://x.com/b</loc></url>
      </urlset>`;
    expect(parseSitemapXml(xml)).toEqual([
      { url: "https://x.com/a", lastmod: "2025-01-01" },
      { url: "https://x.com/b", lastmod: null },
    ]);
  });

  it("returns an empty array when there are no <url> entries", () => {
    expect(parseSitemapXml(`<urlset></urlset>`)).toEqual([]);
    expect(parseSitemapXml("")).toEqual([]);
  });

  it("ignores entries without a <loc>", () => {
    const xml = `<urlset><url><lastmod>2025-01-01</lastmod></url><url><loc>https://x.com/a</loc></url></urlset>`;
    expect(parseSitemapXml(xml)).toEqual([{ url: "https://x.com/a", lastmod: null }]);
  });
});

describe("parseSitemapIndex", () => {
  it("extracts nested sitemap URLs", () => {
    const xml = `
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://x.com/a.xml</loc></sitemap>
        <sitemap><loc>https://x.com/b.xml</loc></sitemap>
      </sitemapindex>`;
    expect(parseSitemapIndex(xml)).toEqual(["https://x.com/a.xml", "https://x.com/b.xml"]);
  });

  it("returns an empty array when no nested sitemaps", () => {
    expect(parseSitemapIndex(`<sitemapindex></sitemapindex>`)).toEqual([]);
  });
});

import { checkSitemapLastmod } from "../../src/checks/sitemap-checks.js";

describe("checkSitemapLastmod", () => {
  const now = new Date("2026-04-25T00:00:00Z");

  it("flags entries with lastmod older than 12 months", () => {
    const issues = checkSitemapLastmod([
      { url: "https://x/a", lastmod: "2024-01-01" },
      { url: "https://x/b", lastmod: "2026-01-01" },
    ], now);
    expect(issues.map((i) => i.code)).toContain("SITEMAP_LASTMOD_STALE");
    expect(issues[0].message).toContain("1");
  });

  it("ignores entries without lastmod (no false positives)", () => {
    expect(checkSitemapLastmod([{ url: "https://x/a", lastmod: null }], now)).toEqual([]);
  });

  it("returns no issue when nothing is stale", () => {
    expect(checkSitemapLastmod([
      { url: "https://x/a", lastmod: "2026-01-01" },
    ], now)).toEqual([]);
  });

  it("ignores unparseable lastmod values", () => {
    expect(checkSitemapLastmod([{ url: "https://x/a", lastmod: "not-a-date" }], now)).toEqual([]);
  });
});
