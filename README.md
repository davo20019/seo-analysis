# SEO Analysis Tool

This project is a crawl-based SEO CLI for auditing websites.

It focuses on technical SEO issues that can be derived from the crawl itself, with optional headless-Chromium rendering (`--render`), Google CrUX field data (`--crux`), and Lighthouse audits for a small set of pages.

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
- missing or invalid JSON-LD structured data
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
- images missing explicit width and height attributes
- images without `loading="lazy"` hints
- images served in legacy formats (jpg/png/gif) instead of webp/avif
- missing or zoom-blocking viewport meta (mobile audit)
- missing Strict-Transport-Security, missing Content-Type, or overly defensive Cache-Control on HTTP responses
- `X-Robots-Tag` noindex/nofollow directives delivered via HTTP response headers
- URLs explicitly disallowed by `robots.txt` for the configured user agent
- JSON-LD validation against rich-result requirements: Product, Article (BlogPosting/NewsArticle), FAQPage, BreadcrumbList, Organization, LocalBusiness
- JSON-LD Product offers without `price` or `priceCurrency`
- nested sitemap-index resolution (walks one level of nested sitemaps, capped at 50 children)
- sitemap entries with `lastmod` older than 12 months
- real-user Core Web Vitals from Google CrUX (LCP/INP/CLS p75) when `--crux` is enabled and `CRUX_API_KEY` is set

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

# Override the User-Agent string sent by the crawler
npm run dev -- https://example.com --user-agent "Mozilla/5.0 (compatible; MyCrawler/1.0)"
```

```bash
# Render pages with headless Chromium (Playwright) — needed for SPAs,
# JS-challenge sites (Cloudflare turnstile), and pages whose final DOM
# depends on JS. Slower and heavier than the default static fetch.
npm run dev -- https://example.com --render --max-pages 5
```

Notes on `--render`:
- First `npm install` auto-downloads Chromium (~300MB). To skip (e.g. CI), set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and run `npx playwright install chromium` later.
- Rendering is slower than raw fetch (typical: 2–10s per page). Use `--max-pages` to scope.
- Render uses `--retries` (default 3) with exponential backoff on transient failures (navigation timeouts, ad-script hangs).
- Known limitation: `redirectChain` is not captured for rendered pages in v1. The `finalUrl` is still accurate.

```bash
# Query Google's CrUX API for real-user Core Web Vitals (requires CRUX_API_KEY env var)
CRUX_API_KEY=your-google-api-key npm run dev -- https://example.com --crux --max-pages 5
```

```bash
# Generate a polished HTML report (open in any browser, email to a client)
npm run dev -- https://example.com --max-pages 25 --html-report report.html

# Generate a PDF report (uses Playwright/Chromium under the hood)
npm run dev -- https://example.com --max-pages 25 --pdf-report report.pdf

# Generate both at once
npm run dev -- https://example.com --max-pages 25 --html-report report.html --pdf-report report.pdf
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
- fetches pages in parallel with `--concurrency` (run `--help` for the default)
- retries slow or retryable requests with exponential backoff (also applies to `--render` on transient navigation failures)
- deduplicates redirected pages by final URL
- seeds the crawl queue from `sitemap.xml` automatically
- walks one level of nested sitemap-index files (capped at 50 children)
- supports `--include-path` and `--exclude-path` regex filters
- samples representative sitemap URLs with `--sample-sitemap`
- captures response headers per page for `X-Robots-Tag`, HSTS, Cache-Control, and Content-Type checks
- optionally renders pages with headless Chromium via `--render` (Playwright) for SPAs and JS-challenge sites

## Notes And Limits

- `--sample-sitemap` is useful when you want representative sitemap coverage quickly, but link-graph findings are less complete because the crawl is intentionally sampled.
- Sitemap reconciliation relies on the set of sitemap URLs the CLI was able to collect. The report marks sitemap coverage as partial when that set was truncated.
- JSON-LD validation covers Google's rich-result requirements for Product, Article (BlogPosting/NewsArticle), FAQPage, BreadcrumbList, Organization, and LocalBusiness. Other schema types are still presence-only.
- `--render` (Playwright/Chromium) handles SPAs and JS-challenge sites (Cloudflare turnstile, JS-rendered DOM) but `redirectChain` is not captured for rendered pages.

## License

[MIT](LICENSE)
