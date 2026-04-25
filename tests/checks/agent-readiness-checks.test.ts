import { describe, it, expect } from "vitest";
import {
  buildAgentReadinessReport,
  evaluateAiBotPolicy,
  evaluateLlmsTxt,
  evaluateSchemaCoverage,
  parseContentSignals,
  KNOWN_AI_USER_AGENTS,
} from "../../src/checks/agent-readiness-checks.js";
import { parseRobotsRules } from "../../src/checks/robots-checks.js";
import type { PageReport } from "../../src/types.js";

function makePage(overrides: Partial<PageReport> & { url: string; schemaTypes?: string[] }): PageReport {
  return {
    url: overrides.url,
    finalUrl: overrides.finalUrl ?? overrides.url,
    status: 200,
    contentType: "text/html",
    redirectChain: [],
    checks: {
      title: null,
      titleLength: 0,
      metaDescription: null,
      metaDescriptionLength: 0,
      canonical: null,
      htmlLang: null,
      expectedLocale: null,
      hreflang: [],
      robotsMeta: null,
      h1s: [],
      wordCount: 0,
      imagesTotal: 0,
      imagesMissingAlt: 0,
      internalLinks: 0,
      incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0,
      internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0,
      inSitemap: false,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: overrides.schemaTypes ?? [],
      bodyText: null,
    },
    issues: [],
    discoveredLinks: [],
  };
}

describe("evaluateAiBotPolicy", () => {
  it("classifies explicit allow and disallow blocks", () => {
    const rules = parseRobotsRules(`
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Allow: /
`);
    const policy = evaluateAiBotPolicy(rules, "https://example.com");
    const gpt = policy.find((p) => p.userAgent === "GPTBot");
    const claude = policy.find((p) => p.userAgent === "ClaudeBot");
    expect(gpt?.status).toBe("blocked");
    expect(claude?.status).toBe("allowed");
  });

  it("treats wildcard-only sites as unspecified for AI bots", () => {
    const rules = parseRobotsRules(`
User-agent: *
Disallow: /admin/
`);
    const policy = evaluateAiBotPolicy(rules, "https://example.com");
    expect(policy.every((p) => p.status === "unspecified")).toBe(true);
  });

  it("returns one entry per known AI user agent", () => {
    const policy = evaluateAiBotPolicy({}, "https://example.com");
    expect(policy).toHaveLength(KNOWN_AI_USER_AGENTS.length);
  });
});

describe("parseContentSignals", () => {
  it("parses content-signal directives with comma-separated key=value pairs", () => {
    const signals = parseContentSignals(
      `User-agent: *\nContent-Signal: search=yes, ai-train=no, ai-input=yes\n`,
    );
    expect(signals).toEqual({ search: "yes", aiTrain: "no", aiInput: "yes" });
  });

  it("returns unspecified when no signals are declared", () => {
    expect(parseContentSignals("User-agent: *\nDisallow: /private/\n")).toEqual({
      search: "unspecified",
      aiTrain: "unspecified",
      aiInput: "unspecified",
    });
  });
});

describe("evaluateLlmsTxt", () => {
  it("counts headings, links, and bytes", () => {
    const text = `# Example
A short summary.

## Docs
- [API](https://example.com/api)
- [Guide](https://example.com/guide)

## Examples
- [Sample](https://example.com/sample)
`;
    const result = evaluateLlmsTxt(text);
    expect(result.hasH1).toBe(true);
    expect(result.sectionCount).toBe(2);
    expect(result.linkCount).toBe(3);
    expect(result.byteSize).toBeGreaterThan(50);
  });

  it("flags missing H1 and zero links on an empty file", () => {
    const result = evaluateLlmsTxt("");
    expect(result.hasH1).toBe(false);
    expect(result.sectionCount).toBe(0);
    expect(result.linkCount).toBe(0);
    expect(result.byteSize).toBe(0);
  });
});

describe("evaluateSchemaCoverage", () => {
  it("detects Organization/WebSite on the homepage", () => {
    const pages = [
      makePage({ url: "https://example.com/", schemaTypes: ["Organization"] }),
      makePage({ url: "https://example.com/about" }),
    ];
    const cov = evaluateSchemaCoverage(pages, "https://example.com/");
    expect(cov.homepageHasOrgOrWebsite).toBe(true);
  });

  it("counts article-like pages with and without Article schema", () => {
    const pages = [
      makePage({ url: "https://example.com/blog/foo", schemaTypes: ["BlogPosting"] }),
      makePage({ url: "https://example.com/blog/bar" }),
      makePage({ url: "https://example.com/news/baz", schemaTypes: ["NewsArticle"] }),
      makePage({ url: "https://example.com/about" }),
    ];
    const cov = evaluateSchemaCoverage(pages, "https://example.com/");
    expect(cov.articleLikePages).toBe(3);
    expect(cov.articleLikePagesWithSchema).toBe(2);
  });
});

describe("buildAgentReadinessReport", () => {
  it("returns a low score for a site with no readiness signals", () => {
    const report = buildAgentReadinessReport({
      startUrl: "https://example.com/",
      pages: [makePage({ url: "https://example.com/" })],
      robotsTxtPresent: false,
      robotsText: "",
      robotsRules: {},
      sitemapPresent: false,
      llmsTxtPresent: false,
      llmsText: null,
      llmsFullTxtPresent: false,
      markdownNegotiationSupported: false,
      linkHeaderPresent: false,
      linkHeaderRels: [],
      webBotAuthAdvertised: false,
      wellKnownProbes: [],
    });
    expect(report.score).toBeLessThan(40);
    expect(report.issues.some((i) => i.code === "AGENT_NO_EXPLICIT_AI_POLICY")).toBe(true);
    expect(report.issues.some((i) => i.code === "AGENT_HOMEPAGE_NO_ORG")).toBe(true);
  });

  it("returns a high score when most signals are present", () => {
    const goodLlms = `# Example\n\n## Docs\n- [API](https://example.com/api)\n- [Guide](https://example.com/guide)\n\nMore text to push past 200 bytes so the size sanity check passes for the agent-readiness rubric here.\n`;
    const robotsText = `User-agent: GPTBot\nAllow: /\n\nContent-Signal: search=yes, ai-train=no\n`;
    const robotsRules = parseRobotsRules(robotsText);
    const report = buildAgentReadinessReport({
      startUrl: "https://example.com/",
      pages: [
        makePage({ url: "https://example.com/", schemaTypes: ["Organization", "WebSite"] }),
        makePage({ url: "https://example.com/blog/foo", schemaTypes: ["BlogPosting"] }),
      ],
      robotsTxtPresent: true,
      robotsText,
      robotsRules,
      sitemapPresent: true,
      llmsTxtPresent: true,
      llmsText: goodLlms,
      llmsFullTxtPresent: true,
      markdownNegotiationSupported: true,
      linkHeaderPresent: true,
      linkHeaderRels: ["alternate"],
      webBotAuthAdvertised: true,
      wellKnownProbes: [
        { name: "agent-skills", url: "https://example.com/.well-known/agent-skills/index.json", status: 200, present: true },
        { name: "api-catalog", url: "https://example.com/.well-known/api-catalog", status: 200, present: true },
        { name: "mcp-server-card", url: "https://example.com/.well-known/mcp/server-card.json", status: 200, present: true },
        { name: "oauth-authorization-server", url: "https://example.com/.well-known/oauth-authorization-server", status: 200, present: true },
        { name: "oauth-protected-resource", url: "https://example.com/.well-known/oauth-protected-resource", status: 404, present: false },
      ],
    });
    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.issues.some((i) => i.code === "AGENT_NO_EXPLICIT_AI_POLICY")).toBe(false);
    expect(report.issues.some((i) => i.code === "AGENT_HOMEPAGE_NO_ORG")).toBe(false);
    expect(report.botAccessControl.contentSignals.search).toBe("yes");
    expect(report.botAccessControl.contentSignals.aiTrain).toBe("no");
  });

  it("flags article-like pages without Article schema", () => {
    const report = buildAgentReadinessReport({
      startUrl: "https://example.com/",
      pages: [
        makePage({ url: "https://example.com/", schemaTypes: ["Organization"] }),
        makePage({ url: "https://example.com/blog/post-a" }),
        makePage({ url: "https://example.com/blog/post-b" }),
      ],
      robotsTxtPresent: true,
      robotsText: "",
      robotsRules: {},
      sitemapPresent: true,
      llmsTxtPresent: false,
      llmsText: null,
      llmsFullTxtPresent: false,
      markdownNegotiationSupported: false,
      linkHeaderPresent: false,
      linkHeaderRels: [],
      webBotAuthAdvertised: false,
      wellKnownProbes: [],
    });
    expect(report.issues.some((i) => i.code === "AGENT_ARTICLES_NO_SCHEMA")).toBe(true);
    expect(report.capabilities.schemaCoverage.articleLikePages).toBe(2);
    expect(report.capabilities.schemaCoverage.articleLikePagesWithSchema).toBe(0);
  });
});
