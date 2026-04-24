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

export function checkResponseHeaders(
  url: string,
  headers: Record<string, string>,
): Issue[] {
  const issues: Issue[] = [];
  const isHttps = url.startsWith("https://");

  if (isHttps && !headers["strict-transport-security"]) {
    issues.push({
      code: "HEADER_HSTS_MISSING",
      severity: "low",
      message: "HTTPS response is missing the Strict-Transport-Security (HSTS) header.",
      recommendation: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains on HTTPS responses.",
    });
  }

  if (!headers["content-type"]) {
    issues.push({
      code: "HEADER_CONTENT_TYPE_MISSING",
      severity: "medium",
      message: "Response has no Content-Type header.",
      recommendation: "Set Content-Type (e.g. text/html; charset=utf-8) so browsers and crawlers parse correctly.",
    });
  }

  const cache = headers["cache-control"]?.toLowerCase() ?? "";
  if (cache.includes("no-store") && cache.includes("no-cache") && cache.includes("max-age=0")) {
    issues.push({
      code: "HEADER_CACHE_CONTROL_AGGRESSIVE_NOCACHE",
      severity: "low",
      message: "Cache-Control combines no-store, no-cache, and max-age=0 — overly defensive for an HTML page.",
      recommendation: "Pick one caching strategy (e.g. public, max-age=3600) unless content is truly uncacheable.",
    });
  }

  return issues;
}
