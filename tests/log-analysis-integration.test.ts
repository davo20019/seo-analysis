import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analyzeLogs } from "../src/logs/index.js";
import type { DnsResolver } from "../src/types.js";
import { persistCrawl } from "../src/persist.js";

const SITE = "https://example.com/";

function streamFrom(s: string): Readable { return Readable.from(s); }

function googleResolver(): DnsResolver {
  return {
    reverse: async (ip) => {
      if (ip === "66.249.66.1") return ["crawl-66-249-66-1.googlebot.com"];
      if (ip === "8.8.8.8") return ["dns.google"];
      throw new Error("ENOTFOUND");
    },
    resolve4: async (host) => {
      if (host === "crawl-66-249-66-1.googlebot.com") return ["66.249.66.1"];
      throw new Error("ENOTFOUND");
    },
    resolve6: async () => { throw new Error("ENOTFOUND"); }
  };
}

const FIXTURE_LOG = [
  `66.249.66.1 - - [25/Apr/2026:10:15:23 +0000] "GET /index.html HTTP/1.1" 200 1234 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"`,
  `66.249.66.1 - - [25/Apr/2026:10:15:24 +0000] "GET /orphan HTTP/1.1" 200 512 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"`,
  `66.249.66.1 - - [25/Apr/2026:10:15:25 +0000] "GET /broken HTTP/1.1" 503 256 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"`,
  ""
].join("\n");

describe("analyzeLogs integration", () => {
  beforeEach(() => {
    // Test isolation: set SEO_AUDIT_CRAWLS_DIR (consumed by src/persist.ts:resolveCrawlsDir)
    // to a fresh temp dir so persisted crawls don't collide with the user's real config.
    const tmp = mkdtempSync(join(tmpdir(), "seoaudit-logs-"));
    process.env.SEO_AUDIT_CRAWLS_DIR = tmp;
  });

  it("Layer A only when no persisted crawl exists", async () => {
    const r = await analyzeLogs(streamFrom(FIXTURE_LOG), {
      site: SITE,
      format: "combined",
      dnsResolver: googleResolver(),
    });
    expect(r.bots.find((b) => b.name === "googlebot")?.hits).toBe(3);
    expect(r.baselineCrawl).toBeNull();
    expect(r.orphans).toHaveLength(0);
    expect(r.stalePriorities).toHaveLength(0);
    expect(r.statusMismatches).toHaveLength(0);
    expect(r.issues.find((i) => i.code === "LOG_DNS_UNAVAILABLE")).toBeUndefined();
  });

  it("Layer B activates when a crawl exists", async () => {
    const persistResult = await persistCrawl({
      startUrl: SITE,
      pages: [
        {
          url: "https://example.com/index.html",
          finalUrl: "https://example.com/index.html",
          status: 200,
          contentType: "text/html",
          redirectChain: [],
          checks: {} as never,
          issues: [],
          discoveredLinks: [],
          linkGraph: { pageRank: 0.5, incomingInternalLinks: 0, outgoingInternalLinks: 0, wordCount: 100 } as never,
        },
        {
          url: "https://example.com/broken",
          finalUrl: "https://example.com/broken",
          status: 200,
          contentType: "text/html",
          redirectChain: [],
          checks: {} as never,
          issues: [],
          discoveredLinks: [],
        },
      ],
      summary: {} as never,
      infrastructure: {} as never,
      lighthouse: [],
    } as never);
    expect(persistResult.path.length).toBeGreaterThan(0);

    const r = await analyzeLogs(streamFrom(FIXTURE_LOG), {
      site: SITE,
      format: "combined",
      dnsResolver: googleResolver(),
    });
    expect(r.baselineCrawl).not.toBeNull();
    // After URL normalization, agg keys are full URLs.
    expect(r.orphans.map((o) => o.url)).toContain("https://example.com/orphan");
    expect(r.orphans.map((o) => o.url)).not.toContain("https://example.com/index.html");
    expect(r.orphans.map((o) => o.url)).not.toContain("https://example.com/broken");
    expect(r.statusMismatches.map((m) => m.url)).toContain("https://example.com/broken");
    expect(r.issues.some((i) => i.code === "LOG_ORPHAN_PAGE")).toBe(true);
    expect(r.issues.some((i) => i.code === "LOG_STATUS_MISMATCH")).toBe(true);
  });

  it("emits LOG_DNS_UNAVAILABLE when reverse-DNS fails", async () => {
    const failingResolver: DnsResolver = {
      reverse: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
      resolve4: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
      resolve6: vi.fn().mockRejectedValue(new Error("ENOTFOUND")),
    };
    const r = await analyzeLogs(streamFrom(FIXTURE_LOG), {
      site: SITE,
      format: "combined",
      dnsResolver: failingResolver,
    });
    expect(r.issues.find((i) => i.code === "LOG_DNS_UNAVAILABLE")).toBeDefined();
    expect(r.unverifiedBotHits).toBeGreaterThan(0);
    expect(r.spoofedHits).toBe(0);
  });
});
