/**
 * Canonicalize a URL for matching crawled pages against external systems
 * (GSC, GA4, etc.) that may report URLs with subtly different formatting.
 *
 * Rules:
 *  - lowercase scheme + host
 *  - drop default ports (80/443)
 *  - drop fragments
 *  - sort query parameters; drop common tracking params (utm_*, gclid, fbclid)
 *  - keep trailing slash exactly as-is on non-root paths (GSC preserves it)
 */
export function canonicalizeForMatch(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }

  parsed.hash = "";
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  if (parsed.search) {
    const params = [...parsed.searchParams.entries()]
      .filter(([key]) => !isTrackingParam(key))
      .sort(([a], [b]) => a.localeCompare(b));
    parsed.search = "";
    for (const [key, value] of params) parsed.searchParams.append(key, value);
  }

  return parsed.toString();
}

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.startsWith("utm_") ||
    lower === "gclid" ||
    lower === "fbclid" ||
    lower === "mc_cid" ||
    lower === "mc_eid"
  );
}

/**
 * Build a lookup map keyed by canonicalized URL. Both the canonical form and
 * the trailing-slash-toggled variant are inserted, since GSC sometimes reports
 * `/path` and the crawl reports `/path/` (or vice versa).
 */
export function indexByCanonicalUrl<T>(rows: Array<[string, T]>): Map<string, T> {
  const map = new Map<string, T>();
  for (const [url, value] of rows) {
    const canonical = canonicalizeForMatch(url);
    map.set(canonical, value);

    const toggled = toggleTrailingSlash(canonical);
    if (toggled && !map.has(toggled)) {
      map.set(toggled, value);
    }
  }
  return map;
}

export function toggleTrailingSlash(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.pathname === "/") return null;
  parsed.pathname = parsed.pathname.endsWith("/")
    ? parsed.pathname.slice(0, -1)
    : `${parsed.pathname}/`;
  return parsed.toString();
}
