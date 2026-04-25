# Roadmap

Goal: open-source CLI that covers the full scope of a paid SEO audit suite (Screaming Frog, Sitebulb, Ahrefs, Semrush) for agency/consultant use.

A UI layer may be added later. Phase work should keep the core analyzer decoupled from CLI presentation so the same JSON output can feed a future web/desktop UI without rework.

Phases are ordered by impact-per-effort. Each phase leaves the tool strictly better than before, even if the next phase is never shipped.

## Phase 1 — Close the technical-audit gap

Target: match Screaming Frog / Sitebulb on technical SEO coverage.

- **JS rendering** via Playwright behind a `--render` flag. Keep cheerio as the fast-path default. Single biggest gap — without it, SPAs and client-rendered sites are invisible.
- **Schema.org / JSON-LD validation** beyond presence. Validate Product, Article, FAQ, Breadcrumb, Organization, LocalBusiness against Google's rich-result requirements.
- **Core Web Vitals from the CrUX API** — one call per origin, returns real field data (LCP, INP, CLS) instead of Lighthouse lab-only.
- **robots.txt rule evaluation** — confirm each crawled URL is actually allowed for Googlebot, not just that the file exists.
- **Response header audit** — `x-robots-tag`, cache-control, HSTS, content-type correctness.
- **Nested sitemap index** support and `lastmod` staleness checks.
- **Image audit** — format (webp/avif), natural vs rendered dimensions, `loading="lazy"`, `decoding="async"`.
- **Mobile audit** — viewport meta, tap-target sizing, font-size minimums.

Estimated effort: 2–4 weeks.

## Phase 2 — Data layer via DataForSEO

Optional subcommands gated on an API-key env var. Users without a key still get full Phase 1 functionality.

- `--backlinks` — referring domains, anchor distribution, toxic-link flags.
- `--keyword-volumes` — enrich extracted terms with search volume, CPC, difficulty.
- `--serp-check --keyword "..."` — current SERP rank for target queries.
- `--competitors domain1,domain2` — side-by-side audit against competitors.

Estimated effort: 1–2 weeks.

## Phase 3 — Monitoring and diffing

- Persist each crawl as timestamped JSON in a `.seo-audit/` directory.
- `seo-audit diff <old> <new>` — highlight regressions and resolved issues.
- Exit-code mode for CI/cron (`--fail-on critical`) — turns the CLI into a ContentKing-lite monitor for anyone with a scheduler.

Estimated effort: ~1 week.

## Phase 4 — Reporting

- HTML report template consuming existing JSON output — shareable client deliverable.
- Markdown executive summary (top-N prioritized issues with remediation text).
- Severity model (critical / warning / info) applied consistently across all issue types.

Estimated effort: ~1 week.

## Phase 5 — Advanced differentiation

Pick based on client demand:

- **Log file analysis** (Apache/nginx) → crawl-budget insights. High value for enterprise clients.
- **Duplicate content detection** via MinHash / shingling.
- **Readability and content quality** — Flesch-Kincaid, heading-hierarchy correctness, thin-content flags.
- **E-E-A-T signals** — author bylines, about/contact pages, citation density.
- **International SEO** — currency/language consistency, geo-targeting validation beyond hreflang.
- **Local SEO** — NAP consistency, LocalBusiness schema completeness.
- **Agent readiness (shipped, opt-in)** — `--agent-readiness` flag scoring four buckets (discoverability, content accessibility, bot access control, capabilities). Inspired by [Cloudflare's agent-readiness framework](https://blog.cloudflare.com/agent-readiness/). Probes AI-bot rules, llms.txt depth, `llms-full.txt`, markdown content negotiation, `Content-Signal` directives, Web Bot Auth, and well-known endpoints (`agent-skills`, `api-catalog`, `mcp/server-card`, OAuth discovery). Track follow-ups: deeper `llms.txt` validation, commerce-protocol probes (x402, UCP, ACP) once they stabilize.

Effort: open-ended; treat as a menu, not a sequence.

## Milestone notes

- After Phase 1 + Phase 4, the tool is a credible open-source replacement for the audit-deliverable use case.
- Phases 2 and 3 are force multipliers for recurring client engagements.
- Phase 5 items are what distinguish this from "another auditor" once the fundamentals are locked in.
