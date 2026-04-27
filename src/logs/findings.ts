import type {
  Issue,
  OrphanFinding,
  SiteReport,
  StaleFinding,
  StatusMismatchFinding,
} from "../types.js";
import type { AggResult } from "./aggregate.js";

const ORPHAN_CAP = 200;
const MISMATCH_CAP = 200;
const STALE_DAYS = 30;
const STALE_TOP_N = 100;

export function findOrphans(
  agg: AggResult,
  crawl: SiteReport,
  dnsAvailable: boolean
): { findings: OrphanFinding[]; issues: Issue[] } {
  const crawlUrls = new Set<string>();
  for (const p of crawl.pages) {
    crawlUrls.add(p.url);
    if (p.finalUrl !== p.url) crawlUrls.add(p.finalUrl);
  }
  const findings: OrphanFinding[] = [];
  for (const [url, u] of agg.urls) {
    if (crawlUrls.has(url)) continue;
    findings.push({
      url,
      hits: u.hits,
      bots: [...u.bots].sort(),
      firstSeen: u.firstSeen,
      lastSeen: u.lastSeen
    });
  }
  findings.sort((a, b) => b.hits - a.hits);
  const capped = findings.slice(0, ORPHAN_CAP);
  const issues: Issue[] = capped.map((f) => ({
    code: "LOG_ORPHAN_PAGE",
    severity: "low",
    url: f.url,
    message: `Bots visited ${f.url} (${f.hits} hits) but it isn't in the crawl's link graph.`,
    recommendation: "Add an internal link to this page or remove it from indexable surfaces."
  }));
  void dnsAvailable;
  return { findings: capped, issues };
}

export function findStalePriorities(
  agg: AggResult,
  crawl: SiteReport,
  windowEnd: string
): { findings: StaleFinding[]; issues: Issue[] } {
  const ranked = crawl.pages
    .filter((p): p is typeof p & { linkGraph: { pageRank: number } } =>
      p.linkGraph !== undefined && typeof p.linkGraph.pageRank === "number")
    .sort((a, b) => b.linkGraph.pageRank - a.linkGraph.pageRank)
    .slice(0, STALE_TOP_N);

  const endMs = Date.parse(windowEnd);
  const findings: StaleFinding[] = [];
  for (const p of ranked) {
    const u = agg.urls.get(p.url);
    if (u === undefined) {
      findings.push({
        url: p.url,
        pageRank: p.linkGraph.pageRank,
        daysSinceLastCrawl: null,
        hitsInWindow: 0
      });
      continue;
    }
    const lastMs = Date.parse(u.lastSeen);
    const days = Math.round((endMs - lastMs) / 86_400_000);
    if (days > STALE_DAYS) {
      findings.push({
        url: p.url,
        pageRank: p.linkGraph.pageRank,
        daysSinceLastCrawl: days,
        hitsInWindow: u.hits
      });
    }
  }
  const issues: Issue[] = findings.map((f) => ({
    code: "LOG_STALE_PRIORITY_PAGE",
    severity: "low",
    url: f.url,
    message:
      f.daysSinceLastCrawl === null
        ? `High-PageRank page ${f.url} not crawled by bots in this log window.`
        : `High-PageRank page ${f.url} last crawled ${f.daysSinceLastCrawl} days ago.`,
    recommendation: "Check robots.txt, sitemap inclusion, internal links, and noindex directives for this URL."
  }));
  return { findings, issues };
}

export function findStatusMismatches(
  agg: AggResult,
  crawl: SiteReport
): { findings: StatusMismatchFinding[]; issues: Issue[] } {
  const crawlByUrl = new Map<string, number>();
  for (const p of crawl.pages) crawlByUrl.set(p.url, p.status);
  const findings: StatusMismatchFinding[] = [];
  for (const [url, u] of agg.urls) {
    const crawlStatus = crawlByUrl.get(url);
    if (crawlStatus !== 200) continue;
    const errorStatuses = new Map<number, number>();
    for (const [code, count] of u.statusCounts) {
      if (code >= 400) errorStatuses.set(code, count);
    }
    if (errorStatuses.size === 0) continue;
    const worstStatus = [...errorStatuses.keys()].sort((a, b) => b - a)[0];
    findings.push({
      url,
      crawlStatus: 200,
      logStatuses: Object.fromEntries(u.statusCounts),
      worstStatus,
      hits: errorStatuses.get(worstStatus)!
    });
  }
  findings.sort((a, b) => b.hits - a.hits);
  const capped = findings.slice(0, MISMATCH_CAP);
  const issues: Issue[] = capped.map((f) => ({
    code: "LOG_STATUS_MISMATCH",
    severity: "low",
    url: f.url,
    message: `Crawl says ${f.url} returns 200, but bots saw ${f.worstStatus} (${f.hits} times) in this window.`,
    recommendation: "Investigate the timing of the failures; possible CDN cache flush, transient outage, or rate-limiting."
  }));
  return { findings: capped, issues };
}
