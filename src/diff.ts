import type { SiteReport } from "./types.js";

export interface IssueDelta {
  code: string;
  oldCount: number;
  newCount: number;
}

export interface PageDelta {
  url: string;
  oldStatus: number | null;
  newStatus: number | null;
}

export interface SiteReportDiff {
  oldUrl: string;
  newUrl: string;
  pageSet: { added: string[]; removed: string[]; common: number };
  issuesByCode: {
    new: IssueDelta[];
    resolved: IssueDelta[];
    increased: IssueDelta[];
    decreased: IssueDelta[];
    unchanged: IssueDelta[];
  };
  severityDelta: { high: number; medium: number; low: number };
  statusChanges: PageDelta[];
}

function countIssuesByCode(report: SiteReport): Map<string, number> {
  const map = new Map<string, number>();
  for (const page of report.pages) {
    for (const issue of page.issues) {
      map.set(issue.code, (map.get(issue.code) ?? 0) + 1);
    }
  }
  return map;
}

function pageStatusMap(report: SiteReport): Map<string, number> {
  const map = new Map<string, number>();
  for (const page of report.pages) {
    map.set(page.finalUrl, page.status);
  }
  return map;
}

export function diffSiteReports(oldReport: SiteReport, newReport: SiteReport): SiteReportDiff {
  const oldUrls = new Set(oldReport.pages.map((p) => p.finalUrl));
  const newUrls = new Set(newReport.pages.map((p) => p.finalUrl));
  const added = [...newUrls].filter((u) => !oldUrls.has(u)).sort();
  const removed = [...oldUrls].filter((u) => !newUrls.has(u)).sort();
  const common = [...oldUrls].filter((u) => newUrls.has(u)).length;

  const oldCounts = countIssuesByCode(oldReport);
  const newCounts = countIssuesByCode(newReport);
  const allCodes = new Set([...oldCounts.keys(), ...newCounts.keys()]);

  const newIssues: IssueDelta[] = [];
  const resolved: IssueDelta[] = [];
  const increased: IssueDelta[] = [];
  const decreased: IssueDelta[] = [];
  const unchanged: IssueDelta[] = [];

  for (const code of allCodes) {
    const oldCount = oldCounts.get(code) ?? 0;
    const newCount = newCounts.get(code) ?? 0;
    const delta: IssueDelta = { code, oldCount, newCount };
    if (oldCount === 0 && newCount > 0) newIssues.push(delta);
    else if (oldCount > 0 && newCount === 0) resolved.push(delta);
    else if (newCount > oldCount) increased.push(delta);
    else if (newCount < oldCount) decreased.push(delta);
    else unchanged.push(delta);
  }

  const sortByCode = (a: IssueDelta, b: IssueDelta) => a.code.localeCompare(b.code);
  newIssues.sort(sortByCode);
  resolved.sort(sortByCode);
  increased.sort(sortByCode);
  decreased.sort(sortByCode);
  unchanged.sort(sortByCode);

  const oldStatuses = pageStatusMap(oldReport);
  const newStatuses = pageStatusMap(newReport);
  const statusChanges: PageDelta[] = [];
  for (const url of oldUrls) {
    if (!newUrls.has(url)) continue;
    const oldStatus = oldStatuses.get(url) ?? null;
    const newStatus = newStatuses.get(url) ?? null;
    if (oldStatus !== newStatus) {
      statusChanges.push({ url, oldStatus, newStatus });
    }
  }
  statusChanges.sort((a, b) => a.url.localeCompare(b.url));

  return {
    oldUrl: oldReport.startUrl,
    newUrl: newReport.startUrl,
    pageSet: { added, removed, common },
    issuesByCode: { new: newIssues, resolved, increased, decreased, unchanged },
    severityDelta: {
      high: newReport.summary.issueTotals.high - oldReport.summary.issueTotals.high,
      medium: newReport.summary.issueTotals.medium - oldReport.summary.issueTotals.medium,
      low: newReport.summary.issueTotals.low - oldReport.summary.issueTotals.low,
    },
    statusChanges,
  };
}

export function renderDiffText(diff: SiteReportDiff): string {
  const lines: string[] = [];
  lines.push(`Diff: ${diff.oldUrl} → ${diff.newUrl}`);
  lines.push(`Severity totals delta: high: ${signed(diff.severityDelta.high)}  medium: ${signed(diff.severityDelta.medium)}  low: ${signed(diff.severityDelta.low)}`);
  lines.push("");

  const hasRegressions =
    diff.issuesByCode.new.length > 0 ||
    diff.issuesByCode.increased.length > 0 ||
    diff.statusChanges.some((s) => regressed(s));

  if (!hasRegressions && diff.issuesByCode.resolved.length === 0 && diff.issuesByCode.decreased.length === 0 &&
      diff.pageSet.added.length === 0 && diff.pageSet.removed.length === 0) {
    lines.push("No regressions and no improvements — reports are equivalent.");
    return lines.join("\n");
  }

  if (!hasRegressions) {
    lines.push("No regressions.");
  }

  if (diff.issuesByCode.new.length > 0) {
    lines.push(`New issues (${diff.issuesByCode.new.length}):`);
    for (const d of diff.issuesByCode.new) lines.push(`  - ${d.code}: 0 → ${d.newCount}`);
    lines.push("");
  }

  if (diff.issuesByCode.increased.length > 0) {
    lines.push(`Increased (${diff.issuesByCode.increased.length}):`);
    for (const d of diff.issuesByCode.increased) lines.push(`  - ${d.code}: ${d.oldCount} → ${d.newCount}`);
    lines.push("");
  }

  if (diff.issuesByCode.resolved.length > 0) {
    lines.push(`Resolved (${diff.issuesByCode.resolved.length}):`);
    for (const d of diff.issuesByCode.resolved) lines.push(`  + ${d.code}: ${d.oldCount} → 0`);
    lines.push("");
  }

  if (diff.issuesByCode.decreased.length > 0) {
    lines.push(`Decreased (${diff.issuesByCode.decreased.length}):`);
    for (const d of diff.issuesByCode.decreased) lines.push(`  + ${d.code}: ${d.oldCount} → ${d.newCount}`);
    lines.push("");
  }

  if (diff.statusChanges.length > 0) {
    lines.push(`Status code changes (${diff.statusChanges.length}):`);
    for (const s of diff.statusChanges) lines.push(`  ${regressed(s) ? "-" : "+"} ${s.url}: ${s.oldStatus} → ${s.newStatus}`);
    lines.push("");
  }

  if (diff.pageSet.added.length > 0) {
    lines.push(`Pages added (${diff.pageSet.added.length}):`);
    for (const u of diff.pageSet.added.slice(0, 20)) lines.push(`  + ${u}`);
    if (diff.pageSet.added.length > 20) lines.push(`  ... and ${diff.pageSet.added.length - 20} more`);
    lines.push("");
  }

  if (diff.pageSet.removed.length > 0) {
    lines.push(`Pages removed (${diff.pageSet.removed.length}):`);
    for (const u of diff.pageSet.removed.slice(0, 20)) lines.push(`  - ${u}`);
    if (diff.pageSet.removed.length > 20) lines.push(`  ... and ${diff.pageSet.removed.length - 20} more`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function regressed(s: PageDelta): boolean {
  if (s.oldStatus == null || s.newStatus == null) return false;
  return s.oldStatus < 400 && s.newStatus >= 400;
}

export function renderDiffJson(diff: SiteReportDiff): string {
  return JSON.stringify(diff, null, 2);
}
