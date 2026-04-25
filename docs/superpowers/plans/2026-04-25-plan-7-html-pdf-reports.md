# Plan 7 — HTML and PDF Reports

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add `--html-report <path>` and `--pdf-report <path>` flags that emit client-ready HTML and PDF audit reports from the existing `SiteReport` JSON, so consultants can email a polished deliverable instead of a JSON blob.

**Architecture:** New `src/report.ts` exports two functions: `renderHtmlReport(report: SiteReport): string` (pure — returns a full standalone HTML document) and `renderPdfReport(report: SiteReport): Promise<Buffer>` (uses existing Playwright dep: `page.setContent(html)` → `page.pdf()`). CLI adds two flags; both can be used together. No new dependencies.

**Tech Stack:** Same as Phase 1. Hand-rolled HTML template literals (no template engine — keeps the dep tree minimal). Inline CSS for self-contained portability.

**Scope exclusions:**
- Custom themes / client logos — v1 ships one clean default; configurability later if asked.
- Per-page detail pages — v1 is single-document site-wide summary.
- Interactive sorting / filtering — v1 is static HTML; add later if needed.
- Email integration — out of scope.

---

## File Structure

New:
- `src/report.ts` — `renderHtmlReport`, `renderPdfReport`, helper `escapeHtml`.
- `tests/report.test.ts` — unit tests for HTML rendering. PDF test gated behind `RUN_BROWSER_TESTS=1`.

Modified:
- `src/types.ts` — add `htmlReport?: string` and `pdfReport?: string` to `AnalyzeOptions` (paths). Optional.
- `src/cli.ts` — add `--html-report` and `--pdf-report` flags.
- `src/analyzer.ts` — no changes. The CLI handles the report-writing after `analyzeSite` returns.
- `README.md` — document the flags.

---

## Task 1: renderHtmlReport — pure function + tests

**Files:**
- Create: `src/report.ts`
- Create: `tests/report.test.ts`

The HTML must be a full standalone document with inline CSS. Sections:
1. Header (site URL, crawl date, total pages)
2. Summary metrics card (issue counts by severity, key counts)
3. Top issues table
4. Issue catalog: each issue code with affected URLs (collapsible `<details>` per code)
5. Infrastructure issues
6. (Optional, included if present) Lighthouse / keyword summary sections

- [ ] **Step 1: Failing tests**

Create `tests/report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderHtmlReport, escapeHtml } from "../src/report.js";
import type { SiteReport } from "../src/types.js";

const minimalReport: SiteReport = {
  startUrl: "https://example.com/",
  infrastructure: {
    robotsTxt: { url: "https://example.com/robots.txt", present: true, status: 200, sitemaps: [], blocksAllCrawlers: false },
    sitemap: { url: "https://example.com/sitemap.xml", present: true, status: 200, urlCount: 5, knownUrls: 5, coverageLimited: false, isIndex: false },
    llmsTxt: { url: "https://example.com/llms.txt", present: false, status: 404, isEmpty: false },
    issues: [
      { code: "ROBOTS_NO_SITEMAP", severity: "low", message: "robots.txt does not list a sitemap.", recommendation: "Declare the sitemap in robots.txt." },
    ],
  },
  summary: {
    crawledPages: 2,
    issueTotals: { high: 1, medium: 2, low: 3 },
    pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 1,
    internalLinksChecked: 10, pagesWithBrokenInternalLinks: 0, pagesWithRedirectingInternalLinks: 0,
    pagesWithAnchorTextIssues: 0, pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
    pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
    topIssues: [
      { code: "META_DESCRIPTION_MISSING", count: 1 },
      { code: "IMAGES_MISSING_LAZY_LOADING", count: 2 },
    ],
    duplicateTitles: [], duplicateMetaDescriptions: [],
  },
  pages: [
    {
      url: "https://example.com/", finalUrl: "https://example.com/", status: 200, contentType: "text/html",
      redirectChain: [],
      checks: {
        title: "Hello", titleLength: 5, metaDescription: null, metaDescriptionLength: 0,
        canonical: null, htmlLang: "en", expectedLocale: null, hreflang: [],
        robotsMeta: null, h1s: ["Hello"], wordCount: 100,
        imagesTotal: 1, imagesMissingAlt: 0,
        internalLinks: 1, incomingInternalLinks: 0,
        internalLinksWithoutAnchorText: 0, internalLinksWithNonDescriptiveAnchorText: 0,
        externalLinks: 0, inSitemap: true,
        openGraph: { title: null, description: null, image: null },
        schemaTypes: [], bodyText: "Hello world",
      },
      issues: [
        { code: "META_DESCRIPTION_MISSING", severity: "high", message: "No meta description.", recommendation: "Add one." },
      ],
      discoveredLinks: [],
    },
  ],
  lighthouse: [],
};

describe("escapeHtml", () => {
  it("escapes <, >, &, \", '", () => {
    expect(escapeHtml(`<a href="x">a&b'c</a>`)).toBe(`&lt;a href=&quot;x&quot;&gt;a&amp;b&#39;c&lt;/a&gt;`);
  });
});

describe("renderHtmlReport", () => {
  const html = renderHtmlReport(minimalReport);

  it("returns a standalone HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("includes site URL and page count in the header", () => {
    expect(html).toContain("https://example.com/");
    expect(html).toContain("2"); // crawledPages
  });

  it("renders severity counts", () => {
    expect(html).toContain("high");
    expect(html).toContain("medium");
    expect(html).toContain("low");
  });

  it("lists top issue codes", () => {
    expect(html).toContain("META_DESCRIPTION_MISSING");
    expect(html).toContain("IMAGES_MISSING_LAZY_LOADING");
  });

  it("includes infrastructure issues", () => {
    expect(html).toContain("ROBOTS_NO_SITEMAP");
  });

  it("escapes HTML in user-provided content", () => {
    const tainted: SiteReport = {
      ...minimalReport,
      pages: [
        {
          ...minimalReport.pages[0],
          checks: { ...minimalReport.pages[0].checks, title: `<script>alert(1)</script>` },
        },
      ],
    };
    const out = renderHtmlReport(tainted);
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/report.test.ts`

Expected: "Cannot find module".

- [ ] **Step 3: Implement**

Create `src/report.ts`:

```ts
import type { SiteReport, Issue, Severity } from "./types.js";

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];

const STYLES = `
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f2937; max-width: 1100px; margin: 32px auto; padding: 0 24px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 32px 0 12px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  h3 { font-size: 16px; margin: 24px 0 8px; }
  .muted { color: #6b7280; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 16px 0; }
  .card { background: #f9fafb; border-radius: 8px; padding: 12px 16px; }
  .card .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 22px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.high { background: #fee2e2; color: #991b1b; }
  .badge.medium { background: #fef3c7; color: #92400e; }
  .badge.low { background: #e5e7eb; color: #374151; }
  details { margin: 8px 0; }
  details summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
  details ul { margin: 4px 0 12px; padding-left: 20px; }
  code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
`;

export function renderHtmlReport(report: SiteReport): string {
  const date = new Date().toISOString().slice(0, 10);
  const summary = report.summary;
  const issueByCode = collectIssuesByCode(report);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SEO Audit — ${escapeHtml(report.startUrl)}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>SEO Audit Report</h1>
  <p class="muted">${escapeHtml(report.startUrl)} · ${date} · ${summary.crawledPages} pages crawled</p>
</header>

<h2>Summary</h2>
<div class="grid">
  <div class="card"><div class="label">High</div><div class="value">${summary.issueTotals.high}</div></div>
  <div class="card"><div class="label">Medium</div><div class="value">${summary.issueTotals.medium}</div></div>
  <div class="card"><div class="label">Low</div><div class="value">${summary.issueTotals.low}</div></div>
  <div class="card"><div class="label">Pages</div><div class="value">${summary.crawledPages}</div></div>
  <div class="card"><div class="label">Internal Links Checked</div><div class="value">${summary.internalLinksChecked}</div></div>
  <div class="card"><div class="label">Broken Link Pages</div><div class="value">${summary.pagesWithBrokenInternalLinks}</div></div>
  <div class="card"><div class="label">Orphan Pages</div><div class="value">${summary.orphanCandidatePages}</div></div>
  <div class="card"><div class="label">Hreflang Issue Pages</div><div class="value">${summary.pagesWithHreflangIssues}</div></div>
</div>

<h2>Top Issues</h2>
${renderTopIssuesTable(summary.topIssues)}

<h2>Issue Catalog</h2>
${renderIssueCatalog(issueByCode)}

<h2>Infrastructure</h2>
${renderInfrastructure(report)}
</body>
</html>`;
}

function renderTopIssuesTable(top: Array<{ code: string; count: number }>): string {
  if (top.length === 0) return `<p class="muted">No issues found.</p>`;
  const rows = top
    .map((t) => `<tr><td><code>${escapeHtml(t.code)}</code></td><td>${t.count}</td></tr>`)
    .join("");
  return `<table><thead><tr><th>Code</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table>`;
}

interface IssueGroup {
  code: string;
  severity: Severity;
  message: string;
  recommendation: string;
  urls: string[];
}

function collectIssuesByCode(report: SiteReport): IssueGroup[] {
  const map = new Map<string, IssueGroup>();
  for (const page of report.pages) {
    for (const issue of page.issues) {
      let g = map.get(issue.code);
      if (!g) {
        g = { code: issue.code, severity: issue.severity, message: issue.message, recommendation: issue.recommendation, urls: [] };
        map.set(issue.code, g);
      }
      g.urls.push(page.finalUrl);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const sa = SEVERITY_ORDER.indexOf(a.severity);
    const sb = SEVERITY_ORDER.indexOf(b.severity);
    if (sa !== sb) return sa - sb;
    return b.urls.length - a.urls.length;
  });
}

function renderIssueCatalog(groups: IssueGroup[]): string {
  if (groups.length === 0) return `<p class="muted">No per-page issues.</p>`;
  return groups.map((g) => {
    const urlsHtml = g.urls.slice(0, 50)
      .map((u) => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`)
      .join("");
    const more = g.urls.length > 50 ? `<li class="muted">… and ${g.urls.length - 50} more</li>` : "";
    return `<details>
<summary><span class="badge ${g.severity}">${g.severity}</span> <code>${escapeHtml(g.code)}</code> — ${g.urls.length} page(s)</summary>
<p>${escapeHtml(g.message)}</p>
<p class="muted">Recommendation: ${escapeHtml(g.recommendation)}</p>
<ul>${urlsHtml}${more}</ul>
</details>`;
  }).join("\n");
}

function renderInfrastructure(report: SiteReport): string {
  const issues = report.infrastructure.issues;
  if (issues.length === 0) return `<p class="muted">No infrastructure issues.</p>`;
  const rows = issues.map((i: Issue) => `<tr>
<td><span class="badge ${i.severity}">${i.severity}</span></td>
<td><code>${escapeHtml(i.code)}</code></td>
<td>${escapeHtml(i.message)}</td>
</tr>`).join("");
  return `<table><thead><tr><th>Severity</th><th>Code</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`;
}
```

- [ ] **Step 4: Run — must pass (8 tests)**

Run: `npm test -- tests/report.test.ts`

- [ ] **Step 5: Full suite + build**

Run: `npm test`

Expected: 98 total (90 prior + 8 new).

Run: `npm run build`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: add renderHtmlReport for client-ready HTML output"
```

---

## Task 2: renderPdfReport — Playwright wrapper

**Files:**
- Modify: `src/report.ts`
- Modify: `tests/report.test.ts`

- [ ] **Step 1: Append integration test gated by env var**

Append to `tests/report.test.ts`:

```ts
import { renderPdfReport } from "../src/report.js";

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === "1";
const maybeDescribe = RUN_BROWSER_TESTS ? describe : describe.skip;

maybeDescribe("renderPdfReport (integration)", () => {
  it("produces a non-empty PDF buffer starting with %PDF", async () => {
    const buf = await renderPdfReport(minimalReport);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  }, 60000);
});
```

- [ ] **Step 2: Run — integration test should be skipped by default**

Run: `npm test`

Expected: 98 still pass; new describe is reported as skipped.

- [ ] **Step 3: Implement**

Append to `src/report.ts`:

```ts
import { chromium } from "playwright";

export async function renderPdfReport(report: SiteReport): Promise<Buffer> {
  const html = renderHtmlReport(report);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" }, printBackground: true });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run integration test manually**

Run: `RUN_BROWSER_TESTS=1 npm test -- tests/report.test.ts`

Expected: integration test passes (~5-15s).

- [ ] **Step 5: Build + suite**

Run: `npm test && npm run build`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: add renderPdfReport via Playwright"
```

---

## Task 3: CLI flags + integration

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add to CliOptions interface**

```ts
htmlReportPath: string | null;
pdfReportPath: string | null;
```

- [ ] **Step 2: Initialize defaults**

In `parseArgs` defaults:

```ts
htmlReportPath: null,
pdfReportPath: null,
```

- [ ] **Step 3: Add flag parsing**

```ts
if (arg === "--html-report") {
  options.htmlReportPath = requireValue(argv, index, "--html-report");
  index += 1;
  continue;
}
if (arg.startsWith("--html-report=")) {
  options.htmlReportPath = arg.split("=").slice(1).join("=");
  continue;
}
if (arg === "--pdf-report") {
  options.pdfReportPath = requireValue(argv, index, "--pdf-report");
  index += 1;
  continue;
}
if (arg.startsWith("--pdf-report=")) {
  options.pdfReportPath = arg.split("=").slice(1).join("=");
  continue;
}
```

- [ ] **Step 4: Update help text**

In `printHelp()`, add near the existing `--output` line:

```
  --html-report <file>       Write a polished HTML report to <file>
  --pdf-report <file>        Write a PDF report to <file> (uses Playwright/Chromium)
```

- [ ] **Step 5: Wire into main()**

After `analyzeSite` returns and `reports` are collected, BEFORE the existing `--output` write logic, add:

```ts
if (options.htmlReportPath) {
  const { renderHtmlReport } = await import("./report.js");
  const html = reports.length === 1 ? renderHtmlReport(reports[0]) : reports.map(renderHtmlReport).join("\n<hr>\n");
  await writeFile(options.htmlReportPath, html, "utf8");
  console.error(`HTML report written to ${options.htmlReportPath}`);
}
if (options.pdfReportPath) {
  const { renderPdfReport } = await import("./report.js");
  const buf = reports.length === 1
    ? await renderPdfReport(reports[0])
    : Buffer.concat(await Promise.all(reports.map(renderPdfReport)));
  await writeFile(options.pdfReportPath, buf);
  console.error(`PDF report written to ${options.pdfReportPath}`);
}
```

(The `Buffer.concat` for multi-report PDFs is a placeholder — concatenating two PDF buffers is not a valid merge. For multi-report runs, either reject the flag with a clear error, or accept that only the last URL's PDF survives. Pick the cleaner option: throw a clear error if `reports.length > 1` and `--pdf-report` is set.)

Actually replace the multi-report PDF block with this safer version:

```ts
if (options.pdfReportPath) {
  if (reports.length !== 1) {
    throw new Error("--pdf-report requires exactly one URL (got " + reports.length + ").");
  }
  const { renderPdfReport } = await import("./report.js");
  const buf = await renderPdfReport(reports[0]);
  await writeFile(options.pdfReportPath, buf);
  console.error(`PDF report written to ${options.pdfReportPath}`);
}
```

`--html-report` for multiple URLs is fine (concatenated with `<hr>` separators).

- [ ] **Step 6: Build + test**

Run: `npm run build && npm test`

Expected: clean.

- [ ] **Step 7: Smoke — HTML**

Run: `npm run dev -- https://example.com --max-pages 2 --html-report /tmp/test-report.html`

Expected: file created, opens in a browser as a styled report.

- [ ] **Step 8: Smoke — PDF**

Run: `npm run dev -- https://example.com --max-pages 2 --pdf-report /tmp/test-report.pdf`

Expected: PDF created (~50KB), opens in a viewer.

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --html-report and --pdf-report CLI flags"
```

---

## Task 4: README

- [ ] **Step 1: Add example to "Useful Options"**

After the existing examples, add:

````markdown
```bash
# Generate a polished HTML report (open in any browser)
npm run dev -- https://example.com --max-pages 25 --html-report report.html

# Generate a PDF report (uses Playwright; requires Chromium installed)
npm run dev -- https://example.com --max-pages 25 --pdf-report report.pdf
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document --html-report and --pdf-report flags"
```

---

## Self-Review

- **Spec coverage:** HTML rendering (Task 1, 8 tests), PDF generation (Task 2, integration test), CLI integration (Task 3, smoke tests), docs (Task 4).
- **Placeholder scan:** Every step has complete code. The HTML template is fully written.
- **Type consistency:** `SiteReport`, `Issue`, `Severity` from `types.ts`. `renderHtmlReport` returns `string`; `renderPdfReport` returns `Promise<Buffer>`.
- **Multi-URL PDF:** rejected with clear error rather than producing a broken concat. Documented.
