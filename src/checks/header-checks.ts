import type { Issue } from "../types.js";

export interface ParsedLink {
  url: string;
  rel: string[];
  params: Record<string, string>;
}

export function parseLinkHeader(value: string | undefined | null): ParsedLink[] {
  if (!value) return [];
  const links: ParsedLink[] = [];
  const entries = splitLinkHeader(value);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const urlMatch = trimmed.match(/^<([^>]+)>(.*)$/);
    if (!urlMatch) continue;
    const url = urlMatch[1].trim();
    const rest = urlMatch[2];
    const params: Record<string, string> = {};

    for (const part of rest.split(";")) {
      const seg = part.trim();
      if (!seg) continue;
      const eq = seg.indexOf("=");
      if (eq < 0) continue;
      const key = seg.slice(0, eq).trim().toLowerCase();
      let val = seg.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      params[key] = val;
    }

    const rel = (params.rel ?? "")
      .split(/\s+/)
      .map((r) => r.toLowerCase())
      .filter((r) => r.length > 0);

    links.push({ url, rel, params });
  }

  return links;
}

function splitLinkHeader(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let buffer = "";

  for (const ch of value) {
    if (ch === '"' && !inQuote) inQuote = true;
    else if (ch === '"' && inQuote) inQuote = false;
    else if (ch === "<" && !inQuote) depth += 1;
    else if (ch === ">" && !inQuote) depth -= 1;

    if (ch === "," && !inQuote && depth === 0) {
      out.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }

  if (buffer.trim()) out.push(buffer);
  return out;
}

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

function isHtmlContentType(contentType: string | null | undefined): boolean {
  const normalized = (contentType ?? "").toLowerCase();
  return normalized.includes("text/html") || normalized.includes("application/xhtml+xml");
}

function normalizeUrlForCompare(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

export function checkLinkCanonicalHeader(
  headers: Record<string, string>,
  htmlCanonical: string | null,
  finalUrl: string,
): Issue[] {
  const links = parseLinkHeader(headers["link"]);
  const canonicalLinks = links.filter((l) => l.rel.includes("canonical"));
  if (canonicalLinks.length === 0) return [];

  const issues: Issue[] = [];

  if (canonicalLinks.length > 1) {
    issues.push({
      code: "HEADER_LINK_CANONICAL_MULTIPLE",
      severity: "medium",
      message: `Response advertises ${canonicalLinks.length} Link rel="canonical" values — search engines will pick one or ignore them all.`,
      recommendation: "Serve exactly one canonical Link header per response.",
    });
  }

  const headerCanonicalRaw = canonicalLinks[0].url;
  let headerCanonical: string;
  try {
    headerCanonical = new URL(headerCanonicalRaw, finalUrl).toString();
  } catch {
    issues.push({
      code: "HEADER_LINK_CANONICAL_INVALID",
      severity: "medium",
      message: `Link rel="canonical" header contains an invalid URL: "${headerCanonicalRaw}".`,
      recommendation: "Serve an absolute, well-formed URL in the Link rel=\"canonical\" header.",
    });
    return issues;
  }

  if (htmlCanonical) {
    const htmlNormalized = normalizeUrlForCompare(htmlCanonical);
    if (htmlNormalized !== headerCanonical) {
      issues.push({
        code: "HEADER_LINK_CANONICAL_HTML_MISMATCH",
        severity: "medium",
        message: `Link rel="canonical" header (${headerCanonical}) disagrees with the HTML canonical (${htmlNormalized}).`,
        recommendation:
          "Make the HTTP Link rel=\"canonical\" header and the HTML <link rel=\"canonical\"> point to the same URL.",
      });
    }
  }

  return issues;
}

export function checkContentEncoding(
  headers: Record<string, string>,
  contentType: string | null,
): Issue[] {
  if (!isHtmlContentType(contentType)) return [];
  const encoding = headers["content-encoding"]?.toLowerCase() ?? "";
  if (encoding && encoding !== "identity") return [];
  return [
    {
      code: "HEADER_CONTENT_ENCODING_MISSING",
      severity: "low",
      message: "HTML response is served without compression (no gzip/br/zstd Content-Encoding).",
      recommendation:
        "Enable gzip or brotli compression on HTML responses to reduce transfer size and improve load time.",
    },
  ];
}

export function checkVaryAcceptEncoding(headers: Record<string, string>): Issue[] {
  const encoding = headers["content-encoding"]?.toLowerCase() ?? "";
  if (!encoding || encoding === "identity") return [];

  const vary = headers["vary"]?.toLowerCase() ?? "";
  const tokens = vary.split(",").map((t) => t.trim());
  if (tokens.includes("*") || tokens.includes("accept-encoding")) return [];

  return [
    {
      code: "HEADER_VARY_ACCEPT_ENCODING_MISSING",
      severity: "low",
      message: "Response is compressed but lacks `Vary: Accept-Encoding` — shared caches may serve the wrong encoding to clients.",
      recommendation:
        "Add `Vary: Accept-Encoding` (or `Vary: *`) to compressed responses so caches key on the request encoding.",
    },
  ];
}
