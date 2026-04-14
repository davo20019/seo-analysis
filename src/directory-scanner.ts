import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { load } from "cheerio";

import { buildKeywordSummary, extractTermFrequencies, matchKeywordsOnPage } from "./keywords.js";
import type { PageTextContent } from "./keywords.js";
import type { KeywordSummary, PageReport, SiteReport, TermFrequency } from "./types.js";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const DEFAULT_BATCH_SIZE = 20;

async function findHtmlFiles(directory: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...await findHtmlFiles(fullPath));
    } else if (entry.isFile()) {
      const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();

      if (HTML_EXTENSIONS.has(extension)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function detectPageUrl(html: string, filePath: string, baseDirectory: string): string {
  const $ = load(html);

  const canonical = $('link[rel="canonical"]').attr("href")?.trim();

  if (canonical && canonical.startsWith("http")) {
    return canonical;
  }

  const base = $("base").attr("href")?.trim();

  if (base && base.startsWith("http")) {
    const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();

    if (ogUrl && ogUrl.startsWith("http")) {
      return ogUrl;
    }

    return base;
  }

  const relativePath = relative(baseDirectory, filePath);
  return "/" + relativePath.replace(/\\/g, "/").replace(/\/index\.html?$/i, "/");
}

function parseLocalFile(
  html: string,
  pageUrl: string,
  keywords: string[]
): PageReport {
  const $ = load(html);

  const title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.replace(/\s+/g, " ").trim() || null;
  const h1s = $("h1")
    .map((_, element) => $(element).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim() || null;
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  const page: PageReport = {
    url: pageUrl,
    finalUrl: pageUrl,
    status: 200,
    contentType: "text/html",
    redirectChain: [],
    checks: {
      title,
      titleLength: title?.length ?? 0,
      metaDescription,
      metaDescriptionLength: metaDescription?.length ?? 0,
      canonical: $('link[rel="canonical"]').attr("href")?.trim() || null,
      htmlLang: $("html").attr("lang")?.trim() || null,
      expectedLocale: null,
      hreflang: [],
      robotsMeta: null,
      h1s,
      wordCount,
      imagesTotal: $("img").length,
      imagesMissingAlt: 0,
      internalLinks: 0,
      incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0,
      internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0,
      inSitemap: false,
      openGraph: {
        title: $('meta[property="og:title"]').attr("content")?.trim() || null,
        description: $('meta[property="og:description"]').attr("content")?.trim() || null,
        image: $('meta[property="og:image"]').attr("content")?.trim() || null,
      },
      schemaTypes: [],
      bodyText,
    },
    issues: [],
    discoveredLinks: [],
  };

  if (keywords.length > 0) {
    const content: PageTextContent = {
      title: title ?? "",
      metaDescription: metaDescription ?? "",
      h1Text: h1s.join(" "),
      bodyText: bodyText ?? "",
    };

    page.keywordMatches = matchKeywordsOnPage(keywords, content);
  }

  return page;
}

export interface DirectoryScanOptions {
  keywords: string[];
  extractTerms: boolean;
  topTermsCount: number;
}

export async function scanDirectory(
  directory: string,
  options: DirectoryScanOptions
): Promise<SiteReport> {
  const dirStat = await stat(directory);

  if (!dirStat.isDirectory()) {
    throw new Error(`"${directory}" is not a directory.`);
  }

  const htmlFiles = await findHtmlFiles(directory);

  if (htmlFiles.length === 0) {
    throw new Error(`No .html or .htm files found in "${directory}".`);
  }

  const pages: PageReport[] = [];

  for (let i = 0; i < htmlFiles.length; i += DEFAULT_BATCH_SIZE) {
    const batch = htmlFiles.slice(i, i + DEFAULT_BATCH_SIZE);
    const batchPages = await Promise.all(
      batch.map(async (filePath) => {
        const html = await readFile(filePath, "utf8");
        const pageUrl = detectPageUrl(html, filePath, directory);
        return parseLocalFile(html, pageUrl, options.keywords);
      })
    );
    pages.push(...batchPages);
  }

  const keywordSummary: KeywordSummary[] | undefined =
    options.keywords.length > 0 ? buildKeywordSummary(options.keywords, pages) : undefined;

  const topTerms: TermFrequency[] | undefined =
    options.extractTerms ? extractTermFrequencies(pages, options.topTermsCount) : undefined;

  return {
    startUrl: directory,
    infrastructure: {
      robotsTxt: {
        url: "",
        present: false,
        status: null,
        sitemaps: [],
        blocksAllCrawlers: false,
      },
      sitemap: {
        url: "",
        present: false,
        status: null,
        urlCount: 0,
        knownUrls: 0,
        coverageLimited: false,
        isIndex: false,
      },
      llmsTxt: {
        url: "",
        present: false,
        status: null,
        isEmpty: false,
      },
      issues: [],
    },
    summary: {
      crawledPages: pages.length,
      issueTotals: { high: 0, medium: 0, low: 0 },
      pagesWithNoindex: 0,
      pagesMissingTitle: 0,
      pagesMissingDescription: 0,
      internalLinksChecked: 0,
      pagesWithBrokenInternalLinks: 0,
      pagesWithRedirectingInternalLinks: 0,
      pagesWithAnchorTextIssues: 0,
      pagesWithFewIncomingInternalLinks: 0,
      orphanCandidatePages: 0,
      pagesMissingFromSitemap: 0,
      pagesWithHreflangIssues: 0,
      topIssues: [],
      duplicateTitles: [],
      duplicateMetaDescriptions: [],
    },
    pages,
    lighthouse: [],
    keywordSummary,
    topTerms,
  };
}
