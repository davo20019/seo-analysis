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
  /** Injectable delay for testing the 429 retry without real wait. Default: setTimeout-backed 2s. */
  delayMs?: (ms: number) => Promise<void>;
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

    const delay = this.opts.delayMs ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const rows = await queryAllRows(property, startDate, endDate, accessToken, fetcher, delay);
    const metrics = buildMetricsMap(rows);
    this.lastResult = { property, startDate, endDate, totalRows: rows.length, metrics };
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

interface Ga4Row {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

async function queryAllRows(
  property: string,
  startDate: string,
  endDate: string,
  accessToken: string,
  fetcher: typeof fetch,
  delay: (ms: number) => Promise<void>,
): Promise<Ga4Row[]> {
  const PAGE_SIZE = 100_000;
  const MAX_TOTAL_ROWS = 100_000_000;
  const allRows: Ga4Row[] = [];
  let offset = 0;
  let total = Infinity;

  while (allRows.length < total && allRows.length < MAX_TOTAL_ROWS) {
    const url = `${DATA_API_BASE}/${property}:runReport`;
    const requestInit: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pageLocation" }],
        metrics: [
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "totalUsers" },
          { name: "engagementRate" },
        ],
        limit: PAGE_SIZE,
        offset,
        keepEmptyRows: false,
      }),
    };

    let response = await fetcher(url, requestInit);
    if (response.status === 429) {
      await delay(2000);
      response = await fetcher(url, requestInit);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw mapDataApiError(response.status, text, property);
    }
    const body = (await response.json()) as { rows?: Ga4Row[]; rowCount?: number };
    const rows = body.rows ?? [];
    allRows.push(...rows);
    if (typeof body.rowCount === "number") total = body.rowCount;
    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }
  return allRows;
}

function buildMetricsMap(rows: Ga4Row[]): Map<string, Ga4PageMetrics> {
  const entries: Array<[string, Ga4PageMetrics]> = [];
  for (const row of rows) {
    const url = row.dimensionValues?.[0]?.value;
    if (!url) continue;
    const m = row.metricValues ?? [];
    entries.push([
      url,
      {
        sessions: parseNum(m[0]?.value),
        screenPageViews: parseNum(m[1]?.value),
        totalUsers: parseNum(m[2]?.value),
        engagementRate: parseNum(m[3]?.value),
      },
    ]);
  }
  return indexByCanonicalUrl(entries);
}

function parseNum(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapDataApiError(status: number, body: string, property: string): Error {
  if (status === 401) {
    return new Error(
      `GA4 token exchange failed (401). Likely causes: invalid or expired service-account key, or the token request was denied at Google's OAuth2 endpoint. Body: ${body}`,
    );
  }
  if (status === 403) {
    return new Error(
      `GA4 Data API forbidden (403). Grant the service-account email the Viewer role on ${property} in GA4 Admin → Property Access Management. Body: ${body}`,
    );
  }
  if (status === 404) {
    return new Error(
      `GA4 property not found (404) for ${property}. Pass --ga4-property properties/N or verify the SA email has access. Body: ${body}`,
    );
  }
  return new Error(`GA4 Data API failed (${status}) for ${property}: ${body}`);
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
