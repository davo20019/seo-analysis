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

  async fetch(_origin: string, _startUrl: string): Promise<Map<string, Ga4PageMetrics>> {
    throw new Error("not implemented");
  }
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
