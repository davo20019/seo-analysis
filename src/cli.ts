import { readFile, writeFile } from "node:fs/promises";

import { analyzeSite } from "./analyzer.js";
import { scanDirectory } from "./directory-scanner.js";
import type { DuplicateGroup, KeywordSummary, LighthouseReport, SiteReport, TermFrequency } from "./types.js";

interface CliOptions {
  concurrency: number | null;
  crux: boolean;
  excludePathPatterns: string[];
  fullSitemap: boolean;
  includePathPatterns: string[];
  json: boolean;
  lighthouse: boolean;
  lighthousePages: number;
  maxPages: number;
  outputPath: string | null;
  keywords: string[];
  keywordFile: string | null;
  extractTerms: boolean;
  topTerms: number;
  fromDirectory: string | null;
  render: boolean;
  renderTimeoutMs: number | null;
  retries: number;
  sampleSitemap: boolean;
  seedSitemap: boolean;
  timeoutMs: number;
  urls: string[];
  userAgent: string | null;
}

function printHelp(): void {
  console.log(`SEO Analysis CLI

Usage:
  npm run dev -- <url> [more-urls] [options]

Options:
  --max-pages <number>       Maximum pages to crawl per site. Default: 10
  --full-sitemap             Crawl every sitemap URL instead of stopping at --max-pages
  --sample-sitemap           Sample representative sitemap URLs up to --max-pages
  --timeout-ms <number>      Request timeout in milliseconds. Default: 10000
  --concurrency <number>     Number of pages to fetch in parallel. Default: 6
  --retries <number>         Retry count for failed or retryable requests. Default: 2
  --include-path <regex>     Only crawl discovered URLs whose path matches the regex
  --exclude-path <regex>     Skip discovered URLs whose path matches the regex
  --no-sitemap-seed          Do not seed the crawl queue from sitemap URLs
  --lighthouse               Run optional Lighthouse audits on a small set of crawled pages
  --lighthouse-pages <n>     Number of crawled pages to send through Lighthouse. Default: 1
  --crux                     Query Google's CrUX API for real-user Core Web Vitals (requires CRUX_API_KEY env var)
  --render                   Render pages with headless Chromium (Playwright) instead of raw fetch — needed for SPAs and JS-challenge sites
  --render-timeout-ms <n>    Timeout per page render in milliseconds (default: 30000)
  --keyword <term>          Search for this keyword in crawled pages (repeatable)
  --keyword-file <path>     Read keywords from a file, one per line
  --extract-terms           Extract and rank the most frequent terms on the site
  --top-terms <n>           Number of top terms to report. Default: 20
  --from-directory <path>   Search local HTML files instead of crawling
  --json                     Print raw JSON instead of a text report
  --output <file>            Write the final report to a file
  --user-agent <string>      Override the HTTP User-Agent sent by the crawler
  --help                     Show this help

Examples:
  npm run dev -- https://example.com
  npm run dev -- https://example.com --max-pages 25 --concurrency 6
  npm run dev -- https://example.com --full-sitemap --concurrency 12
  npm run dev -- https://example.com --sample-sitemap --max-pages 25
  npm run dev -- https://example.com --include-path '^/blog' --exclude-path '/tag/'
  npm run dev -- https://example.com --lighthouse --lighthouse-pages 3
  npm run dev -- https://example.com https://example.org --json --output report.json
  npm run dev -- https://example.com --keyword "seo" --keyword "site audit"
  npm run dev -- https://example.com --keyword-file keywords.txt --extract-terms
  npm run dev -- --from-directory ./site_backup --keyword-file keywords.txt`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseNumberValue(rawValue: string, flag: string): number {
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a valid integer.`);
  }

  return parsed;
}

function validatePatterns(patterns: string[], flag: string): void {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown regex error";
      throw new Error(`Invalid ${flag} pattern "${pattern}": ${message}`);
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    concurrency: null,
    crux: false,
    excludePathPatterns: [],
    fullSitemap: false,
    includePathPatterns: [],
    json: false,
    lighthouse: false,
    lighthousePages: 1,
    maxPages: 10,
    outputPath: null,
    keywords: [],
    keywordFile: null,
    extractTerms: false,
    topTerms: 20,
    fromDirectory: null,
    render: false,
    renderTimeoutMs: null,
    retries: 2,
    sampleSitemap: false,
    seedSitemap: true,
    timeoutMs: 10_000,
    urls: [],
    userAgent: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--full-sitemap") {
      options.fullSitemap = true;
      continue;
    }

    if (arg === "--sample-sitemap") {
      options.sampleSitemap = true;
      continue;
    }

    if (arg === "--no-sitemap-seed") {
      options.seedSitemap = false;
      continue;
    }

    if (arg === "--crux") {
      options.crux = true;
      continue;
    }

    if (arg === "--lighthouse") {
      options.lighthouse = true;
      continue;
    }

    if (arg === "--max-pages") {
      options.maxPages = parseNumberValue(requireValue(argv, index, "--max-pages"), "--max-pages");
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-pages=")) {
      options.maxPages = parseNumberValue(arg.split("=")[1] ?? "", "--max-pages");
      continue;
    }

    if (arg === "--timeout-ms") {
      options.timeoutMs = parseNumberValue(
        requireValue(argv, index, "--timeout-ms"),
        "--timeout-ms"
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parseNumberValue(arg.split("=")[1] ?? "", "--timeout-ms");
      continue;
    }

    if (arg === "--concurrency") {
      options.concurrency = parseNumberValue(
        requireValue(argv, index, "--concurrency"),
        "--concurrency"
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--concurrency=")) {
      options.concurrency = parseNumberValue(arg.split("=")[1] ?? "", "--concurrency");
      continue;
    }

    if (arg === "--retries") {
      options.retries = parseNumberValue(requireValue(argv, index, "--retries"), "--retries");
      index += 1;
      continue;
    }

    if (arg.startsWith("--retries=")) {
      options.retries = parseNumberValue(arg.split("=")[1] ?? "", "--retries");
      continue;
    }

    if (arg === "--include-path") {
      options.includePathPatterns.push(requireValue(argv, index, "--include-path"));
      index += 1;
      continue;
    }

    if (arg.startsWith("--include-path=")) {
      options.includePathPatterns.push(arg.split("=")[1] ?? "");
      continue;
    }

    if (arg === "--exclude-path") {
      options.excludePathPatterns.push(requireValue(argv, index, "--exclude-path"));
      index += 1;
      continue;
    }

    if (arg.startsWith("--exclude-path=")) {
      options.excludePathPatterns.push(arg.split("=")[1] ?? "");
      continue;
    }

    if (arg === "--lighthouse-pages") {
      options.lighthousePages = parseNumberValue(
        requireValue(argv, index, "--lighthouse-pages"),
        "--lighthouse-pages"
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--lighthouse-pages=")) {
      options.lighthousePages = parseNumberValue(
        arg.split("=")[1] ?? "",
        "--lighthouse-pages"
      );
      continue;
    }

    if (arg === "--render") {
      options.render = true;
      continue;
    }

    if (arg === "--render-timeout-ms") {
      options.renderTimeoutMs = parseNumberValue(
        requireValue(argv, index, "--render-timeout-ms"),
        "--render-timeout-ms"
      );
      index += 1;
      continue;
    }

    if (arg.startsWith("--render-timeout-ms=")) {
      options.renderTimeoutMs = parseNumberValue(
        arg.split("=")[1] ?? "",
        "--render-timeout-ms"
      );
      continue;
    }

    if (arg === "--output") {
      options.outputPath = requireValue(argv, index, "--output");
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      options.outputPath = arg.split("=")[1] ?? null;
      continue;
    }

    if (arg === "--user-agent") {
      options.userAgent = requireValue(argv, index, "--user-agent");
      index += 1;
      continue;
    }

    if (arg.startsWith("--user-agent=")) {
      options.userAgent = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg === "--keyword") {
      options.keywords.push(requireValue(argv, index, "--keyword"));
      index += 1;
      continue;
    }

    if (arg.startsWith("--keyword=")) {
      options.keywords.push(arg.split("=").slice(1).join("="));
      continue;
    }

    if (arg === "--keyword-file") {
      options.keywordFile = requireValue(argv, index, "--keyword-file");
      index += 1;
      continue;
    }

    if (arg.startsWith("--keyword-file=")) {
      options.keywordFile = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg === "--extract-terms") {
      options.extractTerms = true;
      continue;
    }

    if (arg === "--top-terms") {
      options.topTerms = parseNumberValue(requireValue(argv, index, "--top-terms"), "--top-terms");
      index += 1;
      continue;
    }

    if (arg.startsWith("--top-terms=")) {
      options.topTerms = parseNumberValue(arg.split("=")[1] ?? "", "--top-terms");
      continue;
    }

    if (arg === "--from-directory") {
      options.fromDirectory = requireValue(argv, index, "--from-directory");
      index += 1;
      continue;
    }

    if (arg.startsWith("--from-directory=")) {
      options.fromDirectory = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.urls.push(arg);
  }

  if (options.fromDirectory) {
    if (options.keywords.length === 0 && !options.keywordFile && !options.extractTerms) {
      throw new Error(
        "Use --from-directory with --keyword, --keyword-file, or --extract-terms."
      );
    }
  } else if (options.urls.length === 0) {
    throw new Error("Provide at least one website URL to analyze.");
  }

  if (!Number.isFinite(options.topTerms) || options.topTerms < 1) {
    throw new Error("--top-terms must be a positive integer.");
  }

  if (!options.fullSitemap && (!Number.isFinite(options.maxPages) || options.maxPages < 1)) {
    throw new Error("--max-pages must be a positive integer.");
  }

  if (options.fullSitemap && options.sampleSitemap) {
    throw new Error("--sample-sitemap cannot be combined with --full-sitemap.");
  }

  if (options.sampleSitemap && !options.seedSitemap) {
    throw new Error("--sample-sitemap cannot be combined with --no-sitemap-seed.");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("--timeout-ms must be a positive integer.");
  }

  if (options.concurrency !== null && (!Number.isFinite(options.concurrency) || options.concurrency < 1)) {
    throw new Error("--concurrency must be a positive integer.");
  }

  if (!Number.isFinite(options.retries) || options.retries < 0) {
    throw new Error("--retries must be zero or a positive integer.");
  }

  if (!Number.isFinite(options.lighthousePages) || options.lighthousePages < 1) {
    throw new Error("--lighthouse-pages must be a positive integer.");
  }

  validatePatterns(options.includePathPatterns, "--include-path");
  validatePatterns(options.excludePathPatterns, "--exclude-path");

  return options;
}

async function loadKeywords(
  cliKeywords: string[],
  keywordFilePath: string | null
): Promise<string[]> {
  const keywords = [...cliKeywords];

  if (keywordFilePath) {
    const content = await readFile(keywordFilePath, "utf8");
    const fileKeywords = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    keywords.push(...fileKeywords);
  }

  return [...new Set(keywords)];
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatInfrastructure(report: SiteReport): string[] {
  const lines = [
    `robots.txt: ${report.infrastructure.robotsTxt.present ? "present" : "missing"}`
  ];

  if (report.infrastructure.robotsTxt.present) {
    lines.push(`robots sitemap directives: ${report.infrastructure.robotsTxt.sitemaps.length}`);
  }

  lines.push(`sitemap.xml: ${report.infrastructure.sitemap.present ? "present" : "missing"}`);

  if (report.infrastructure.sitemap.present) {
    lines.push(`sitemap URLs detected: ${report.infrastructure.sitemap.urlCount}`);
  }

  if (report.infrastructure.sitemap.knownUrls > 0) {
    lines.push(
      `known sitemap URLs collected: ${report.infrastructure.sitemap.knownUrls}${report.infrastructure.sitemap.coverageLimited ? " (partial)" : ""}`
    );
  }

  lines.push(`llms.txt: ${report.infrastructure.llmsTxt.present ? "present" : "missing"}`);

  return lines;
}

function formatDuplicateGroups(label: string, groups: DuplicateGroup[]): string[] {
  if (groups.length === 0) {
    return [];
  }

  return [
    "",
    `${label}:`,
    ...groups.slice(0, 5).map((group) => `- ${group.count} pages: "${truncate(group.value, 90)}"`)
  ];
}

function formatLighthouseReport(lighthouse: LighthouseReport[]): string[] {
  if (lighthouse.length === 0) {
    return [];
  }

  return [
    "",
    "Lighthouse:",
    ...lighthouse.map((entry) => {
      if (entry.error) {
        return `- ${entry.requestedUrl}: error=${truncate(entry.error, 140)}`;
      }

      return [
        `- ${entry.finalUrl}`,
        `  performance=${entry.scores.performance ?? "n/a"} accessibility=${entry.scores.accessibility ?? "n/a"} best_practices=${entry.scores.bestPractices ?? "n/a"} seo=${entry.scores.seo ?? "n/a"}`,
        `  lcp_ms=${entry.metrics.largestContentfulPaintMs ?? "n/a"} cls=${entry.metrics.cumulativeLayoutShift ?? "n/a"} tbt_ms=${entry.metrics.totalBlockingTimeMs ?? "n/a"}`
      ].join("\n");
    })
  ];
}

function formatKeywordSummary(summary: KeywordSummary[]): string[] {
  if (summary.length === 0) {
    return [];
  }

  const lines = ["", "Keyword Search Results:"];

  for (const entry of summary) {
    const locations: string[] = [];

    if (entry.locations.title > 0) locations.push(`title(${entry.locations.title})`);
    if (entry.locations.h1 > 0) locations.push(`h1(${entry.locations.h1})`);
    if (entry.locations.metaDescription > 0) locations.push(`meta(${entry.locations.metaDescription})`);
    if (entry.locations.body > 0) locations.push(`body(${entry.locations.body})`);

    const foundIn = locations.length > 0 ? locations.join(" ") : "\u2014";
    lines.push(
      `  "${truncate(entry.keyword, 30)}"  pages=${entry.pages}  occurrences=${entry.totalOccurrences}  found_in=${foundIn}`
    );
  }

  return lines;
}

function formatTopTerms(terms: TermFrequency[]): string[] {
  if (terms.length === 0) {
    return [];
  }

  const lines = ["", "Top Site Terms:"];

  for (let i = 0; i < terms.length; i += 1) {
    const entry = terms[i];
    const locations: string[] = [];

    if (entry.locations.title > 0) locations.push(`title(${entry.locations.title})`);
    if (entry.locations.h1 > 0) locations.push(`h1(${entry.locations.h1})`);
    if (entry.locations.metaDescription > 0) locations.push(`meta(${entry.locations.metaDescription})`);
    if (entry.locations.body > 0) locations.push(`body(${entry.locations.body})`);

    lines.push(
      `  ${i + 1}. "${entry.term}"  pages=${entry.pages}  occurrences=${entry.occurrences}  ${locations.join(" ")}`
    );
  }

  return lines;
}

function formatPage(page: SiteReport["pages"][number]): string {
  const issuePreview =
    page.issues.length > 0 ? page.issues.slice(0, 5).map((issue) => issue.code).join(", ") : "none";
  const lines = [
    `- ${page.finalUrl}`,
    `  status=${page.status} redirects=${page.redirectChain.length} words=${page.checks.wordCount} h1s=${page.checks.h1s.length} internal_links=${page.checks.internalLinks} incoming_internal_links=${page.checks.incomingInternalLinks} issues=${page.issues.length}`,
    `  title=${page.checks.titleLength || 0} chars description=${page.checks.metaDescriptionLength || 0} chars html_lang=${page.checks.htmlLang ?? "missing"} expected_locale=${page.checks.expectedLocale ?? "n/a"} hreflang=${page.checks.hreflang.length} in_sitemap=${page.checks.inSitemap ? "yes" : "no"}`,
    `  internal_anchor_empty=${page.checks.internalLinksWithoutAnchorText} internal_anchor_generic=${page.checks.internalLinksWithNonDescriptiveAnchorText}`,
    `  top_issues=${issuePreview}`
  ];

  if (page.url !== page.finalUrl) {
    lines.splice(1, 0, `  requested=${page.url}`);
  }

  return lines.join("\n");
}

function formatTextReport(report: SiteReport): string {
  const topIssues =
    report.summary.topIssues.length > 0
      ? report.summary.topIssues.map((issue) => `${issue.code} (${issue.count})`).join(", ")
      : "none";

  const lines = [
    `Site: ${report.startUrl}`,
    `Crawled pages: ${report.summary.crawledPages}`,
    `Issue totals: high=${report.summary.issueTotals.high} medium=${report.summary.issueTotals.medium} low=${report.summary.issueTotals.low}`,
    `Pages with noindex: ${report.summary.pagesWithNoindex}`,
    `Pages missing title: ${report.summary.pagesMissingTitle}`,
    `Pages missing description: ${report.summary.pagesMissingDescription}`,
    `Internal links checked: ${report.summary.internalLinksChecked}`,
    `Pages with broken internal links: ${report.summary.pagesWithBrokenInternalLinks}`,
    `Pages with redirecting internal links: ${report.summary.pagesWithRedirectingInternalLinks}`,
    `Pages with anchor text issues: ${report.summary.pagesWithAnchorTextIssues}`,
    `Pages with few incoming internal links: ${report.summary.pagesWithFewIncomingInternalLinks}`,
    `Orphan candidates: ${report.summary.orphanCandidatePages}`,
    `Pages missing from sitemap: ${report.summary.pagesMissingFromSitemap}`,
    `Pages with hreflang issues: ${report.summary.pagesWithHreflangIssues}`,
    `Duplicate title groups: ${report.summary.duplicateTitles.length}`,
    `Duplicate description groups: ${report.summary.duplicateMetaDescriptions.length}`,
    `Top issues: ${topIssues}`,
    ...formatInfrastructure(report),
    ...formatDuplicateGroups("Duplicate Titles", report.summary.duplicateTitles),
    ...formatDuplicateGroups("Duplicate Descriptions", report.summary.duplicateMetaDescriptions),
    ...formatLighthouseReport(report.lighthouse),
    "",
    "Pages:",
    ...report.pages.map(formatPage)
  ];

  if (report.infrastructure.issues.length > 0) {
    lines.push("", "Infrastructure issues:");
    lines.push(...report.infrastructure.issues.map((issue) => `- ${issue.code}: ${issue.message}`));
  }

  if (report.keywordSummary) {
    lines.push(...formatKeywordSummary(report.keywordSummary));
  }

  if (report.topTerms) {
    lines.push(...formatTopTerms(report.topTerms));
  }

  return lines.join("\n");
}

async function maybeWriteOutput(outputPath: string | null, contents: string): Promise<void> {
  if (!outputPath) {
    return;
  }

  await writeFile(outputPath, contents, "utf8");
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const keywords = await loadKeywords(options.keywords, options.keywordFile);
    const reports: SiteReport[] = [];

    if (options.fromDirectory) {
      const report = await scanDirectory(options.fromDirectory, {
        keywords,
        extractTerms: options.extractTerms,
        topTermsCount: options.topTerms,
      });
      reports.push(report);
    } else {
      for (const url of options.urls) {
        reports.push(
          await analyzeSite(url, {
            ...(options.concurrency !== null ? { concurrency: options.concurrency } : {}),
            excludePathPatterns: options.excludePathPatterns,
            fullSitemap: options.fullSitemap,
            includePathPatterns: options.includePathPatterns,
            keywords,
            extractTerms: options.extractTerms,
            topTermsCount: options.topTerms,
            lighthouse: options.lighthouse,
            lighthousePageCount: options.lighthousePages,
            maxPages: options.maxPages,
            crux: options.crux,
            ...(process.env.CRUX_API_KEY ? { cruxApiKey: process.env.CRUX_API_KEY } : {}),
            render: options.render,
            ...(options.renderTimeoutMs ? { renderTimeoutMs: options.renderTimeoutMs } : {}),
            retries: options.retries,
            sampleSitemap: options.sampleSitemap,
            seedSitemap: options.seedSitemap,
            timeoutMs: options.timeoutMs,
            ...(options.userAgent ? { userAgent: options.userAgent } : {}),
          })
        );
      }
    }

    const output = options.json
      ? JSON.stringify(reports, null, 2)
      : reports.map(formatTextReport).join("\n\n");

    await maybeWriteOutput(options.outputPath, output);
    console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CLI error";
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

await main();
