import type { PageReport } from "../types.js";
import { canonicalizeForMatch } from "./url-match.js";

/**
 * Generic interface for URL-keyed enrichment sources (GSC, GA4, Ahrefs, etc.).
 * Each adapter fetches data for the crawl origin and returns a map keyed by
 * (canonicalized) URL. The runner attaches values to PageReport.metrics[name].
 */
export interface EnrichmentSource<T> {
  /** Namespace under which results are attached (e.g. "gsc", "ga4"). */
  name: string;
  /** Fetch URL-keyed metrics for the given origin. May throw. */
  fetch(origin: string, startUrl: string): Promise<Map<string, T>>;
}

/** Attach metrics from a source onto each matching PageReport in place. */
export function applyEnrichment<T>(
  pages: PageReport[],
  source: EnrichmentSource<T>,
  data: Map<string, T>,
): { matched: number } {
  let matched = 0;
  for (const page of pages) {
    const key = canonicalizeForMatch(page.finalUrl);
    const value = data.get(key);
    if (value === undefined) continue;
    page.metrics ??= {};
    (page.metrics as Record<string, unknown>)[source.name] = value;
    matched += 1;
  }
  return { matched };
}
