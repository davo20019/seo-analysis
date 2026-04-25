import type { Issue } from "../types.js";

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

const URL_RE = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
const SITEMAP_RE = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
const LOC_RE = /<loc>\s*([\s\S]*?)\s*<\/loc>/i;
const LASTMOD_RE = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i;

export function parseSitemapXml(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  if (!xml) return out;
  for (const match of xml.matchAll(URL_RE)) {
    const block = match[1];
    const loc = block.match(LOC_RE)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = block.match(LASTMOD_RE)?.[1]?.trim() ?? null;
    out.push({ url: loc, lastmod });
  }
  return out;
}

export function parseSitemapIndex(xml: string): string[] {
  const out: string[] = [];
  if (!xml) return out;
  for (const match of xml.matchAll(SITEMAP_RE)) {
    const loc = match[1].match(LOC_RE)?.[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}
