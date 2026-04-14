export { analyzeSite } from "./analyzer.js";
export { scanDirectory } from "./directory-scanner.js";
export type { DirectoryScanOptions } from "./directory-scanner.js";
export {
  buildKeywordSummary,
  countOccurrences,
  extractTermFrequencies,
  matchKeywordsOnPage,
} from "./keywords.js";
export type { PageTextContent } from "./keywords.js";
export type {
  AnalyzeOptions,
  DuplicateGroup,
  InfrastructureReport,
  Issue,
  KeywordLocationCounts,
  KeywordMatch,
  KeywordSummary,
  LighthouseMetrics,
  LighthouseReport,
  LighthouseScores,
  PageChecks,
  PageReport,
  Severity,
  SiteReport,
  SiteSummary,
  TermFrequency,
} from "./types.js";
