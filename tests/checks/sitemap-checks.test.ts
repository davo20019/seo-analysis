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
