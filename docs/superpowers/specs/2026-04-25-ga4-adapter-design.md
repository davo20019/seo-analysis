# GA4 enrichment adapter — design

**Date:** 2026-04-25
**Status:** Approved, pending implementation plan

## Goal

Add a `--ga4` CLI flag that enriches each crawled page with Google Analytics 4 traffic metrics, mirroring the existing `--gsc` adapter. Reuses the service-account auth, URL-match, and `EnrichmentSource` plumbing already in `src/enrichment/`.

This closes the cheapest of the remaining Phase 2 items in `ROADMAP.md`: the auth, URL canonicalization, and report-rendering scaffolding all exist and are reusable for GA4 with no refactor.

## Non-goals

- No new wizard. The existing `--gsc-setup` already creates the service account; GA4 only needs an additional permission grant (documented in README).
- No GA4-specific event/conversion analysis in this iteration. Conversions are deferred until we have a client report that demonstrates the need.
- No generalization of the enrichment-report metadata shape (`report.gsc`, `report.ga4`). That refactor lands when we add the third source (likely DataForSEO backlinks).

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Metric set | Tight 4-field: `sessions`, `screenPageViews`, `totalUsers`, `engagementRate` |
| 2 | Property identifier | Auto-detect via GA4 Admin API; `--ga4-property properties/N` overrides |
| 3 | Priority-issue ranking | GSC-first, GA4-fallback (single `priorityIssues` list, `rankedBy` tags the source) |
| 4 | Setup UX | No `--ga4-setup` wizard; documented paragraph for the GA4 grant step |
| 5 | Type shape | Mirror GSC types (`Ga4PageMetrics`, `Ga4EnrichmentReport`); generalize later |

### Open-source backwards-compatibility constraint

The package is published to npm as `@davo20019/seo-audit`. Even pre-1.0, JSON shape changes can break downstream consumers parsing `summary.priorityIssues[]` or `report.gsc`. Therefore:

- All additions are namespaced (`page.metrics.ga4`, `report.ga4`) and additive — no existing field is renamed or removed.
- The one breaking shape change (priority entry now keyed by `rankedBy` + `rankValue` + `metrics`) keeps the deprecated GSC fields (`impressions`, `clicks`, `position`) populated in parallel with `@deprecated` JSDoc, for at least one minor cycle.
- README CHANGELOG documents the deprecation.

## Architecture

### Module layout

```
src/enrichment/
  google-auth.ts        (existing — unchanged)
  url-match.ts          (existing — unchanged)
  index.ts              (existing — EnrichmentSource<T>, applyEnrichment unchanged)
  gsc.ts                (existing — unchanged)
  ga4.ts                (NEW — Ga4EnrichmentSource, property auto-detection)

src/types.ts            (extend: Ga4PageMetrics, Ga4EnrichmentReport,
                         PageMetrics.ga4, SiteReport.ga4, AnalyzeOptions.ga4*,
                         PrioritySummaryEntry shape evolution)
src/analyzer.ts         (extend: runGa4Enrichment; buildPriorityIssues falls
                         back to GA4; trigger condition broadens)
src/cli.ts              (extend: --ga4* flag family; text formatter;
                         lift resolveGscCredentialOptions → resolveGoogleCredentialOptions)
src/report.ts           (extend: HTML "Analytics" section; per-page row column;
                         priority-issues table reads rankedBy)
README.md               (extend: --ga4 docs + GA4 grant paragraph + CHANGELOG)

tests/enrichment/
  ga4.test.ts           (NEW — fetch + property resolution + URL match)
```

### Module dependency direction

One-way: `cli → analyzer → enrichment/ga4 → enrichment/google-auth + url-match`. No new top-level dependencies. The GA4 Data API and Admin API are plain HTTPS calls; same posture as `gsc.ts` (no `googleapis` SDK).

## Data model (`src/types.ts`)

```ts
export interface Ga4PageMetrics {
  sessions: number;
  screenPageViews: number;
  totalUsers: number;
  engagementRate: number;   // 0..1, GA4's native scale
}

export interface PageMetrics {
  gsc?: GscPageMetrics;
  ga4?: Ga4PageMetrics;     // added
}

export interface Ga4EnrichmentReport {
  property: string;          // resolved "properties/123456789"
  startDate: string;         // YYYY-MM-DD
  endDate: string;           // YYYY-MM-DD
  totalRows: number;
  matchedPages: number;
  unmatchedRows: number;
  error: string | null;
}

export interface SiteReport {
  // ...
  gsc?: GscEnrichmentReport;
  ga4?: Ga4EnrichmentReport; // added
}

export interface AnalyzeOptions {
  // ...
  ga4?: boolean;
  ga4Property?: string;
  ga4Days?: number;
  ga4ServiceAccountKey?: string;       // inline JSON (env var / CI path)
  ga4ServiceAccountKeyFile?: string;   // path on disk
}
```

### `PrioritySummaryEntry` evolution

Old (current) shape:

```ts
{
  code: string;
  severity: Severity;
  url: string;
  impressions: number;   // GSC-specific
  clicks: number;        // GSC-specific
  position: number;      // GSC-specific
}
```

New shape — fixed-width, scales to N sources without growing optional columns:

```ts
export interface PrioritySummaryEntry {
  code: string;
  severity: Severity;
  url: string;
  rankedBy: "gsc" | "ga4";   // which source provided rankValue
  rankValue: number;         // the scalar used to sort (impressions or sessions)
  metrics: PageMetrics;      // full per-source data attached to the page

  /** @deprecated Read from `metrics.gsc.impressions`. Kept for backwards compat. */
  impressions?: number;
  /** @deprecated Read from `metrics.gsc.clicks`. */
  clicks?: number;
  /** @deprecated Read from `metrics.gsc.position`. */
  position?: number;
}
```

Adding source #3 adds one option to `rankedBy` and a namespace under `PageMetrics` — no new top-level optional fields on the entry.

## GA4 fetcher behavior (`src/enrichment/ga4.ts`)

### Class shape

```ts
export class Ga4EnrichmentSource implements EnrichmentSource<Ga4PageMetrics> {
  name = "ga4";
  lastResult: Ga4FetchResult | null = null;
  constructor(private opts: Ga4Options) {}
  async fetch(origin: string, _startUrl: string): Promise<Map<string, Ga4PageMetrics>> { ... }
}

export interface Ga4Options {
  property?: string;                      // "properties/123456789"
  days?: number;                          // default 90
  auth: GoogleAccessTokenProvider;        // same interface as GSC
  fetcher?: typeof fetch;                 // injectable for tests
}
```

### OAuth scope

`https://www.googleapis.com/auth/analytics.readonly` — covers both Admin API listing and Data API `runReport`.

### Property auto-resolution

When `opts.property` is not passed:

1. `GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries` — paginate via `pageToken` until exhausted; flatten to `[{ property: "properties/123", displayName }]`.
2. For each property, `GET https://analyticsadmin.googleapis.com/v1beta/properties/{ID}/dataStreams` — filter to `type === "WEB_DATA_STREAM"`, read `webStreamData.defaultUri`.
3. Match: hostname of `defaultUri` (case-insensitive, leading `www.` stripped) equals origin hostname (same normalization).
   - **Exactly one match** → use it.
   - **Multiple matches** → throw with the candidate list (`property` + `displayName` + `defaultUri`); user resolves by passing `--ga4-property`.
   - **Zero matches** → throw with the GA4 Property Access URL and the `--ga4-property` suggestion.
4. The token cache in `GoogleServiceAccountAuth` prevents JWT re-signing across the Admin and Data calls.

### Data API call

```
POST https://analyticsdata.googleapis.com/v1beta/{property}:runReport
```

Body:
```json
{
  "dateRanges": [{"startDate": "<ISO>", "endDate": "<ISO>"}],
  "dimensions": [{"name": "pageLocation"}],
  "metrics": [
    {"name": "sessions"},
    {"name": "screenPageViews"},
    {"name": "totalUsers"},
    {"name": "engagementRate"}
  ],
  "limit": 100000,
  "offset": <pagination cursor>,
  "keepEmptyRows": false
}
```

`pageLocation` returns the full URL (scheme + host + path + query), feeding directly into `canonicalizeForMatch` so matching is symmetrical with GSC's `page` dimension.

### Pagination

Loop on `offset += rows.length` until `rowCount` is exhausted or a hard cap of 100,000 total rows is reached (matches `MAX_TOTAL_ROWS` in `gsc.ts`). The Data API's `rowCount` field reports the total upfront.

### Error surface

Errors do **not** crash the audit. `runGa4Enrichment` in the analyzer wraps `fetch()` in try/catch and returns a `Ga4EnrichmentReport` with `error` populated, mirroring GSC's failure mode (the audit completes; the GA4 section shows the error string).

| HTTP | Likely cause | Message |
|------|--------------|---------|
| 401 | Token exchange or scope problem | "GA4 token exchange failed (401): {body}. Check service-account key and scope." |
| 403 | SA not granted Viewer on property | "GA4 Data API forbidden (403). Grant {sa-email} the Viewer role on {property} in GA4 Admin → Property Access Management." |
| 404 | Wrong property ID | "GA4 property not found (404). Pass --ga4-property properties/N or run --gsc-setup again to verify the SA email." |
| 429 | Rate limit | One retry with 2s backoff, then surface as-is. |
| other | — | Bubble up status + body. |

## Analyzer wiring (`src/analyzer.ts`)

### `runGa4Enrichment`

New orchestrator alongside `runGscEnrichment` (around `src/analyzer.ts:2194`):

```ts
async function runGa4Enrichment(args: {
  startUrl: string;
  pages: PageReport[];
  property?: string;
  days?: number;
  serviceAccount: ServiceAccountSource | null;
}): Promise<Ga4EnrichmentReport> {
  if (!args.serviceAccount) {
    return emptyGa4Report({
      error: "GA4 enrichment skipped: no service-account credentials. " +
             "Set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_APPLICATION_CREDENTIALS_JSON, " +
             "or pass --ga4-service-account-key-file. " +
             "Re-uses the same SA created by `seo-audit --gsc-setup`; " +
             "grant it Viewer on your GA4 property under Admin → Property Access Management.",
    });
  }
  const source = new Ga4EnrichmentSource({
    property: args.property,
    days: args.days,
    auth: new GoogleServiceAccountAuth(args.serviceAccount),
  });
  const origin = new URL(args.startUrl).origin;
  try {
    const data = await source.fetch(origin, args.startUrl);
    const { matched } = applyEnrichment(args.pages, source, data);
    const r = source.lastResult;
    return {
      property: r?.property ?? "",
      startDate: r?.startDate ?? "",
      endDate: r?.endDate ?? "",
      totalRows: r?.totalRows ?? 0,
      matchedPages: matched,
      unmatchedRows: Math.max(0, (r?.totalRows ?? 0) - matched),
      error: null,
    };
  } catch (err) {
    return emptyGa4Report({
      property: args.property ?? "",
      error: `GA4 enrichment failed: ${(err as Error).message}`,
    });
  }
}
```

### Call site

Mirrors GSC's wiring at `src/analyzer.ts:2648`:

```ts
let ga4;
if (rawOptions.ga4) {
  const serviceAccount: ServiceAccountSource | null = rawOptions.ga4ServiceAccountKey
    ? { json: rawOptions.ga4ServiceAccountKey }
    : rawOptions.ga4ServiceAccountKeyFile
      ? { filePath: rawOptions.ga4ServiceAccountKeyFile }
      : null;
  ga4 = await runGa4Enrichment({
    startUrl: normalizedStartUrl,
    pages,
    property: rawOptions.ga4Property,
    days: rawOptions.ga4Days,
    serviceAccount,
  });
}
```

### Credential resolution sharing

GSC and GA4 use the same service account. Lift `resolveGscCredentialOptions` (`src/cli.ts:585`) into a generic `resolveGoogleCredentialOptions(overrideFile?: string)` returning `{ key?: string, keyFile?: string }`. Both adapters call it; GSC keeps its existing flag override, GA4 gets `--ga4-service-account-key-file`. Pure refactor — no behavior change for `--gsc`.

### Priority-issue ranker

Replace `buildPriorityIssues` (`src/analyzer.ts:2247`):

```ts
function buildPriorityIssues(pages: PageReport[], limit = 10): PrioritySummaryEntry[] {
  const entries: PrioritySummaryEntry[] = [];
  for (const page of pages) {
    const m = page.metrics;
    if (!m) continue;

    let rankedBy: "gsc" | "ga4" | null = null;
    let rankValue = 0;
    if (m.gsc && m.gsc.impressions > 0) {
      rankedBy = "gsc";
      rankValue = m.gsc.impressions;
    } else if (m.ga4 && m.ga4.sessions > 0) {
      rankedBy = "ga4";
      rankValue = m.ga4.sessions;
    }
    if (!rankedBy) continue;

    for (const issue of page.issues) {
      if (issue.severity !== "high" && issue.severity !== "medium") continue;
      entries.push({
        code: issue.code,
        severity: issue.severity,
        url: page.finalUrl,
        rankedBy,
        rankValue,
        metrics: m,
        impressions: m.gsc?.impressions ?? 0,
        clicks: m.gsc?.clicks ?? 0,
        position: m.gsc?.position ?? 0,
      });
    }
  }
  entries.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1;
    return b.rankValue - a.rankValue;
  });
  return entries.slice(0, limit);
}
```

### Trigger condition

Update at `src/analyzer.ts:2670`:

```ts
const gscOk = gsc && !gsc.error;
const ga4Ok = ga4 && !ga4.error;
if (gscOk || ga4Ok) {
  summary.priorityIssues = buildPriorityIssues(pages);
}
```

## CLI surface (`src/cli.ts`)

### Flags

```
--ga4                              Enrich crawled pages with Google Analytics 4
                                   sessions / pageviews / users / engagement rate
                                   (service-account auth; reuses the SA from --gsc-setup)
--ga4-property <id>                Override property auto-detection (e.g. properties/123456789)
--ga4-days <n>                     Days of GA4 data to query. Default: 90
--ga4-service-account-key-file <path>
                                   Path to service-account JSON; defaults to
                                   GOOGLE_APPLICATION_CREDENTIALS
```

No `--ga4-setup` wizard. The README gets a "Adding GA4" subsection: paste the `client_email` from the SA into GA4 Admin → Property Access Management as Viewer, then run `seo-audit <url> --gsc --ga4`.

### Text formatter

- New `formatGa4Enrichment(ga4: Ga4EnrichmentReport): string[]` mirroring `formatGscEnrichment` (`src/cli.ts:690`) — error-or-summary line + matched/unmatched counts.
- Per-page line at `src/cli.ts:817` extends to insert a `ga4 sessions=… users=… eng=XX.X%` row when `page.metrics?.ga4` is set, immediately after the GSC line.
- `formatPriorityIssues` reads `entry.rankedBy`:
  - `"gsc"` → existing format `(impressions=… clicks=… pos=…)`
  - `"ga4"` → new format `(sessions=… users=… eng=…%)`

## HTML report (`src/report.ts`)

- New `<h2>Analytics</h2>` section rendered when `report.ga4` is present (parallels `<h2>Search Console</h2>` at `src/report.ts:86`).
- Per-page table column at `src/report.ts:235`: "Analytics" cell next to the existing Search Console cell, populated from `page.metrics?.ga4`.
- Priority-issues table reads `entry.rankedBy` and renders the appropriate metric column; a small badge ("via GSC" / "via GA4") tags each row.

## JSON output

Stays additive:
- `report.ga4` appears alongside `report.gsc`.
- `page.metrics.ga4` appears alongside `page.metrics.gsc`.
- Deprecated fields on `priorityIssues[]` retained.

## Tests (`tests/enrichment/ga4.test.ts`)

1. **`fetch()` happy path** — mocked `fetcher` returns Admin `accountSummaries`, `dataStreams` for two properties (one matches), then a Data API page with three rows. Assert: matched property, correct date range, three entries in metrics map.
2. **`fetch()` property override** — `opts.property` set; assert no Admin calls happen.
3. **`fetch()` ambiguous match** — two web data streams match origin; assert thrown error lists both candidates.
4. **`fetch()` no match** — assert error message contains the GA4 Property Access URL hint.
5. **`fetch()` 403** — Data API returns 403; assert error message names the SA email and Property Access Management.
6. **`fetch()` pagination** — first call returns 100k rows + `rowCount: 150000`; second call offset=100k returns 50k; assert merged into 150k entries.
7. **URL canonicalization regression** — GA4 reports `https://Example.com/page/?utm_source=x` and `https://example.com/page`; assert both fall under the same canonical key.
8. **Priority ranker fallback** — page with GA4 sessions=100, no GSC; assert priority entry has `rankedBy: "ga4"`, `rankValue: 100`. Page with GSC impressions=500 and GA4 sessions=50; assert `rankedBy: "gsc"`, `rankValue: 500`.
9. **Backwards-compat** — assert deprecated `impressions/clicks/position` fields remain populated for GSC-ranked entries.

No integration tests against real GA4 (no fixtures, no network in CI — same posture as the existing GSC tests).

## Risks & open questions

- **Auto-detection ambiguity in real properties.** Some clients have multiple GA4 properties pointing at the same domain (test/staging/prod streams). The "multiple matches → throw with candidates" path is the honest answer; users disambiguate via `--ga4-property`. We could add `--ga4-stream-id` as a tiebreaker later if this comes up often.
- **`engagementRate` sample-size effects.** On low-traffic pages, the value is noisy. Acceptable for an audit deliverable; not blocking.
- **No bundle-size delta.** Plain `fetch` + `crypto`; no SDK additions.
