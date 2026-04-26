import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import type { SiteReport } from "./types.js";

export function resolveCrawlsDir(): string {
  const override = process.env.SEO_AUDIT_CRAWLS_DIR;
  if (override && override.trim().length > 0) return override;
  return join(homedir(), ".config", "seo-audit", "crawls");
}

export function hostKeyFromUrl(url: string): string {
  const parsed = new URL(url);
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  const port = parsed.port;
  const isDefaultPort =
    port === "" ||
    (parsed.protocol === "http:" && port === "80") ||
    (parsed.protocol === "https:" && port === "443");

  return isDefaultPort ? host : `${host}_${port}`;
}

export interface PersistResult {
  path: string;
  isFirstForHost: boolean;
  previousPath: string | null;
}

export interface PersistOptions {
  now?: () => Date;
}

export async function persistCrawl(
  report: SiteReport,
  opts: PersistOptions = {},
): Promise<PersistResult> {
  const host = hostKeyFromUrl(report.startUrl);
  const hostDir = join(resolveCrawlsDir(), host);

  // Track whether the host directory existed before we touched it.
  let hostExisted = true;
  try {
    await stat(hostDir);
  } catch {
    hostExisted = false;
  }

  await mkdir(hostDir, { recursive: true, mode: 0o700 });

  // Find the latest existing crawl for this host BEFORE we add ours.
  // We need this for both `isFirstForHost` (no entries) and for `previousPath`.
  const existingEntries = hostExisted ? await listCrawlsInDir(hostDir, host) : [];
  const previousPath = existingEntries[0]?.path ?? null;
  const isFirstForHost = existingEntries.length === 0;

  // Build the filename. Use atomic exclusive-create with flag "wx" to avoid TOCTOU race.
  // On EEXIST, advance by 1 millisecond and retry. Cap at 1000 attempts for safety.
  const nowFn = opts.now ?? (() => new Date());
  let when = nowFn();
  const body = JSON.stringify(report, null, 2);
  let path = "";
  let lastErr: NodeJS.ErrnoException | null = null;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    path = filenameFor(hostDir, when);
    try {
      await writeFile(path, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
      lastErr = null;
      break;
    } catch (err) {
      const ioErr = err as NodeJS.ErrnoException;
      if (ioErr.code !== "EEXIST") throw err;
      lastErr = ioErr;
      when = new Date(when.getTime() + 1);
    }
  }
  if (lastErr) {
    throw new Error(`persistCrawl: could not find an unused filename after 1000 attempts (last: ${path})`);
  }

  return { path, isFirstForHost, previousPath };
}

export async function loadCrawl(path: string): Promise<SiteReport> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as SiteReport;
}

function filenameFor(hostDir: string, when: Date): string {
  // ISO with `:` and `.` swapped to `-` for filesystem safety on Windows.
  // Example: 2026-04-25T19-34-56-789Z.json
  const iso = when.toISOString().replace(/[:.]/g, "-");
  return join(hostDir, `${iso}.json`);
}

async function listCrawlsInDir(hostDir: string, host: string): Promise<CrawlEntry[]> {
  let names: string[];
  try {
    names = await readdir(hostDir);
  } catch {
    return [];
  }
  const entries: CrawlEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = join(hostDir, name);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    entries.push({
      path: full,
      timestamp: name.slice(0, -".json".length),
      host,
      size: info.size,
      mtime: info.mtime,
    });
  }
  // Newest-first by filename (timestamps are lexicographic-sortable ISO strings).
  entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return entries;
}

export async function listCrawls(host: string): Promise<CrawlEntry[]> {
  const hostDir = join(resolveCrawlsDir(), host);
  return listCrawlsInDir(hostDir, host);
}

export async function recentCrawlsForUrl(
  url: string,
  count: number,
): Promise<CrawlEntry[]> {
  const host = hostKeyFromUrl(url);
  const all = await listCrawls(host);
  return all.slice(0, Math.max(0, count));
}

export interface CrawlEntry {
  path: string;
  timestamp: string;
  host: string;
  size: number;
  mtime: Date;
}
