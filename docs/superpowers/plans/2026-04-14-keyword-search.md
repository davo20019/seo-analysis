# Keyword Search & Term Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add keyword search, term frequency extraction, and offline directory search to the existing SEO analysis CLI.

**Architecture:** Extends the existing crawl pipeline — keyword matching and term counting run inline as each page is parsed. A new `directory-scanner.ts` module handles the `--from-directory` offline mode. All analysis shares the same Cheerio-parsed DOM, so no extra fetching or parsing passes are needed.

**Tech Stack:** TypeScript, Cheerio (already installed), Node built-in `fs/promises` and `path` for directory scanning. No new dependencies.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `KeywordMatch`, `KeywordSummary`, `TermFrequency` interfaces; extend `PageReport`, `SiteReport`, `AnalyzeOptions` |
| `src/keywords.ts` | Create | Keyword matching logic (`countKeywordInText`, `matchKeywordsOnPage`) and term extraction logic (`extractTerms`, stop words list) |
| `src/directory-scanner.ts` | Create | Recursive HTML file discovery, local file parsing, canonical/base URL detection |
| `src/analyzer.ts` | Modify | Browser-like headers, bump default concurrency, call keyword/term functions after page parse |
| `src/cli.ts` | Modify | New CLI flags, keyword file reading, `--from-directory` mode, keyword/term output formatting |

---

### Task 1: Add types for keyword search and term extraction

**Files:**
- Modify: `src/types.ts:44-54` (extend `PageReport`)
- Modify: `src/types.ts:105-129` (extend `SiteSummary` and `SiteReport`)
- Modify: `src/types.ts:131-144` (extend `AnalyzeOptions`)

- [ ] **Step 1: Add KeywordMatch interface**

Add after the `PageChecks` interface (after line 43) in `src/types.ts`:

```typescript
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
```

- [ ] **Step 2: Add KeywordSummary interface**

Add after `KeywordMatch`:

```typescript
export interface KeywordSummary {
  keyword: string;
  pages: number;
  totalOccurrences: number;
  locations: KeywordLocationCounts;
  urls: string[];
}
```

- [ ] **Step 3: Add TermFrequency interface**

Add after `KeywordSummary`:

```typescript
export interface TermFrequency {
  term: string;
  pages: number;
  occurrences: number;
  locations: KeywordLocationCounts;
  urls: string[];
}
```

- [ ] **Step 4: Extend PageReport with keywordMatches**

In the `PageReport` interface, add after the `discoveredLinks` field:

```typescript
  keywordMatches?: KeywordMatch[];
```

- [ ] **Step 5: Extend SiteReport with keyword and term data**

In the `SiteReport` interface, add after the `lighthouse` field:

```typescript
  keywordSummary?: KeywordSummary[];
  topTerms?: TermFrequency[];
```

- [ ] **Step 6: Extend AnalyzeOptions with keyword and term options**

In the `AnalyzeOptions` interface, add after the `excludePathPatterns` field:

```typescript
  keywords?: string[];
  extractTerms?: boolean;
  topTermsCount?: number;
```

- [ ] **Step 7: Verify the project compiles**

Run: `npx tsc --noEmit`
Expected: No errors (new types are not used yet, just defined)

- [ ] **Step 8: Commit**

```bash
git add src/types.ts
git commit -m "feat: add types for keyword search, keyword summary, and term frequency"
```

---

### Task 2: Implement keyword matching and term extraction logic

**Files:**
- Create: `src/keywords.ts`

- [ ] **Step 1: Create `src/keywords.ts` with stop words and `countOccurrences`**

```typescript
import type { KeywordLocationCounts, KeywordMatch, KeywordSummary, TermFrequency } from "./types.js";

const STOP_WORDS = new Set([
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
  "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
  "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
  "or", "an", "will", "my", "one", "all", "would", "there", "their", "what",
  "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
  "when", "make", "can", "like", "time", "no", "just", "him", "know", "take",
  "people", "into", "year", "your", "good", "some", "could", "them", "see",
  "other", "than", "then", "now", "look", "only", "come", "its", "over",
  "think", "also", "back", "after", "use", "two", "how", "our", "work",
  "first", "well", "way", "even", "new", "want", "because", "any", "these",
  "give", "day", "most", "us", "are", "has", "was", "were", "been", "had",
  "did", "does", "being", "more", "very", "much", "own", "should", "may",
  "each", "such", "here", "where", "why", "let", "still", "too", "those",
  "through", "while", "before", "must", "between", "under", "never", "same",
  "another", "both", "few", "during", "without", "again", "once", "already",
  "many", "since", "long", "down", "off", "thing", "every", "per", "via"
]);

const MIN_TERM_LENGTH = 3;

export function countOccurrences(text: string, keyword: string): number {
  if (!text || !keyword) {
    return 0;
  }

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  let count = 0;
  let position = 0;

  while (true) {
    const index = lowerText.indexOf(lowerKeyword, position);

    if (index === -1) {
      break;
    }

    count += 1;
    position = index + lowerKeyword.length;
  }

  return count;
}
```

- [ ] **Step 2: Add `matchKeywordsOnPage` function**

Append to `src/keywords.ts`:

```typescript
export interface PageTextContent {
  title: string;
  metaDescription: string;
  h1Text: string;
  bodyText: string;
}

export function matchKeywordsOnPage(
  keywords: string[],
  content: PageTextContent
): KeywordMatch[] {
  return keywords.map((keyword) => {
    const locations: KeywordLocationCounts = {
      title: countOccurrences(content.title, keyword),
      h1: countOccurrences(content.h1Text, keyword),
      metaDescription: countOccurrences(content.metaDescription, keyword),
      body: countOccurrences(content.bodyText, keyword),
    };

    return {
      keyword,
      locations,
      totalOccurrences: locations.title + locations.h1 + locations.metaDescription + locations.body,
    };
  });
}
```

- [ ] **Step 3: Add `buildKeywordSummary` function**

Append to `src/keywords.ts`:

```typescript
import type { PageReport } from "./types.js";

export function buildKeywordSummary(
  keywords: string[],
  pages: PageReport[]
): KeywordSummary[] {
  const summaries: KeywordSummary[] = keywords.map((keyword) => {
    const locations: KeywordLocationCounts = { title: 0, h1: 0, metaDescription: 0, body: 0 };
    const urls: string[] = [];
    let totalOccurrences = 0;

    for (const page of pages) {
      const match = page.keywordMatches?.find((m) => m.keyword === keyword);

      if (!match || match.totalOccurrences === 0) {
        continue;
      }

      urls.push(page.finalUrl);
      totalOccurrences += match.totalOccurrences;
      locations.title += match.locations.title;
      locations.h1 += match.locations.h1;
      locations.metaDescription += match.locations.metaDescription;
      locations.body += match.locations.body;
    }

    return {
      keyword,
      pages: urls.length,
      totalOccurrences,
      locations,
      urls,
    };
  });

  return summaries.sort((a, b) => {
    if (a.pages === 0 && b.pages > 0) return -1;
    if (a.pages > 0 && b.pages === 0) return 1;
    return a.pages - b.pages;
  });
}
```

- [ ] **Step 4: Add `extractTermFrequencies` function**

Append to `src/keywords.ts`:

```typescript
interface TermAccumulator {
  occurrences: number;
  locations: KeywordLocationCounts;
  pageUrls: Set<string>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(word));
}

function addTokensToAccumulator(
  tokens: string[],
  location: keyof KeywordLocationCounts,
  pageUrl: string,
  accumulator: Map<string, TermAccumulator>
): void {
  for (const token of tokens) {
    let entry = accumulator.get(token);

    if (!entry) {
      entry = {
        occurrences: 0,
        locations: { title: 0, h1: 0, metaDescription: 0, body: 0 },
        pageUrls: new Set(),
      };
      accumulator.set(token, entry);
    }

    entry.occurrences += 1;
    entry.locations[location] += 1;
    entry.pageUrls.add(pageUrl);
  }
}

export function extractTermFrequencies(
  pages: PageReport[],
  topN: number
): TermFrequency[] {
  const accumulator = new Map<string, TermAccumulator>();

  for (const page of pages) {
    const title = page.checks.title ?? "";
    const metaDescription = page.checks.metaDescription ?? "";
    const h1Text = page.checks.h1s.join(" ");
    const bodyText = page.checks.bodyText ?? "";

    addTokensToAccumulator(tokenize(title), "title", page.finalUrl, accumulator);
    addTokensToAccumulator(tokenize(metaDescription), "metaDescription", page.finalUrl, accumulator);
    addTokensToAccumulator(tokenize(h1Text), "h1", page.finalUrl, accumulator);
    addTokensToAccumulator(tokenize(bodyText), "body", page.finalUrl, accumulator);
  }

  return [...accumulator.entries()]
    .sort((a, b) => b[1].occurrences - a[1].occurrences)
    .slice(0, topN)
    .map(([term, data]) => ({
      term,
      pages: data.pageUrls.size,
      occurrences: data.occurrences,
      locations: data.locations,
      urls: [...data.pageUrls],
    }));
}
```

- [ ] **Step 5: Fix the import statement at the top of the file**

The file should have a single combined import from `./types.js` at the top. Ensure line 1 reads:

```typescript
import type { KeywordLocationCounts, KeywordMatch, KeywordSummary, PageReport, TermFrequency } from "./types.js";
```

Remove the duplicate `import type { PageReport }` added in Step 3.

- [ ] **Step 6: Verify the project compiles**

Run: `npx tsc --noEmit`
Expected: No errors. Note: the compile will warn or error if `PageChecks.bodyText` does not exist yet — this is expected and will be added in Task 3.

- [ ] **Step 7: Commit**

```bash
git add src/keywords.ts
git commit -m "feat: add keyword matching and term frequency extraction logic"
```

---

### Task 3: Store body text in PageChecks and wire keyword matching into the crawler

**Files:**
- Modify: `src/types.ts:22-43` (add `bodyText` to `PageChecks`)
- Modify: `src/analyzer.ts:23-24` (update `DEFAULT_USER_AGENT` and `DEFAULT_CONCURRENCY`)
- Modify: `src/analyzer.ts:227-243` (update `fetchResponse` headers)
- Modify: `src/analyzer.ts:65-89` (update `createEmptyChecks`)
- Modify: `src/analyzer.ts:1036-1143` (update `analyzeHtml` to store bodyText)
- Modify: `src/analyzer.ts:2062-2289` (update `analyzeSite` to wire keyword matching and term extraction)

- [ ] **Step 1: Add `bodyText` to `PageChecks` in `src/types.ts`**

In the `PageChecks` interface, add after the `schemaTypes` field:

```typescript
  bodyText: string | null;
```

- [ ] **Step 2: Update `createEmptyChecks` in `src/analyzer.ts`**

Add `bodyText: null` to the return object in `createEmptyChecks()`, after the `schemaTypes: []` line:

```typescript
    schemaTypes: [],
    bodyText: null
```

- [ ] **Step 3: Update browser headers in `src/analyzer.ts`**

Replace the `DEFAULT_USER_AGENT` constant (line 23):

```typescript
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0";
```

Update `DEFAULT_CONCURRENCY` (line 20):

```typescript
const DEFAULT_CONCURRENCY = 6;
```

- [ ] **Step 4: Update `fetchResponse` headers in `src/analyzer.ts`**

Replace the `headers` object in the `fetchResponse` function (around line 232-236):

```typescript
    return await fetch(url, {
      redirect: "manual",
      headers: {
        "user-agent": options.userAgent,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.5",
        "accept-encoding": "gzip, deflate, br, zstd",
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
```

- [ ] **Step 5: Store `bodyText` in `analyzeHtml` in `src/analyzer.ts`**

In `analyzeHtml()`, around line 1088 where `bodyText` is already computed for `wordCount`, keep the variable and store it in the returned `checks` object. Find the line:

```typescript
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
```

This variable already exists. In the `checks` object of the return statement, add after `schemaTypes`:

```typescript
      bodyText: bodyText || null,
```

- [ ] **Step 6: Wire keyword matching into `analyzeSite` in `src/analyzer.ts`**

Add import at the top of `analyzer.ts`:

```typescript
import { buildKeywordSummary, extractTermFrequencies, matchKeywordsOnPage } from "./keywords.js";
import type { PageTextContent } from "./keywords.js";
```

In `analyzeSite()`, after each page is fully built (both the `startPage` and pages from the batch loop), add keyword matching. The cleanest approach is a helper function right before `analyzeSite`:

```typescript
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
```

Then in `analyzeSite()`, extract the keywords from options near the top of the function (after the `fetchOptions` declaration):

```typescript
  const keywords = rawOptions.keywords ?? [];
  const extractTermsEnabled = rawOptions.extractTerms ?? false;
  const topTermsCount = rawOptions.topTermsCount ?? 20;
```

After `pages.push(startPage)` (line 2149), add:

```typescript
  applyKeywordMatches(startPage, keywords);
```

Inside the batch loop, after `pages.push(page)` (line 2227), add:

```typescript
      applyKeywordMatches(page, keywords);
```

- [ ] **Step 7: Add keyword summary and term extraction to the return value**

In `analyzeSite()`, before the final `return` statement (around line 2277), add:

```typescript
  const keywordSummary = keywords.length > 0 ? buildKeywordSummary(keywords, pages) : undefined;
  const topTerms = extractTermsEnabled ? extractTermFrequencies(pages, topTermsCount) : undefined;
```

Update the return statement to include these:

```typescript
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
    topTerms,
  };
```

- [ ] **Step 8: Verify the project compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/analyzer.ts
git commit -m "feat: wire keyword matching and term extraction into crawl pipeline"
```

---

### Task 4: Add CLI flags and output formatting

**Files:**
- Modify: `src/cli.ts:1-53` (add new flags to help text)
- Modify: `src/cli.ts:86-280` (add new option parsing)
- Modify: `src/cli.ts:342-394` (add keyword/term output formatting)
- Modify: `src/cli.ts:404-441` (pass new options to `analyzeSite`)

- [ ] **Step 1: Add keyword-related fields to `CliOptions` interface**

In `src/cli.ts`, add these fields to the `CliOptions` interface (after `outputPath`):

```typescript
  keywords: string[];
  keywordFile: string | null;
  extractTerms: boolean;
  topTerms: number;
  fromDirectory: string | null;
```

- [ ] **Step 2: Update help text**

In the `printHelp()` function, add these lines to the options list (after the `--output` line):

```
  --keyword <term>          Search for this keyword in crawled pages (repeatable)
  --keyword-file <path>     Read keywords from a file, one per line
  --extract-terms           Extract and rank the most frequent terms on the site
  --top-terms <n>           Number of top terms to report. Default: 20
  --from-directory <path>   Search local HTML files instead of crawling
```

Add examples:

```
  npm run dev -- https://example.com --keyword "seo" --keyword "site audit"
  npm run dev -- https://example.com --keyword-file keywords.txt --extract-terms
  npm run dev -- --from-directory ./site_backup --keyword-file keywords.txt
```

- [ ] **Step 3: Update `parseArgs` defaults and parsing**

Add defaults in the `parseArgs` function options object:

```typescript
    keywords: [],
    keywordFile: null,
    extractTerms: false,
    topTerms: 20,
    fromDirectory: null,
```

Add parsing blocks for the new flags (in the `for` loop, before the `if (arg.startsWith("--"))` catch-all):

```typescript
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
```

- [ ] **Step 4: Update validation in `parseArgs`**

After the existing validation block, add:

```typescript
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
```

Remove or update the existing `options.urls.length === 0` check to be handled by the new block above.

- [ ] **Step 5: Add keyword file reading helper**

Add this import at the top of `src/cli.ts`:

```typescript
import { readFile } from "node:fs/promises";
```

Add a helper function after `validatePatterns`:

```typescript
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
```

- [ ] **Step 6: Add keyword summary formatting**

Add after `formatLighthouseReport`:

```typescript
function formatKeywordSummary(summary: import("./types.js").KeywordSummary[]): string[] {
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

    const foundIn = locations.length > 0 ? locations.join(" ") : "—";
    lines.push(
      `  "${truncate(entry.keyword, 30)}"  pages=${entry.pages}  occurrences=${entry.totalOccurrences}  found_in=${foundIn}`
    );
  }

  return lines;
}

function formatTopTerms(terms: import("./types.js").TermFrequency[]): string[] {
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
```

- [ ] **Step 7: Wire keyword/term formatting into `formatTextReport`**

In `formatTextReport`, add before the return:

```typescript
  if (report.keywordSummary) {
    lines.push(...formatKeywordSummary(report.keywordSummary));
  }

  if (report.topTerms) {
    lines.push(...formatTopTerms(report.topTerms));
  }
```

- [ ] **Step 8: Wire keyword options into `main()`**

In the `main()` function, after `const options = parseArgs(...)`, add keyword loading:

```typescript
    const keywords = await loadKeywords(options.keywords, options.keywordFile);
```

Update the `analyzeSite` call to pass keyword options:

```typescript
        await analyzeSite(url, {
          concurrency: options.concurrency,
          excludePathPatterns: options.excludePathPatterns,
          fullSitemap: options.fullSitemap,
          includePathPatterns: options.includePathPatterns,
          lighthouse: options.lighthouse,
          lighthousePageCount: options.lighthousePages,
          maxPages: options.maxPages,
          retries: options.retries,
          sampleSitemap: options.sampleSitemap,
          seedSitemap: options.seedSitemap,
          timeoutMs: options.timeoutMs,
          keywords,
          extractTerms: options.extractTerms,
          topTermsCount: options.topTerms,
        })
```

- [ ] **Step 9: Verify the project compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI flags and output formatting for keyword search and term extraction"
```

---

### Task 5: Implement `--from-directory` offline search

**Files:**
- Create: `src/directory-scanner.ts`
- Modify: `src/cli.ts:404-441` (add `--from-directory` branch in `main()`)

- [ ] **Step 1: Create `src/directory-scanner.ts`**

```typescript
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { load } from "cheerio";

import { matchKeywordsOnPage, extractTermFrequencies, buildKeywordSummary } from "./keywords.js";
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
    try {
      const ogUrl = $('meta[property="og:url"]').attr("content")?.trim();

      if (ogUrl && ogUrl.startsWith("http")) {
        return ogUrl;
      }

      return base;
    } catch {
      return base;
    }
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
      externalLinks: 0,
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
        isIndex: false,
        coverageLimited: false,
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
```

- [ ] **Step 2: Wire `--from-directory` into `main()` in `src/cli.ts`**

Add import at the top of `cli.ts`:

```typescript
import { scanDirectory } from "./directory-scanner.js";
```

In the `main()` function, add a branch before the existing `for` loop over `options.urls`:

```typescript
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
            // ... existing options ...
            keywords,
            extractTerms: options.extractTerms,
            topTermsCount: options.topTerms,
          })
        );
      }
    }
```

- [ ] **Step 3: Verify the project compiles**

Run: `npx tsc --noEmit`
Expected: No errors. If there are type mismatches (e.g., `SiteSummary` or `InfrastructureReport` have fields the stub doesn't include), fix the stub object in `scanDirectory` to match the exact interface shape.

- [ ] **Step 4: Commit**

```bash
git add src/directory-scanner.ts src/cli.ts
git commit -m "feat: add --from-directory mode for offline keyword search"
```

---

### Task 6: Manual verification

**Files:** None modified — verification only.

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Clean compile, `dist/` directory updated.

- [ ] **Step 2: Test keyword search against a live site**

Run: `npm run dev -- https://example.com --keyword "example" --keyword "domain" --max-pages 3`

Expected: Standard SEO report followed by a "Keyword Search Results" section showing match counts for "example" and "domain".

- [ ] **Step 3: Test term extraction**

Run: `npm run dev -- https://example.com --extract-terms --top-terms 10 --max-pages 3`

Expected: Standard SEO report followed by a "Top Site Terms" section listing the 10 most frequent terms.

- [ ] **Step 4: Test keyword file**

Create a test keyword file:

```bash
printf "example\ndomain\n# this is a comment\nillustrative" > /tmp/test-keywords.txt
```

Run: `npm run dev -- https://example.com --keyword-file /tmp/test-keywords.txt --max-pages 3`

Expected: Keyword search results for all three keywords (comment line skipped).

- [ ] **Step 5: Test JSON output**

Run: `npm run dev -- https://example.com --keyword "example" --extract-terms --max-pages 2 --json`

Expected: JSON output including `keywordSummary` and `topTerms` arrays with `urls` fields populated.

- [ ] **Step 6: Test `--from-directory` mode**

If httrack is available:

```bash
httrack "https://example.com" -O "/tmp/example-backup" --depth=1
npm run dev -- --from-directory /tmp/example-backup --keyword "example" --extract-terms
```

If httrack is not available, create a test directory manually:

```bash
mkdir -p /tmp/test-html
printf '<html><head><title>Test Page</title><meta name="description" content="A test page for SEO"></head><body><h1>SEO Testing</h1><p>This page tests SEO keyword search functionality.</p></body></html>' > /tmp/test-html/index.html
printf '<html><head><title>About Us</title><link rel="canonical" href="https://example.com/about"></head><body><h1>About</h1><p>We do SEO analysis and keyword research.</p></body></html>' > /tmp/test-html/about.html

npm run dev -- --from-directory /tmp/test-html --keyword "SEO" --keyword "keyword" --extract-terms
```

Expected: Results based on local files, canonical URL detected for `about.html`.

- [ ] **Step 7: Test error cases**

Run: `npm run dev -- --from-directory /tmp/test-html`
Expected: Error message "Use --from-directory with --keyword, --keyword-file, or --extract-terms."

Run: `npm run dev -- --from-directory /tmp/nonexistent --keyword "test"`
Expected: Error about directory not existing.

- [ ] **Step 8: Commit any fixes**

If any issues were found and fixed during verification:

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```

---

### Task 7: Update README and push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md**

Add a "Keyword Search" section after the "Useful Options" section:

```markdown
## Keyword Search

Search for specific keywords across a site:

\`\`\`bash
# Search for keywords
npm run dev -- https://example.com --keyword "seo audit" --keyword "site speed"

# Load keywords from a file
npm run dev -- https://example.com --keyword-file keywords.txt

# Combine keyword search with term extraction
npm run dev -- https://example.com --keyword-file keywords.txt --extract-terms --top-terms 30
\`\`\`

## Offline Search

Search pre-downloaded HTML files for faster repeated searches:

\`\`\`bash
# Download a site with httrack
httrack "https://example.com" -O "./site_backup"

# Search the local copy (no network requests)
npm run dev -- --from-directory ./site_backup --keyword-file keywords.txt
npm run dev -- --from-directory ./site_backup --extract-terms
\`\`\`
```

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "docs: add keyword search and offline search documentation"
git push origin main
```
