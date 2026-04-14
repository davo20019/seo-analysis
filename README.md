# SEO Analysis Tool

This project is a crawl-based SEO CLI for auditing your own websites. It now covers:

- title and meta description quality
- suspicious metadata values like `[object Object]`
- canonical problems
- missing H1 headings
- `noindex` directives
- images without alt text
- exact missing Open Graph fields
- missing JSON-LD schema
- duplicate titles and duplicate meta descriptions across crawled pages
- missing `robots.txt` or `sitemap.xml`

## Why TypeScript here

For this tool, TypeScript is still the right default:

- one language for CLI, backend APIs, and a future dashboard
- built-in `fetch` in modern Node versions
- easy extension into Playwright or Lighthouse-based audits later
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

# Limit the crawl to a site section
npm run dev -- https://example.com --include-path '^/blog'

# Skip utility or archive paths
npm run dev -- https://example.com --exclude-path '/tag/' --exclude-path '/page/[0-9]+'
```

## What The CLI Does

The analyzer now:

- crawls up to `--max-pages` pages on the same site
- retries slow or retryable requests before failing
- fetches multiple pages in parallel with `--concurrency`
- deduplicates redirected pages by final URL
- can seed the crawl from sitemap URLs
- supports include and exclude regex filters for discovered paths
- reports duplicate titles and descriptions site-wide
- reports exact missing Open Graph fields instead of one generic issue

## Good Next Steps

If you want this to become a fuller SEO platform, the next additions should be:

1. Lighthouse or PageSpeed integration for Core Web Vitals.
2. Google Search Console ingestion for impressions, clicks, CTR, and query data.
3. Scheduled crawls with saved historical reports.
4. A small web dashboard for issue tracking by site and page.
5. Keyword-based rules for landing pages and blog posts.
