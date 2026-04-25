import type { RobotsRules } from "./checks/robots-checks.js";

export type Severity = "high" | "medium" | "low";

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  recommendation: string;
}

export interface RedirectHop {
  fromUrl: string;
  toUrl: string;
  status: number;
}

export interface HreflangAlternate {
  lang: string;
  url: string;
}

export interface PageChecks {
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  htmlLang: string | null;
  expectedLocale: string | null;
  hreflang: HreflangAlternate[];
  robotsMeta: string | null;
  h1s: string[];
  wordCount: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  internalLinks: number;
  incomingInternalLinks: number;
  internalLinksWithoutAnchorText: number;
  internalLinksWithNonDescriptiveAnchorText: number;
  externalLinks: number;
  inSitemap: boolean;
  openGraph: {
    title: string | null;
    description: string | null;
    image: string | null;
  };
  schemaTypes: string[];
  bodyText: string | null;
}

export interface KeywordLocationCounts {
  title: number;
  h1: number;
  metaDescription: number;
  body: number;
}

export interface KeywordMatch {
  keyword: string;
  locations: KeywordLocationCounts;
  totalOccurrences: number;
}

export interface KeywordSummary {
  keyword: string;
  pages: number;
  totalOccurrences: number;
  locations: KeywordLocationCounts;
  urls: string[];
}

export interface TermFrequency {
  term: string;
  pages: number;
  occurrences: number;
  locations: KeywordLocationCounts;
  urls: string[];
}

export interface PageReport {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  redirectChain: RedirectHop[];
  checks: PageChecks;
  issues: Issue[];
  discoveredLinks: string[];
  keywordMatches?: KeywordMatch[];
}

export interface InfrastructureReport {
  robotsTxt: {
    url: string;
    present: boolean;
    status: number | null;
    sitemaps: string[];
    blocksAllCrawlers: boolean;
    rules?: RobotsRules;
  };
  sitemap: {
    url: string;
    present: boolean;
    status: number | null;
    urlCount: number;
    knownUrls: number;
    coverageLimited: boolean;
    isIndex: boolean;
  };
  llmsTxt: {
    url: string;
    present: boolean;
    status: number | null;
    isEmpty: boolean;
  };
  issues: Issue[];
}

export interface DuplicateGroup {
  value: string;
  count: number;
  urls: string[];
}

export interface LighthouseScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

export interface LighthouseMetrics {
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  totalBlockingTimeMs: number | null;
  cumulativeLayoutShift: number | null;
  speedIndexMs: number | null;
  interactiveMs: number | null;
}

export interface LighthouseReport {
  requestedUrl: string;
  finalUrl: string;
  fetchTime: string | null;
  scores: LighthouseScores;
  metrics: LighthouseMetrics;
  error: string | null;
}

export interface SiteSummary {
  crawledPages: number;
  issueTotals: Record<Severity, number>;
  pagesWithNoindex: number;
  pagesMissingTitle: number;
  pagesMissingDescription: number;
  internalLinksChecked: number;
  pagesWithBrokenInternalLinks: number;
  pagesWithRedirectingInternalLinks: number;
  pagesWithAnchorTextIssues: number;
  pagesWithFewIncomingInternalLinks: number;
  orphanCandidatePages: number;
  pagesMissingFromSitemap: number;
  pagesWithHreflangIssues: number;
  topIssues: Array<{
    code: string;
    count: number;
  }>;
  duplicateTitles: DuplicateGroup[];
  duplicateMetaDescriptions: DuplicateGroup[];
}

export interface SiteReport {
  startUrl: string;
  infrastructure: InfrastructureReport;
  summary: SiteSummary;
  pages: PageReport[];
  lighthouse: LighthouseReport[];
  keywordSummary?: KeywordSummary[];
  topTerms?: TermFrequency[];
}

export interface AnalyzeOptions {
  maxPages?: number;
  timeoutMs?: number;
  userAgent?: string;
  concurrency?: number;
  retries?: number;
  seedSitemap?: boolean;
  fullSitemap?: boolean;
  sampleSitemap?: boolean;
  lighthouse?: boolean;
  lighthousePageCount?: number;
  includePathPatterns?: string[];
  excludePathPatterns?: string[];
  keywords?: string[];
  extractTerms?: boolean;
  topTermsCount?: number;
  render?: boolean;
  renderTimeoutMs?: number;
  crux?: boolean;
  cruxApiKey?: string;
}
