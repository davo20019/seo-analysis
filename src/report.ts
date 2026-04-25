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

<h2>Pages</h2>
${renderPages(report)}

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

function renderPages(report: SiteReport): string {
  if (report.pages.length === 0) return `<p class="muted">No pages crawled.</p>`;
  const rows = report.pages.map((p) => `<tr>
<td><a href="${escapeHtml(p.finalUrl)}">${escapeHtml(p.finalUrl)}</a></td>
<td>${escapeHtml(p.checks.title ?? "")}</td>
<td>${p.status}</td>
<td>${p.issues.length}</td>
</tr>`).join("");
  return `<table><thead><tr><th>URL</th><th>Title</th><th>Status</th><th>Issues</th></tr></thead><tbody>${rows}</tbody></table>`;
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
