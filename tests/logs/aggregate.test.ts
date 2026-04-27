import { describe, expect, it } from "vitest";
import { createAggregator, type VerifiedLogEntry } from "../../src/logs/aggregate.js";

function entry(over: Partial<VerifiedLogEntry> = {}): VerifiedLogEntry {
  return {
    ip: "1.2.3.4",
    timestamp: "2026-04-25T10:00:00Z",
    method: "GET",
    url: "/x",
    status: 200,
    userAgent: "Mozilla/5.0",
    bot: "googlebot",
    verified: true,
    ...over
  };
}

describe("createAggregator", () => {
  it("counts hits per URL", () => {
    const agg = createAggregator();
    agg.add(entry({ url: "/a" }));
    agg.add(entry({ url: "/a" }));
    agg.add(entry({ url: "/b" }));
    const out = agg.finish();
    expect(out.urls.get("/a")?.hits).toBe(2);
    expect(out.urls.get("/b")?.hits).toBe(1);
  });

  it("tracks status codes per URL", () => {
    const agg = createAggregator();
    agg.add(entry({ url: "/a", status: 200 }));
    agg.add(entry({ url: "/a", status: 503 }));
    agg.add(entry({ url: "/a", status: 503 }));
    const out = agg.finish();
    const a = out.urls.get("/a");
    expect(a?.statusCounts.get(200)).toBe(1);
    expect(a?.statusCounts.get(503)).toBe(2);
  });

  it("tracks first/last seen", () => {
    const agg = createAggregator();
    agg.add(entry({ url: "/a", timestamp: "2026-04-25T10:00:00Z" }));
    agg.add(entry({ url: "/a", timestamp: "2026-04-25T10:30:00Z" }));
    agg.add(entry({ url: "/a", timestamp: "2026-04-25T09:00:00Z" }));
    const out = agg.finish();
    const a = out.urls.get("/a");
    expect(a?.firstSeen).toBe("2026-04-25T09:00:00Z");
    expect(a?.lastSeen).toBe("2026-04-25T10:30:00Z");
  });

  it("aggregates per-bot summaries", () => {
    const agg = createAggregator();
    agg.add(entry({ url: "/a", ip: "1.1.1.1", bot: "googlebot" }));
    agg.add(entry({ url: "/b", ip: "1.1.1.1", bot: "googlebot" }));
    agg.add(entry({ url: "/c", ip: "2.2.2.2", bot: "bingbot" }));
    const out = agg.finish();
    expect(out.bots).toEqual([
      { name: "googlebot", hits: 2, uniqueUrls: 2, uniqueIps: 1 },
      { name: "bingbot", hits: 1, uniqueUrls: 1, uniqueIps: 1 },
    ]);
  });

  it("infers the time window from min/max timestamps", () => {
    const agg = createAggregator();
    agg.add(entry({ timestamp: "2026-04-25T10:00:00Z" }));
    agg.add(entry({ timestamp: "2026-04-26T10:00:00Z" }));
    const out = agg.finish();
    expect(out.timeWindow.earliest).toBe("2026-04-25T10:00:00Z");
    expect(out.timeWindow.latest).toBe("2026-04-26T10:00:00Z");
    expect(out.timeWindow.durationHours).toBe(24);
  });

  it("produces zeroed window when empty", () => {
    const out = createAggregator().finish();
    expect(out.urls.size).toBe(0);
    expect(out.bots).toEqual([]);
    expect(out.timeWindow.durationHours).toBe(0);
  });
});
