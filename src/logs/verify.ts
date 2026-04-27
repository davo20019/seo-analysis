import type { DnsResolver, VerifiedBot } from "../types.js";

export interface BotVerdict {
  bot: VerifiedBot["name"] | null;
  verified: boolean;
}

const BOT_SUFFIXES: Record<VerifiedBot["name"], string[] | null> = {
  googlebot:     [".googlebot.com", ".google.com"],
  bingbot:       [".search.msn.com"],
  applebot:      [".applebot.apple.com"],
  duckduckbot:   [".duckduckgo.com"],
  claudebot:     null,
  gptbot:        null,
  perplexitybot: null,
  other:         null
};

const BOT_UA_PATTERNS: Array<[VerifiedBot["name"], RegExp]> = [
  ["googlebot",     /googlebot/i],
  ["bingbot",       /bingbot/i],
  ["applebot",      /applebot/i],
  ["duckduckbot",   /duckduckbot/i],
  ["claudebot",     /claudebot|claude-web/i],
  ["gptbot",        /gptbot/i],
  ["perplexitybot", /perplexitybot/i],
];

export function classifyBotFromUserAgent(ua: string): VerifiedBot["name"] | null {
  for (const [name, re] of BOT_UA_PATTERNS) {
    if (re.test(ua)) return name;
  }
  return null;
}

export async function probeDnsAvailable(resolver: DnsResolver): Promise<boolean> {
  try {
    const names = await resolver.reverse("8.8.8.8");
    return names.length > 0;
  } catch {
    return false;
  }
}

export function createBotVerifier(opts: {
  dnsResolver: DnsResolver;
  timeoutMs?: number;
}): {
  verify(ip: string, claimedBot: VerifiedBot["name"]): Promise<BotVerdict>;
} {
  const cache = new Map<string, BotVerdict>();
  const { dnsResolver, timeoutMs = 2000 } = opts;

  function withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("DNS timeout")), timeoutMs);
      p.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); }
      );
    });
  }

  return {
    async verify(ip, claimedBot) {
      const cacheKey = `${ip}|${claimedBot}`;
      const hit = cache.get(cacheKey);
      if (hit !== undefined) return hit;

      const suffixes = BOT_SUFFIXES[claimedBot];
      if (suffixes === null) {
        // No DNS verification path defined for this bot family — accept the UA claim.
        const v: BotVerdict = { bot: claimedBot, verified: true };
        cache.set(cacheKey, v);
        return v;
      }

      try {
        const ptrNames = await withTimeout(dnsResolver.reverse(ip));
        const matchingPtr = ptrNames.find((n) =>
          suffixes.some((s) => n.toLowerCase().endsWith(s)));
        if (matchingPtr === undefined) {
          const v: BotVerdict = { bot: null, verified: true };
          cache.set(cacheKey, v);
          return v;
        }
        const forwardIps = await withTimeout(dnsResolver.resolve4(matchingPtr).catch(() => [] as string[]));
        const forward6   = await withTimeout(dnsResolver.resolve6(matchingPtr).catch(() => [] as string[]));
        const allForward = [...forwardIps, ...forward6];
        const v: BotVerdict = allForward.includes(ip)
          ? { bot: claimedBot, verified: true }
          : { bot: null, verified: true };
        cache.set(cacheKey, v);
        return v;
      } catch {
        const v: BotVerdict = { bot: null, verified: false };
        cache.set(cacheKey, v);
        return v;
      }
    }
  };
}
