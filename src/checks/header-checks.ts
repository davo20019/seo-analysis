import type { Issue } from "../types.js";

export function checkXRobotsTag(headers: Record<string, string>): Issue[] {
  const raw = headers["x-robots-tag"];
  if (!raw) return [];

  const issues: Issue[] = [];
  const directives = raw.split(",").map((s) => s.trim().toLowerCase());
  for (const directive of directives) {
    if (directive.includes(":")) continue;
    if (directive === "noindex") {
      issues.push({
        code: "HEADER_X_ROBOTS_NOINDEX",
        severity: "high",
        message: "X-Robots-Tag header contains noindex — page is excluded from search results.",
        recommendation: "Remove noindex from the X-Robots-Tag response header unless exclusion is intentional.",
      });
    }
    if (directive === "nofollow") {
      issues.push({
        code: "HEADER_X_ROBOTS_NOFOLLOW",
        severity: "medium",
        message: "X-Robots-Tag header contains nofollow — links on this page won't pass authority.",
        recommendation: "Remove nofollow from the X-Robots-Tag response header unless intentional.",
      });
    }
  }
  return issues;
}
