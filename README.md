# SEO Analysis Tool

This project is a crawl-based SEO CLI for auditing websites.

It focuses on technical SEO issues that can be derived from the crawl itself, with optional headless-Chromium rendering (`--render`), Google CrUX field data (`--crux`), and Lighthouse audits for a small set of pages. Optional traffic enrichment from Google Search Console (`--gsc`) and Google Analytics 4 (`--ga4`) ranks issues by real-world impact.

Every successful audit is auto-persisted to `~/.config/seo-audit/crawls/`; `seo-audit diff <url>` compares the two most recent crawls of a host, and `--fail-on <severity>` gates CI/cron jobs against regressions vs. the previous persisted crawl. Opt out of persistence with `--no-persist` or `SEO_AUDIT_NO_PERSIST=1`.

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
- optional Google Analytics 4 enrichment (`--ga4`) merging sessions/pageviews/users/engagement-rate per crawled URL; feeds the "Priority issues" summary as a fallback when GSC isn't available
- crawl persistence + diffing: every audit auto-saves to `~/.config/seo-audit/crawls/<host>/<timestamp>.json`; `seo-audit diff <url>` auto-picks the two most recent crawls, and `--fail-on <severity>` gates CI/cron against regressions vs. the previous persisted crawl
- near-duplicate content detection (MinHash, Jaccard ≥ 0.85 over 5-word shingles): clusters of pages with substantially similar body text get a "Content duplicates" summary section + medium-severity `CONTENT_NEAR_DUPLICATE` per-page issue. Skip with `--no-content-dedup`.
- internal link equity (PageRank, damping 0.85, 20 iterations): per-page `pageRank` score plus an "underlinked important pages" highlight for high-content pages with below-median rank — the "your money page gets 1 internal link" insight. Skip with `--no-link-graph`.

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

| Flag | Description |
|---|---|
| `--output <path>` | Write JSON report to a file (default: stdout). |
| `--no-persist` | Skip persisting the crawl to `~/.config/seo-audit/crawls/`. Default: every successful audit is persisted. Set `SEO_AUDIT_NO_PERSIST=1` to default the same. |
| `--fail-on <severity>` | Exit non-zero if issues at `<severity>` increased. Fresh-audit mode: compares to the previous persisted crawl. Diff mode: compares the two passed report files. One of: `high`, `medium`, `low`. |

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

**Auth** uses a Google Cloud service account (no OAuth browser flow, no token caching). The fastest way to set it up is the bundled wizard:

```bash
seo-audit --gsc-setup https://your-site.com
```

The wizard:
- Detects `gcloud` and (if present) creates the service account, downloads the key to `~/.config/seo-audit/gsc-key.json`, and chmods it `600`.
- Falls back to printed step-by-step instructions if `gcloud` isn't available.
- Prints the service-account email to grant in Search Console (Settings → Users and permissions → Add user → Restricted).
- Verifies the credentials by exchanging them for a real access token before declaring success.

After setup, every subsequent run is silent:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/seo-audit/gsc-key.json
seo-audit https://your-site.com --gsc
```

If you prefer manual setup or are running in CI, the auth layer also accepts:
- `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` (file path)
- `GOOGLE_APPLICATION_CREDENTIALS_JSON='{...inline json...}'` (CI-friendly, one secret)
- `--gsc-service-account-key-file /path/to/key.json` (CLI override)

The same credentials work for any future Google integration (e.g. a future `--ga4`).

Optional flags: `--gsc-property` to override property auto-detection (URL-prefix or `sc-domain:example.com`), `--gsc-days` to change the lookback window (default 90).

### Google Analytics 4 enrichment (`--ga4`)

Merges per-page sessions, pageviews, users, and engagement rate from the GA4
Data API into the crawl report. Useful when you want to know which pages get
real traffic — not just search impressions — and prioritize technical-issue
remediation accordingly.

**Setup** (one-time, ~30 seconds if `--gsc-setup` has already run):

1. If you haven't already run `seo-audit --gsc-setup`, run it now. It creates
   a service account and downloads its JSON key. The same SA is reused for
   GA4 — no second key needed.
2. Open your GA4 property → **Admin → Property Access Management**.
3. Click **+** → **Add users**. Paste the service-account email
   (visible in `~/.config/seo-audit/gsc-key.json` under `client_email`).
4. Set **Direct roles** to **Viewer**. Save.
5. Run:

   ```sh
   GOOGLE_APPLICATION_CREDENTIALS=~/.config/seo-audit/gsc-key.json \
     seo-audit https://your-site.com --gsc --ga4
   ```

The CLI auto-detects the GA4 property by matching the crawl origin against
each accessible property's web data stream `defaultUri`. If multiple
properties match (e.g., separate prod/staging streams for the same domain),
the audit fails with the candidate list — pass `--ga4-property properties/N`
to disambiguate.

**Priority issues** are ranked by GSC impressions when `--gsc` is enabled,
with GA4 sessions as a fallback when GSC is unavailable. The HTML report
shows a "via GSC" / "via GA4" badge per row.

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
| `ga4` | `false` | Enrich crawled pages with Google Analytics 4 metrics (sessions, pageviews, users, engagement rate) |
| `ga4-property` | (auto-detect) | Override property auto-detection (e.g. `properties/123456789`) |
| `ga4-days` | `90` | Days of GA4 data to query |
| `ga4-service-account-key` | (none) | Service-account JSON for GA4 (use a repo secret); the SA email needs Viewer role on the property |
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

### Persistence

Every successful audit is auto-saved to `~/.config/seo-audit/crawls/<host>/<timestamp>.json`
(mode `0700`, alongside the existing `gsc-key.json`). This enables:

- `seo-audit diff <url>` — compare the two most recent crawls of a host without
  having to remember file paths.
- `seo-audit <url> --fail-on <severity>` — gate cron / CI runs against
  regressions vs. the previous persisted crawl.

**The persisted JSON contains everything the audit captured**, including page
metadata, GSC/GA4 traffic data when enriched (`--gsc` / `--ga4`), and the full
body text per page. Treat the directory as you would any other client-data
artifact.

**Opt out** with `--no-persist` per run, or `SEO_AUDIT_NO_PERSIST=1` (or
`SEO_AUDIT_NO_PERSIST=true`) in your environment.

**Override the location** with `SEO_AUDIT_CRAWLS_DIR=<path>` — useful when the
default `$HOME/.config/` doesn't fit (sandboxed CI runners, separate volume, XDG
preferences).

**Retention:** none. Crawls accumulate forever. At ~5 MB per crawl × 250 weekly
crawls × 5 years per host, the footprint is around 1.3 GB per host long-term —
manageable. `rm -rf ~/.config/seo-audit/crawls/<host>/` if you ever want to
reset.

## CHANGELOG

### v0.5.0 — 2026-04-26

- **Added:** near-duplicate content detection. Audits now include a
  `report.contentDedup` summary with clusters of pages whose body text
  exceeds 85% Jaccard similarity. Each cluster member gets a new
  medium-severity `CONTENT_NEAR_DUPLICATE` issue. Skip via
  `--no-content-dedup`.
- **Added:** internal link-equity (PageRank) computation. Audits now
  include a `report.linkGraph` summary with the top 10 pages by
  PageRank and an "underlinked important pages" list (high content,
  low rank — the "your money page gets 1 internal link" finding).
  Each `PageReport` gains a `linkGraph.pageRank` field. Skip via
  `--no-link-graph`.
- **Changed:** the HTML report Pages table grows a conditional
  `PageRank` column when any page has link-graph metrics, sortable
  alongside the existing Title / Status / Issues columns.
- **Note for `--fail-on` cron users:** the new
  `CONTENT_NEAR_DUPLICATE` issue is medium severity and will surface
  on most e-commerce / programmatic-SEO sites. The fresh-mode
  `--fail-on` introduced in v0.4.0 only fails on regressions vs. the
  previous persisted crawl, so users with at least one prior persisted
  crawl are unaffected. Users running `--fail-on medium` *without* a
  baseline (brand-new install in fresh CI) may see new failures on the
  first v0.5 run. Recovery: pass `--no-content-dedup`, raise
  `--fail-on high`, or run the audit once to seed a baseline.

### v0.4.0 — 2026-04-26

- **Added:** every successful audit is now persisted to
  `~/.config/seo-audit/crawls/<host>/<timestamp>.json` (mode `0700`).
  Opt out via `--no-persist` or `SEO_AUDIT_NO_PERSIST=1`.
- **Added:** `seo-audit diff <url>` auto-picks the two most recent
  persisted crawls of the host. The existing
  `seo-audit diff <old.json> <new.json>` form still works for
  explicit comparisons.
- **Added:** `SEO_AUDIT_CRAWLS_DIR` env var overrides the default
  crawls directory location.
- **Added:** `evaluateFailOn` helper exported from `dist/diff.js`
  for programmatic consumers.
- **Changed:** `--fail-on <severity>` now applies in fresh-audit mode
  too. It compares the new audit against the previous persisted crawl
  and exits non-zero if issues at the named severity increased. On the
  first run for a host, prints a "skipping regression check" warning
  and exits `0`. (Diff-mode behavior is unchanged.)

### v0.3.0 — 2026-04-25

- **Added:** `--ga4` flag and supporting `--ga4-property`, `--ga4-days`,
  `--ga4-service-account-key-file` options. Enriches each crawled page with
  GA4 sessions, pageviews, users, and engagement rate; reuses the
  service-account workflow set up by `--gsc-setup`.
- **Added:** `ga4`, `ga4-property`, `ga4-days`, and `ga4-service-account-key`
  inputs on the GitHub Action. The `ga4-service-account-key` input falls back
  to `gsc-service-account-key` when blank, since the same SA can read both.
- **Added:** `report.ga4` enrichment-result summary alongside `report.gsc`.
- **Added:** `page.metrics.ga4` per-page GA4 metrics alongside
  `page.metrics.gsc`.
- **Changed:** `summary.priorityIssues[]` entries now carry `rankedBy`,
  `rankValue`, and `metrics` fields; the GSC-specific `impressions`, `clicks`,
  and `position` fields are kept populated for one minor cycle (deprecated).
- **Changed:** `summary.priorityIssues` is now built whenever GSC **or** GA4
  enrichment succeeds (previously only when GSC succeeded).
- **Changed:** HTML report now renders `<h2>Analytics</h2>` (when GA4 is
  enabled) and `<h2>Priority issues</h2>` as top-level sections; the priority
  list previously rendered nested under `<h2>Search Console</h2>`, which hid
  it on GA4-only audits.

## License

[MIT](LICENSE)
