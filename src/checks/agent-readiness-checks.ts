import type {
  AgentBotPolicy,
  AgentContentSignals,
  AgentContentSignalValue,
  AgentLlmsTxtAnalysis,
  AgentReadinessReport,
  AgentSchemaCoverage,
  AgentWellKnownProbe,
  Issue,
  PageReport,
} from "../types.js";
import { isUrlAllowed, type RobotsRules } from "./robots-checks.js";

export const KNOWN_AI_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Bytespider",
  "Applebot-Extended",
  "cohere-ai",
  "Meta-ExternalAgent",
] as const;

const WELL_KNOWN_PROBE_PATHS: Array<{ name: string; path: string }> = [
  { name: "agent-skills", path: "/.well-known/agent-skills/index.json" },
  { name: "api-catalog", path: "/.well-known/api-catalog" },
  { name: "mcp-server-card", path: "/.well-known/mcp/server-card.json" },
  { name: "oauth-authorization-server", path: "/.well-known/oauth-authorization-server" },
  { name: "oauth-protected-resource", path: "/.well-known/oauth-protected-resource" },
];

const WEB_BOT_AUTH_PATH = "/.well-known/http-message-signatures-directory";

const ARTICLE_LIKE_SCHEMA_TYPES = new Set(["Article", "BlogPosting", "NewsArticle"]);
const ARTICLE_LIKE_PATH_PATTERN = /\/(?:blog|post|posts|news|article|articles)(?:\/|$)/i;

export function evaluateAiBotPolicy(rules: RobotsRules, origin: string): AgentBotPolicy[] {
  return KNOWN_AI_USER_AGENTS.map((userAgent) => {
    const ua = userAgent.toLowerCase();
    const hasOwnBlock = Object.prototype.hasOwnProperty.call(rules, ua);
    const probeUrl = `${origin}/`;

    if (hasOwnBlock) {
      const allowed = isUrlAllowed(probeUrl, userAgent, { [ua]: rules[ua] });
      return {
        userAgent,
        status: allowed ? "allowed" : "blocked",
        matchedRule: `User-agent: ${userAgent}`,
      };
    }

    return { userAgent, status: "unspecified" };
  });
}

export function parseContentSignals(robotsText: string): AgentContentSignals {
  const signals: AgentContentSignals = {
    search: "unspecified",
    aiTrain: "unspecified",
    aiInput: "unspecified",
  };

  const lines = robotsText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key !== "content-signal" && key !== "content-signals") continue;

    const value = line.slice(colon + 1).trim();
    for (const part of value.split(",")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim().toLowerCase();
      const raw = part.slice(eq + 1).trim().toLowerCase();
      const normalized: AgentContentSignalValue =
        raw === "yes" || raw === "allow" || raw === "true"
          ? "yes"
          : raw === "no" || raw === "disallow" || raw === "false"
            ? "no"
            : "unspecified";

      if (normalized === "unspecified") continue;
      if (name === "search") signals.search = normalized;
      else if (name === "ai-train") signals.aiTrain = normalized;
      else if (name === "ai-input") signals.aiInput = normalized;
    }
  }

  return signals;
}

export function evaluateLlmsTxt(text: string): AgentLlmsTxtAnalysis {
  const byteSize = Buffer.byteLength(text, "utf8");
  const hasH1 = /^\s*#\s+\S/m.test(text);
  const sectionMatches = text.match(/^\s*##\s+\S/gm);
  const sectionCount = sectionMatches ? sectionMatches.length : 0;
  const linkMatches = text.match(/\[[^\]]+\]\(([^)]+)\)/g);
  const linkCount = linkMatches ? linkMatches.length : 0;
  return { hasH1, sectionCount, linkCount, byteSize };
}

export function evaluateSchemaCoverage(
  pages: PageReport[],
  startUrl: string,
): AgentSchemaCoverage {
  const startOrigin = new URL(startUrl).origin;
  const startPath = new URL(startUrl).pathname.replace(/\/+$/, "") || "/";

  const homepage = pages.find((page) => {
    try {
      const u = new URL(page.finalUrl);
      const path = u.pathname.replace(/\/+$/, "") || "/";
      return u.origin === startOrigin && (path === "/" || path === startPath);
    } catch {
      return false;
    }
  });

  const homepageHasOrgOrWebsite = !!homepage?.checks.schemaTypes.some(
    (t) => t === "Organization" || t === "WebSite",
  );

  let articleLikePages = 0;
  let articleLikePagesWithSchema = 0;

  for (const page of pages) {
    let pathname: string;
    try {
      pathname = new URL(page.finalUrl).pathname;
    } catch {
      continue;
    }

    if (!ARTICLE_LIKE_PATH_PATTERN.test(pathname)) continue;
    articleLikePages += 1;
    if (page.checks.schemaTypes.some((t) => ARTICLE_LIKE_SCHEMA_TYPES.has(t))) {
      articleLikePagesWithSchema += 1;
    }
  }

  return { homepageHasOrgOrWebsite, articleLikePages, articleLikePagesWithSchema };
}

export interface ProbeFetcher {
  (url: string, init?: { method?: "GET" | "HEAD"; headers?: Record<string, string> }): Promise<{
    status: number;
    headers: Record<string, string>;
    text: string;
  }>;
}

export async function probeWellKnownEndpoints(
  origin: string,
  fetcher: ProbeFetcher,
): Promise<AgentWellKnownProbe[]> {
  const results = await Promise.allSettled(
    WELL_KNOWN_PROBE_PATHS.map(async ({ name, path }) => {
      const url = `${origin}${path}`;
      const res = await fetcher(url, { method: "GET" });
      return {
        name,
        url,
        status: res.status,
        present: res.status >= 200 && res.status < 300,
      } satisfies AgentWellKnownProbe;
    }),
  );

  return results.map((r, idx) => {
    if (r.status === "fulfilled") return r.value;
    return {
      name: WELL_KNOWN_PROBE_PATHS[idx].name,
      url: `${origin}${WELL_KNOWN_PROBE_PATHS[idx].path}`,
      status: null,
      present: false,
    };
  });
}

export async function probeWebBotAuth(
  origin: string,
  fetcher: ProbeFetcher,
): Promise<boolean> {
  try {
    const res = await fetcher(`${origin}${WEB_BOT_AUTH_PATH}`, { method: "GET" });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

export async function probeMarkdownNegotiation(
  url: string,
  fetcher: ProbeFetcher,
): Promise<boolean> {
  try {
    const res = await fetcher(url, {
      method: "GET",
      headers: { Accept: "text/markdown" },
    });
    if (res.status < 200 || res.status >= 300) return false;
    const contentType = (res.headers["content-type"] ?? "").toLowerCase();
    return contentType.includes("text/markdown") || contentType.includes("application/markdown");
  } catch {
    return false;
  }
}

export async function probeLinkHeader(
  url: string,
  fetcher: ProbeFetcher,
): Promise<{ present: boolean; rels: string[] }> {
  try {
    const res = await fetcher(url, { method: "HEAD" });
    const headerValue = res.headers["link"] ?? "";
    if (!headerValue) return { present: false, rels: [] };
    const rels = parseLinkHeaderRels(headerValue);
    return { present: true, rels };
  } catch {
    return { present: false, rels: [] };
  }
}

function parseLinkHeaderRels(value: string): string[] {
  const rels = new Set<string>();
  for (const part of value.split(",")) {
    const match = part.match(/rel\s*=\s*"?([^";]+)"?/i);
    if (match) {
      for (const rel of match[1].split(/\s+/)) {
        if (rel) rels.add(rel.toLowerCase());
      }
    }
  }
  return [...rels];
}

interface BuildArgs {
  startUrl: string;
  pages: PageReport[];
  robotsTxtPresent: boolean;
  robotsText: string;
  robotsRules: RobotsRules;
  sitemapPresent: boolean;
  llmsTxtPresent: boolean;
  llmsText: string | null;
  llmsFullTxtPresent: boolean;
  markdownNegotiationSupported: boolean;
  linkHeaderPresent: boolean;
  linkHeaderRels: string[];
  webBotAuthAdvertised: boolean;
  wellKnownProbes: AgentWellKnownProbe[];
}

export function buildAgentReadinessReport(args: BuildArgs): AgentReadinessReport {
  const origin = new URL(args.startUrl).origin;
  const aiBots = evaluateAiBotPolicy(args.robotsRules, origin);
  const contentSignals = parseContentSignals(args.robotsText);
  const llmsTxtAnalysis = args.llmsText !== null ? evaluateLlmsTxt(args.llmsText) : null;
  const schemaCoverage = evaluateSchemaCoverage(args.pages, args.startUrl);

  const issues: Issue[] = [];

  const allUnspecified = aiBots.every((b) => b.status === "unspecified");
  if (allUnspecified) {
    issues.push({
      code: "AGENT_NO_EXPLICIT_AI_POLICY",
      severity: "low",
      message:
        "robots.txt has no explicit rules for known AI crawlers (GPTBot, ClaudeBot, PerplexityBot, etc.).",
      recommendation:
        "Decide whether AI crawlers should be allowed and add explicit User-agent blocks so the choice is intentional.",
    });
  }

  if (args.llmsTxtPresent && llmsTxtAnalysis) {
    if (!llmsTxtAnalysis.hasH1) {
      issues.push({
        code: "AGENT_LLMSTXT_NO_H1",
        severity: "low",
        message: "llms.txt does not start with a top-level `# Heading`.",
        recommendation: "Open llms.txt with a single H1 naming the site so agents have an anchor for context.",
      });
    }
    if (llmsTxtAnalysis.sectionCount === 0) {
      issues.push({
        code: "AGENT_LLMSTXT_NO_SECTIONS",
        severity: "low",
        message: "llms.txt has no `## Section` headings.",
        recommendation:
          "Group key resources under named sections (e.g. Docs, API, Examples) so agents can pick the right one.",
      });
    }
    if (llmsTxtAnalysis.linkCount === 0) {
      issues.push({
        code: "AGENT_LLMSTXT_NO_LINKS",
        severity: "low",
        message: "llms.txt contains no markdown links.",
        recommendation: "Link to your most important canonical documents so agents know what to read first.",
      });
    }
    if (llmsTxtAnalysis.byteSize > 0 && llmsTxtAnalysis.byteSize < 200) {
      issues.push({
        code: "AGENT_LLMSTXT_TOO_SMALL",
        severity: "low",
        message: `llms.txt is only ${llmsTxtAnalysis.byteSize} bytes — likely too thin to be useful.`,
        recommendation: "Expand llms.txt to a meaningful summary plus links to key sections.",
      });
    }
  }

  if (schemaCoverage.articleLikePages > 0 && schemaCoverage.articleLikePagesWithSchema === 0) {
    issues.push({
      code: "AGENT_ARTICLES_NO_SCHEMA",
      severity: "low",
      message: `${schemaCoverage.articleLikePages} article-like page(s) have no Article/BlogPosting/NewsArticle JSON-LD.`,
      recommendation: "Add Article schema so agents can extract author, datePublished, and headline reliably.",
    });
  }

  if (
    args.pages.length > 0 &&
    isLikelyHomepageInPages(args.pages, args.startUrl) &&
    !schemaCoverage.homepageHasOrgOrWebsite
  ) {
    issues.push({
      code: "AGENT_HOMEPAGE_NO_ORG",
      severity: "low",
      message: "Homepage has no Organization or WebSite JSON-LD.",
      recommendation:
        "Add Organization (and ideally WebSite) schema to the homepage so agents can identify the publisher.",
    });
  }

  const subscores = {
    discoverability: scoreDiscoverability({
      robotsTxtPresent: args.robotsTxtPresent,
      sitemapPresent: args.sitemapPresent,
      linkHeaderPresent: args.linkHeaderPresent,
    }),
    contentAccessibility: scoreContentAccessibility({
      llmsTxtPresent: args.llmsTxtPresent,
      llmsTxtAnalysis,
      llmsFullTxtPresent: args.llmsFullTxtPresent,
      markdownNegotiationSupported: args.markdownNegotiationSupported,
    }),
    botAccessControl: scoreBotAccessControl({
      aiBots,
      contentSignals,
      webBotAuthAdvertised: args.webBotAuthAdvertised,
    }),
    capabilities: scoreCapabilities({
      probes: args.wellKnownProbes,
      schemaCoverage,
    }),
  };

  const score = Math.round(
    (subscores.discoverability +
      subscores.contentAccessibility +
      subscores.botAccessControl +
      subscores.capabilities) /
      4,
  );

  return {
    score,
    subscores,
    discoverability: {
      robotsTxtPresent: args.robotsTxtPresent,
      sitemapPresent: args.sitemapPresent,
      linkHeaderPresent: args.linkHeaderPresent,
      linkHeaderRels: args.linkHeaderRels,
    },
    contentAccessibility: {
      llmsTxtPresent: args.llmsTxtPresent,
      llmsTxtAnalysis,
      llmsFullTxtPresent: args.llmsFullTxtPresent,
      markdownNegotiationSupported: args.markdownNegotiationSupported,
    },
    botAccessControl: {
      aiBots,
      contentSignals,
      webBotAuthAdvertised: args.webBotAuthAdvertised,
    },
    capabilities: {
      probes: args.wellKnownProbes,
      schemaCoverage,
    },
    issues,
  };
}

function scoreDiscoverability(args: {
  robotsTxtPresent: boolean;
  sitemapPresent: boolean;
  linkHeaderPresent: boolean;
}): number {
  let score = 0;
  if (args.robotsTxtPresent) score += 50;
  if (args.sitemapPresent) score += 35;
  if (args.linkHeaderPresent) score += 15;
  return score;
}

function scoreContentAccessibility(args: {
  llmsTxtPresent: boolean;
  llmsTxtAnalysis: AgentLlmsTxtAnalysis | null;
  llmsFullTxtPresent: boolean;
  markdownNegotiationSupported: boolean;
}): number {
  let score = 0;
  if (args.llmsTxtPresent) score += 30;
  if (args.llmsTxtAnalysis) {
    if (args.llmsTxtAnalysis.hasH1) score += 10;
    if (args.llmsTxtAnalysis.sectionCount >= 1) score += 10;
    if (args.llmsTxtAnalysis.linkCount >= 1) score += 10;
    if (args.llmsTxtAnalysis.byteSize >= 200) score += 10;
  }
  if (args.llmsFullTxtPresent) score += 15;
  if (args.markdownNegotiationSupported) score += 15;
  return Math.min(100, score);
}

function scoreBotAccessControl(args: {
  aiBots: AgentBotPolicy[];
  contentSignals: AgentContentSignals;
  webBotAuthAdvertised: boolean;
}): number {
  let score = 0;
  const explicit = args.aiBots.filter((b) => b.status !== "unspecified").length;
  const totalBots = args.aiBots.length;
  if (totalBots > 0) {
    score += Math.round((explicit / totalBots) * 60);
  }

  const signalsSet =
    (args.contentSignals.search !== "unspecified" ? 1 : 0) +
    (args.contentSignals.aiTrain !== "unspecified" ? 1 : 0) +
    (args.contentSignals.aiInput !== "unspecified" ? 1 : 0);
  score += signalsSet * 10;

  if (args.webBotAuthAdvertised) score += 10;
  return Math.min(100, score);
}

function scoreCapabilities(args: {
  probes: AgentWellKnownProbe[];
  schemaCoverage: AgentSchemaCoverage;
}): number {
  let score = 0;
  const presentProbes = args.probes.filter((p) => p.present).length;
  if (args.probes.length > 0) {
    score += Math.round((presentProbes / args.probes.length) * 50);
  }

  if (args.schemaCoverage.homepageHasOrgOrWebsite) score += 25;

  if (args.schemaCoverage.articleLikePages > 0) {
    const ratio = args.schemaCoverage.articleLikePagesWithSchema / args.schemaCoverage.articleLikePages;
    score += Math.round(ratio * 25);
  } else {
    score += 25;
  }

  return Math.min(100, score);
}

function isLikelyHomepageInPages(pages: PageReport[], startUrl: string): boolean {
  try {
    const start = new URL(startUrl);
    const startPath = start.pathname.replace(/\/+$/, "") || "/";
    return pages.some((page) => {
      try {
        const u = new URL(page.finalUrl);
        const path = u.pathname.replace(/\/+$/, "") || "/";
        return u.origin === start.origin && (path === "/" || path === startPath);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
