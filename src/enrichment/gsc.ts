import type { GscPageMetrics } from "../types.js";
import type { EnrichmentSource } from "./index.js";
import type { GoogleAccessTokenProvider } from "./google-auth.js";
import { canonicalizeForMatch, indexByCanonicalUrl } from "./url-match.js";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GSC_API_BASE = "https://searchconsole.googleapis.com/v1";

interface SiteEntry {
  siteUrl: string;
  permissionLevel?: string;
}

interface SearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export interface GscFetchResult {
  property: string;
  startDate: string;
  endDate: string;
  totalRows: number;
  metrics: Map<string, GscPageMetrics>;
}

export interface GscOptions {
  property?: string;
  days?: number;
  /**
   * Anything that produces a Google access token for the GSC scope. Today the
   * CLI passes a `GoogleServiceAccountAuth`; a future SaaS will pass an OAuth
   * refresh-token-backed provider without touching this adapter.
   */
  auth: GoogleAccessTokenProvider;
  fetcher?: typeof fetch;
}

export class GscEnrichmentSource implements EnrichmentSource<GscPageMetrics> {
  name = "gsc";
  lastResult: GscFetchResult | null = null;

  constructor(private opts: GscOptions) {}

  async fetch(origin: string, _startUrl: string): Promise<Map<string, GscPageMetrics>> {
    const fetcher = this.opts.fetcher ?? fetch;
    const accessToken = await this.opts.auth.getAccessToken([GSC_SCOPE]);

    const property = this.opts.property
      ? this.opts.property
      : await resolveProperty(origin, accessToken, fetcher);

    if (!property) {
      throw new Error(
        `No accessible GSC property matched origin ${origin}. Pass --gsc-property or grant the service account access in Search Console.`,
      );
    }

    const days = Math.max(1, this.opts.days ?? 90);
    const endDate = formatDate(new Date());
    const startDate = formatDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

    const rows = await queryAllPages(property, startDate, endDate, accessToken, fetcher);
    const metrics = buildMetricsMap(rows);
    this.lastResult = {
      property,
      startDate,
      endDate,
      totalRows: rows.length,
      metrics,
    };
    return metrics;
  }
}

async function resolveProperty(
  origin: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  const response = await fetcher(`${GSC_API_BASE}/sites`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GSC sites.list failed (${response.status}): ${text}`);
  }
  const body = (await response.json()) as { siteEntry?: SiteEntry[] };
  const entries = body.siteEntry ?? [];

  return pickBestProperty(origin, entries);
}

export function pickBestProperty(origin: string, entries: SiteEntry[]): string | null {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }

  const accessible = entries.filter(
    (entry) => (entry.permissionLevel ?? "").toLowerCase() !== "siteunverifieduser",
  );

  for (const entry of accessible) {
    if (entry.siteUrl.startsWith("sc-domain:")) {
      const domain = entry.siteUrl.slice("sc-domain:".length).toLowerCase();
      if (host === domain || host.endsWith(`.${domain}`)) {
        return entry.siteUrl;
      }
    }
  }

  let bestPrefix: { siteUrl: string; length: number } | null = null;
  const normalizedOrigin = origin.replace(/\/+$/, "") + "/";
  for (const entry of accessible) {
    if (entry.siteUrl.startsWith("sc-domain:")) continue;
    const prefix = entry.siteUrl.endsWith("/") ? entry.siteUrl : `${entry.siteUrl}/`;
    if (normalizedOrigin === prefix || normalizedOrigin.startsWith(prefix)) {
      if (!bestPrefix || prefix.length > bestPrefix.length) {
        bestPrefix = { siteUrl: entry.siteUrl, length: prefix.length };
      }
    }
  }
  return bestPrefix?.siteUrl ?? null;
}

async function queryAllPages(
  property: string,
  startDate: string,
  endDate: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<SearchAnalyticsRow[]> {
  const PAGE_SIZE = 25_000;
  const MAX_TOTAL_ROWS = 100_000;
  const allRows: SearchAnalyticsRow[] = [];
  let startRow = 0;

  while (allRows.length < MAX_TOTAL_ROWS) {
    const url = `${GSC_API_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
    const response = await fetcher(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: PAGE_SIZE,
        startRow,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GSC searchAnalytics.query failed (${response.status}): ${text}`);
    }
    const body = (await response.json()) as { rows?: SearchAnalyticsRow[] };
    const rows = body.rows ?? [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    startRow += rows.length;
  }

  return allRows;
}

function buildMetricsMap(rows: SearchAnalyticsRow[]): Map<string, GscPageMetrics> {
  const entries: Array<[string, GscPageMetrics]> = [];
  for (const row of rows) {
    const url = row.keys?.[0];
    if (!url) continue;
    entries.push([
      url,
      {
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr: row.ctr ?? 0,
        position: row.position ?? 0,
      },
    ]);
  }
  return indexByCanonicalUrl(entries);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export { canonicalizeForMatch };
