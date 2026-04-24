import { describe, it, expect } from "vitest";
import { parseRobotsRules, isUrlAllowed, checkUrlAgainstRobots } from "../../src/checks/robots-checks.js";

describe("parseRobotsRules", () => {
  it("groups rules by user-agent", () => {
    const rules = parseRobotsRules(`
User-agent: *
Disallow: /admin/
Allow: /admin/public/

User-agent: Googlebot
Disallow: /private/
`);
    expect(rules["*"]).toEqual([
      { type: "disallow", path: "/admin/" },
      { type: "allow", path: "/admin/public/" },
    ]);
    expect(rules["googlebot"]).toEqual([
      { type: "disallow", path: "/private/" },
    ]);
  });

  it("handles comments and blank lines", () => {
    const rules = parseRobotsRules(`
# a comment
User-agent: *

Disallow: /x   # inline comment
`);
    expect(rules["*"]).toEqual([{ type: "disallow", path: "/x" }]);
  });
});

describe("isUrlAllowed", () => {
  const rules = {
    "*": [
      { type: "disallow" as const, path: "/admin/" },
      { type: "allow" as const, path: "/admin/public/" },
    ],
    "googlebot": [
      { type: "disallow" as const, path: "/secret/" },
    ],
  };

  it("allows URLs that do not match any disallow", () => {
    expect(isUrlAllowed("https://site.com/about", "googlebot", rules)).toBe(true);
  });

  it("blocks URLs matching a disallow for the requested UA", () => {
    expect(isUrlAllowed("https://site.com/secret/page", "googlebot", rules)).toBe(false);
  });

  it("falls back to * rules when UA-specific rules are silent", () => {
    expect(isUrlAllowed("https://site.com/admin/secret", "googlebot", rules)).toBe(false);
  });

  it("longest-match allow beats shorter disallow", () => {
    expect(isUrlAllowed("https://site.com/admin/public/x", "googlebot", rules)).toBe(true);
  });

  it("is case-insensitive on user-agent", () => {
    expect(isUrlAllowed("https://site.com/secret/x", "GoogleBot", rules)).toBe(false);
  });
});

describe("checkUrlAgainstRobots", () => {
  const rules = { "*": [{ type: "disallow" as const, path: "/admin/" }] };

  it("flags a disallowed URL", () => {
    const issues = checkUrlAgainstRobots("https://site.com/admin/x", "googlebot", rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("ROBOTS_DISALLOWS_URL");
    expect(issues[0].severity).toBe("high");
  });

  it("does not flag an allowed URL", () => {
    expect(checkUrlAgainstRobots("https://site.com/about", "googlebot", rules)).toEqual([]);
  });

  it("returns empty when there are no rules at all", () => {
    expect(checkUrlAgainstRobots("https://site.com/x", "googlebot", {})).toEqual([]);
  });
});
