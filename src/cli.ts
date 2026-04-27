import { readFile, writeFile } from "node:fs/promises";

import { analyzeSite } from "./analyzer.js";
import { parseExtractionRules } from "./extract.js";
import { persistCrawl, loadCrawl, recentCrawlsForUrl } from "./persist.js";
import { evaluateFailOn } from "./diff.js";
import { scanDirectory } from "./directory-scanner.js";
import type {
  AgentReadinessReport,
  AnalyzeProgressEvent,
  AnalyzeProgressStage,
  ContentDedupReport,
  DuplicateGroup,
  ExtractionRule,
  ExtractionSummary,
  Ga4EnrichmentReport,
  GscEnrichmentReport,
  KeywordSummary,
  LighthouseReport,
  LinkGraphReport,
  PrioritySummaryEntry,
  SiteReport,
  TermFrequency
} from "./types.js";

interface CliOptions {
  agentReadiness: boolean;
  concurrency: number | null;
  crux: boolean;
  gsc: boolean;
  gscProperty: string | null;
  gscDays: number | null;
  gscServiceAccountKeyFile: string | null;
  gscSetup: boolean;
  ga4: boolean;
  ga4Property: string | null;
  ga4Days: number | null;
  ga4ServiceAccountKeyFile: string | null;
  excludePathPatterns: string[];
  extract: string | null;
  extractFile: string | null;
  fullSitemap: boolean;
  htmlReportPath: string | null;
  includePathPatterns: string[];
  json: boolean;
  lighthouse: boolean;
  lighthousePages: number;
  noContentDedup: boolean;
  noLinkGraph: boolean;
  noPersist: boolean;
  noProgress: boolean;
  maxPages: number;
  outputPath: string | null;
  pdfReportPath: string | null;
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
  diffMode: boolean;
  diffOldPath: string | null;
  diffNewPath: string | null;
  diffAutoUrl: string | null;
  failOnSeverity: "high" | "medium" | "low" | null;
}

function printHelp(): void {
  console.log(`SEO Analysis CLI

Subcommands:
  diff <url>                  Compare the two most recent persisted crawls for <url>
  diff <old.json> <new.json>  Compare two report JSON files explicitly
  logs <path>                 Analyze a server/CDN access log. Use "-" for stdin.
                              Required: --site <url>.

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
  --agent-readiness          Score how prepared the site is for AI agent crawlers (llms.txt depth, AI-bot rules, well-known endpoints)
  --gsc                      Enrich crawled pages with Google Search Console clicks/impressions/CTR/position (service-account auth)
  --gsc-property <url>       Override GSC property auto-detection (URL-prefix or sc-domain:example.com)
  --gsc-days <n>             Days of GSC data to query. Default: 90
  --gsc-service-account-key-file <path>  Path to service-account JSON (overrides GOOGLE_APPLICATION_CREDENTIALS env var)
  --gsc-setup                Interactive wizard to create a GSC service account and print the next steps
  --ga4                      Enrich crawled pages with Google Analytics 4 sessions/pageviews/users/engagement (service-account auth; reuses --gsc-setup's SA)
  --ga4-property <id>        Override property auto-detection (e.g. properties/123456789)
  --ga4-days <n>             Days of GA4 data to query. Default: 90
  --ga4-service-account-key-file <path>  Path to service-account JSON (overrides GOOGLE_APPLICATION_CREDENTIALS env var)
  --render                   Render pages with headless Chromium (Playwright) instead of raw fetch — needed for SPAs and JS-challenge sites
  --render-timeout-ms <n>    Timeout per page render in milliseconds (default: 30000)
  --keyword <term>          Search for this keyword in crawled pages (repeatable)
  --keyword-file <path>     Read keywords from a file, one per line
  --extract-terms           Extract and rank the most frequent terms on the site
  --top-terms <n>           Number of top terms to report. Default: 20
  --from-directory <path>   Search local HTML files instead of crawling
  --extract <json>          Inline JSON of extraction rules (mutually exclusive with --extract-file)
  --extract-file <path>     JSON file of extraction rules
  --json                     Print raw JSON instead of a text report
  --output <file>            Write the final report to a file
  --no-progress              Disable the interactive stderr crawl progress line
  --no-persist               Skip persisting the crawl to ~/.config/seo-audit/crawls/.
                             Default: every successful audit is persisted.
                             Env: SEO_AUDIT_NO_PERSIST=1 sets the same.
  --no-content-dedup         Skip the near-duplicate content detection (MinHash).
  --no-link-graph            Skip the internal link-equity (PageRank) computation.
  --fail-on <severity>       Exit non-zero if issues at <severity> increased.
                             Fresh-audit mode: compares to the previous persisted crawl.
                             Diff mode: compares the two passed report files.
                             One of: high, medium, low.
  --html-report <file>       Write a polished HTML report to <file>
  --pdf-report <file>        Write a PDF report to <file> (uses Playwright/Chromium)
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

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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
    agentReadiness: false,
    concurrency: null,
    crux: false,
    gsc: false,
    gscProperty: null,
    gscDays: null,
    gscServiceAccountKeyFile: null,
    gscSetup: false,
    ga4: false,
    ga4Property: null,
    ga4Days: null,
    ga4ServiceAccountKeyFile: null,
    excludePathPatterns: [],
    extract: null,
    extractFile: null,
    fullSitemap: false,
    htmlReportPath: null,
    includePathPatterns: [],
    json: false,
    lighthouse: false,
    lighthousePages: 1,
    noContentDedup: false,
    noLinkGraph: false,
    noPersist: false,
    noProgress: false,
    maxPages: 10,
    outputPath: null,
    pdfReportPath: null,
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
    userAgent: null,
    diffMode: false,
    diffOldPath: null,
    diffNewPath: null,
    diffAutoUrl: null,
    failOnSeverity: null
  };

  if (argv[0] === "diff") {
    options.diffMode = true;
    const arg1 = argv[1];
    const arg2 = argv[2];
    if (arg1 && isHttpUrl(arg1) && (!arg2 || arg2.startsWith("--"))) {
      options.diffAutoUrl = arg1;
    } else if (arg1 && arg2) {
      options.diffOldPath = arg1;
      options.diffNewPath = arg2;
    }

    const flagLoopStart = options.diffAutoUrl ? 2 : 3;
    for (let index = flagLoopStart; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === "--json") { options.json = true; continue; }
      if (arg === "--output") {
        options.outputPath = requireValue(argv, index, "--output");
        index += 1; continue;
      }
      if (arg.startsWith("--output=")) { options.outputPath = arg.split("=").slice(1).join("="); continue; }
      if (arg === "--fail-on") {
        const v = requireValue(argv, index, "--fail-on");
        if (v !== "high" && v !== "medium" && v !== "low") {
          throw new Error("--fail-on must be high|medium|low");
        }
        options.failOnSeverity = v;
        index += 1; continue;
      }
      if (arg.startsWith("--fail-on=")) {
        const v = arg.split("=").slice(1).join("=");
        if (v !== "high" && v !== "medium" && v !== "low") {
          throw new Error("--fail-on must be high|medium|low");
        }
        options.failOnSeverity = v as "high" | "medium" | "low";
        continue;
      }
      if (arg === "--help" || arg === "-h") {
        printHelp();
        process.exit(0);
      }
      throw new Error(`Unknown option in diff mode: ${arg}`);
    }
    return options;
  }

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

    if (arg === "--agent-readiness") {
      options.agentReadiness = true;
      continue;
    }

    if (arg === "--gsc") {
      options.gsc = true;
      continue;
    }

    if (arg === "--gsc-setup") {
      options.gscSetup = true;
      continue;
    }

    if (arg === "--gsc-property") {
      options.gscProperty = requireValue(argv, index, "--gsc-property");
      index += 1;
      continue;
    }

    if (arg.startsWith("--gsc-property=")) {
      options.gscProperty = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg === "--gsc-days") {
      options.gscDays = parseNumberValue(requireValue(argv, index, "--gsc-days"), "--gsc-days");
      index += 1;
      continue;
    }

    if (arg.startsWith("--gsc-days=")) {
      options.gscDays = parseNumberValue(arg.split("=")[1] ?? "", "--gsc-days");
      continue;
    }

    if (arg === "--gsc-service-account-key-file") {
      options.gscServiceAccountKeyFile = requireValue(argv, index, "--gsc-service-account-key-file");
      index += 1;
      continue;
    }

    if (arg.startsWith("--gsc-service-account-key-file=")) {
      options.gscServiceAccountKeyFile = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg === "--ga4") {
      options.ga4 = true;
      continue;
    }
    if (arg === "--ga4-property") {
      options.ga4Property = requireValue(argv, index, "--ga4-property");
      index += 1;
      continue;
    }
    if (arg.startsWith("--ga4-property=")) {
      options.ga4Property = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--ga4-days") {
      options.ga4Days = parseNumberValue(requireValue(argv, index, "--ga4-days"), "--ga4-days");
      index += 1;
      continue;
    }
    if (arg.startsWith("--ga4-days=")) {
      options.ga4Days = parseNumberValue(arg.split("=")[1] ?? "", "--ga4-days");
      continue;
    }
    if (arg === "--ga4-service-account-key-file") {
      options.ga4ServiceAccountKeyFile = requireValue(argv, index, "--ga4-service-account-key-file");
      index += 1;
      continue;
    }
    if (arg.startsWith("--ga4-service-account-key-file=")) {
      options.ga4ServiceAccountKeyFile = arg.split("=").slice(1).join("=");
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

    if (arg === "--no-persist") {
      options.noPersist = true;
      continue;
    }

    if (arg === "--no-progress") {
      options.noProgress = true;
      continue;
    }

    if (arg === "--no-content-dedup") {
      options.noContentDedup = true;
      continue;
    }

    if (arg === "--no-link-graph") {
      options.noLinkGraph = true;
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

    if (arg === "--fail-on") {
      const v = requireValue(argv, index, "--fail-on");
      if (v !== "high" && v !== "medium" && v !== "low") {
        throw new Error("--fail-on must be high|medium|low");
      }
      options.failOnSeverity = v;
      index += 1;
      continue;
    }

    if (arg.startsWith("--fail-on=")) {
      const v = arg.split("=").slice(1).join("=");
      if (v !== "high" && v !== "medium" && v !== "low") {
        throw new Error("--fail-on must be high|medium|low");
      }
      options.failOnSeverity = v as "high" | "medium" | "low";
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

    if (arg === "--html-report") {
      options.htmlReportPath = requireValue(argv, index, "--html-report");
      index += 1;
      continue;
    }

    if (arg.startsWith("--html-report=")) {
      options.htmlReportPath = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg === "--pdf-report") {
      options.pdfReportPath = requireValue(argv, index, "--pdf-report");
      index += 1;
      continue;
    }

    if (arg.startsWith("--pdf-report=")) {
      options.pdfReportPath = arg.split("=").slice(1).join("=");
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

    if (arg === "--extract") {
      options.extract = requireValue(argv, index, "--extract");
      index += 1;
      continue;
    }

    if (arg.startsWith("--extract=")) {
      options.extract = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg === "--extract-file") {
      options.extractFile = requireValue(argv, index, "--extract-file");
      index += 1;
      continue;
    }

    if (arg.startsWith("--extract-file=")) {
      options.extractFile = arg.split("=").slice(1).join("=");
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.urls.push(arg);
  }

  if (options.gscSetup) {
    // Setup wizard short-circuits before crawl validation; URL is optional.
  } else if (options.fromDirectory) {
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

function resolveGoogleCredentialOptions(
  cliFilePath: string | null,
): { key?: string; keyFile?: string } {
  const inlineJson =
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? process.env.GSC_SERVICE_ACCOUNT_KEY ?? null;
  if (inlineJson && inlineJson.trim().length > 0) {
    return { key: inlineJson.trim() };
  }
  const filePath = cliFilePath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null;
  if (filePath && filePath.trim().length > 0) {
    return { keyFile: filePath.trim() };
  }
  return {};
}

function mapToGscCreds(creds: { key?: string; keyFile?: string }): {
  gscServiceAccountKey?: string;
  gscServiceAccountKeyFile?: string;
} {
  return {
    ...(creds.key !== undefined ? { gscServiceAccountKey: creds.key } : {}),
    ...(creds.keyFile !== undefined ? { gscServiceAccountKeyFile: creds.keyFile } : {}),
  };
}

function mapToGa4Creds(creds: { key?: string; keyFile?: string }): {
  ga4ServiceAccountKey?: string;
  ga4ServiceAccountKeyFile?: string;
} {
  return {
    ...(creds.key !== undefined ? { ga4ServiceAccountKey: creds.key } : {}),
    ...(creds.keyFile !== undefined ? { ga4ServiceAccountKeyFile: creds.keyFile } : {}),
  };
}

interface CliProgressReporter {
  onProgress?: (event: AnalyzeProgressEvent) => void;
  finish: () => void;
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function createCliProgressReporter(options: CliOptions): CliProgressReporter {
  const disabled =
    options.noProgress ||
    isTruthyEnv(process.env.SEO_AUDIT_NO_PROGRESS) ||
    isTruthyEnv(process.env.CI) ||
    !process.stderr.isTTY;

  if (disabled) {
    return { finish: () => undefined };
  }

  let wroteLine = false;

  return {
    onProgress(event) {
      const columns = process.stderr.columns ?? 120;
      const text = truncateMiddle(formatCliProgress(event), Math.max(20, columns - 1));
      process.stderr.write(`\r\x1b[2K${text}`);
      wroteLine = true;
    },
    finish() {
      if (!wroteLine) {
        return;
      }

      process.stderr.write("\r\x1b[2K");
      wroteLine = false;
    }
  };
}

function formatCliProgress(event: AnalyzeProgressEvent): string {
  const pages = formatProgressPages(event);
  const queue = `queued: ${event.queuedUrls}`;
  const active = event.activePages > 0 ? ` | active: ${event.activePages}` : "";

  if (event.phase === "crawl-start") {
    return `Crawling ${formatProgressUrl(event.url)} | ${pages} | ${queue}`;
  }

  if (event.phase === "page-start" || event.phase === "page-complete") {
    const current = formatProgressUrl(event.finalUrl ?? event.url);
    return `Crawling ${current} | ${pages} | ${queue}${active}`;
  }

  if (event.phase === "crawl-complete") {
    return `Crawled | ${pages} | finalizing report...`;
  }

  const stage = formatProgressStage(event.stage);
  if (event.phase === "analysis-start") {
    return `Crawled | ${pages} | ${stage}...`;
  }

  return `Crawled | ${pages} | completed ${stage}`;
}

function formatProgressPages(event: AnalyzeProgressEvent): string {
  if (event.maxPages === null) {
    return `pages: ${event.crawledPages}`;
  }

  return `pages: ${event.crawledPages}/${event.maxPages}`;
}

function formatProgressStage(stage: AnalyzeProgressStage | undefined): string {
  switch (stage) {
    case "lighthouse":
      return "running Lighthouse";
    case "agent-readiness":
      return "checking agent readiness";
    case "gsc":
      return "enriching from GSC";
    case "ga4":
      return "enriching from GA4";
    default:
      return "working";
  }
}

function formatProgressUrl(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }

  const keep = maxLength - 3;
  const startLength = Math.ceil(keep / 2);
  const endLength = Math.floor(keep / 2);
  return `${value.slice(0, startLength)}...${value.slice(value.length - endLength)}`;
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

function formatGscEnrichment(gsc: GscEnrichmentReport): string[] {
  if (gsc.error) {
    return ["", `GSC enrichment: ${gsc.error}`];
  }
  return [
    "",
    `GSC enrichment: property=${gsc.property} window=${gsc.startDate}..${gsc.endDate}`,
    `  rows fetched: ${gsc.totalRows}, matched to crawled pages: ${gsc.matchedPages}, unmatched: ${gsc.unmatchedRows}`
  ];
}

function formatGa4Enrichment(ga4: Ga4EnrichmentReport): string[] {
  if (ga4.error) {
    return ["", `GA4 enrichment: ${ga4.error}`];
  }
  return [
    "",
    `GA4 enrichment: property=${ga4.property} window=${ga4.startDate}..${ga4.endDate}`,
    `  rows fetched: ${ga4.totalRows}, matched to crawled pages: ${ga4.matchedPages}, unmatched: ${ga4.unmatchedRows}`,
  ];
}

function formatContentDedup(r: ContentDedupReport): string[] {
  if (r.clusters.length === 0) {
    return [
      "",
      `Content duplicates: 0 near-duplicate clusters (${r.pagesAnalyzed} analyzed, ${r.pagesSkipped} skipped due to short body).`,
    ];
  }
  const firstCluster = r.clusters[0];
  const lines = [
    "",
    `Content duplicates: ${r.clusters.length} cluster(s) covering ${r.totalNearDuplicatePages} pages (Jaccard ≥ ${firstCluster.threshold}, shingle=${firstCluster.shingleSize}):`,
  ];
  for (const c of r.clusters) {
    lines.push(`  Cluster (${c.members.length} pages, representative: ${c.representativeUrl}):`);
    const members = c.members.slice(0, 50);
    for (const m of members) {
      const tag = m.url === c.representativeUrl ? "★" : "·";
      lines.push(`    ${tag} ${m.url} (similarity ${m.similarityToRepresentative.toFixed(2)})`);
    }
    if (c.members.length > 50) {
      lines.push(`    … and ${c.members.length - 50} more`);
    }
  }
  return lines;
}

function formatLinkGraph(r: LinkGraphReport): string[] {
  if (r.pagesAnalyzed < 2) {
    return ["", `Internal link equity: skipped (need ≥2 crawled pages, have ${r.pagesAnalyzed}).`];
  }
  const lines = [
    "",
    `Internal link equity (PageRank d=${r.damping}, ${r.iterations} iterations, ${r.edges} internal edges):`,
    `  Top by PageRank:`,
  ];
  for (const e of r.topPages) {
    lines.push(
      `    ${e.url}  rank=${e.pageRank.toFixed(4)}  words=${e.wordCount}  incoming=${e.incomingInternalLinks}`,
    );
  }
  if (r.underLinkedImportantPages.length > 0) {
    lines.push(`  Underlinked important pages (high content, low rank):`);
    for (const e of r.underLinkedImportantPages) {
      lines.push(
        `    ${e.url}  rank=${e.pageRank.toFixed(4)}  words=${e.wordCount}  incoming=${e.incomingInternalLinks}`,
      );
    }
  }
  return lines;
}

function formatExtractions(s: ExtractionSummary): string[] {
  if (s.rules.length === 0) return [];
  const lines: string[] = ["", "Custom extractions:"];
  lines.push(`  Rules: ${s.rules.join(", ")} (${s.rules.length})`);
  lines.push("  Match coverage:");
  for (const name of s.rules) {
    const matched = s.matchCounts[name] ?? 0;
    const pct = s.pagesEvaluated === 0 ? 0 : Math.round((matched / s.pagesEvaluated) * 100);
    lines.push(`    ${name.padEnd(20)} ${pct}% (${matched}/${s.pagesEvaluated})`);
  }
  if (s.pagesWithMissingRequired > 0) {
    lines.push(`  Pages with missing required fields: ${s.pagesWithMissingRequired}`);
    for (const name of s.rules) {
      const m = s.missingRequiredCounts[name] ?? 0;
      if (m > 0) lines.push(`    ${name}: ${m}`);
    }
  }
  return lines;
}

function formatPriorityIssues(entries: PrioritySummaryEntry[]): string[] {
  if (entries.length === 0) return [];
  const lines = ["", "Priority issues (high/medium severity on pages with traffic):"];
  for (const e of entries) {
    if (e.rankedBy === "gsc") {
      const g = e.metrics.gsc;
      lines.push(
        `  [${e.severity}] ${e.code} — ${e.url} (via GSC: impr=${g?.impressions ?? 0}, clicks=${g?.clicks ?? 0}, pos=${(g?.position ?? 0).toFixed(1)})`,
      );
    } else {
      const g = e.metrics.ga4;
      lines.push(
        `  [${e.severity}] ${e.code} — ${e.url} (via GA4: sessions=${g?.sessions ?? 0}, users=${g?.totalUsers ?? 0}, eng=${((g?.engagementRate ?? 0) * 100).toFixed(1)}%)`,
      );
    }
  }
  return lines;
}

function formatAgentReadiness(readiness: AgentReadinessReport): string[] {
  const lines = [
    "",
    `Agent Readiness: score=${readiness.score}/100 (discoverability=${readiness.subscores.discoverability} content=${readiness.subscores.contentAccessibility} bot_access=${readiness.subscores.botAccessControl} capabilities=${readiness.subscores.capabilities})`
  ];

  const explicitBots = readiness.botAccessControl.aiBots.filter((b) => b.status !== "unspecified");
  if (explicitBots.length === 0) {
    lines.push("  AI bot policy: no explicit rules for known agents");
  } else {
    lines.push(
      `  AI bot policy: ${explicitBots
        .map((b) => `${b.userAgent}=${b.status}`)
        .join(", ")}`
    );
  }

  const signals = readiness.botAccessControl.contentSignals;
  if (
    signals.search !== "unspecified" ||
    signals.aiTrain !== "unspecified" ||
    signals.aiInput !== "unspecified"
  ) {
    lines.push(
      `  Content signals: search=${signals.search} ai-train=${signals.aiTrain} ai-input=${signals.aiInput}`
    );
  }

  if (readiness.contentAccessibility.llmsTxtPresent) {
    const a = readiness.contentAccessibility.llmsTxtAnalysis;
    if (a) {
      lines.push(
        `  llms.txt: ${a.byteSize}B sections=${a.sectionCount} links=${a.linkCount} h1=${a.hasH1 ? "yes" : "no"}`
      );
    }
  } else {
    lines.push("  llms.txt: missing");
  }

  lines.push(
    `  llms-full.txt: ${readiness.contentAccessibility.llmsFullTxtPresent ? "present" : "missing"}`
  );
  lines.push(
    `  markdown content negotiation: ${readiness.contentAccessibility.markdownNegotiationSupported ? "supported" : "not advertised"}`
  );
  lines.push(
    `  Web Bot Auth directory: ${readiness.botAccessControl.webBotAuthAdvertised ? "advertised" : "not advertised"}`
  );

  const presentProbes = readiness.capabilities.probes.filter((p) => p.present);
  lines.push(
    `  well-known endpoints: ${presentProbes.length}/${readiness.capabilities.probes.length}` +
      (presentProbes.length > 0 ? ` (${presentProbes.map((p) => p.name).join(", ")})` : "")
  );

  const cov = readiness.capabilities.schemaCoverage;
  lines.push(
    `  homepage Org/WebSite schema: ${cov.homepageHasOrgOrWebsite ? "yes" : "no"}; article schema: ${cov.articleLikePagesWithSchema}/${cov.articleLikePages}`
  );

  if (readiness.issues.length > 0) {
    lines.push("  Agent readiness issues:");
    for (const issue of readiness.issues) {
      lines.push(`  - ${issue.code}: ${issue.message}`);
    }
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

  const gsc = page.metrics?.gsc;
  if (gsc) {
    lines.splice(2, 0, `  gsc impressions=${gsc.impressions} clicks=${gsc.clicks} ctr=${(gsc.ctr * 100).toFixed(1)}% pos=${gsc.position.toFixed(1)}`);
  }

  const ga4 = page.metrics?.ga4;
  if (ga4) {
    // Insert below the GSC line if present, otherwise at the same position.
    lines.splice(gsc ? 3 : 2, 0, `  ga4 sessions=${ga4.sessions} pageviews=${ga4.screenPageViews} users=${ga4.totalUsers} eng=${(ga4.engagementRate * 100).toFixed(1)}%`);
  }

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

  if (report.agentReadiness) {
    lines.push(...formatAgentReadiness(report.agentReadiness));
  }

  if (report.gsc) {
    lines.push(...formatGscEnrichment(report.gsc));
  }

  if (report.ga4) {
    lines.push(...formatGa4Enrichment(report.ga4));
  }

  if (report.contentDedup) lines.push(...formatContentDedup(report.contentDedup));
  if (report.linkGraph)    lines.push(...formatLinkGraph(report.linkGraph));
  if (report.extractionSummary) lines.push(...formatExtractions(report.extractionSummary));

  if (report.summary.priorityIssues && report.summary.priorityIssues.length > 0) {
    lines.push(...formatPriorityIssues(report.summary.priorityIssues));
  }

  if (report.keywordSummary) {
    lines.push(...formatKeywordSummary(report.keywordSummary));
  }

  if (report.topTerms) {
    lines.push(...formatTopTerms(report.topTerms));
  }

  return lines.join("\n");
}

async function runLogsSubcommand(argv: string[]): Promise<void> {
  let path: string | null = null;
  let site: string | null = null;
  let format: "auto" | "combined" | "json" | "cloudflare" | "fastly" = "auto";
  let verifyBots = true;
  let since: string | undefined;
  let until: string | undefined;
  let asJson = false;
  let outputPath: string | null = null;
  let htmlReportPath: string | null = null;
  let pdfReportPath: string | null = null;
  let noProgress = false;
  let failOnSeverity: "high" | "medium" | "low" | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--site") { site = argv[++i] ?? null; continue; }
    if (arg === "--format") {
      const v = argv[++i] ?? "";
      if (!["auto", "combined", "json", "cloudflare", "fastly"].includes(v)) {
        throw new Error("--format must be one of auto|combined|json|cloudflare|fastly");
      }
      format = v as typeof format;
      continue;
    }
    if (arg === "--no-verify-bots") { verifyBots = false; continue; }
    if (arg === "--since") { since = argv[++i]; continue; }
    if (arg === "--until") { until = argv[++i]; continue; }
    if (arg === "--json") { asJson = true; continue; }
    if (arg === "--output") { outputPath = argv[++i] ?? null; continue; }
    if (arg === "--html-report") { htmlReportPath = argv[++i] ?? null; continue; }
    if (arg === "--pdf-report") { pdfReportPath = argv[++i] ?? null; continue; }
    if (arg === "--no-progress") { noProgress = true; continue; }
    if (arg === "--fail-on") {
      const v = argv[++i];
      if (v !== "high" && v !== "medium" && v !== "low") {
        throw new Error("--fail-on must be high|medium|low");
      }
      failOnSeverity = v;
      continue;
    }
    if (!arg.startsWith("--") && path === null) { path = arg; continue; }
    throw new Error(`Unknown logs argument: ${arg}`);
  }
  if (path === null) {
    console.error("Usage: seo-audit logs <path|-> --site <url> [options]");
    process.exit(1);
  }
  if (site === null) {
    console.error("--site is required for `seo-audit logs`.");
    process.exit(1);
  }

  const { analyzeLogs } = await import("./logs/index.js");
  const report = await analyzeLogs(path, {
    site,
    format,
    verifyBots,
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(noProgress ? {} : { onProgress: () => { /* progress UI deferred */ } }),
  });

  const json = JSON.stringify(report, null, 2);
  const text = formatLogAnalysisReport(report);

  if (asJson) {
    if (outputPath !== null) {
      await writeFile(outputPath, json, "utf8");
    } else {
      process.stdout.write(json);
      process.stdout.write("\n");
    }
    process.stderr.write(
      `Log analysis: ${report.timeWindow.durationHours}h, ${totalBotHits(report)} bot hits, ` +
      `${report.orphans.length} orphans, ${report.stalePriorities.length} stale priorities, ` +
      `${report.statusMismatches.length} status mismatches.\n`
    );
  } else {
    process.stdout.write(text);
    process.stdout.write("\n");
    if (outputPath !== null) await writeFile(outputPath, json, "utf8");
  }

  if (htmlReportPath !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reportMod = await import("./report.js") as any;
    const html: string = reportMod.renderLogAnalysisReport(report);
    await writeFile(htmlReportPath, html, "utf8");
  }
  if (pdfReportPath !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reportMod = await import("./report.js") as any;
    const html: string = reportMod.renderLogAnalysisReport(report);
    await reportMod.renderPdfReport(html, pdfReportPath);
  }

  if (failOnSeverity !== null) {
    const failingSeverities =
      failOnSeverity === "high" ? ["high"] :
      failOnSeverity === "medium" ? ["high", "medium"] :
      ["high", "medium", "low"];
    const triggered = report.issues.some((i) => failingSeverities.includes(i.severity));
    if (triggered) process.exit(2);
  }
}

function totalBotHits(r: import("./types.js").LogAnalysisReport): number {
  return r.bots.reduce((sum, b) => sum + b.hits, 0);
}

function formatLogAnalysisReport(r: import("./types.js").LogAnalysisReport): string {
  const lines: string[] = [];
  lines.push(`Log analysis: ${r.source} (format=${r.format})`);
  if (r.timeWindow.earliest !== "") {
    lines.push(`Log window:      ${r.timeWindow.earliest} → ${r.timeWindow.latest}  (${r.timeWindow.durationHours}h)`);
  }
  if (r.baselineCrawl !== null) {
    lines.push(`Crawl baseline:  ${r.baselineCrawl.crawledAt}  (${r.baselineCrawl.daysOld} days old, ${r.baselineCrawl.pages} pages)`);
  } else {
    lines.push("Crawl baseline:  none — Layer B disabled. Run `seo-audit <site>` to enable joined findings.");
  }
  lines.push(`Total lines:     ${r.totalLines} (parse errors: ${r.parseErrors})`);
  lines.push(`Spoofed hits:    ${r.spoofedHits}`);
  lines.push(`Unverified hits: ${r.unverifiedBotHits}`);
  lines.push("");
  lines.push("Bots:");
  if (r.bots.length === 0) lines.push("  (none)");
  for (const b of r.bots) {
    lines.push(`  ${b.name.padEnd(16)} hits=${b.hits} urls=${b.uniqueUrls} ips=${b.uniqueIps}`);
  }
  if (r.orphans.length > 0) {
    lines.push("", `Orphan pages (${r.orphans.length}):`);
    for (const o of r.orphans.slice(0, 20)) lines.push(`  ${o.url}  hits=${o.hits}`);
    if (r.orphans.length > 20) lines.push(`  … and ${r.orphans.length - 20} more`);
  }
  if (r.stalePriorities.length > 0) {
    lines.push("", `Stale priority pages (${r.stalePriorities.length}):`);
    for (const s of r.stalePriorities) {
      const days = s.daysSinceLastCrawl === null ? "never" : `${s.daysSinceLastCrawl}d`;
      lines.push(`  ${s.url}  rank=${s.pageRank.toFixed(4)}  last=${days}`);
    }
  }
  if (r.statusMismatches.length > 0) {
    lines.push("", `Status mismatches (${r.statusMismatches.length}):`);
    for (const m of r.statusMismatches.slice(0, 20)) {
      lines.push(`  ${m.url}  crawl=${m.crawlStatus}  worstLog=${m.worstStatus}  hits=${m.hits}`);
    }
    if (r.statusMismatches.length > 20) lines.push(`  … and ${r.statusMismatches.length - 20} more`);
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
    if (process.argv[2] === "logs") {
      await runLogsSubcommand(process.argv.slice(3));
      return;
    }

    const options = parseArgs(process.argv.slice(2));

    if (options.gscSetup) {
      const { runGscSetup } = await import("./gsc-setup.js");
      await runGscSetup(options.urls[0]);
      return;
    }

    if (options.diffMode) {
      const { diffSiteReports, renderDiffText, renderDiffJson } = await import("./diff.js");
      let oldReport: SiteReport;
      let newReport: SiteReport;

      if (options.diffAutoUrl) {
        const recent = await recentCrawlsForUrl(options.diffAutoUrl, 2);
        if (recent.length < 2) {
          throw new Error(
            `Need at least 2 persisted crawls for ${options.diffAutoUrl} (have ${recent.length}). ` +
            `Run \`seo-audit ${options.diffAutoUrl}\` first, or pass explicit paths: ` +
            `\`seo-audit diff <old.json> <new.json>\`.`,
          );
        }
        oldReport = await loadCrawl(recent[1].path);
        newReport = await loadCrawl(recent[0].path);
        console.error(`Comparing ${recent[1].timestamp} → ${recent[0].timestamp}`);
      } else if (options.diffOldPath && options.diffNewPath) {
        const [oldRaw, newRaw] = await Promise.all([
          readFile(options.diffOldPath, "utf8"),
          readFile(options.diffNewPath, "utf8"),
        ]);
        const oldParsed = JSON.parse(oldRaw);
        const newParsed = JSON.parse(newRaw);
        oldReport = Array.isArray(oldParsed) ? oldParsed[0] : oldParsed;
        newReport = Array.isArray(newParsed) ? newParsed[0] : newParsed;
      } else {
        throw new Error("diff requires either <url> or <old.json> <new.json>");
      }

      const diff = diffSiteReports(oldReport, newReport);
      const out = options.json ? renderDiffJson(diff) : renderDiffText(diff);
      if (options.outputPath) {
        await writeFile(options.outputPath, out, "utf8");
      } else {
        console.log(out);
      }
      if (options.failOnSeverity) {
        const delta = diff.severityDelta[options.failOnSeverity];
        if (delta > 0) {
          console.error(`fail-on: ${options.failOnSeverity} severity increased by ${delta}`);
          process.exit(1);
        }
      }
      return;
    }

    const keywords = await loadKeywords(options.keywords, options.keywordFile);
    const reports: SiteReport[] = [];

    let extractRules: Record<string, ExtractionRule> | undefined;
    if (options.extract !== null && options.extractFile !== null) {
      console.error("Use --extract or --extract-file, not both.");
      process.exit(1);
    }
    if (options.extractFile !== null) {
      try {
        const contents = await readFile(options.extractFile, "utf8");
        extractRules = parseExtractionRules(contents);
      } catch (err) {
        console.error(`Failed to load --extract-file: ${(err as Error).message}`);
        process.exit(1);
      }
    } else if (options.extract !== null) {
      try {
        extractRules = parseExtractionRules(options.extract);
      } catch (err) {
        console.error(`Failed to parse --extract: ${(err as Error).message}`);
        process.exit(1);
      }
    }

    if (options.fromDirectory) {
      const report = await scanDirectory(options.fromDirectory, {
        keywords,
        extractTerms: options.extractTerms,
        topTermsCount: options.topTerms,
      });
      reports.push(report);
    } else {
      for (const url of options.urls) {
        const progress = createCliProgressReporter(options);
        try {
          reports.push(await analyzeSite(url, {
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
            agentReadiness: options.agentReadiness,
            gsc: options.gsc,
            ...(options.gscProperty ? { gscProperty: options.gscProperty } : {}),
            ...(options.gscDays !== null ? { gscDays: options.gscDays } : {}),
            ...mapToGscCreds(resolveGoogleCredentialOptions(options.gscServiceAccountKeyFile)),
            ga4: options.ga4,
            ...(options.ga4Property ? { ga4Property: options.ga4Property } : {}),
            ...(options.ga4Days !== null ? { ga4Days: options.ga4Days } : {}),
            ...mapToGa4Creds(resolveGoogleCredentialOptions(options.ga4ServiceAccountKeyFile)),
            contentDedup: !options.noContentDedup,
            linkGraph: !options.noLinkGraph,
            ...(extractRules ? { extract: extractRules } : {}),
            render: options.render,
            ...(options.renderTimeoutMs ? { renderTimeoutMs: options.renderTimeoutMs } : {}),
            retries: options.retries,
            sampleSitemap: options.sampleSitemap,
            seedSitemap: options.seedSitemap,
            timeoutMs: options.timeoutMs,
            ...(options.userAgent ? { userAgent: options.userAgent } : {}),
            ...(progress.onProgress ? { onProgress: progress.onProgress } : {}),
          }));
        } finally {
          progress.finish();
        }
      }
    }

    // Phase 3: persist every report first, then run fail-on checks. Two-pass
    // ordering matters in the multi-URL case: if URL1 regresses, we don't want
    // to skip persisting URL2 just because process.exit fires mid-loop.
    const persistDisabled =
      options.noPersist ||
      process.env.SEO_AUDIT_NO_PERSIST === "1" ||
      process.env.SEO_AUDIT_NO_PERSIST === "true";

    const previousByReport = new Map<SiteReport, string | null>();

    for (const report of reports) {
      let previousPath: string | null = null;
      if (!persistDisabled) {
        try {
          const result = await persistCrawl(report);
          previousPath = result.previousPath;
          if (result.isFirstForHost) {
            console.error(
              `Persisting crawl to ${result.path}. Use --no-persist (or SEO_AUDIT_NO_PERSIST=1) to opt out.`,
            );
          }
        } catch (err) {
          console.error(`Warning: failed to persist crawl: ${(err as Error).message}`);
        }
      } else if (options.failOnSeverity) {
        try {
          const recent = await recentCrawlsForUrl(report.startUrl, 1);
          previousPath = recent[0]?.path ?? null;
        } catch (err) {
          console.error(`Warning: could not read crawl history: ${(err as Error).message}`);
        }
      }
      previousByReport.set(report, previousPath);
    }

    if (options.failOnSeverity) {
      for (const report of reports) {
        const previousPath = previousByReport.get(report) ?? null;
        let previous: SiteReport | null = null;
        if (previousPath) {
          try {
            previous = await loadCrawl(previousPath);
          } catch (err) {
            console.error(`Warning: could not read previous crawl at ${previousPath}: ${(err as Error).message}`);
          }
        }
        const decision = evaluateFailOn(report, previous, options.failOnSeverity);
        if (!previous) {
          console.error(
            `No prior crawl found for ${report.startUrl}; skipping --fail-on regression check.`,
          );
        } else if (decision.shouldFail) {
          console.error(`--fail-on ${options.failOnSeverity}: ${decision.reason}`);
          process.exit(1);
        }
      }
    }

    const output = options.json
      ? JSON.stringify(reports, null, 2)
      : reports.map(formatTextReport).join("\n\n");

    await maybeWriteOutput(options.outputPath, output);

    if (options.htmlReportPath) {
      const { renderHtmlReport } = await import("./report.js");
      const html = reports.length === 1
        ? renderHtmlReport(reports[0])
        : reports.map(renderHtmlReport).join("\n<hr>\n");
      await writeFile(options.htmlReportPath, html, "utf8");
      console.error(`HTML report written to ${options.htmlReportPath}`);
    }

    if (options.pdfReportPath) {
      if (reports.length !== 1) {
        throw new Error(`--pdf-report requires exactly one URL (got ${reports.length}).`);
      }
      const { renderPdfReport } = await import("./report.js");
      const buf = await renderPdfReport(reports[0]);
      await writeFile(options.pdfReportPath, buf);
      console.error(`PDF report written to ${options.pdfReportPath}`);
    }

    console.log(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CLI error";
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

await main();
