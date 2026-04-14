import type {
  KeywordLocationCounts,
  KeywordMatch,
  KeywordSummary,
  PageReport,
  TermFrequency,
} from "./types.js";

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------

export const STOP_WORDS = new Set<string>([
  "a", "about", "above", "after", "again", "against", "ain", "all", "also",
  "am", "an", "and", "any", "are", "aren", "as", "at", "be", "because",
  "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "cannot", "could", "couldn", "d", "did", "didn", "do", "does",
  "doesn", "doing", "don", "down", "during", "each", "even", "few", "for",
  "from", "further", "get", "got", "had", "hadn", "has", "hasn", "have",
  "haven", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "isn", "it",
  "its", "itself", "just", "let", "ll", "m", "ma", "may", "me", "mightn",
  "more", "most", "mustn", "my", "myself", "need", "needn", "no", "nor",
  "not", "now", "o", "of", "off", "on", "once", "only", "or", "other",
  "our", "ours", "ourselves", "out", "over", "own", "re", "s", "same",
  "shan", "she", "should", "shouldn", "so", "some", "such", "t", "than",
  "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under",
  "until", "up", "us", "ve", "very", "was", "wasn", "we", "were", "weren",
  "what", "when", "where", "which", "while", "who", "whom", "why", "will",
  "with", "won", "would", "wouldn", "y", "you", "your", "yours",
  "yourself", "yourselves", "been", "being", "having", "doing",
  // Extra common web/content stop words
  "ago", "already", "always", "another", "anything", "around", "back",
  "come", "coming", "else", "everything", "find", "first", "follow",
  "give", "go", "going", "good", "great", "home", "however", "include",
  "keep", "know", "last", "like", "look", "make", "many", "might",
  "much", "must", "new", "next", "old", "one", "part", "place", "right",
  "said", "say", "see", "set", "since", "still", "sure", "take", "tell",
  "thing", "think", "though", "three", "time", "two", "use", "used",
  "using", "via", "want", "way", "well", "whole", "within", "work",
  "year", "yet",
]);

// ---------------------------------------------------------------------------
// PageTextContent interface
// ---------------------------------------------------------------------------

export interface PageTextContent {
  title: string;
  metaDescription: string;
  h1Text: string;
  bodyText: string;
}

// ---------------------------------------------------------------------------
// countOccurrences
// ---------------------------------------------------------------------------

/**
 * Count non-overlapping, case-insensitive occurrences of `keyword` in `text`.
 */
export function countOccurrences(text: string, keyword: string): number {
  if (!keyword) return 0;
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  let count = 0;
  let pos = 0;
  while ((pos = lower.indexOf(kw, pos)) !== -1) {
    count++;
    pos += kw.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// matchKeywordsOnPage
// ---------------------------------------------------------------------------

/**
 * For each keyword, count occurrences in each page location and return
 * a `KeywordMatch` array.
 */
export function matchKeywordsOnPage(
  keywords: string[],
  content: PageTextContent,
): KeywordMatch[] {
  return keywords.map((keyword) => {
    const title = countOccurrences(content.title, keyword);
    const h1 = countOccurrences(content.h1Text, keyword);
    const metaDescription = countOccurrences(content.metaDescription, keyword);
    const body = countOccurrences(content.bodyText, keyword);
    const locations: KeywordLocationCounts = { title, h1, metaDescription, body };
    return {
      keyword,
      locations,
      totalOccurrences: title + h1 + metaDescription + body,
    };
  });
}

// ---------------------------------------------------------------------------
// buildKeywordSummary
// ---------------------------------------------------------------------------

/**
 * Aggregate keyword matches across all pages.
 * Sort: 0-match keywords first, then ascending by page count.
 */
export function buildKeywordSummary(
  keywords: string[],
  pages: PageReport[],
): KeywordSummary[] {
  // Build a map: keyword -> accumulated summary data
  const summaryMap = new Map<
    string,
    { pages: number; totalOccurrences: number; locations: KeywordLocationCounts; urls: string[] }
  >();

  for (const kw of keywords) {
    summaryMap.set(kw, {
      pages: 0,
      totalOccurrences: 0,
      locations: { title: 0, h1: 0, metaDescription: 0, body: 0 },
      urls: [],
    });
  }

  for (const page of pages) {
    if (!page.keywordMatches) continue;
    for (const match of page.keywordMatches) {
      const entry = summaryMap.get(match.keyword);
      if (!entry) continue;
      if (match.totalOccurrences > 0) {
        entry.pages++;
        entry.totalOccurrences += match.totalOccurrences;
        entry.locations.title += match.locations.title;
        entry.locations.h1 += match.locations.h1;
        entry.locations.metaDescription += match.locations.metaDescription;
        entry.locations.body += match.locations.body;
        entry.urls.push(page.finalUrl);
      }
    }
  }

  const summaries: KeywordSummary[] = keywords.map((kw) => {
    const entry = summaryMap.get(kw)!;
    return { keyword: kw, ...entry };
  });

  // Sort: 0-match keywords first, then ascending by page count
  summaries.sort((a, b) => {
    if (a.totalOccurrences === 0 && b.totalOccurrences > 0) return -1;
    if (b.totalOccurrences === 0 && a.totalOccurrences > 0) return 1;
    return a.pages - b.pages;
  });

  return summaries;
}

// ---------------------------------------------------------------------------
// extractTermFrequencies — internal helpers
// ---------------------------------------------------------------------------

interface TermAccumulator {
  occurrences: number;
  pages: Set<string>;
  locations: KeywordLocationCounts;
  urls: Set<string>;
}

/**
 * Tokenize a string: lowercase, replace non-alphanumeric (except apostrophes
 * and hyphens) with spaces, split on whitespace.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Add tokens from `text` into the accumulator map, tracking the page URL
 * and which location the text came from.
 */
function addTokensToAccumulator(
  text: string,
  location: keyof KeywordLocationCounts,
  pageUrl: string,
  acc: Map<string, TermAccumulator>,
): void {
  const tokens = tokenize(text);
  for (const token of tokens) {
    let entry = acc.get(token);
    if (!entry) {
      entry = {
        occurrences: 0,
        pages: new Set<string>(),
        locations: { title: 0, h1: 0, metaDescription: 0, body: 0 },
        urls: new Set<string>(),
      };
      acc.set(token, entry);
    }
    entry.occurrences++;
    entry.locations[location]++;
    entry.pages.add(pageUrl);
    entry.urls.add(pageUrl);
  }
}

// ---------------------------------------------------------------------------
// extractTermFrequencies
// ---------------------------------------------------------------------------

/**
 * Tokenize text from all pages, filter stop words and short words,
 * count frequency across the site, return top N as `TermFrequency[]`
 * sorted by occurrences descending.
 *
 * NOTE: Accesses `page.checks.bodyText` which does not yet exist on
 * `PageChecks`. This will cause a TypeScript compile error until Task 3
 * adds the field to the interface.
 */
export function extractTermFrequencies(
  pages: PageReport[],
  topN: number,
): TermFrequency[] {
  const acc = new Map<string, TermAccumulator>();

  for (const page of pages) {
    const url = page.finalUrl;
    const checks = page.checks;

    addTokensToAccumulator(checks.title ?? "", "title", url, acc);
    addTokensToAccumulator(checks.metaDescription ?? "", "metaDescription", url, acc);
    addTokensToAccumulator(checks.h1s.join(" "), "h1", url, acc);
    // bodyText will be added to PageChecks in Task 3; this line causes a
    // compile error until that field is added.
    addTokensToAccumulator(checks.bodyText ?? "", "body", url, acc);
  }

  const results: TermFrequency[] = [];
  for (const [term, entry] of acc.entries()) {
    results.push({
      term,
      occurrences: entry.occurrences,
      pages: entry.pages.size,
      locations: entry.locations,
      urls: Array.from(entry.urls),
    });
  }

  results.sort((a, b) => b.occurrences - a.occurrences);
  return results.slice(0, topN);
}
