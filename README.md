# SEO Analysis Tool

This project is a crawl-based SEO CLI for auditing websites.

It focuses on technical SEO issues that can be derived from the crawl itself, with optional Lighthouse support for a small set of pages.

## What It Checks

- missing, short, long, duplicate, and multiple title tags
- missing, short, long, and duplicate meta descriptions
- suspicious metadata values like `[object Object]`, `undefined`, or `null`
- canonical issues, including missing, invalid, cross-host, and URL-mismatch canonicals
- HTTP pages instead of HTTPS
- locale-aware `html lang` checks
- hreflang extraction and validation
- hreflang duplicate values, missing `x-default`, missing self-reference, missing return links, redirecting targets, and locale-target mismatches
- missing and multiple H1 headings
- `noindex` directives
- images without alt text
- exact missing Open Graph fields
- missing JSON-LD schema presence
- low body word count
- pages with no crawlable internal links
- internal links with missing anchor text
- internal links with generic anchor text like `read more` or `click here`
- broken internal links, redirecting internal links, and redirect chains
- weak internal-link support, including pages with only one incoming internal link
- orphan candidates based on the crawled internal-link graph
- sitemap inclusion checks for crawled pages
- sitemap-vs-canonical mismatches
- missing or blocking `robots.txt`
- missing `sitemap.xml`
- missing or empty `llms.txt`
- optional Lighthouse audits for performance, accessibility, best practices, and SEO

## Quick Start

```bash
npm install
npm run dev -- https://example.com
```

Build the CLI:

```bash
npm run build
npm run start -- https://example.com --max-pages 20
```

Write JSON output to a file:

```bash
npm run dev -- https://example.com --json --output report.json
```

## Useful Options

```bash
# Faster crawl with retries and sitemap seeding
npm run dev -- https://example.com --max-pages 50 --concurrency 6 --retries 2

# Crawl every URL surfaced by discovered sitemap files
npm run dev -- https://example.com --full-sitemap --concurrency 12

# Sample representative sitemap URLs up to --max-pages
npm run dev -- https://example.com --sample-sitemap --max-pages 25

# Limit the crawl to a site section
npm run dev -- https://example.com --include-path '^/blog'

# Skip utility or archive paths
npm run dev -- https://example.com --exclude-path '/tag/' --exclude-path '/page/[0-9]+'

# Add Lighthouse for a few representative pages
npm run dev -- https://example.com --lighthouse --lighthouse-pages 3
```

## Keyword Search

Search for specific keywords across a site:

```bash
# Search for keywords
npm run dev -- https://example.com --keyword "seo audit" --keyword "site speed"

# Load keywords from a file (one per line, # comments supported)
npm run dev -- https://example.com --keyword-file keywords.txt

# Combine keyword search with term extraction
npm run dev -- https://example.com --keyword-file keywords.txt --extract-terms --top-terms 30
```

## Offline Search

Search pre-downloaded HTML files for faster repeated searches:

```bash
# Download a site with httrack
httrack "https://example.com" -O "./site_backup"

# Search the local copy (no network requests)
npm run dev -- --from-directory ./site_backup --keyword-file keywords.txt
npm run dev -- --from-directory ./site_backup --extract-terms
```

## Crawl Behavior

- crawls up to `--max-pages` pages, or the full sitemap with `--full-sitemap`
- fetches pages in parallel with `--concurrency` (default: 6)
- retries slow or retryable requests with exponential backoff
- deduplicates redirected pages by final URL
- seeds the crawl queue from `sitemap.xml` automatically
- supports `--include-path` and `--exclude-path` regex filters
- samples representative sitemap URLs with `--sample-sitemap`

## Notes And Limits

- `--sample-sitemap` is useful when you want representative sitemap coverage quickly, but link-graph findings are less complete because the crawl is intentionally sampled.
- Sitemap reconciliation relies on the set of sitemap URLs the CLI was able to collect. The report marks sitemap coverage as partial when that set was truncated.
- Structured data support is currently presence-based. The CLI detects JSON-LD types, but it does not yet perform full schema validation.

## License

[MIT](LICENSE)
