# Keyword Search & Term Extraction

Extends the existing SEO analysis CLI with keyword search, term frequency extraction, and offline search against pre-downloaded sites.

## Motivation

Searching for keywords across a site is a frequent SEO task. Screaming Frog handles it but is slow due to GUI overhead and sequential processing. This feature adds keyword search directly to the existing crawl pipeline — parallel, CLI-native, and capable of searching local HTML files for repeat runs with zero network overhead.

## Section 1: Browser-Like Headers

Replace the current `seo-analysis-cli/0.3` user-agent and minimal accept header in `fetchResponse()` with full browser-like defaults:

```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: en-US,en;q=0.5
Accept-Encoding: gzip, deflate, br, zstd
Upgrade-Insecure-Requests: 1
DNT: 1
Sec-Fetch-Dest: document
Sec-Fetch-Mode: navigate
Sec-Fetch-Site: none
Sec-Fetch-User: ?1
Sec-GPC: 1
```

These are the defaults. The existing `--user-agent` CLI option (wired through `AnalyzeOptions.userAgent`) can still override the UA string. No custom header flags for now.

### Changes

- `analyzer.ts`: update `DEFAULT_USER_AGENT` constant and the `headers` object in `fetchResponse()`.

## Section 2: Keyword Search From a List

When the user passes `--keyword "term"` and/or `--keyword-file path`, the crawler runs an extra analysis pass on each fetched page.

### Matching behavior

- **Case-insensitive substring matching** — "seo" matches "seo audit" in body text. This matches Screaming Frog behavior.
- **Occurrence count** — count non-overlapping occurrences of the exact phrase in each location.
- **Locations tracked separately** — title, meta description, H1s, body text.

### CLI flags

```
--keyword <term>         Search for this keyword (repeatable)
--keyword-file <path>    Read keywords from a file, one per line
```

Both can be combined. Empty lines and lines starting with `#` in the keyword file are skipped.

### Data model

New field on `PageReport`:

```typescript
interface KeywordMatch {
  keyword: string;
  locations: {
    title: number;
    h1: number;
    metaDescription: number;
    body: number;
  };
  totalOccurrences: number;
}
```

`PageReport.keywordMatches: KeywordMatch[]` — only present when keywords are provided.

Site-level summary adds:

```typescript
interface KeywordSummary {
  keyword: string;
  pages: number;
  totalOccurrences: number;
  locations: { title: number; h1: number; metaDescription: number; body: number };
  urls: string[];
}
```

`SiteReport.keywordSummary: KeywordSummary[]` — sorted with **0-match keywords first** (surfaces gaps), then ascending by page count.

### Terminal output

Appended after the existing report:

```
Keyword Search Results:
  keyword        pages  occurrences  found_in
  "core vitals"  0      0            —
  "site speed"   4      11           body(4)
  "seo audit"    12     47           title(3) h1(5) meta(2) body(12)
```

### JSON/CSV export

Full URL lists included per keyword for client handoff.

### No keywords provided

If neither `--keyword` nor `--keyword-file` is passed, no keyword search runs. Existing behavior is untouched.

## Section 3: Term Frequency Extraction

When the user passes `--extract-terms`, the tool extracts the most common terms from crawled pages.

### Extraction behavior

- Extract visible text from body, titles, H1s, and meta descriptions.
- Filter out English stop words and words shorter than 3 characters.
- Count word frequency across the entire site.
- Report the top 20 terms by default, configurable with `--top-terms <n>`.

### CLI flags

```
--extract-terms          Enable term frequency extraction
--top-terms <n>          Number of top terms to report (default: 20)
```

### Data model

```typescript
interface TermFrequency {
  term: string;
  pages: number;
  occurrences: number;
  locations: { title: number; h1: number; metaDescription: number; body: number };
  urls: string[];
}
```

`SiteReport.topTerms: TermFrequency[]` — only present when `--extract-terms` is passed.

### Terminal output

```
Top Site Terms:
  rank  term          pages  occurrences  locations
  1     "marketing"   18     142          title(8) h1(10) meta(2) body(18)
  2     "analytics"   15     98           title(5) h1(3) body(15)
  3     "conversion"  12     67           body(12)
```

### Combinable

Can run alongside keyword search in a single crawl:

```bash
npm run dev -- https://example.com --keyword-file keywords.txt --extract-terms
```

## Section 4: Offline Search With `--from-directory`

Skip the network crawl entirely and search local HTML files.

### CLI flag

```
--from-directory <path>  Search local HTML files instead of crawling
```

### Behavior

- Recursively finds all `.html` and `.htm` files in the directory.
- Parses each with Cheerio (same as the live crawler).
- Runs keyword search and/or term extraction on the local files.
- **URL detection**: parse the HTML for `<link rel="canonical">` and `<base>` tags first. Fall back to file path only if neither exists. This avoids httrack's mangled file naming.
- No network requests. Speed is limited only by disk I/O.

### Constraints

- No URL argument required when `--from-directory` is set.
- Crawl-specific flags (`--max-pages`, `--concurrency`, `--retries`, `--timeout-ms`, sitemap options) are ignored.
- SEO audit checks (canonical issues, robots.txt, infrastructure) are skipped — this mode is for keyword/term search only.
- If neither `--keyword`, `--keyword-file`, nor `--extract-terms` is passed, exit with an error: "Use --from-directory with --keyword, --keyword-file, or --extract-terms."

### Use case

Crawl a site once with httrack, then run as many keyword searches as needed with zero network overhead:

```bash
httrack "https://example.com" -O "./site_backup" ...
npm run dev -- --from-directory ./site_backup --keyword-file keywords.txt
npm run dev -- --from-directory ./site_backup --extract-terms --top-terms 50
```

## Section 5: Batching and Performance

### Inline search during crawl

Keyword matching and term counting happen immediately after each page is parsed — no second pass, no storing raw HTML. Near-zero overhead added to existing crawl time.

### Default concurrency

Bumped from 4 to 6. Browser-like headers reduce blocking risk, so a higher default is safe.

### Offline mode batching

`--from-directory` reads and parses files in batches (same concurrency model as the crawler) to avoid opening thousands of file handles at once.

### No new dependencies

Everything uses the existing Cheerio parser and Node built-ins. No external processes spawned.

## Files Changed

- `src/types.ts` — add `KeywordMatch`, `KeywordSummary`, `TermFrequency` interfaces; extend `PageReport`, `SiteReport`, `AnalyzeOptions`
- `src/analyzer.ts` — browser headers, keyword matching logic, term extraction logic, inline during crawl
- `src/cli.ts` — new CLI flags, keyword file parsing, terminal output formatting, `--from-directory` mode
- `src/directory-scanner.ts` — new file for recursive HTML file discovery and local parsing (used only by `--from-directory`)
