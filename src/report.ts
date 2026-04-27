import type {
  AgentReadinessReport,
  ContentDedupReport,
  ExtractionSummary,
  GscEnrichmentReport,
  Ga4EnrichmentReport,
  Issue,
  LinkGraphReport,
  LogAnalysisReport,
  PrioritySummaryEntry,
  Severity,
  SiteReport,
} from "./types.js";
import { chromium } from "playwright";

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
  .badge.neutral { background: #e5e7eb; color: #4b5563; }
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
${report.gsc ? `\n<h2>Search Console</h2>\n${renderGscSection(report.gsc)}` : ""}
${report.ga4 ? `\n<h2>Analytics</h2>\n${renderGa4Section(report.ga4)}` : ""}
${report.contentDedup ? `\n<h2>Content duplicates</h2>\n${renderContentDedupSection(report.contentDedup)}` : ""}
${report.linkGraph ? `\n<h2>Internal link equity</h2>\n${renderLinkGraphSection(report.linkGraph)}` : ""}
${report.extractionSummary ? `\n<h2>Custom extractions</h2>\n${renderExtractionsSection(report.extractionSummary)}` : ""}
${(report.gsc || report.ga4) && report.summary.priorityIssues && report.summary.priorityIssues.length > 0
  ? `\n<h2>Priority issues</h2>\n${renderPriorityIssues(report.summary.priorityIssues)}`
  : ""}
${report.agentReadiness ? `\n<h2>Agent Readiness</h2>\n${renderAgentReadiness(report.agentReadiness)}` : ""}
</body>
</html>`;
}

function renderGscSection(gsc: GscEnrichmentReport): string {
  if (gsc.error) {
    return `<p class="muted">${escapeHtml(gsc.error)}</p>`;
  }
  return `<p class="muted">Property: <code>${escapeHtml(gsc.property)}</code> · window ${escapeHtml(gsc.startDate)} – ${escapeHtml(gsc.endDate)} · rows fetched ${gsc.totalRows} · matched to crawled pages ${gsc.matchedPages} · unmatched ${gsc.unmatchedRows}.</p>`;
}

function renderGa4Section(ga4: Ga4EnrichmentReport): string {
  if (ga4.error) {
    return `<p class="muted">${escapeHtml(ga4.error)}</p>`;
  }
  return `<p class="muted">Property: <code>${escapeHtml(ga4.property)}</code> · window ${escapeHtml(ga4.startDate)} – ${escapeHtml(ga4.endDate)} · rows fetched ${ga4.totalRows} · matched to crawled pages ${ga4.matchedPages} · unmatched ${ga4.unmatchedRows}.</p>`;
}

function renderContentDedupSection(r: ContentDedupReport): string {
  if (r.clusters.length === 0) {
    return `<p class="muted">0 near-duplicate clusters detected (${r.pagesAnalyzed} pages analyzed, ${r.pagesSkipped} skipped due to short body).</p>`;
  }
  const firstCluster = r.clusters[0];
  const summary = `<p class="muted">${r.clusters.length} cluster(s) covering ${r.totalNearDuplicatePages} pages · Jaccard threshold ${firstCluster.threshold} · shingle size ${firstCluster.shingleSize} words · ${r.pagesAnalyzed} pages analyzed (${r.pagesSkipped} skipped).</p>`;
  const blocks = r.clusters.map((c) => {
    const members = c.members.slice(0, 50);
    const more = c.members.length > 50 ? `<li class="muted">… and ${c.members.length - 50} more</li>` : "";
    const items = members
      .map((m) => {
        const tag = m.url === c.representativeUrl ? "★ " : "";
        return `<li>${tag}<a href="${escapeHtml(m.url)}">${escapeHtml(m.url)}</a> <span class="muted">(similarity ${m.similarityToRepresentative.toFixed(2)})</span></li>`;
      })
      .join("");
    return `<details>
<summary><strong>${c.members.length} pages</strong> · representative: <a href="${escapeHtml(c.representativeUrl)}">${escapeHtml(c.representativeUrl)}</a></summary>
<ul>${items}${more}</ul>
</details>`;
  }).join("\n");
  return `${summary}\n${blocks}`;
}

function renderLinkGraphSection(r: LinkGraphReport): string {
  if (r.pagesAnalyzed < 2) {
    return `<p class="muted">Skipped: need ≥2 crawled pages, have ${r.pagesAnalyzed}.</p>`;
  }
  const summary = `<p class="muted">PageRank computed across ${r.pagesAnalyzed} crawled pages and ${r.edges} internal edges (damping ${r.damping}, ${r.iterations} iterations).</p>`;

  const renderRow = (e: { url: string; pageRank: number; wordCount: number; incomingInternalLinks: number }) =>
    `<tr><td><a href="${escapeHtml(e.url)}">${escapeHtml(e.url)}</a></td><td>${e.pageRank.toFixed(4)}</td><td>${e.wordCount}</td><td>${e.incomingInternalLinks}</td></tr>`;

  const topTable = `<h3>Top by PageRank</h3>
<table><thead><tr><th>URL</th><th>PageRank</th><th>Words</th><th>Incoming</th></tr></thead><tbody>${r.topPages.map(renderRow).join("")}</tbody></table>`;

  const underTable = r.underLinkedImportantPages.length === 0
    ? `<p class="muted">No underlinked important pages (high content, low rank) detected.</p>`
    : `<h3>Underlinked important pages</h3>
<p class="muted">High word-count pages with below-median PageRank.</p>
<table><thead><tr><th>URL</th><th>PageRank</th><th>Words</th><th>Incoming</th></tr></thead><tbody>${r.underLinkedImportantPages.map(renderRow).join("")}</tbody></table>`;

  return `${summary}\n${topTable}\n${underTable}`;
}

function renderExtractionsSection(s: ExtractionSummary): string {
  if (s.rules.length === 0) return "";
  const coverageRows = s.rules
    .map((name) => {
      const matched = s.matchCounts[name] ?? 0;
      const pct = s.pagesEvaluated === 0 ? 0 : Math.round((matched / s.pagesEvaluated) * 100);
      return `<tr><td><code>${escapeHtml(name)}</code></td><td>${pct}% (${matched}/${s.pagesEvaluated})</td></tr>`;
    })
    .join("\n");
  const missingRows = s.rules
    .filter((name) => (s.missingRequiredCounts[name] ?? 0) > 0)
    .map((name) => `<li><code>${escapeHtml(name)}</code>: ${s.missingRequiredCounts[name]}</li>`)
    .join("\n");
  return `
<p>Rules: ${s.rules.map((n) => `<code>${escapeHtml(n)}</code>`).join(", ")} (${s.rules.length})</p>
<table>
<thead><tr><th>Rule</th><th>Match coverage</th></tr></thead>
<tbody>
${coverageRows}
</tbody>
</table>
${
  s.pagesWithMissingRequired > 0
    ? `<p>Pages with missing required fields: <strong>${s.pagesWithMissingRequired}</strong></p>\n<ul>\n${missingRows}\n</ul>`
    : `<p>No pages with missing required fields.</p>`
}
`.trim();
}

function renderPriorityIssues(entries: PrioritySummaryEntry[]): string {
  const rows = entries
    .map((e) => {
      let metricCells: string;
      if (e.rankedBy === "gsc") {
        const g = e.metrics.gsc;
        metricCells = `<td>${g?.impressions ?? 0}</td><td>${g?.clicks ?? 0}</td><td>${(g?.position ?? 0).toFixed(1)}</td>`;
      } else {
        const g = e.metrics.ga4;
        metricCells = `<td>${g?.sessions ?? 0}</td><td>${g?.screenPageViews ?? 0}</td><td>${((g?.engagementRate ?? 0) * 100).toFixed(1)}%</td>`;
      }
      return `<tr>
<td><span class="badge ${e.severity}">${e.severity}</span></td>
<td><code>${escapeHtml(e.code)}</code></td>
<td><a href="${escapeHtml(e.url)}">${escapeHtml(e.url)}</a></td>
<td><span class="badge neutral">via ${e.rankedBy.toUpperCase()}</span></td>
${metricCells}
</tr>`;
    })
    .join("");

  // Mixed-source list: render two metric headers and let the badge column
  // tell readers which row to read which way.
  return `<p class="muted">High/medium-severity issues on pages with traffic, sorted by impressions (GSC-ranked) or sessions (GA4-ranked).</p>
<table>
<thead><tr><th>Severity</th><th>Code</th><th>URL</th><th>Source</th><th>Impressions / Sessions</th><th>Clicks / Pageviews</th><th>Position / Engagement</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

function renderAgentReadiness(readiness: AgentReadinessReport): string {
  const subscores = readiness.subscores;
  const summary = `<div class="grid">
<div class="card"><div class="label">Overall</div><div class="value">${readiness.score}</div></div>
<div class="card"><div class="label">Discoverability</div><div class="value">${subscores.discoverability}</div></div>
<div class="card"><div class="label">Content Access</div><div class="value">${subscores.contentAccessibility}</div></div>
<div class="card"><div class="label">Bot Access</div><div class="value">${subscores.botAccessControl}</div></div>
<div class="card"><div class="label">Capabilities</div><div class="value">${subscores.capabilities}</div></div>
</div>`;

  const botRows = readiness.botAccessControl.aiBots
    .map((b) => `<tr><td><code>${escapeHtml(b.userAgent)}</code></td><td>${b.status}</td></tr>`)
    .join("");
  const botTable = `<h3>AI bot policy (robots.txt)</h3>
<table><thead><tr><th>User-agent</th><th>Status</th></tr></thead><tbody>${botRows}</tbody></table>`;

  const signals = readiness.botAccessControl.contentSignals;
  const contentSignalsBlock = `<p class="muted">Content signals: search=${signals.search} · ai-train=${signals.aiTrain} · ai-input=${signals.aiInput}</p>`;

  const llms = readiness.contentAccessibility;
  const llmsBlock = `<h3>Content accessibility</h3>
<ul>
<li>llms.txt: ${llms.llmsTxtPresent ? "present" : "missing"}${
    llms.llmsTxtAnalysis
      ? ` (${llms.llmsTxtAnalysis.byteSize}B, ${llms.llmsTxtAnalysis.sectionCount} section(s), ${llms.llmsTxtAnalysis.linkCount} link(s), H1: ${llms.llmsTxtAnalysis.hasH1 ? "yes" : "no"})`
      : ""
  }</li>
<li>llms-full.txt: ${llms.llmsFullTxtPresent ? "present" : "missing"}</li>
<li>markdown content negotiation: ${llms.markdownNegotiationSupported ? "supported" : "not advertised"}</li>
</ul>`;

  const probeRows = readiness.capabilities.probes
    .map(
      (p) => `<tr><td><code>${escapeHtml(p.name)}</code></td><td><code>${escapeHtml(p.url)}</code></td><td>${p.present ? "present" : "absent"}</td><td>${p.status ?? "—"}</td></tr>`,
    )
    .join("");
  const probesBlock = `<h3>Well-known endpoints</h3>
<table><thead><tr><th>Name</th><th>URL</th><th>Status</th><th>HTTP</th></tr></thead><tbody>${probeRows}</tbody></table>
<p class="muted">Web Bot Auth directory: ${readiness.botAccessControl.webBotAuthAdvertised ? "advertised" : "not advertised"}</p>`;

  const cov = readiness.capabilities.schemaCoverage;
  const schemaBlock = `<h3>Schema coverage</h3>
<ul>
<li>Homepage Organization/WebSite schema: ${cov.homepageHasOrgOrWebsite ? "yes" : "no"}</li>
<li>Article-like pages with schema: ${cov.articleLikePagesWithSchema}/${cov.articleLikePages}</li>
</ul>`;

  const issuesBlock =
    readiness.issues.length === 0
      ? `<p class="muted">No agent-readiness issues.</p>`
      : `<h3>Agent readiness issues</h3>
<table><thead><tr><th>Severity</th><th>Code</th><th>Message</th></tr></thead><tbody>${readiness.issues
          .map(
            (i) => `<tr><td><span class="badge ${i.severity}">${i.severity}</span></td><td><code>${escapeHtml(i.code)}</code></td><td>${escapeHtml(i.message)}</td></tr>`,
          )
          .join("")}</tbody></table>`;

  return `${summary}\n${botTable}\n${contentSignalsBlock}\n${llmsBlock}\n${probesBlock}\n${schemaBlock}\n${issuesBlock}`;
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
  const showGsc = report.pages.some((p) => p.metrics?.gsc);
  const showGa4 = report.pages.some((p) => p.metrics?.ga4);
  const showRank = report.pages.some((p) => p.linkGraph);
  const rows = report.pages.map((p) => {
    const gscCell = showGsc
      ? `<td>${p.metrics?.gsc ? `${p.metrics.gsc.impressions} impr / ${p.metrics.gsc.clicks} clk / pos ${p.metrics.gsc.position.toFixed(1)}` : ""}</td>`
      : "";
    const ga4Cell = showGa4
      ? `<td>${p.metrics?.ga4 ? `${p.metrics.ga4.sessions} sess / ${p.metrics.ga4.screenPageViews} pv / eng ${(p.metrics.ga4.engagementRate * 100).toFixed(1)}%` : ""}</td>`
      : "";
    const rankCell = showRank
      ? `<td>${p.linkGraph ? p.linkGraph.pageRank.toFixed(4) : ""}</td>`
      : "";
    return `<tr>
<td><a href="${escapeHtml(p.finalUrl)}">${escapeHtml(p.finalUrl)}</a></td>
<td>${escapeHtml(p.checks.title ?? "")}</td>
<td>${p.status}</td>
<td>${p.issues.length}</td>
${gscCell}
${ga4Cell}
${rankCell}
</tr>`;
  }).join("");
  const gscHead = showGsc ? "<th>GSC</th>" : "";
  const ga4Head = showGa4 ? "<th>GA4</th>" : "";
  const rankHead = showRank ? "<th>PageRank</th>" : "";
  return `<table><thead><tr><th>URL</th><th>Title</th><th>Status</th><th>Issues</th>${gscHead}${ga4Head}${rankHead}</tr></thead><tbody>${rows}</tbody></table>`;
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

export async function renderPdfReport(report: SiteReport): Promise<Buffer> {
  const html = renderHtmlReport(report);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}

export function renderLogAnalysisReport(r: LogAnalysisReport): string {
  const date = new Date().toISOString().slice(0, 19).replace("T", " ");
  const botRows = r.bots
    .map((b) => `<tr><td><code>${escapeHtml(b.name)}</code></td><td>${b.hits}</td><td>${b.uniqueUrls}</td><td>${b.uniqueIps}</td></tr>`)
    .join("\n");
  const orphanRows = r.orphans
    .map((o) => `<tr><td><a href="${escapeHtml(o.url)}">${escapeHtml(o.url)}</a></td><td>${o.hits}</td><td>${escapeHtml(o.bots.join(", "))}</td></tr>`)
    .join("\n");
  const staleRows = r.stalePriorities
    .map((s) => `<tr><td><a href="${escapeHtml(s.url)}">${escapeHtml(s.url)}</a></td><td>${s.pageRank.toFixed(4)}</td><td>${s.daysSinceLastCrawl ?? "never"}</td><td>${s.hitsInWindow}</td></tr>`)
    .join("\n");
  const mismatchRows = r.statusMismatches
    .map((m) => `<tr><td><a href="${escapeHtml(m.url)}">${escapeHtml(m.url)}</a></td><td>${m.crawlStatus}</td><td>${m.worstStatus}</td><td>${m.hits}</td></tr>`)
    .join("\n");
  const baseline = r.baselineCrawl !== null
    ? `<p>Crawl baseline: <code>${escapeHtml(r.baselineCrawl.crawledAt)}</code> (${r.baselineCrawl.daysOld} days old, ${r.baselineCrawl.pages} pages)</p>`
    : `<p class="muted">No persisted crawl found for this host. Run a regular audit to enable joined findings.</p>`;
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>SEO Audit — Log Analysis</title>
<style>body{font:14px/1.4 -apple-system,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#222}h1,h2{margin-top:1.5em}table{border-collapse:collapse;width:100%}th,td{padding:.4em .6em;border-bottom:1px solid #eee;text-align:left}.muted{color:#888}code{font-family:ui-monospace,monospace;background:#f4f4f4;padding:.05em .25em;border-radius:3px}</style>
</head><body>
<h1>Log analysis</h1>
<p class="muted">${escapeHtml(r.source)} · format=<code>${escapeHtml(r.format)}</code> · generated ${date}</p>
<p>Log window: <code>${escapeHtml(r.timeWindow.earliest)}</code> → <code>${escapeHtml(r.timeWindow.latest)}</code> (${r.timeWindow.durationHours}h)</p>
${baseline}
<p>Total lines: ${r.totalLines} · parse errors: ${r.parseErrors} · spoofed hits: ${r.spoofedHits} · unverified: ${r.unverifiedBotHits}</p>

<h2>Bots</h2>
<table><thead><tr><th>Bot</th><th>Hits</th><th>Unique URLs</th><th>Unique IPs</th></tr></thead><tbody>${botRows}</tbody></table>

${r.orphans.length > 0 ? `<h2>Orphan pages (${r.orphans.length})</h2>
<table><thead><tr><th>URL</th><th>Hits</th><th>Bots</th></tr></thead><tbody>${orphanRows}</tbody></table>` : ""}

${r.stalePriorities.length > 0 ? `<h2>Stale priority pages (${r.stalePriorities.length})</h2>
<table><thead><tr><th>URL</th><th>PageRank</th><th>Days since last crawl</th><th>Hits in window</th></tr></thead><tbody>${staleRows}</tbody></table>` : ""}

${r.statusMismatches.length > 0 ? `<h2>Status mismatches (${r.statusMismatches.length})</h2>
<table><thead><tr><th>URL</th><th>Crawl status</th><th>Worst log status</th><th>Hits</th></tr></thead><tbody>${mismatchRows}</tbody></table>` : ""}

${r.issues.length > 0 ? `<h2>Issues</h2>
<table><thead><tr><th>Severity</th><th>Code</th><th>Message</th></tr></thead><tbody>${
  r.issues.map((i) => `<tr><td>${i.severity}</td><td><code>${escapeHtml(i.code)}</code></td><td>${escapeHtml(i.message)}</td></tr>`).join("\n")
}</tbody></table>` : ""}

</body></html>`;
}
