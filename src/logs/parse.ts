import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export type LogFormat = "combined" | "json" | "cloudflare" | "fastly" | "unknown";

export interface RawLogEntry {
  ip: string;
  timestamp: string;       // ISO 8601
  method: string;
  url: string;
  status: number;
  userAgent: string;
}

const COMBINED_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (.*?) HTTP\/[\d.]+" (\d+) \S+ "[^"]*" "([^"]*)"$/;

export function detectLogFormat(sampleLines: string[]): LogFormat {
  if (sampleLines.length === 0) return "unknown";
  const nonEmpty = sampleLines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return "unknown";
  if (nonEmpty.every((l) => COMBINED_RE.test(l))) return "combined";

  const firstAttempt = nonEmpty.slice(0, 3).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  });
  if (firstAttempt.every((v) => v !== null && typeof v === "object")) {
    const obj = firstAttempt[0] as Record<string, unknown>;
    if ("EdgeStartTimestamp" in obj || "ClientRequestUserAgent" in obj) return "cloudflare";
    if ("client_ip" in obj && "fastly_id" in obj) return "fastly";
    return "json";
  }
  return "unknown";
}

export async function* parseLogStream(
  input: Readable,
  format: LogFormat
): AsyncIterable<RawLogEntry> {
  if (format === "unknown") {
    throw new Error("Cannot parse stream with format=unknown");
  }
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    const entry = parseLine(line, format);
    if (entry !== null) yield entry;
  }
}

function parseLine(line: string, format: LogFormat): RawLogEntry | null {
  if (format === "combined") return parseCombined(line);
  // Other parsers are added in Task 3.
  return null;
}

function parseCombined(line: string): RawLogEntry | null {
  const m = line.match(COMBINED_RE);
  if (m === null) return null;
  const [, ip, ts, method, url, status, userAgent] = m;
  const timestamp = clfToIso(ts);
  if (timestamp === null) return null;
  return {
    ip,
    timestamp,
    method,
    url,
    status: Number.parseInt(status, 10),
    userAgent
  };
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
};

function clfToIso(stamp: string): string | null {
  // "25/Apr/2026:10:15:23 +0000"
  const m = stamp.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/);
  if (m === null) return null;
  const [, day, monStr, year, hh, mm, ss, tz] = m;
  const mon = MONTHS[monStr];
  if (mon === undefined) return null;
  const offset = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  return `${year}-${mon}-${day}T${hh}:${mm}:${ss}${offset}`;
}
