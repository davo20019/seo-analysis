import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import dnsPromises from "node:dns/promises";

import type {
  AnalyzeLogsOptions,
  DnsResolver,
  Issue,
  LogAnalysisBaseline,
  LogAnalysisReport,
  SiteReport,
} from "../types.js";

import { detectLogFormat, parseLogStream, type LogFormat } from "./parse.js";
import { classifyBotFromUserAgent, createBotVerifier, probeDnsAvailable } from "./verify.js";
import { createAggregator, type VerifiedLogEntry } from "./aggregate.js";
import { findOrphans, findStalePriorities, findStatusMismatches } from "./findings.js";
import { recentCrawlsForUrl, loadCrawl } from "../persist.js";

type LogInput = string | Readable;

const DEFAULT_RESOLVER: DnsResolver = {
  reverse: dnsPromises.reverse,
  resolve4: dnsPromises.resolve4,
  resolve6: dnsPromises.resolve6,
};

export async function analyzeLogs(
  input: LogInput,
  options: AnalyzeLogsOptions
): Promise<LogAnalysisReport> {
  const { site, format = "auto", verifyBots = true, since, until, onProgress } = options;
  if (typeof site !== "string" || site.length === 0) {
    throw new Error("analyzeLogs: 'site' is required");
  }
  const sinceMs = since !== undefined ? Date.parse(since) : null;
  const untilMs = until !== undefined ? Date.parse(until) : null;
  if (since !== undefined && Number.isNaN(sinceMs)) {
    throw new Error(`analyzeLogs: invalid --since: ${since}`);
  }
  if (until !== undefined && Number.isNaN(untilMs)) {
    throw new Error(`analyzeLogs: invalid --until: ${until}`);
  }

  const sourceLabel = typeof input === "string" ? input : "stdin";
  const initialStream = await openStream(input);

  const { stream: detectStream, format: resolvedFormat } =
    format === "auto" ? await detectFormatFromStream(initialStream) : { stream: initialStream, format };

  if (resolvedFormat === "unknown") {
    throw new Error("Could not auto-detect log format. Use --format to specify.");
  }
  onProgress?.({ phase: "parse-start", format: resolvedFormat });

  const dnsResolver = options.dnsResolver ?? DEFAULT_RESOLVER;
  const dnsAvailable = verifyBots ? await probeDnsAvailable(dnsResolver) : false;
  const verifier = dnsAvailable ? createBotVerifier({ dnsResolver }) : null;

  const aggregator = createAggregator();
  let totalLines = 0;
  let parseErrors = 0;
  let spoofedHits = 0;
  let unverifiedBotHits = 0;
  let lastReport = 0;
  let bytesRead = 0;
  detectStream.on("data", (chunk) => { bytesRead += (chunk as Buffer).length; });

  for await (const entry of parseLogStream(detectStream, resolvedFormat)) {
    totalLines += 1;
    if (entry.url === "" || entry.timestamp === "") {
      parseErrors += 1;
      continue;
    }
    if (sinceMs !== null && Date.parse(entry.timestamp) < sinceMs) continue;
    if (untilMs !== null && Date.parse(entry.timestamp) >= untilMs) continue;

    const claimed = classifyBotFromUserAgent(entry.userAgent);
    if (claimed === null) continue;

    let bot: VerifiedLogEntry["bot"];
    let verified = false;
    if (verifier !== null) {
      const v = await verifier.verify(entry.ip, claimed);
      if (v.bot === null) {
        if (v.verified) spoofedHits += 1;
        else unverifiedBotHits += 1;
        continue;
      }
      bot = v.bot;
      verified = true;
    } else {
      bot = claimed;
      unverifiedBotHits += 1;
    }
    aggregator.add({ ...entry, bot, verified });

    if (totalLines - lastReport >= 5_000) {
      lastReport = totalLines;
      onProgress?.({ phase: "parse-progress", linesRead: totalLines, bytesRead });
    }
  }

  const aggResult = aggregator.finish();
  onProgress?.({ phase: "join-start" });

  let baselineCrawl: LogAnalysisBaseline | null = null;
  let crawl: SiteReport | null = null;
  try {
    const recent = await recentCrawlsForUrl(site, 1);
    if (recent.length > 0) {
      crawl = await loadCrawl(recent[0].path);
      const crawledAt = recent[0].timestamp;
      const daysOld = Math.round((Date.now() - new Date(crawledAt).getTime()) / 86_400_000);
      baselineCrawl = { crawledAt, pages: crawl.pages.length, daysOld };
    }
  } catch {
    crawl = null;
    baselineCrawl = null;
  }

  const issues: Issue[] = [];
  let orphans: LogAnalysisReport["orphans"] = [];
  let stalePriorities: LogAnalysisReport["stalePriorities"] = [];
  let statusMismatches: LogAnalysisReport["statusMismatches"] = [];

  if (crawl !== null) {
    const o = findOrphans(aggResult, crawl, dnsAvailable);
    orphans = o.findings;
    issues.push(...o.issues);

    const s = findStalePriorities(
      aggResult,
      crawl,
      aggResult.timeWindow.latest === "" ? new Date().toISOString() : aggResult.timeWindow.latest
    );
    stalePriorities = s.findings;
    issues.push(...s.issues);

    const sm = findStatusMismatches(aggResult, crawl);
    statusMismatches = sm.findings;
    issues.push(...sm.issues);

    if (
      baselineCrawl !== null &&
      aggResult.timeWindow.earliest !== "" &&
      Date.parse(baselineCrawl.crawledAt) < Date.parse(aggResult.timeWindow.earliest)
    ) {
      issues.push({
        code: "LOG_BASELINE_STALE",
        severity: "low",
        message: "The persisted crawl predates the log window. Findings reflect a stale baseline.",
        recommendation: "Re-run a fresh `seo-audit` audit before trusting orphan/stale findings."
      });
    }
  }

  if (verifyBots && !dnsAvailable) {
    issues.push({
      code: "LOG_DNS_UNAVAILABLE",
      severity: "low",
      message: "Reverse-DNS verification was unavailable in this environment; bot identities are unverified.",
      recommendation: "Re-run from an environment with outbound DNS to verify bot attribution."
    });
  }

  onProgress?.({ phase: "complete" });
  return {
    source: sourceLabel,
    format: resolvedFormat,
    totalLines,
    parseErrors,
    timeWindow: aggResult.timeWindow,
    bots: aggResult.bots,
    spoofedHits,
    unverifiedBotHits,
    baselineCrawl,
    orphans,
    stalePriorities,
    statusMismatches,
    issues
  };
}

async function openStream(input: LogInput): Promise<Readable> {
  if (input === "-") return process.stdin;
  if (typeof input === "string") return createReadStream(input);
  return input;
}

async function detectFormatFromStream(input: Readable): Promise<{ stream: Readable; format: LogFormat }> {
  const sample: string[] = [];
  const buffered: Buffer[] = [];
  let leftover = "";
  for await (const chunk of input) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffered.push(buf);
    leftover += buf.toString("utf8");
    const lines = leftover.split(/\r?\n/);
    leftover = lines.pop() ?? "";
    for (const l of lines) {
      if (l.length > 0) sample.push(l);
      if (sample.length >= 5) break;
    }
    if (sample.length >= 5) break;
  }
  const format = detectLogFormat(sample);
  // Re-emit the buffered prefix + the rest of the original stream.
  const prefix = Buffer.concat(buffered);
  const rest = Readable.from((async function* () {
    yield prefix;
    for await (const c of input) yield c;
  })());
  return { stream: rest, format };
}
