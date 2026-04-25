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
- HTTP `Link: rel="canonical"` mismatches with the HTML `<link rel="canonical">`, multiple/invalid canonical Link values
- HTML responses served without `Content-Encoding` (gzip/br/zstd) compression
- compressed responses missing `Vary: Accept-Encoding` (shared-cache hazard)
- URLs explicitly disallowed by `robots.txt` for the configured user agent
- JSON-LD validation against rich-result requirements: Product, Article (BlogPosting/NewsArticle), FAQPage, BreadcrumbList, Organization, LocalBusiness
- JSON-LD Product offers without `price` or `priceCurrency`
- nested sitemap-index resolution (walks one level of nested sitemaps, capped at 50 children)
- sitemap entries with `lastmod` older than 12 months
- real-user Core Web Vitals from Google CrUX (LCP/INP/CLS p75) when `--crux` is enabled and `CRUX_API_KEY` is set
- optional AI-agent readiness scoring (`--agent-readiness`) covering AI-bot rules, llms.txt depth, `llms-full.txt`, markdown content negotiation, well-known endpoints (`agent-skills`, `api-catalog`, `mcp/server-card`, OAuth discovery), Web Bot Auth, and `Link:` headers
- optional Google Search Console enrichment (`--gsc`) merging clicks/impressions/CTR/avg-position per crawled URL, plus a "Priority issues" summary that ranks high/medium-severity issues by traffic exposure

## Install

Run instantly with `npx` (no install needed):

```bash
npx @davo20019/seo-audit https://example.com
```

Install globally:

```bash
npm install -g @davo20019/seo-audit
seo-audit https://example.com --max-pages 25
```

Add to a project (use as a library too):

```bash
npm install @davo20019/seo-audit
```

```ts
import { analyzeSite } from "@davo20019/seo-audit";
const report = await analyzeSite("https://example.com", { maxPages: 50 });
```

## Quick Start (from source)

```bash
git clone https://github.com/davo20019/seo-analysis.git
cd seo-analysis
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
# Score the site for AI-agent readiness (llms.txt depth, AI-bot policy, well-known endpoints)
npm run dev -- https://example.com --agent-readiness --max-pages 25
```

```bash
# Enrich with Google Search Console traffic data (priority-rank issues by impressions)
GOOGLE_APPLICATION_CREDENTIALS=./gsc-service-account.json \
  npm run dev -- https://example.com --gsc --max-pages 100
```

The `--gsc` flag pulls clicks, impressions, CTR, and average position from Search Console for every crawled URL and adds a **Priority issues** section to the summary — high/medium-severity issues sorted by impressions, so the audit answers "which problem affects pages that actually get traffic?" rather than just "what problems exist?".

**Auth** uses a Google Cloud service account (no OAuth browser flow, no token caching). One-time setup:

1. In Google Cloud, create a service account and download its JSON key.
2. In Search Console (Settings → Users and permissions), add the service account email as a **Restricted** user on the property you want to audit.
3. Either set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` (file path) or `GOOGLE_APPLICATION_CREDENTIALS_JSON='{...inline json...}'` (CI-friendly), or pass `--gsc-service-account-key-file /path/to/key.json`.

The same credentials work for any future Google integration (e.g. a future `--ga4`).

Optional flags: `--gsc-property` to override property auto-detection (URL-prefix or `sc-domain:example.com`), `--gsc-days` to change the lookback window (default 90).

The `--agent-readiness` flag adds an opinionated rubric (inspired by [Cloudflare's agent-readiness framework](https://blog.cloudflare.com/agent-readiness/)) covering four buckets:

- **Discoverability** — robots.txt, sitemap.xml, `Link:` HTTP headers (RFC 8288).
- **Content accessibility** — llms.txt presence and content depth (H1, sections, links, size), `llms-full.txt`, and markdown content negotiation (`Accept: text/markdown`).
- **Bot access control** — explicit rules for known AI user agents (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Bytespider, Applebot-Extended, …), `Content-Signal` directives (`search`, `ai-train`, `ai-input`), and Web Bot Auth (`/.well-known/http-message-signatures-directory`).
- **Capabilities & protocols** — well-known endpoints (`/.well-known/agent-skills/index.json`, `/.well-known/api-catalog`, `/.well-known/mcp/server-card.json`, OAuth discovery) plus structured-data coverage from an agent perspective (Organization/WebSite on the homepage, Article schema on article-like paths).

Each bucket is scored 0–100 and averaged into a single `score` (also 0–100). The full breakdown — including which probes succeeded — lands in the JSON, text, and HTML reports as a separate `Agent Readiness` section.

```bash
# Generate a polished HTML report (open in any browser, email to a client)
npm run dev -- https://example.com --max-pages 25 --html-report report.html

# Generate a PDF report (uses Playwright/Chromium under the hood)
npm run dev -- https://example.com --max-pages 25 --pdf-report report.pdf

# Generate both at once
npm run dev -- https://example.com --max-pages 25 --html-report report.html --pdf-report report.pdf
```

## Diff Reports

Compare two crawl reports to see what changed between runs:

```bash
# Compare last week's crawl to this week's
npm run dev -- diff old-report.json new-report.json

# Output as JSON for piping into another tool
npm run dev -- diff old.json new.json --json --output diff.json

# Fail (non-zero exit) if any high-severity issues were added — useful in CI
npm run dev -- diff old.json new.json --fail-on high
```

The diff highlights:
- New issue codes (didn't appear in old)
- Resolved issue codes (appeared in old, not in new)
- Counts that increased or decreased
- HTTP status changes on common pages
- Pages added or removed from the crawl

## GitHub Action

Run SEO audits in CI without writing any glue code:

```yaml
# .github/workflows/seo.yml
name: SEO Audit
on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: davo20019/seo-analysis@v1
        with:
          url: https://staging.mysite.com
          max-pages: 50
          fail-on: high   # block PRs that introduce high-severity issues
```

### Inputs

| Input | Default | Description |
|---|---|---|
| `url` | (required) | URL to crawl |
| `max-pages` | `50` | Maximum pages to crawl |
| `concurrency` | (CLI default) | Pages fetched in parallel |
| `render` | `false` | Use Playwright for JS rendering |
| `fail-on` | (none) | Fail the workflow if issues at this severity exist (`high`, `medium`, `low`) |
| `crux` | `false` | Query Google CrUX for real-user Core Web Vitals |
| `crux-api-key` | (none) | API key for CrUX (use a repo secret) |
| `agent-readiness` | `false` | Score AI-agent readiness (llms.txt depth, AI-bot rules, well-known endpoints) |
| `gsc` | `false` | Enrich crawled pages with Google Search Console clicks/impressions/CTR/position |
| `gsc-property` | (auto-detect) | Override GSC property (URL-prefix or `sc-domain:example.com`) |
| `gsc-days` | `90` | Days of GSC history to query |
| `gsc-service-account-key` | (none) | Service-account JSON for GSC (use a repo secret); the SA email needs Restricted access on the property |
| `user-agent` | (default) | Override the crawler's User-Agent |
| `include-paths` | (none) | Comma-separated regex; only crawl matching URLs |
| `exclude-paths` | (none) | Comma-separated regex; skip matching URLs |
| `output-json` | `seo-report.json` | Where to write the JSON report |
| `output-html` | (none) | Optional path for the HTML report |

### Outputs

| Output | Description |
|---|---|
| `high-issues` | Count of high-severity issues |
| `medium-issues` | Count of medium-severity issues |
| `low-issues` | Count of low-severity issues |
| `pages-crawled` | Number of pages successfully crawled |
| `report-path` | Path to the JSON report (use with `actions/upload-artifact`) |

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

## Privacy

This tool does not collect telemetry. No analytics, no phone-home, no install tracking. Crawl reports stay on your machine. The only outbound network traffic is:

- HTTP fetches to the URLs you ask the tool to crawl
- Optional: Google's CrUX API when you pass `--crux` (sends an origin string + your API key)
- Optional: Chromium downloads from Microsoft's Playwright CDN on first install

If a future version ever adds opt-in telemetry, it will be exactly that — opt-in, with explicit disclosure.

## License

[MIT](LICENSE)
