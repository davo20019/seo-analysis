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
