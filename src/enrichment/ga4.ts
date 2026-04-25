import type { Ga4PageMetrics } from "../types.js";
import type { EnrichmentSource } from "./index.js";
import type { GoogleAccessTokenProvider } from "./google-auth.js";
import { canonicalizeForMatch, indexByCanonicalUrl } from "./url-match.js";

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const ADMIN_API_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_API_BASE = "https://analyticsdata.googleapis.com/v1beta";

export interface Ga4PropertyCandidate {
  property: string;
  displayName: string;
  webStreams: Array<{ defaultUri: string }>;
}

export type PickResult =
  | { kind: "ok"; property: string }
  | { kind: "ambiguous"; candidates: Ga4PropertyCandidate[] }
  | { kind: "none" };

export interface Ga4FetchResult {
  property: string;
  startDate: string;
  endDate: string;
  totalRows: number;
  metrics: Map<string, Ga4PageMetrics>;
}

export interface Ga4Options {
  property?: string;
  days?: number;
  auth: GoogleAccessTokenProvider;
  fetcher?: typeof fetch;
}

export class Ga4EnrichmentSource implements EnrichmentSource<Ga4PageMetrics> {
  name = "ga4";
  lastResult: Ga4FetchResult | null = null;

  constructor(private opts: Ga4Options) {}

  async fetch(origin: string, _startUrl: string): Promise<Map<string, Ga4PageMetrics>> {
    const fetcher = this.opts.fetcher ?? fetch;
    const accessToken = await this.opts.auth.getAccessToken([GA4_SCOPE]);

    const property = this.opts.property
      ? this.opts.property
      : await resolveProperty(origin, accessToken, fetcher);

    const days = Math.max(1, this.opts.days ?? 90);
    const endDate = formatDate(new Date());
    const startDate = formatDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

    // Stub data fetch — Task 5 fills this in.
    const runReportUrl = `${DATA_API_BASE}/${property}:runReport`;
    await fetcher(runReportUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "bounceRate" },
        ],
        limit: 10000,
      }),
    });
    const metrics = new Map<string, Ga4PageMetrics>();
    this.lastResult = { property, startDate, endDate, totalRows: 0, metrics };
    return metrics;
  }
}

async function resolveProperty(
  origin: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<string> {
  const candidates = await listAccessibleProperties(accessToken, fetcher);
  const result = pickBestGa4Property(origin, candidates);
  if (result.kind === "ok") return result.property;
  if (result.kind === "ambiguous") {
    const list = result.candidates
      .map((c) => `  - ${c.property} ("${c.displayName}")`)
      .join("\n");
    throw new Error(
      `Multiple GA4 properties match origin ${origin}:\n${list}\nPass --ga4-property properties/N to disambiguate.`,
    );
  }
  throw new Error(
    `No GA4 property matched origin ${origin}. Grant the service account Viewer access in GA4 Admin → Property Access Management, or pass --ga4-property properties/N.`,
  );
}

async function listAccessibleProperties(
  accessToken: string,
  fetcher: typeof fetch,
): Promise<Ga4PropertyCandidate[]> {
  const properties: Array<{ property: string; displayName: string }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${ADMIN_API_BASE}/accountSummaries`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetcher(url.toString(), {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GA4 Admin accountSummaries failed (${response.status}): ${text}`);
    }
    const body = (await response.json()) as {
      accountSummaries?: Array<{
        propertySummaries?: Array<{ property: string; displayName: string }>;
      }>;
      nextPageToken?: string;
    };
    for (const account of body.accountSummaries ?? []) {
      for (const summary of account.propertySummaries ?? []) {
        properties.push({ property: summary.property, displayName: summary.displayName });
      }
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  const candidateLists = await Promise.all(
    properties.map(async ({ property, displayName }) => {
      const streams = await listWebDataStreams(property, accessToken, fetcher);
      return streams.length > 0 ? { property, displayName, webStreams: streams } : null;
    })
  );
  return candidateLists.filter((c): c is Ga4PropertyCandidate => c !== null);
}

async function listWebDataStreams(
  property: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<Array<{ defaultUri: string }>> {
  const url = `${ADMIN_API_BASE}/${property}/dataStreams`;
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GA4 Admin dataStreams failed for ${property} (${response.status}): ${text}`);
  }
  const body = (await response.json()) as {
    dataStreams?: Array<{ type?: string; webStreamData?: { defaultUri?: string } }>;
  };
  const out: Array<{ defaultUri: string }> = [];
  for (const stream of body.dataStreams ?? []) {
    if (stream.type === "WEB_DATA_STREAM" && stream.webStreamData?.defaultUri) {
      out.push({ defaultUri: stream.webStreamData.defaultUri });
    }
  }
  return out;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function pickBestGa4Property(origin: string, candidates: Ga4PropertyCandidate[]): PickResult {
  let originHost: string;
  try {
    originHost = stripWww(new URL(origin).hostname.toLowerCase());
  } catch {
    return { kind: "none" };
  }

  const matches: Ga4PropertyCandidate[] = [];
  for (const c of candidates) {
    for (const stream of c.webStreams) {
      const streamHost = parseHost(stream.defaultUri);
      if (streamHost && stripWww(streamHost) === originHost) {
        matches.push(c);
        break;
      }
    }
  }

  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "ok", property: matches[0].property };
  return { kind: "ambiguous", candidates: matches };
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export { canonicalizeForMatch, indexByCanonicalUrl };
