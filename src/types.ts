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
  metrics?: PageMetrics;
}

export interface PageMetrics {
  gsc?: GscPageMetrics;
}

export interface GscPageMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscEnrichmentReport {
  property: string;
  startDate: string;
  endDate: string;
  totalRows: number;
  matchedPages: number;
  unmatchedRows: number;
  error: string | null;
}

export interface PrioritySummaryEntry {
  code: string;
  severity: Severity;
  url: string;
  impressions: number;
  clicks: number;
  position: number;
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
  priorityIssues?: PrioritySummaryEntry[];
}

export type AgentBotPolicyStatus = "allowed" | "blocked" | "unspecified";

export interface AgentBotPolicy {
  userAgent: string;
  status: AgentBotPolicyStatus;
  matchedRule?: string;
}

export type AgentContentSignalValue = "yes" | "no" | "unspecified";

export interface AgentContentSignals {
  search: AgentContentSignalValue;
  aiTrain: AgentContentSignalValue;
  aiInput: AgentContentSignalValue;
}

export interface AgentLlmsTxtAnalysis {
  hasH1: boolean;
  sectionCount: number;
  linkCount: number;
  byteSize: number;
}

export interface AgentSchemaCoverage {
  homepageHasOrgOrWebsite: boolean;
  articleLikePages: number;
  articleLikePagesWithSchema: number;
}

export interface AgentWellKnownProbe {
  name: string;
  url: string;
  present: boolean;
  status: number | null;
}

export interface AgentReadinessReport {
  score: number;
  subscores: {
    discoverability: number;
    contentAccessibility: number;
    botAccessControl: number;
    capabilities: number;
  };
  discoverability: {
    robotsTxtPresent: boolean;
    sitemapPresent: boolean;
    linkHeaderPresent: boolean;
    linkHeaderRels: string[];
  };
  contentAccessibility: {
    llmsTxtPresent: boolean;
    llmsTxtAnalysis: AgentLlmsTxtAnalysis | null;
    llmsFullTxtPresent: boolean;
    markdownNegotiationSupported: boolean;
  };
  botAccessControl: {
    aiBots: AgentBotPolicy[];
    contentSignals: AgentContentSignals;
    webBotAuthAdvertised: boolean;
  };
  capabilities: {
    probes: AgentWellKnownProbe[];
    schemaCoverage: AgentSchemaCoverage;
  };
  issues: Issue[];
}

export interface SiteReport {
  startUrl: string;
  infrastructure: InfrastructureReport;
  summary: SiteSummary;
  pages: PageReport[];
  lighthouse: LighthouseReport[];
  keywordSummary?: KeywordSummary[];
  topTerms?: TermFrequency[];
  agentReadiness?: AgentReadinessReport;
  gsc?: GscEnrichmentReport;
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
  agentReadiness?: boolean;
  gsc?: boolean;
  gscProperty?: string;
  gscDays?: number;
  gscServiceAccountKey?: string;
  gscServiceAccountKeyFile?: string;
}
