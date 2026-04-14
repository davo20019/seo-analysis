import { load } from "cheerio";

import type {
  AnalyzeOptions,
  DuplicateGroup,
  InfrastructureReport,
  Issue,
  PageChecks,
  PageReport,
  Severity,
  SiteReport
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRIES = 2;
const DEFAULT_USER_AGENT = "seo-analysis-cli/0.2";
const MAX_QUEUE_FACTOR = 20;
const MAX_SITEMAP_FILES = 20;
const RETRY_BASE_DELAY_MS = 250;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SUSPICIOUS_METADATA_PATTERNS = [/\[object object\]/i, /\bundefined\b/i, /\bnull\b/i];
const SKIP_FILE_PATTERN =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?|xml|zip)$/i;

interface FetchResult {
  contentType: string | null;
  finalUrl: string;
  status: number;
  text: string;
}

interface FetchOptions {
  retries: number;
  timeoutMs: number;
  userAgent: string;
}

interface PathFilters {
  exclude: RegExp[];
  include: RegExp[];
}

interface InspectInfrastructureResult {
  crawlSeeds: string[];
  report: InfrastructureReport;
}

function createEmptyChecks(): PageChecks {
  return {
    title: null,
    titleLength: 0,
    metaDescription: null,
    metaDescriptionLength: 0,
    canonical: null,
    htmlLang: null,
    robotsMeta: null,
    h1s: [],
    wordCount: 0,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: 0,
    externalLinks: 0,
    openGraph: {
      title: null,
      description: null,
      image: null
    },
    schemaTypes: []
  };
}

function normalizeUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.hash = "";

  if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

function shouldSkipUrl(url: URL): boolean {
  if (!["http:", "https:"].includes(url.protocol)) {
    return true;
  }

  return SKIP_FILE_PATTERN.test(url.pathname);
}

function makeIssue(
  code: string,
  severity: Severity,
  message: string,
  recommendation: string
): Issue {
  return { code, severity, message, recommendation };
}

function pushIssue(issues: Issue[], issue: Issue): void {
  if (!issues.some((existing) => existing.code === issue.code)) {
    issues.push(issue);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function hasSuspiciousMetadataValue(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return SUSPICIOUS_METADATA_PATTERNS.some((pattern) => pattern.test(value));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function compilePatterns(rawPatterns: string[] | undefined, label: string): RegExp[] {
  return (rawPatterns ?? []).map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown regex error";
      throw new Error(`Invalid ${label} pattern "${pattern}": ${message}`);
    }
  });
}

function matchesPathFilters(url: string, filters: PathFilters): boolean {
  const parsed = new URL(url);
  const value = `${parsed.pathname}${parsed.search}`;

  if (filters.include.length > 0 && !filters.include.some((pattern) => pattern.test(value))) {
    return false;
  }

  if (filters.exclude.some((pattern) => pattern.test(value))) {
    return false;
  }

  return true;
}

async function fetchText(url: string, options: FetchOptions): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": options.userAgent,
        accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8"
      },
      signal: controller.signal
    });

    return {
      contentType: response.headers.get("content-type"),
      finalUrl: response.url,
      status: response.status,
      text: await response.text()
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithRetry(url: string, options: FetchOptions): Promise<FetchResult> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetchText(url, options);

      if (attempt < options.retries && isRetryableStatus(response.status)) {
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt >= options.retries) {
        throw error;
      }

      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`));
}

function extractSchemaTypes(rawScripts: string[]): string[] {
  const types = new Set<string>();

  const visitNode = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visitNode);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const typeValue = record["@type"];

    if (typeof typeValue === "string" && typeValue.trim()) {
      types.add(typeValue.trim());
    }

    if (Array.isArray(typeValue)) {
      typeValue
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .forEach((item) => types.add(item.trim()));
    }

    if (record["@graph"]) {
      visitNode(record["@graph"]);
    }
  };

  for (const rawScript of rawScripts) {
    try {
      visitNode(JSON.parse(rawScript));
    } catch {
      continue;
    }
  }

  return [...types];
}

function parseRobotsTxt(text: string): { blocksAllCrawlers: boolean; sitemaps: string[] } {
  const lines = text.split(/\r?\n/);
  const sitemaps: string[] = [];
  let currentAppliesToAll = false;
  let blocksAllCrawlers = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();

    if (!line) {
      currentAppliesToAll = false;
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "user-agent") {
      currentAppliesToAll = value === "*";
      continue;
    }

    if (key === "sitemap" && value) {
      sitemaps.push(value);
      continue;
    }

    if (currentAppliesToAll && key === "disallow" && value === "/") {
      blocksAllCrawlers = true;
    }
  }

  return {
    blocksAllCrawlers,
    sitemaps: [...new Set(sitemaps)]
  };
}

function extractSitemapLocations(text: string, baseUrl: string): string[] {
  const matches = text.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi);
  const locations = new Set<string>();

  for (const match of matches) {
    const rawLocation = match[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim();

    if (!rawLocation) {
      continue;
    }

    try {
      locations.add(normalizeUrl(new URL(rawLocation, baseUrl).toString()));
    } catch {
      continue;
    }
  }

  return [...locations];
}

async function collectSitemapSeeds(
  sitemapUrls: string[],
  options: FetchOptions,
  maxUrls: number
): Promise<string[]> {
  const queue = [...new Set(sitemapUrls.map(normalizeUrl))];
  const visitedSitemaps = new Set<string>();
  const seedUrls = new Set<string>();

  while (
    queue.length > 0 &&
    visitedSitemaps.size < MAX_SITEMAP_FILES &&
    seedUrls.size < maxUrls
  ) {
    const sitemapUrl = queue.shift();

    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) {
      continue;
    }

    visitedSitemaps.add(sitemapUrl);

    try {
      const response = await fetchTextWithRetry(sitemapUrl, options);

      if (response.status < 200 || response.status >= 300) {
        continue;
      }

      const locations = extractSitemapLocations(response.text, response.finalUrl);

      if (/<sitemapindex[\s>]/i.test(response.text)) {
        for (const location of locations) {
          if (!visitedSitemaps.has(location) && queue.length < MAX_SITEMAP_FILES * 4) {
            queue.push(location);
          }
        }

        continue;
      }

      for (const location of locations) {
        try {
          if (shouldSkipUrl(new URL(location))) {
            continue;
          }
        } catch {
          continue;
        }

        seedUrls.add(location);

        if (seedUrls.size >= maxUrls) {
          break;
        }
      }
    } catch {
      continue;
    }
  }

  return [...seedUrls];
}

async function inspectInfrastructure(
  startUrl: string,
  options: FetchOptions,
  seedSitemap: boolean,
  maxSeedUrls: number
): Promise<InspectInfrastructureResult> {
  const origin = new URL(startUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const sitemapUrl = new URL("/sitemap.xml", origin).toString();
  const issues: Issue[] = [];

  const robotsTxt = {
    url: robotsUrl,
    present: false,
    status: null as number | null,
    sitemaps: [] as string[],
    blocksAllCrawlers: false
  };

  const sitemap = {
    url: sitemapUrl,
    present: false,
    status: null as number | null,
    urlCount: 0,
    isIndex: false
  };

  const [robotsResult, sitemapResult] = await Promise.allSettled([
    fetchTextWithRetry(robotsUrl, options),
    fetchTextWithRetry(sitemapUrl, options)
  ]);

  if (robotsResult.status === "fulfilled") {
    robotsTxt.status = robotsResult.value.status;

    if (robotsResult.value.status >= 200 && robotsResult.value.status < 300) {
      robotsTxt.present = true;
      const parsed = parseRobotsTxt(robotsResult.value.text);
      robotsTxt.sitemaps = parsed.sitemaps;
      robotsTxt.blocksAllCrawlers = parsed.blocksAllCrawlers;

      if (parsed.blocksAllCrawlers) {
        pushIssue(
          issues,
          makeIssue(
            "ROBOTS_BLOCKS_ALL",
            "high",
            "robots.txt blocks all crawlers with `Disallow: /` for `User-agent: *`.",
            "Confirm whether the site should actually be blocked from search engines."
          )
        );
      }

      if (parsed.sitemaps.length === 0) {
        pushIssue(
          issues,
          makeIssue(
            "ROBOTS_NO_SITEMAP",
            "low",
            "robots.txt does not list a sitemap.",
            "Add at least one `Sitemap:` directive so crawlers can discover important URLs faster."
          )
        );
      }
    } else {
      pushIssue(
        issues,
        makeIssue(
          "ROBOTS_MISSING",
          "medium",
          "robots.txt is missing or returns a non-success status.",
          "Publish a valid robots.txt file, even if it only allows all crawling and lists the sitemap."
        )
      );
    }
  } else {
    pushIssue(
      issues,
      makeIssue(
        "ROBOTS_UNREACHABLE",
        "medium",
        "robots.txt could not be fetched.",
        "Verify that the site is reachable and serving infrastructure files consistently."
      )
    );
  }

  if (sitemapResult.status === "fulfilled") {
    sitemap.status = sitemapResult.value.status;

    if (sitemapResult.value.status >= 200 && sitemapResult.value.status < 300) {
      sitemap.present = true;
      sitemap.urlCount = (sitemapResult.value.text.match(/<loc>/gi) ?? []).length;
      sitemap.isIndex = /<sitemapindex[\s>]/i.test(sitemapResult.value.text);
    } else if (robotsTxt.sitemaps.length === 0) {
      pushIssue(
        issues,
        makeIssue(
          "SITEMAP_MISSING",
          "medium",
          "sitemap.xml is missing or returns a non-success status.",
          "Publish a sitemap.xml file or ensure the sitemap declared in robots.txt is accessible."
        )
      );
    }
  } else if (robotsTxt.sitemaps.length === 0) {
    pushIssue(
      issues,
      makeIssue(
        "SITEMAP_UNREACHABLE",
        "medium",
        "sitemap.xml could not be fetched.",
        "Verify that the site exposes a sitemap and that the file is publicly reachable."
      )
    );
  }

  let crawlSeeds: string[] = [];

  if (seedSitemap) {
    const sitemapTargets = [...new Set([sitemapUrl, ...robotsTxt.sitemaps])];
    crawlSeeds = await collectSitemapSeeds(sitemapTargets, options, maxSeedUrls);
  }

  return {
    crawlSeeds,
    report: {
      robotsTxt,
      sitemap,
      issues
    }
  };
}

function resolveCanonical(rawCanonical: string | undefined, baseUrl: string): string | null {
  if (!rawCanonical?.trim()) {
    return null;
  }

  try {
    return normalizeUrl(new URL(rawCanonical.trim(), baseUrl).toString());
  } catch {
    return rawCanonical.trim();
  }
}

function textLength(value: string | null): number {
  return value ? value.length : 0;
}

function analyzeHtml(
  requestedUrl: string,
  response: FetchResult,
  html: string,
  allowedHosts: Set<string>
): PageReport {
  const $ = load(html);
  const issues: Issue[] = [];
  const finalUrl = normalizeUrl(response.finalUrl);
  const effectiveHosts = new Set(allowedHosts);
  effectiveHosts.add(new URL(finalUrl).hostname);

  const title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
  const titleCount = $("title").length;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.replace(/\s+/g, " ").trim() || null;
  const canonical = resolveCanonical($('link[rel="canonical"]').attr("href"), finalUrl);
  const htmlLang = $("html").attr("lang")?.trim() || null;
  const robotsMeta = $('meta[name="robots"]').attr("content")?.trim() || null;
  const h1s = $("h1")
    .map((_, element) => $(element).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean);
  const images = $("img");
  const imagesMissingAlt = images
    .toArray()
    .filter((element) => {
      const alt = $(element).attr("alt");
      return alt === undefined || alt.trim() === "";
    }).length;
  const openGraph = {
    title: $('meta[property="og:title"]').attr("content")?.trim() || null,
    description: $('meta[property="og:description"]').attr("content")?.trim() || null,
    image: $('meta[property="og:image"]').attr("content")?.trim() || null
  };
  const suspiciousMetadataFields = [
    ["title", title],
    ["meta description", metaDescription],
    ["canonical", canonical],
    ["og:title", openGraph.title],
    ["og:description", openGraph.description],
    ["og:image", openGraph.image]
  ]
    .filter(([, value]) => hasSuspiciousMetadataValue(value))
    .map(([field]) => field);
  const schemaTypes = extractSchemaTypes(
    $('script[type="application/ld+json"]')
      .map((_, element) => $(element).html() ?? "")
      .get()
  );
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  let internalLinks = 0;
  let externalLinks = 0;
  const discoveredLinks = new Set<string>();

  $('a[href]').each((_, element) => {
    const rawHref = $(element).attr("href");

    if (!rawHref) {
      return;
    }

    try {
      const resolved = new URL(rawHref, finalUrl);

      if (shouldSkipUrl(resolved)) {
        return;
      }

      const normalizedHref = normalizeUrl(resolved.toString());

      if (effectiveHosts.has(resolved.hostname)) {
        internalLinks += 1;
        discoveredLinks.add(normalizedHref);
      } else {
        externalLinks += 1;
      }
    } catch {
      return;
    }
  });

  if (new URL(finalUrl).protocol !== "https:") {
    pushIssue(
      issues,
      makeIssue(
        "PAGE_NOT_HTTPS",
        "high",
        "The page is served over HTTP instead of HTTPS.",
        "Serve the canonical public URL over HTTPS to avoid trust and ranking issues."
      )
    );
  }

  if (normalizeUrl(requestedUrl) !== finalUrl) {
    pushIssue(
      issues,
      makeIssue(
        "URL_REDIRECTED",
        "low",
        "The requested URL redirects to a different final URL.",
        "Use the final canonical URL consistently in internal links and sitemap entries."
      )
    );
  }

  if (!title) {
    pushIssue(
      issues,
      makeIssue(
        "TITLE_MISSING",
        "high",
        "The page is missing a title tag.",
        "Add a unique title tag that targets the page's primary keyword and intent."
      )
    );
  } else {
    if (titleCount > 1) {
      pushIssue(
        issues,
        makeIssue(
          "TITLE_MULTIPLE",
          "medium",
          "The page contains multiple title tags.",
          "Render exactly one title tag in the document head."
        )
      );
    }

    if (title.length < 20) {
      pushIssue(
        issues,
        makeIssue(
          "TITLE_TOO_SHORT",
          "low",
          "The title tag is shorter than 20 characters.",
          "Expand the title so it communicates the page topic more clearly in search results."
        )
      );
    } else if (title.length > 60) {
      pushIssue(
        issues,
        makeIssue(
          "TITLE_TOO_LONG",
          "low",
          "The title tag is longer than 60 characters.",
          "Shorten the title to reduce truncation in search results."
        )
      );
    }
  }

  if (!metaDescription) {
    pushIssue(
      issues,
      makeIssue(
        "META_DESCRIPTION_MISSING",
        "medium",
        "The page is missing a meta description.",
        "Add a concise meta description that summarizes the page value proposition."
      )
    );
  } else if (metaDescription.length < 70 || metaDescription.length > 160) {
    pushIssue(
      issues,
      makeIssue(
        "META_DESCRIPTION_LENGTH",
        "low",
        "The meta description length is outside the typical 70-160 character range.",
        "Rewrite the description so it is descriptive without being truncated."
      )
    );
  }

  if (!htmlLang) {
    pushIssue(
      issues,
      makeIssue(
        "HTML_LANG_MISSING",
        "low",
        "The root html element is missing a lang attribute.",
        "Set the document language to improve accessibility and international SEO signals."
      )
    );
  }

  if (!canonical) {
    pushIssue(
      issues,
      makeIssue(
        "CANONICAL_MISSING",
        "medium",
        "The page is missing a canonical tag.",
        "Add a self-referencing canonical URL unless a different canonical target is intentional."
      )
    );
  } else {
    try {
      const canonicalUrl = new URL(canonical);

      if (canonicalUrl.hostname !== new URL(finalUrl).hostname) {
        pushIssue(
          issues,
          makeIssue(
            "CANONICAL_CROSS_HOST",
            "medium",
            "The canonical points to a different hostname.",
            "Confirm that the cross-domain canonical is deliberate and not masking the page."
          )
        );
      } else if (canonical !== finalUrl) {
        pushIssue(
          issues,
          makeIssue(
            "CANONICAL_DIFFERS",
            "low",
            "The canonical does not match the crawled URL.",
            "Confirm that the canonical target reflects the preferred public version of the page."
          )
        );
      }
    } catch {
      pushIssue(
        issues,
        makeIssue(
          "CANONICAL_INVALID",
          "medium",
          "The canonical tag could not be resolved to a valid URL.",
          "Ensure the canonical contains a valid absolute or relative URL."
        )
      );
    }
  }

  if (h1s.length === 0) {
    pushIssue(
      issues,
      makeIssue(
        "H1_MISSING",
        "medium",
        "The page does not contain an H1 heading.",
        "Add a clear H1 that matches the page topic and search intent."
      )
    );
  } else if (h1s.length > 1) {
    pushIssue(
      issues,
      makeIssue(
        "H1_MULTIPLE",
        "low",
        "The page contains multiple H1 headings.",
        "Use one primary H1 so the page structure is easier to interpret."
      )
    );
  }

  if (robotsMeta?.toLowerCase().includes("noindex")) {
    pushIssue(
      issues,
      makeIssue(
        "ROBOTS_NOINDEX",
        "high",
        "The page includes a noindex directive.",
        "Remove noindex if this page should appear in search results."
      )
    );
  }

  if (images.length > 0 && imagesMissingAlt > 0) {
    pushIssue(
      issues,
      makeIssue(
        "IMAGES_MISSING_ALT",
        "medium",
        `${imagesMissingAlt} image(s) are missing alt text.`,
        "Add descriptive alt text for meaningful images."
      )
    );
  }

  if (!openGraph.title) {
    pushIssue(
      issues,
      makeIssue(
        "OG_TITLE_MISSING",
        "low",
        "The page is missing `og:title`.",
        "Add an Open Graph title so shared links have a clear social preview headline."
      )
    );
  }

  if (!openGraph.description) {
    pushIssue(
      issues,
      makeIssue(
        "OG_DESCRIPTION_MISSING",
        "low",
        "The page is missing `og:description`.",
        "Add an Open Graph description so shared links include meaningful preview text."
      )
    );
  }

  if (!openGraph.image) {
    pushIssue(
      issues,
      makeIssue(
        "OG_IMAGE_MISSING",
        "low",
        "The page is missing `og:image`.",
        "Add an Open Graph image so shared links render with a preview image."
      )
    );
  }

  if (suspiciousMetadataFields.length > 0) {
    pushIssue(
      issues,
      makeIssue(
        "METADATA_SUSPICIOUS_VALUE",
        "medium",
        `Suspicious metadata values were detected in ${suspiciousMetadataFields.join(", ")}.`,
        "Check metadata serialization and templating so all SEO fields render plain strings."
      )
    );
  }

  if (schemaTypes.length === 0) {
    pushIssue(
      issues,
      makeIssue(
        "SCHEMA_MISSING",
        "low",
        "No JSON-LD structured data was detected.",
        "Add schema markup where it supports the page type and business goals."
      )
    );
  }

  if (wordCount < 200) {
    pushIssue(
      issues,
      makeIssue(
        "LOW_WORD_COUNT",
        "low",
        "The page contains fewer than 200 words of body text.",
        "Confirm that the page has enough unique content to satisfy search intent."
      )
    );
  }

  if (internalLinks === 0) {
    pushIssue(
      issues,
      makeIssue(
        "NO_INTERNAL_LINKS",
        "low",
        "No crawlable internal links were found on the page.",
        "Add relevant internal links to improve discoverability and context."
      )
    );
  }

  return {
    url: normalizeUrl(requestedUrl),
    finalUrl,
    status: response.status,
    contentType: response.contentType,
    checks: {
      title,
      titleLength: textLength(title),
      metaDescription,
      metaDescriptionLength: textLength(metaDescription),
      canonical,
      htmlLang,
      robotsMeta,
      h1s,
      wordCount,
      imagesTotal: images.length,
      imagesMissingAlt,
      internalLinks,
      externalLinks,
      openGraph,
      schemaTypes
    },
    issues,
    discoveredLinks: [...discoveredLinks]
  };
}

async function analyzePage(
  url: string,
  allowedHosts: Set<string>,
  options: FetchOptions
): Promise<PageReport> {
  try {
    const response = await fetchTextWithRetry(url, options);

    if (response.status >= 400) {
      return {
        url: normalizeUrl(url),
        finalUrl: normalizeUrl(response.finalUrl),
        status: response.status,
        contentType: response.contentType,
        checks: createEmptyChecks(),
        issues: [
          makeIssue(
            "HTTP_ERROR",
            "high",
            `The page returned HTTP ${response.status}.`,
            "Fix the error response or remove the URL from internal links and sitemaps."
          )
        ],
        discoveredLinks: []
      };
    }

    const contentType = response.contentType?.toLowerCase() ?? "";

    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return {
        url: normalizeUrl(url),
        finalUrl: normalizeUrl(response.finalUrl),
        status: response.status,
        contentType: response.contentType,
        checks: createEmptyChecks(),
        issues: [
          makeIssue(
            "NON_HTML_CONTENT",
            "low",
            "The URL does not return an HTML document.",
            "Keep crawl seeds focused on canonical HTML pages intended for search traffic."
          )
        ],
        discoveredLinks: []
      };
    }

    return analyzeHtml(url, response, response.text, allowedHosts);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";

    return {
      url: normalizeUrl(url),
      finalUrl: normalizeUrl(url),
      status: 0,
      contentType: null,
      checks: createEmptyChecks(),
      issues: [
        makeIssue(
          "FETCH_FAILED",
          "high",
          `The page could not be fetched after ${options.retries + 1} attempt(s): ${message}.`,
          "Verify that the site is reachable and increase the timeout or retry count if the server is slow."
        )
      ],
      discoveredLinks: []
    };
  }
}

function normalizeDuplicateValue(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildDuplicateGroups(
  pages: PageReport[],
  pickValue: (page: PageReport) => string | null
): DuplicateGroup[] {
  const groups = new Map<string, { urls: string[]; value: string }>();

  for (const page of pages) {
    const value = pickValue(page);

    if (!value) {
      continue;
    }

    const normalizedValue = normalizeDuplicateValue(value);
    const existing = groups.get(normalizedValue);

    if (existing) {
      existing.urls.push(page.finalUrl);
      continue;
    }

    groups.set(normalizedValue, {
      value,
      urls: [page.finalUrl]
    });
  }

  return [...groups.values()]
    .filter((group) => group.urls.length > 1)
    .map((group) => ({
      value: group.value,
      count: group.urls.length,
      urls: [...group.urls].sort((left, right) => left.localeCompare(right))
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.value.localeCompare(right.value);
    });
}

function applyDuplicateIssues(
  pages: PageReport[],
  groups: DuplicateGroup[],
  code: string,
  severity: Severity,
  pickLabel: string,
  recommendation: string
): void {
  const pagesByUrl = new Map(pages.map((page) => [page.finalUrl, page]));

  for (const group of groups) {
    for (const url of group.urls) {
      const page = pagesByUrl.get(url);

      if (!page) {
        continue;
      }

      pushIssue(
        page.issues,
        makeIssue(
          code,
          severity,
          `The ${pickLabel} is duplicated across ${group.count} crawled pages.`,
          recommendation
        )
      );
    }
  }
}

function buildSummary(
  pages: PageReport[],
  infrastructure: InfrastructureReport,
  duplicateTitles: DuplicateGroup[],
  duplicateMetaDescriptions: DuplicateGroup[]
) {
  const issueCounts = new Map<string, number>();
  const issueTotals: Record<Severity, number> = {
    high: 0,
    medium: 0,
    low: 0
  };
  const allIssues = [...infrastructure.issues, ...pages.flatMap((page) => page.issues)];

  for (const issue of allIssues) {
    issueTotals[issue.severity] += 1;
    issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
  }

  return {
    crawledPages: pages.length,
    issueTotals,
    pagesWithNoindex: pages.filter((page) =>
      page.issues.some((issue) => issue.code === "ROBOTS_NOINDEX")
    ).length,
    pagesMissingTitle: pages.filter((page) =>
      page.issues.some((issue) => issue.code === "TITLE_MISSING")
    ).length,
    pagesMissingDescription: pages.filter((page) =>
      page.issues.some((issue) => issue.code === "META_DESCRIPTION_MISSING")
    ).length,
    topIssues: [...issueCounts.entries()]
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }

        return left[0].localeCompare(right[0]);
      })
      .slice(0, 5)
      .map(([code, count]) => ({ code, count })),
    duplicateTitles,
    duplicateMetaDescriptions
  };
}

export async function analyzeSite(
  startUrl: string,
  rawOptions: AnalyzeOptions = {}
): Promise<SiteReport> {
  const maxPages = rawOptions.maxPages ?? DEFAULT_MAX_PAGES;
  const concurrency = rawOptions.concurrency ?? DEFAULT_CONCURRENCY;
  const seedSitemap = rawOptions.seedSitemap ?? true;
  const fetchOptions: FetchOptions = {
    retries: rawOptions.retries ?? DEFAULT_RETRIES,
    timeoutMs: rawOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    userAgent: rawOptions.userAgent ?? DEFAULT_USER_AGENT
  };

  if (!Number.isFinite(maxPages) || maxPages < 1) {
    throw new Error("maxPages must be a positive integer.");
  }

  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer.");
  }

  if (!Number.isFinite(fetchOptions.retries) || fetchOptions.retries < 0) {
    throw new Error("retries must be zero or a positive integer.");
  }

  const filters: PathFilters = {
    exclude: compilePatterns(rawOptions.excludePathPatterns, "exclude-path"),
    include: compilePatterns(rawOptions.includePathPatterns, "include-path")
  };
  const normalizedStartUrl = normalizeUrl(startUrl);
  const maxQueueSize = Math.max(maxPages * MAX_QUEUE_FACTOR, maxPages + concurrency);
  const allowedHosts = new Set<string>([new URL(normalizedStartUrl).hostname]);
  const visitedRequestedUrls = new Set<string>();
  const queuedUrls = new Set<string>();
  const seenFinalUrls = new Set<string>();
  const queue: string[] = [];
  const pages: PageReport[] = [];

  const enqueueUrl = (url: string): void => {
    if (queue.length >= maxQueueSize) {
      return;
    }

    if (!matchesPathFilters(url, filters)) {
      return;
    }

    if (visitedRequestedUrls.has(url) || queuedUrls.has(url)) {
      return;
    }

    queuedUrls.add(url);
    queue.push(url);
  };

  const infrastructurePromise = inspectInfrastructure(
    normalizedStartUrl,
    fetchOptions,
    seedSitemap,
    maxQueueSize
  );
  const startPage = await analyzePage(normalizedStartUrl, allowedHosts, fetchOptions);
  visitedRequestedUrls.add(normalizedStartUrl);
  visitedRequestedUrls.add(startPage.finalUrl);

  try {
    allowedHosts.add(new URL(startPage.finalUrl).hostname);
  } catch {
    // Ignore invalid final URLs in failed fetch reports.
  }

  seenFinalUrls.add(startPage.finalUrl);
  pages.push(startPage);

  const infrastructureResult = await infrastructurePromise;

  for (const link of startPage.discoveredLinks) {
    enqueueUrl(link);
  }

  for (const sitemapSeed of infrastructureResult.crawlSeeds) {
    enqueueUrl(sitemapSeed);
  }

  while (queue.length > 0 && pages.length < maxPages) {
    const batchUrls: string[] = [];

    while (
      queue.length > 0 &&
      batchUrls.length < concurrency &&
      pages.length + batchUrls.length < maxPages
    ) {
      const nextUrl = queue.shift();

      if (!nextUrl) {
        continue;
      }

      queuedUrls.delete(nextUrl);

      if (visitedRequestedUrls.has(nextUrl)) {
        continue;
      }

      visitedRequestedUrls.add(nextUrl);
      batchUrls.push(nextUrl);
    }

    if (batchUrls.length === 0) {
      break;
    }

    const batchPages = await Promise.all(
      batchUrls.map((url) => analyzePage(url, allowedHosts, fetchOptions))
    );

    for (const page of batchPages) {
      visitedRequestedUrls.add(page.finalUrl);

      try {
        allowedHosts.add(new URL(page.finalUrl).hostname);
      } catch {
        // Ignore invalid final URLs in failed fetch reports.
      }

      if (seenFinalUrls.has(page.finalUrl)) {
        continue;
      }

      seenFinalUrls.add(page.finalUrl);
      pages.push(page);

      if (pages.length >= maxPages) {
        continue;
      }

      for (const link of page.discoveredLinks) {
        enqueueUrl(link);
      }
    }
  }

  const duplicateTitles = buildDuplicateGroups(pages, (page) => page.checks.title);
  const duplicateMetaDescriptions = buildDuplicateGroups(
    pages,
    (page) => page.checks.metaDescription
  );

  applyDuplicateIssues(
    pages,
    duplicateTitles,
    "TITLE_DUPLICATE_SITEWIDE",
    "medium",
    "title tag",
    "Give each page a distinct title that reflects its specific intent and target keyword."
  );
  applyDuplicateIssues(
    pages,
    duplicateMetaDescriptions,
    "META_DESCRIPTION_DUPLICATE_SITEWIDE",
    "low",
    "meta description",
    "Rewrite duplicated descriptions so each page has a unique search snippet."
  );

  return {
    startUrl: normalizedStartUrl,
    infrastructure: infrastructureResult.report,
    summary: buildSummary(
      pages,
      infrastructureResult.report,
      duplicateTitles,
      duplicateMetaDescriptions
    ),
    pages
  };
}
