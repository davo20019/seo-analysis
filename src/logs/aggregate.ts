import type { VerifiedBot, LogTimeWindow } from "../types.js";

export interface VerifiedLogEntry {
  ip: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  userAgent: string;
  bot: VerifiedBot["name"];
  verified: boolean;
}

export interface UrlAgg {
  hits: number;
  bots: Set<string>;
  statusCounts: Map<number, number>;
  firstSeen: string;
  lastSeen: string;
}

export interface AggResult {
  urls: Map<string, UrlAgg>;
  bots: VerifiedBot[];
  timeWindow: LogTimeWindow;
}

interface BotAgg {
  hits: number;
  urls: Set<string>;
  ips: Set<string>;
}

export function createAggregator(): {
  add(entry: VerifiedLogEntry): void;
  finish(): AggResult;
} {
  const urls = new Map<string, UrlAgg>();
  const bots = new Map<string, BotAgg>();
  let earliest: string | null = null;
  let latest: string | null = null;

  return {
    add(entry) {
      let u = urls.get(entry.url);
      if (u === undefined) {
        u = {
          hits: 0,
          bots: new Set(),
          statusCounts: new Map(),
          firstSeen: entry.timestamp,
          lastSeen: entry.timestamp
        };
        urls.set(entry.url, u);
      }
      u.hits += 1;
      u.bots.add(entry.bot);
      u.statusCounts.set(entry.status, (u.statusCounts.get(entry.status) ?? 0) + 1);
      if (entry.timestamp < u.firstSeen) u.firstSeen = entry.timestamp;
      if (entry.timestamp > u.lastSeen) u.lastSeen = entry.timestamp;

      let b = bots.get(entry.bot);
      if (b === undefined) {
        b = { hits: 0, urls: new Set(), ips: new Set() };
        bots.set(entry.bot, b);
      }
      b.hits += 1;
      b.urls.add(entry.url);
      b.ips.add(entry.ip);

      if (earliest === null || entry.timestamp < earliest) earliest = entry.timestamp;
      if (latest === null || entry.timestamp > latest) latest = entry.timestamp;
    },
    finish() {
      const orderedBots: VerifiedBot[] = [];
      const sortedNames = [...bots.keys()].sort((a, b) => (bots.get(b)!.hits - bots.get(a)!.hits));
      for (const name of sortedNames) {
        const ba = bots.get(name)!;
        orderedBots.push({
          name: name as VerifiedBot["name"],
          hits: ba.hits,
          uniqueUrls: ba.urls.size,
          uniqueIps: ba.ips.size
        });
      }
      const window: LogTimeWindow =
        earliest === null || latest === null
          ? { earliest: "", latest: "", durationHours: 0 }
          : {
              earliest,
              latest,
              durationHours: Math.round((Date.parse(latest) - Date.parse(earliest)) / 3_600_000)
            };
      return { urls, bots: orderedBots, timeWindow: window };
    }
  };
}
