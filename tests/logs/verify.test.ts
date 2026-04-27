import { describe, expect, it, vi } from "vitest";
import { createBotVerifier, probeDnsAvailable, classifyBotFromUserAgent } from "../../src/logs/verify.js";
import type { DnsResolver } from "../../src/types.js";

function fakeResolver(map: Record<string, { ptr?: string[]; a?: string[]; aaaa?: string[] }>): DnsResolver {
  return {
    reverse: async (ip) => {
      const e = map[ip];
      if (e?.ptr === undefined) throw new Error("ENOTFOUND");
      return e.ptr;
    },
    resolve4: async (host) => {
      for (const e of Object.values(map)) {
        if (e.ptr?.includes(host) && e.a) return e.a;
      }
      throw new Error("ENOTFOUND");
    },
    resolve6: async () => { throw new Error("ENOTFOUND"); }
  };
}

describe("classifyBotFromUserAgent", () => {
  it("classifies Googlebot", () => {
    expect(classifyBotFromUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("googlebot");
  });
  it("classifies bingbot", () => {
    expect(classifyBotFromUserAgent("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe("bingbot");
  });
  it("classifies AI bots", () => {
    expect(classifyBotFromUserAgent("ClaudeBot/1.0")).toBe("claudebot");
    expect(classifyBotFromUserAgent("GPTBot/1.0")).toBe("gptbot");
    expect(classifyBotFromUserAgent("PerplexityBot/1.0")).toBe("perplexitybot");
  });
  it("returns null for non-bot UAs", () => {
    expect(classifyBotFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBeNull();
  });
});

describe("probeDnsAvailable", () => {
  it("returns true when reverse-lookup of a known IP succeeds", async () => {
    const r = fakeResolver({ "8.8.8.8": { ptr: ["dns.google"], a: ["8.8.8.8"] } });
    expect(await probeDnsAvailable(r)).toBe(true);
  });
  it("returns false when reverse-lookup fails", async () => {
    const r = fakeResolver({});
    expect(await probeDnsAvailable(r)).toBe(false);
  });
});

describe("createBotVerifier", () => {
  it("verifies a real Googlebot via reverse → forward DNS", async () => {
    const r = fakeResolver({
      "66.249.66.1": { ptr: ["crawl-66-249-66-1.googlebot.com"], a: ["66.249.66.1"] },
    });
    const verifier = createBotVerifier({ dnsResolver: r });
    const v = await verifier.verify("66.249.66.1", "googlebot");
    expect(v).toEqual({ bot: "googlebot", verified: true });
  });

  it("flags a spoofer (forward DNS doesn't match)", async () => {
    const r = fakeResolver({
      "1.2.3.4": { ptr: ["evil.example.com"], a: ["9.9.9.9"] },
    });
    const verifier = createBotVerifier({ dnsResolver: r });
    const v = await verifier.verify("1.2.3.4", "googlebot");
    expect(v).toEqual({ bot: null, verified: true });
  });

  it("caches per IP", async () => {
    const reverseSpy = vi.fn().mockResolvedValue(["crawl-66-249-66-1.googlebot.com"]);
    const resolve4Spy = vi.fn().mockResolvedValue(["66.249.66.1"]);
    const r: DnsResolver = {
      reverse: reverseSpy,
      resolve4: resolve4Spy,
      resolve6: vi.fn().mockRejectedValue(new Error("ENOTFOUND"))
    };
    const verifier = createBotVerifier({ dnsResolver: r });
    await verifier.verify("66.249.66.1", "googlebot");
    await verifier.verify("66.249.66.1", "googlebot");
    expect(reverseSpy).toHaveBeenCalledTimes(1);
    expect(resolve4Spy).toHaveBeenCalledTimes(1);
  });

  it("returns verified:false on DNS error", async () => {
    const r = fakeResolver({});
    const verifier = createBotVerifier({ dnsResolver: r });
    const v = await verifier.verify("1.2.3.4", "googlebot");
    expect(v).toEqual({ bot: null, verified: false });
  });
});
