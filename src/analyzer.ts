import { load } from "cheerio";

import { buildKeywordSummary, extractTermFrequencies, matchKeywordsOnPage } from "./keywords.js";
import type { PageTextContent } from "./keywords.js";
import { runLighthouseAudits } from "./lighthouse.js";
import type {
  AnalyzeOptions,
  DuplicateGroup,
  HreflangAlternate,
  InfrastructureReport,
  Issue,
  LighthouseReport,
  PageChecks,
  PageReport,
  RedirectHop,
  Severity,
  SiteReport
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_RETRIES = 2;
const DEFAULT_LIGHTHOUSE_PAGE_COUNT = 1;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0";
const MAX_QUEUE_FACTOR = 20;
const MAX_SITEMAP_FILES = 20;
const MAX_REDIRECT_HOPS = 10;
const RETRY_BASE_DELAY_MS = 250;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const SUSPICIOUS_METADATA_PATTERNS = [/\[object object\]/i, /\bundefined\b/i, /\bnull\b/i];
const LOCALE_SEGMENT_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const HREFLANG_PATTERN = /^(x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i;
const NON_DESCRIPTIVE_ANCHOR_TEXTS = new Set([
  "article",
  "check it out",
  "click here",
  "continue reading",
  "details",
  "discover",
  "download",
  "explore",
  "find out more",
  "go",
  "here",
  "learn more",
  "link",
  "more",
  "more info",
  "more information",
  "open",
  "page",
  "read more",
  "read this",
  "see details",
  "see more",
  "source",
  "start",
  "tap here",
  "this article",
  "this page",
  "view all",
  "view details",
  "view more",
  "visit",
  "website"
]);
const SKIP_FILE_PATTERN =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?|xml|zip)$/i;

interface FetchResult {
  contentType: string | null;
  finalUrl: string;
  headers: Record<string, string>;
  redirectChain: RedirectHop[];
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

interface CollectSitemapSeedsResult {
  coverageLimited: boolean;
  urls: string[];
}

interface HreflangExtractionResult {
  duplicateLangs: string[];
  invalidEntries: string[];
  links: HreflangAlternate[];
}

function createEmptyChecks(): PageChecks {
  return {
    title: null,
    titleLength: 0,
    metaDescription: null,
    metaDescriptionLength: 0,
    canonical: null,
    htmlLang: null,
    expectedLocale: null,
    hreflang: [],
    robotsMeta: null,
    h1s: [],
    wordCount: 0,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    internalLinks: 0,
    incomingInternalLinks: 0,
    internalLinksWithoutAnchorText: 0,
    internalLinksWithNonDescriptiveAnchorText: 0,
    externalLinks: 0,
    inSitemap: false,
    openGraph: {
      title: null,
      description: null,
      image: null
    },
    schemaTypes: [],
    bodyText: null
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

function truncate(value: string, maxLength = 90): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function summarizeValues(values: Iterable<string>, maxItems = 3): string {
  const uniqueValues = [...new Set(values)];

  if (uniqueValues.length === 0) {
    return "none";
  }

  const preview = uniqueValues.slice(0, maxItems).map((value) => truncate(value)).join(", ");

  if (uniqueValues.length > maxItems) {
    return `${preview}, +${uniqueValues.length - maxItems} more`;
  }

  return preview;
}

function normalizeLangTag(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/_/g, "-").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function getPrimaryLangTag(value: string | null | undefined): string | null {
  const normalized = normalizeLangTag(value);

  if (!normalized || normalized === "x-default") {
    return null;
  }

  return normalized.split("-")[0] ?? null;
}

function inferExpectedLocale(url: string): string | null {
  const [firstSegment] = new URL(url).pathname.split("/").filter(Boolean);

  if (!firstSegment || !LOCALE_SEGMENT_PATTERN.test(firstSegment)) {
    return null;
  }

  return getPrimaryLangTag(firstSegment);
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

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&nbsp;/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isNonDescriptiveAnchorText(value: string): boolean {
  const normalized = normalizeComparableText(value);

  if (!normalized) {
    return false;
  }

  return NON_DESCRIPTIVE_ANCHOR_TEXTS.has(normalized);
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function isHtmlContentType(contentType: string | null): boolean {
  const normalized = contentType?.toLowerCase() ?? "";
  return normalized.includes("text/html") || normalized.includes("application/xhtml+xml");
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

function pageHasIssue(page: PageReport, code: string): boolean {
  return page.issues.some((issue) => issue.code === code);
}

function pageHasAnyIssue(page: PageReport, codes: string[]): boolean {
  return page.issues.some((issue) => codes.includes(issue.code));
}

function isIndexableHtmlPage(page: PageReport): boolean {
  return (
    page.status >= 200 &&
    page.status < 400 &&
    isHtmlContentType(page.contentType) &&
    !pageHasIssue(page, "ROBOTS_NOINDEX")
  );
}

async function fetchResponse(url: string, options: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    return await fetch(url, {
      redirect: "manual",
      headers: {
        "user-agent": options.userAgent,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.5",
        "accept-encoding": "gzip, deflate, br",
        "upgrade-insecure-requests": "1",
        "dnt": "1",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "sec-gpc": "1"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function extractHeaderMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function fetchText(url: string, options: FetchOptions): Promise<FetchResult> {
  let currentUrl = normalizeUrl(url);
  const redirectChain: RedirectHop[] = [];
  const visitedRedirects = new Set<string>();

  while (true) {
    if (visitedRedirects.has(currentUrl)) {
      throw new Error(`Redirect loop detected for ${currentUrl}.`);
    }

    visitedRedirects.add(currentUrl);

    const response = await fetchResponse(currentUrl, options);
    const location = response.headers.get("location");

    if (response.status >= 300 && response.status < 400 && location) {
      if (redirectChain.length >= MAX_REDIRECT_HOPS) {
        throw new Error(`Exceeded ${MAX_REDIRECT_HOPS} redirect hops.`);
      }

      const nextUrl = normalizeUrl(new URL(location, currentUrl).toString());
      redirectChain.push({
        fromUrl: currentUrl,
        toUrl: nextUrl,
        status: response.status
      });
      currentUrl = nextUrl;
      continue;
    }

    return {
      contentType: response.headers.get("content-type"),
      finalUrl: normalizeUrl(response.url || currentUrl),
      headers: extractHeaderMap(response.headers),
      redirectChain,
      status: response.status,
      text: await response.text()
    };
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
): Promise<CollectSitemapSeedsResult> {
  const queue = [...new Set(sitemapUrls.map(normalizeUrl))];
  const visitedSitemaps = new Set<string>();
  const seedUrls = new Set<string>();
  let coverageLimited = false;

  while (queue.length > 0) {
    if (visitedSitemaps.size >= MAX_SITEMAP_FILES || seedUrls.size >= maxUrls) {
      coverageLimited = true;
      break;
    }

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
          coverageLimited = true;
          break;
        }
      }
    } catch {
      continue;
    }
  }

  return {
    coverageLimited,
    urls: [...seedUrls]
  };
}

function compareUrls(left: string, right: string): number {
  return left.localeCompare(right);
}

function getSitemapBucketKey(url: string): string {
  const segments = new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

  if (segments.length === 0) {
    return "/";
  }

  const bucketSegments: string[] = [];
  let index = 0;

  if (LOCALE_SEGMENT_PATTERN.test(segments[0] ?? "")) {
    bucketSegments.push(getPrimaryLangTag(segments[0]) ?? segments[0]);
    index = 1;
  }

  bucketSegments.push(segments[index] ?? "(root)");
  return bucketSegments.join("/");
}

function pickRepresentativeUrls(urls: string[], count: number): string[] {
  const sortedUrls = [...urls].sort(compareUrls);

  if (count >= sortedUrls.length) {
    return sortedUrls;
  }

  const selected: string[] = [];
  const usedIndexes = new Set<number>();

  for (let slot = 0; slot < count; slot += 1) {
    let index = Math.min(
      sortedUrls.length - 1,
      Math.floor(((slot + 0.5) * sortedUrls.length) / count)
    );

    if (usedIndexes.has(index)) {
      for (let offset = 1; offset < sortedUrls.length; offset += 1) {
        const forward = index + offset;

        if (forward < sortedUrls.length && !usedIndexes.has(forward)) {
          index = forward;
          break;
        }

        const backward = index - offset;

        if (backward >= 0 && !usedIndexes.has(backward)) {
          index = backward;
          break;
        }
      }
    }

    if (usedIndexes.has(index)) {
      continue;
    }

    usedIndexes.add(index);
    selected.push(sortedUrls[index]);
  }

  return selected;
}

function sampleSitemapSeeds(
  seedUrls: string[],
  sampleSize: number,
  filters: PathFilters,
  excludedUrls: Set<string>
): string[] {
  if (sampleSize < 1) {
    return [];
  }

  const candidateUrls = [...new Set(seedUrls.map(normalizeUrl))]
    .filter((url) => !excludedUrls.has(url))
    .filter((url) => matchesPathFilters(url, filters));

  if (candidateUrls.length <= sampleSize) {
    return candidateUrls.sort(compareUrls);
  }

  const buckets = new Map<string, string[]>();

  for (const url of candidateUrls) {
    const bucketKey = getSitemapBucketKey(url);
    const bucketUrls = buckets.get(bucketKey);

    if (bucketUrls) {
      bucketUrls.push(url);
      continue;
    }

    buckets.set(bucketKey, [url]);
  }

  const bucketEntries = [...buckets.entries()]
    .map(([key, urls]) => ({
      key,
      urls: urls.sort(compareUrls)
    }))
    .sort((left, right) => {
      if (right.urls.length !== left.urls.length) {
        return right.urls.length - left.urls.length;
      }

      return left.key.localeCompare(right.key);
    });
  const bucketEntriesByKey = new Map(bucketEntries.map((entry) => [entry.key, entry]));

  const quotas = new Map<string, number>();

  if (sampleSize < bucketEntries.length) {
    for (const entry of bucketEntries.slice(0, sampleSize)) {
      quotas.set(entry.key, 1);
    }
  } else {
    let remaining = sampleSize;

    for (const entry of bucketEntries) {
      quotas.set(entry.key, 1);
      remaining -= 1;
    }

    const totalExtraCapacity = bucketEntries.reduce(
      (total, entry) => total + Math.max(0, entry.urls.length - 1),
      0
    );

    if (remaining > 0 && totalExtraCapacity > 0) {
      const rankedBuckets = bucketEntries
        .map((entry) => {
          const capacity = Math.max(0, entry.urls.length - 1);

          if (capacity === 0) {
            return null;
          }

          const exactShare = (remaining * capacity) / totalExtraCapacity;
          const baseShare = Math.min(capacity, Math.floor(exactShare));

          quotas.set(entry.key, (quotas.get(entry.key) ?? 0) + baseShare);

          return {
            key: entry.key,
            remainder: exactShare - baseShare,
            size: entry.urls.length
          };
        })
        .filter((entry): entry is { key: string; remainder: number; size: number } => entry !== null)
        .sort((left, right) => {
          if (right.remainder !== left.remainder) {
            return right.remainder - left.remainder;
          }

          if (right.size !== left.size) {
            return right.size - left.size;
          }

          return left.key.localeCompare(right.key);
        });

      let allocated = 0;

      for (const entry of bucketEntries) {
        allocated += Math.max(0, (quotas.get(entry.key) ?? 0) - 1);
      }

      let leftovers = remaining - allocated;

      while (leftovers > 0) {
        let progressed = false;

        for (const rankedEntry of rankedBuckets) {
          const bucket = bucketEntriesByKey.get(rankedEntry.key);

          if (!bucket) {
            continue;
          }

          const currentQuota = quotas.get(rankedEntry.key) ?? 0;

          if (currentQuota >= bucket.urls.length) {
            continue;
          }

          quotas.set(rankedEntry.key, currentQuota + 1);
          leftovers -= 1;
          progressed = true;

          if (leftovers === 0) {
            break;
          }
        }

        if (!progressed) {
          break;
        }
      }
    }
  }

  const selectedUrls: string[] = [];

  for (const entry of bucketEntries) {
    const quota = quotas.get(entry.key) ?? 0;

    if (quota < 1) {
      continue;
    }

    selectedUrls.push(...pickRepresentativeUrls(entry.urls, quota));
  }

  return selectedUrls.slice(0, sampleSize);
}

async function inspectInfrastructure(
  startUrl: string,
  options: FetchOptions,
  collectSitemapUrls: boolean,
  maxSeedUrls: number
): Promise<InspectInfrastructureResult> {
  const origin = new URL(startUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const sitemapUrl = new URL("/sitemap.xml", origin).toString();
  const llmsTxtUrl = new URL("/llms.txt", origin).toString();
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
    knownUrls: 0,
    coverageLimited: false,
    isIndex: false
  };

  const llmsTxt = {
    url: llmsTxtUrl,
    present: false,
    status: null as number | null,
    isEmpty: false
  };

  const [robotsResult, sitemapResult, llmsTxtResult] = await Promise.allSettled([
    fetchTextWithRetry(robotsUrl, options),
    fetchTextWithRetry(sitemapUrl, options),
    fetchTextWithRetry(llmsTxtUrl, options)
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

  if (llmsTxtResult.status === "fulfilled") {
    llmsTxt.status = llmsTxtResult.value.status;

    if (llmsTxtResult.value.status >= 200 && llmsTxtResult.value.status < 300) {
      llmsTxt.present = true;
      llmsTxt.isEmpty = llmsTxtResult.value.text.trim().length === 0;

      if (llmsTxt.isEmpty) {
        pushIssue(
          issues,
          makeIssue(
            "LLMSTXT_EMPTY",
            "low",
            "llms.txt is present but empty.",
            "Add guidance that helps AI systems understand your canonical docs, product areas, or key content."
          )
        );
      }
    } else {
      pushIssue(
        issues,
        makeIssue(
          "LLMSTXT_MISSING",
          "low",
          "llms.txt is missing or returns a non-success status.",
          "Publish llms.txt if you want to provide AI crawlers with a concise map of important content."
        )
      );
    }
  } else {
    pushIssue(
      issues,
      makeIssue(
        "LLMSTXT_UNREACHABLE",
        "low",
        "llms.txt could not be fetched.",
        "Verify that the file is publicly reachable if you want to support AI crawler guidance."
      )
    );
  }

  let crawlSeeds: string[] = [];

  if (collectSitemapUrls) {
    const sitemapTargets = [...new Set([sitemapUrl, ...robotsTxt.sitemaps])];
    const sitemapSeedResult = await collectSitemapSeeds(sitemapTargets, options, maxSeedUrls);
    crawlSeeds = sitemapSeedResult.urls;
    sitemap.knownUrls = crawlSeeds.length;
    sitemap.coverageLimited = sitemapSeedResult.coverageLimited;
  }

  return {
    crawlSeeds,
    report: {
      robotsTxt,
      sitemap,
      llmsTxt,
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

function extractHreflangData($: ReturnType<typeof load>, baseUrl: string): HreflangExtractionResult {
  const links: HreflangAlternate[] = [];
  const invalidEntries: string[] = [];
  const langCounts = new Map<string, number>();

  $("link[hreflang][href]").each((_, element) => {
    const rel = $(element).attr("rel")?.toLowerCase() ?? "";

    if (!rel.split(/\s+/).includes("alternate")) {
      return;
    }

    const rawLang = normalizeLangTag($(element).attr("hreflang"));
    const rawHref = $(element).attr("href")?.trim();

    if (!rawLang || !rawHref || !HREFLANG_PATTERN.test(rawLang)) {
      invalidEntries.push(`${rawLang ?? "(missing)"} -> ${rawHref ?? "(missing)"}`);
      return;
    }

    try {
      const url = normalizeUrl(new URL(rawHref, baseUrl).toString());
      links.push({ lang: rawLang, url });
      langCounts.set(rawLang, (langCounts.get(rawLang) ?? 0) + 1);
    } catch {
      invalidEntries.push(`${rawLang} -> ${rawHref}`);
    }
  });

  return {
    duplicateLangs: [...langCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([lang]) => lang)
      .sort((left, right) => left.localeCompare(right)),
    invalidEntries,
    links
  };
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
  const expectedLocale = inferExpectedLocale(finalUrl);
  const hreflang = extractHreflangData($, finalUrl);
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
  let internalLinksWithoutAnchorText = 0;
  let internalLinksWithNonDescriptiveAnchorText = 0;
  let externalLinks = 0;
  const discoveredLinks = new Set<string>();
  const genericInternalAnchorTexts = new Set<string>();

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

        const anchorText =
          $(element).text().replace(/\s+/g, " ").trim() ||
          $(element).attr("aria-label")?.replace(/\s+/g, " ").trim() ||
          $(element)
            .find("img[alt]")
            .map((_, image) => $(image).attr("alt")?.replace(/\s+/g, " ").trim() ?? "")
            .get()
            .join(" ")
            .replace(/\s+/g, " ")
            .trim() ||
          $(element).attr("title")?.replace(/\s+/g, " ").trim() ||
          "";

        if (!anchorText) {
          internalLinksWithoutAnchorText += 1;
        } else if (isNonDescriptiveAnchorText(anchorText)) {
          internalLinksWithNonDescriptiveAnchorText += 1;
          genericInternalAnchorTexts.add(anchorText);
        }
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

  if (response.redirectChain.length === 1) {
    pushIssue(
      issues,
      makeIssue(
        "URL_REDIRECTED",
        "low",
        "The requested URL redirects to a different final URL.",
        "Use the final canonical URL consistently in internal links and sitemap entries."
      )
    );
  } else if (response.redirectChain.length > 1) {
    pushIssue(
      issues,
      makeIssue(
        "URL_REDIRECT_CHAIN",
        "medium",
        `The requested URL passes through ${response.redirectChain.length} redirects before the final page.`,
        "Update links and sitemap entries to point directly to the final URL and remove redirect chains."
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
  } else if (expectedLocale && getPrimaryLangTag(htmlLang) !== expectedLocale) {
    pushIssue(
      issues,
      makeIssue(
        "HTML_LANG_LOCALE_MISMATCH",
        "medium",
        `The html lang attribute "${htmlLang}" does not match the URL locale "${expectedLocale}".`,
        "Ensure each localized route renders the correct document language."
      )
    );
  }

  if (hreflang.invalidEntries.length > 0) {
    pushIssue(
      issues,
      makeIssue(
        "HREFLANG_INVALID",
        "medium",
        `Invalid hreflang entries were detected: ${summarizeValues(hreflang.invalidEntries)}.`,
        "Use valid hreflang codes and absolute or resolvable alternate URLs."
      )
    );
  }

  if (hreflang.duplicateLangs.length > 0) {
    pushIssue(
      issues,
      makeIssue(
        "HREFLANG_DUPLICATE",
        "medium",
        `Duplicate hreflang entries were found for: ${hreflang.duplicateLangs.join(", ")}.`,
        "Keep one alternate link per hreflang value."
      )
    );
  }

  if (expectedLocale && hreflang.links.length === 0) {
    pushIssue(
      issues,
      makeIssue(
        "HREFLANG_MISSING",
        "low",
        "No hreflang alternate links were found on this localized page.",
        "Add hreflang links so search engines can map equivalent localized pages."
      )
    );
  }

  if (hreflang.links.length > 0) {
    const hasXDefault = hreflang.links.some((entry) => entry.lang === "x-default");
    const hasSelfReference =
      expectedLocale === null ||
      hreflang.links.some(
        (entry) => getPrimaryLangTag(entry.lang) === expectedLocale && entry.url === finalUrl
      );

    if (!hasXDefault) {
      pushIssue(
        issues,
        makeIssue(
          "HREFLANG_X_DEFAULT_MISSING",
          "low",
          "The page has hreflang links but no x-default entry.",
          "Add an x-default hreflang target when the page participates in a multilingual cluster."
        )
      );
    }

    if (!hasSelfReference) {
      pushIssue(
        issues,
        makeIssue(
          "HREFLANG_SELF_MISSING",
          "low",
          "The page is missing a self-referencing hreflang link.",
          "Include a hreflang entry for the page's own locale and final URL."
        )
      );
    }
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

  if (internalLinksWithoutAnchorText > 0) {
    pushIssue(
      issues,
      makeIssue(
        "INTERNAL_LINK_ANCHOR_EMPTY",
        "medium",
        `${internalLinksWithoutAnchorText} internal link(s) have no accessible anchor text.`,
        "Add visible text, aria-labels, or meaningful image alt text so internal links provide context."
      )
    );
  }

  if (internalLinksWithNonDescriptiveAnchorText > 0) {
    pushIssue(
      issues,
      makeIssue(
        "INTERNAL_LINK_ANCHOR_GENERIC",
        "low",
        `${internalLinksWithNonDescriptiveAnchorText} internal link(s) use generic anchor text: ${summarizeValues(genericInternalAnchorTexts)}.`,
        "Use descriptive anchor text that explains the destination instead of phrases like `read more` or `click here`."
      )
    );
  }

  return {
    url: normalizeUrl(requestedUrl),
    finalUrl,
    status: response.status,
    contentType: response.contentType,
    redirectChain: response.redirectChain,
    checks: {
      title,
      titleLength: textLength(title),
      metaDescription,
      metaDescriptionLength: textLength(metaDescription),
      canonical,
      htmlLang,
      expectedLocale,
      hreflang: hreflang.links,
      robotsMeta,
      h1s,
      wordCount,
      imagesTotal: images.length,
      imagesMissingAlt,
      internalLinks,
      incomingInternalLinks: 0,
      internalLinksWithoutAnchorText,
      internalLinksWithNonDescriptiveAnchorText,
      externalLinks,
      inSitemap: false,
      openGraph,
      schemaTypes,
      bodyText: bodyText || null
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
        redirectChain: response.redirectChain,
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

    if (!isHtmlContentType(response.contentType)) {
      return {
        url: normalizeUrl(url),
        finalUrl: normalizeUrl(response.finalUrl),
        status: response.status,
        contentType: response.contentType,
        redirectChain: response.redirectChain,
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
      redirectChain: [],
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

function applyInternalLinkIssues(pages: PageReport[]): void {
  const requestedPages = new Map(pages.map((page) => [page.url, page]));
  const finalPages = new Map(pages.map((page) => [page.finalUrl, page]));

  for (const page of pages) {
    const brokenTargets = new Set<string>();
    const redirectTargets = new Set<string>();
    const redirectChainTargets = new Set<string>();

    for (const targetUrl of page.discoveredLinks) {
      const targetPage = requestedPages.get(targetUrl) ?? finalPages.get(targetUrl);

      if (!targetPage) {
        continue;
      }

      if (targetPage.issues.some((issue) => issue.code === "HTTP_ERROR" || issue.code === "FETCH_FAILED")) {
        brokenTargets.add(targetUrl);
        continue;
      }

      if (targetPage.url === targetUrl && targetPage.finalUrl !== targetUrl) {
        const label = `${targetUrl} -> ${targetPage.finalUrl}`;

        if (targetPage.redirectChain.length > 1) {
          redirectChainTargets.add(label);
        } else {
          redirectTargets.add(label);
        }
      }
    }

    if (brokenTargets.size > 0) {
      pushIssue(
        page.issues,
        makeIssue(
          "INTERNAL_LINK_BROKEN",
          "medium",
          `${brokenTargets.size} internal link(s) point to broken pages: ${summarizeValues(brokenTargets)}.`,
          "Update internal links so they point to live URLs that return a successful HTML response."
        )
      );
    }

    if (redirectTargets.size > 0) {
      pushIssue(
        page.issues,
        makeIssue(
          "INTERNAL_LINK_REDIRECTS",
          "low",
          `${redirectTargets.size} internal link(s) redirect before the final page: ${summarizeValues(redirectTargets)}.`,
          "Update internal links to point directly to the final destination URL."
        )
      );
    }

    if (redirectChainTargets.size > 0) {
      pushIssue(
        page.issues,
        makeIssue(
          "INTERNAL_LINK_REDIRECT_CHAIN",
          "medium",
          `${redirectChainTargets.size} internal link(s) go through redirect chains: ${summarizeValues(redirectChainTargets)}.`,
          "Replace redirect-chain links with the final destination URL to reduce crawl waste."
        )
      );
    }
  }
}

function applyHreflangCrossChecks(pages: PageReport[]): void {
  const requestedPages = new Map(pages.map((page) => [page.url, page]));
  const finalPages = new Map(pages.map((page) => [page.finalUrl, page]));

  for (const page of pages) {
    if (page.checks.hreflang.length === 0) {
      continue;
    }

    const sourceLocale = page.checks.expectedLocale ?? getPrimaryLangTag(page.checks.htmlLang);
    const missingReturnLinks = new Set<string>();
    const targetLocaleMismatches = new Set<string>();
    const targetRedirects = new Set<string>();

    for (const alternate of page.checks.hreflang) {
      if (alternate.lang === "x-default") {
        continue;
      }

      const targetPage = requestedPages.get(alternate.url) ?? finalPages.get(alternate.url);

      if (!targetPage) {
        continue;
      }

      const alternateLocale = getPrimaryLangTag(alternate.lang);
      const targetLocale = targetPage.checks.expectedLocale ?? getPrimaryLangTag(targetPage.checks.htmlLang);

      if (targetPage.url === alternate.url && targetPage.finalUrl !== alternate.url) {
        targetRedirects.add(`${alternate.lang}: ${alternate.url} -> ${targetPage.finalUrl}`);
      }

      if (alternateLocale && targetLocale && alternateLocale !== targetLocale) {
        targetLocaleMismatches.add(`${alternate.lang}: ${targetPage.finalUrl}`);
      }

      if (sourceLocale) {
        const hasReturnLink = targetPage.checks.hreflang.some(
          (candidate) =>
            getPrimaryLangTag(candidate.lang) === sourceLocale && candidate.url === page.finalUrl
        );

        if (!hasReturnLink) {
          missingReturnLinks.add(`${alternate.lang}: ${targetPage.finalUrl}`);
        }
      }
    }

    if (targetRedirects.size > 0) {
      pushIssue(
        page.issues,
        makeIssue(
          "HREFLANG_TARGET_REDIRECTS",
          "low",
          `${targetRedirects.size} hreflang target(s) redirect: ${summarizeValues(targetRedirects)}.`,
          "Point hreflang links directly to the final canonical alternate URLs."
        )
      );
    }

    if (targetLocaleMismatches.size > 0) {
      pushIssue(
        page.issues,
        makeIssue(
          "HREFLANG_TARGET_LOCALE_MISMATCH",
          "medium",
          `${targetLocaleMismatches.size} hreflang target(s) do not match the declared locale: ${summarizeValues(targetLocaleMismatches)}.`,
          "Ensure each hreflang code points to a page rendered in the same locale."
        )
      );
    }

    if (missingReturnLinks.size > 0) {
      pushIssue(
        page.issues,
        makeIssue(
          "HREFLANG_RETURN_MISSING",
          "low",
          `${missingReturnLinks.size} hreflang target(s) are missing return links back to this page: ${summarizeValues(missingReturnLinks)}.`,
          "Add reciprocal hreflang links across localized alternates."
        )
      );
    }
  }
}

function applySitemapAndLinkArchitectureIssues(
  pages: PageReport[],
  startUrl: string,
  sitemapUrls: string[],
  sitemapCoverageLimited: boolean,
  linkGraphCoverageLimited: boolean
): void {
  const normalizedStartUrl = normalizeUrl(startUrl);
  const requestedPages = new Map(pages.map((page) => [page.url, page]));
  const finalPages = new Map(pages.map((page) => [page.finalUrl, page]));
  const incomingInternalLinks = new Map<string, number>();
  const knownSitemapUrls = new Set(sitemapUrls.map(normalizeUrl));

  for (const page of pages) {
    for (const targetUrl of page.discoveredLinks) {
      const targetPage = requestedPages.get(targetUrl) ?? finalPages.get(targetUrl);

      if (!targetPage || targetPage.finalUrl === page.finalUrl) {
        continue;
      }

      incomingInternalLinks.set(
        targetPage.finalUrl,
        (incomingInternalLinks.get(targetPage.finalUrl) ?? 0) + 1
      );
    }
  }

  for (const page of pages) {
    const incomingCount = incomingInternalLinks.get(page.finalUrl) ?? 0;
    const inSitemap = knownSitemapUrls.has(page.url) || knownSitemapUrls.has(page.finalUrl);
    const isStartPage = page.finalUrl === normalizedStartUrl || page.url === normalizedStartUrl;
    const canonicalDiffers =
      page.checks.canonical !== null && page.checks.canonical !== page.finalUrl;
    const selfCanonicalOrMissing =
      page.checks.canonical === null || page.checks.canonical === page.finalUrl;

    page.checks.incomingInternalLinks = incomingCount;
    page.checks.inSitemap = inSitemap;

    if (inSitemap && canonicalDiffers) {
      pushIssue(
        page.issues,
        makeIssue(
          "SITEMAP_CANONICAL_MISMATCH",
          "medium",
          "The page is in the sitemap but canonicals to a different URL.",
          "Keep only canonical URLs in the sitemap so search engines are not sent conflicting signals."
        )
      );
    }

    if (
      knownSitemapUrls.size > 0 &&
      !sitemapCoverageLimited &&
      isIndexableHtmlPage(page) &&
      selfCanonicalOrMissing &&
      !inSitemap
    ) {
      pushIssue(
        page.issues,
        makeIssue(
          "SITEMAP_URL_MISSING",
          "low",
          "The page looks indexable but is not present in the discovered sitemap URLs.",
          "Add the page to the sitemap if it should be crawled and indexed consistently."
        )
      );
    }

    if (linkGraphCoverageLimited || isStartPage || !isIndexableHtmlPage(page)) {
      continue;
    }

    if (incomingCount === 0) {
      pushIssue(
        page.issues,
        makeIssue(
          "ORPHAN_CANDIDATE",
          inSitemap ? "medium" : "low",
          inSitemap
            ? "The page appears in the sitemap but has no incoming internal links from the crawled pages."
            : "The page has no incoming internal links from the crawled pages.",
          "Add contextual internal links so the page can be discovered and reinforced through the site architecture."
        )
      );
      continue;
    }

    if (incomingCount === 1) {
      pushIssue(
        page.issues,
        makeIssue(
          "INTERNAL_LINK_INCOMING_FEW",
          "low",
          "The page has only one incoming internal link from the crawled pages.",
          "Add more relevant internal links to strengthen discovery and topical context."
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
    pagesWithNoindex: pages.filter((page) => pageHasIssue(page, "ROBOTS_NOINDEX")).length,
    pagesMissingTitle: pages.filter((page) => pageHasIssue(page, "TITLE_MISSING")).length,
    pagesMissingDescription: pages.filter((page) =>
      pageHasIssue(page, "META_DESCRIPTION_MISSING")
    ).length,
    internalLinksChecked: pages.reduce((total, page) => total + page.discoveredLinks.length, 0),
    pagesWithBrokenInternalLinks: pages.filter((page) =>
      pageHasIssue(page, "INTERNAL_LINK_BROKEN")
    ).length,
    pagesWithRedirectingInternalLinks: pages.filter((page) =>
      pageHasAnyIssue(page, ["INTERNAL_LINK_REDIRECTS", "INTERNAL_LINK_REDIRECT_CHAIN"])
    ).length,
    pagesWithAnchorTextIssues: pages.filter((page) =>
      pageHasAnyIssue(page, ["INTERNAL_LINK_ANCHOR_EMPTY", "INTERNAL_LINK_ANCHOR_GENERIC"])
    ).length,
    pagesWithFewIncomingInternalLinks: pages.filter((page) =>
      pageHasIssue(page, "INTERNAL_LINK_INCOMING_FEW")
    ).length,
    orphanCandidatePages: pages.filter((page) => pageHasIssue(page, "ORPHAN_CANDIDATE")).length,
    pagesMissingFromSitemap: pages.filter((page) => pageHasIssue(page, "SITEMAP_URL_MISSING"))
      .length,
    pagesWithHreflangIssues: pages.filter((page) =>
      page.issues.some((issue) => issue.code.startsWith("HREFLANG_"))
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

function pickLighthouseUrls(pages: PageReport[], maxPages: number): string[] {
  const urls: string[] = [];

  for (const page of pages) {
    if (page.status < 200 || page.status >= 400 || !isHtmlContentType(page.contentType)) {
      continue;
    }

    urls.push(page.finalUrl);

    if (urls.length >= maxPages) {
      break;
    }
  }

  return urls;
}

function applyKeywordMatches(page: PageReport, keywords: string[]): void {
  if (keywords.length === 0) {
    return;
  }

  const content: PageTextContent = {
    title: page.checks.title ?? "",
    metaDescription: page.checks.metaDescription ?? "",
    h1Text: page.checks.h1s.join(" "),
    bodyText: page.checks.bodyText ?? "",
  };

  page.keywordMatches = matchKeywordsOnPage(keywords, content);
}

export async function analyzeSite(
  startUrl: string,
  rawOptions: AnalyzeOptions = {}
): Promise<SiteReport> {
  const fullSitemap = rawOptions.fullSitemap ?? false;
  const sampleSitemap = rawOptions.sampleSitemap ?? false;
  const maxPages = fullSitemap ? Number.POSITIVE_INFINITY : rawOptions.maxPages ?? DEFAULT_MAX_PAGES;
  const concurrency = rawOptions.concurrency ?? DEFAULT_CONCURRENCY;
  const seedSitemap = fullSitemap || sampleSitemap ? true : rawOptions.seedSitemap ?? true;
  const fetchOptions: FetchOptions = {
    retries: rawOptions.retries ?? DEFAULT_RETRIES,
    timeoutMs: rawOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    userAgent: rawOptions.userAgent ?? DEFAULT_USER_AGENT
  };

  const keywords = rawOptions.keywords ?? [];
  const extractTermsEnabled = rawOptions.extractTerms ?? false;
  const topTermsCount = rawOptions.topTermsCount ?? 20;

  if (fullSitemap && sampleSitemap) {
    throw new Error("fullSitemap and sampleSitemap cannot both be enabled.");
  }

  if (!fullSitemap && (!Number.isFinite(maxPages) || maxPages < 1)) {
    throw new Error("maxPages must be a positive integer.");
  }

  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("concurrency must be a positive integer.");
  }

  if (!Number.isFinite(fetchOptions.retries) || fetchOptions.retries < 0) {
    throw new Error("retries must be zero or a positive integer.");
  }

  if (rawOptions.lighthousePageCount !== undefined) {
    if (!Number.isFinite(rawOptions.lighthousePageCount) || rawOptions.lighthousePageCount < 1) {
      throw new Error("lighthousePageCount must be a positive integer.");
    }
  }

  const filters: PathFilters = {
    exclude: compilePatterns(rawOptions.excludePathPatterns, "exclude-path"),
    include: compilePatterns(rawOptions.includePathPatterns, "include-path")
  };
  const normalizedStartUrl = normalizeUrl(startUrl);
  const maxQueueSize =
    fullSitemap || sampleSitemap
      ? Number.POSITIVE_INFINITY
      : Math.max(maxPages * MAX_QUEUE_FACTOR, maxPages + concurrency);
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
    true,
    fullSitemap || sampleSitemap ? Number.POSITIVE_INFINITY : maxQueueSize
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
  applyKeywordMatches(startPage, keywords);

  const infrastructureResult = await infrastructurePromise;

  if (sampleSitemap) {
    const remainingPageBudget = Math.max(0, maxPages - pages.length);
    const sampledUrls = sampleSitemapSeeds(
      infrastructureResult.crawlSeeds,
      remainingPageBudget + Math.max(concurrency, Math.ceil(remainingPageBudget * 0.25)),
      filters,
      new Set([normalizedStartUrl, startPage.finalUrl])
    );

    for (const sampledUrl of sampledUrls) {
      enqueueUrl(sampledUrl);
    }

    if (sampledUrls.length === 0) {
      for (const link of startPage.discoveredLinks) {
        enqueueUrl(link);
      }
    }
  } else {
    for (const link of startPage.discoveredLinks) {
      enqueueUrl(link);
    }

    for (const sitemapSeed of infrastructureResult.crawlSeeds) {
      enqueueUrl(sitemapSeed);
    }
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
      applyKeywordMatches(page, keywords);

      if (pages.length >= maxPages || sampleSitemap) {
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
  applyInternalLinkIssues(pages);
  applyHreflangCrossChecks(pages);
  applySitemapAndLinkArchitectureIssues(
    pages,
    normalizedStartUrl,
    infrastructureResult.crawlSeeds,
    infrastructureResult.report.sitemap.coverageLimited,
    sampleSitemap
  );

  const lighthouse: LighthouseReport[] = rawOptions.lighthouse
    ? await runLighthouseAudits(
        pickLighthouseUrls(pages, rawOptions.lighthousePageCount ?? DEFAULT_LIGHTHOUSE_PAGE_COUNT)
      )
    : [];

  const keywordSummary = keywords.length > 0 ? buildKeywordSummary(keywords, pages) : undefined;
  const topTerms = extractTermsEnabled ? extractTermFrequencies(pages, topTermsCount) : undefined;

  return {
    startUrl: normalizedStartUrl,
    infrastructure: infrastructureResult.report,
    summary: buildSummary(
      pages,
      infrastructureResult.report,
      duplicateTitles,
      duplicateMetaDescriptions
    ),
    pages,
    lighthouse,
    keywordSummary,
    topTerms
  };
}
