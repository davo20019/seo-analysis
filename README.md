# SEO Analysis Tool

This project is a crawl-based SEO CLI for auditing your own websites. It now covers:

- title and meta description quality
- suspicious metadata values like `[object Object]`
- canonical problems
- locale-aware `html lang` checks
- hreflang extraction and validation
- hreflang return-link and locale-target checks
- missing H1 headings
- `noindex` directives
- images without alt text
- exact missing Open Graph fields
- missing JSON-LD schema
- broken internal links and redirecting internal links
- redirect-chain detection
- duplicate titles and duplicate meta descriptions across crawled pages
- missing `robots.txt` or `sitemap.xml`
- optional Lighthouse audits for performance, accessibility, best practices, and SEO

## Why TypeScript here

For this tool, TypeScript is still the right default:

- one language for CLI, backend APIs, and a future dashboard
- built-in `fetch` in modern Node versions
- easy extension into Playwright or a future dashboard
- straightforward deployment to serverless or a hosted dashboard

Python becomes more attractive once the project shifts toward data-heavy workflows like keyword clustering, NLP, notebook exploration, or ML scoring.

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

# Crawl every URL surfaced by the sitemap
npm run dev -- https://example.com --full-sitemap --concurrency 12

# Limit the crawl to a site section
npm run dev -- https://example.com --include-path '^/blog'

# Skip utility or archive paths
npm run dev -- https://example.com --exclude-path '/tag/' --exclude-path '/page/[0-9]+'

# Add Lighthouse for a few representative pages
npm run dev -- https://example.com --lighthouse --lighthouse-pages 3
```

## What The CLI Does

The analyzer now:

- crawls up to `--max-pages` pages on the same site
- can crawl the full sitemap with `--full-sitemap`
- retries slow or retryable requests before failing
- fetches multiple pages in parallel with `--concurrency`
- deduplicates redirected pages by final URL
- can seed the crawl from sitemap URLs
- supports include and exclude regex filters for discovered paths
- validates locale-specific `html lang` values
- extracts and audits hreflang clusters
- flags broken internal links and redirect chains after the crawl
- reports duplicate titles and descriptions site-wide
- reports exact missing Open Graph fields instead of one generic issue
- can optionally run Lighthouse on a configurable subset of crawled pages

## Good Next Steps

If you want this to become a fuller SEO platform, the next additions should be:

1. Full schema validation instead of schema-presence checks only.
2. Sitemap-vs-canonical and orphan-page analysis across whole sites.
3. Google Search Console ingestion for impressions, clicks, CTR, and query data.
4. Scheduled crawls with saved historical reports.
5. A small web dashboard for issue tracking by site and page.
