import { describe, it, expect } from "vitest";
import { checkXRobotsTag } from "../../src/checks/header-checks.js";

describe("checkXRobotsTag", () => {
  it("flags noindex in X-Robots-Tag", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "noindex" });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("HEADER_X_ROBOTS_NOINDEX");
    expect(issues[0].severity).toBe("high");
  });

  it("flags nofollow in X-Robots-Tag", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "nofollow" });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("HEADER_X_ROBOTS_NOFOLLOW");
  });

  it("parses comma-separated directives", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "noindex, nofollow" });
    expect(issues.map((i) => i.code).sort()).toEqual([
      "HEADER_X_ROBOTS_NOFOLLOW",
      "HEADER_X_ROBOTS_NOINDEX",
    ]);
  });

  it("ignores googlebot-scoped directives by default", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "googlebot: noindex" });
    expect(issues).toEqual([]);
  });

  it("returns no issues when header is absent", () => {
    expect(checkXRobotsTag({})).toEqual([]);
  });
});
