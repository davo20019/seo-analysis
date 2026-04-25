# Plan 4 — Core Web Vitals from CrUX API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add an opt-in `--crux` flag that queries Google's Chrome UX Report API for real-user Core Web Vitals (LCP, INP, CLS) per origin and emits issues when those metrics fail Google's "Good" thresholds. Provides field data complementing Lighthouse's lab data.

**Architecture:** New `src/crux.ts` exports `queryCrux(origin, apiKey)` (network) plus pure `parseCruxResponse` and `checkCruxMetrics` functions. CLI exposes `--crux` flag + reads `CRUX_API_KEY` env var. `analyzer.ts` makes one query per origin (not per page — CrUX aggregates by origin) and emits issues at the site level.

**Tech Stack:** Same as prior plans. Uses native `fetch`. No new deps.

**Scope exclusions:**
- Per-URL CrUX queries (CrUX supports both origin-level and URL-level; v1 uses origin-only — cheaper, still useful).
- Form factor breakdown (mobile vs desktop) — v1 queries the default (all form factors aggregated).
- Historical data — v1 queries the latest 28-day rolling window.
- Caching CrUX responses across runs — every run is a fresh query.

---

## File Structure

New:
- `src/crux.ts`
- `tests/crux.test.ts`

Modified:
- `src/types.ts` — add `crux?: boolean` to `AnalyzeOptions`.
- `src/analyzer.ts` — call `queryCrux` once per crawl when `--crux` is on; push issues onto `infrastructure.issues`.
- `src/cli.ts` — add `--crux` flag and env-var read.
- `README.md`.

---

## Task 1: parseCruxResponse + checkCruxMetrics (pure)

**Files:**
- Create: `src/crux.ts`
- Create: `tests/crux.test.ts`

CrUX response shape (simplified):
```json
{
  "record": {
    "key": { "origin": "https://example.com" },
    "metrics": {
      "largest_contentful_paint": { "percentiles": { "p75": 2400 } },
      "interaction_to_next_paint": { "percentiles": { "p75": 180 } },
      "cumulative_layout_shift": { "percentiles": { "p75": "0.05" } }
    }
  }
}
```

Note: CLS is returned as a string (e.g. `"0.05"`), not a number. Parse accordingly.

- [ ] **Step 1: Failing tests**

Create `tests/crux.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCruxResponse, checkCruxMetrics } from "../src/crux.js";

describe("parseCruxResponse", () => {
  it("extracts p75 metrics", () => {
    const result = parseCruxResponse({
      record: {
        key: { origin: "https://x" },
        metrics: {
          largest_contentful_paint: { percentiles: { p75: 2400 } },
          interaction_to_next_paint: { percentiles: { p75: 180 } },
          cumulative_layout_shift: { percentiles: { p75: "0.05" } },
        },
      },
    });
    expect(result).toEqual({ lcpMs: 2400, inpMs: 180, cls: 0.05 });
  });

  it("returns nulls for missing metrics", () => {
    expect(parseCruxResponse({ record: { metrics: {} } })).toEqual({
      lcpMs: null, inpMs: null, cls: null,
    });
  });

  it("returns all-null for an empty/invalid response", () => {
    expect(parseCruxResponse({})).toEqual({ lcpMs: null, inpMs: null, cls: null });
    expect(parseCruxResponse(null)).toEqual({ lcpMs: null, inpMs: null, cls: null });
  });
});

describe("checkCruxMetrics", () => {
  it("flags LCP poor (>4000ms)", () => {
    const issues = checkCruxMetrics({ lcpMs: 4500, inpMs: 100, cls: 0.05 });
    expect(issues.find((i) => i.code === "CRUX_LCP_POOR")).toBeDefined();
  });

  it("flags LCP needs-improvement (>2500ms, <=4000ms)", () => {
    const issues = checkCruxMetrics({ lcpMs: 3000, inpMs: 100, cls: 0.05 });
    expect(issues.find((i) => i.code === "CRUX_LCP_NEEDS_IMPROVEMENT")).toBeDefined();
  });

  it("flags INP and CLS thresholds", () => {
    const issues = checkCruxMetrics({ lcpMs: 1000, inpMs: 600, cls: 0.3 });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("CRUX_INP_POOR");
    expect(codes).toContain("CRUX_CLS_POOR");
  });

  it("returns empty when all metrics are good", () => {
    expect(checkCruxMetrics({ lcpMs: 2000, inpMs: 100, cls: 0.05 })).toEqual([]);
  });

  it("returns empty when metrics are null", () => {
    expect(checkCruxMetrics({ lcpMs: null, inpMs: null, cls: null })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/crux.test.ts`

- [ ] **Step 3: Implement**

Create `src/crux.ts`:

```ts
import type { Issue } from "./types.js";

export interface CruxMetrics {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
}

export function parseCruxResponse(raw: unknown): CruxMetrics {
  const record = (raw as { record?: unknown })?.record as
    | { metrics?: Record<string, { percentiles?: { p75?: unknown } }> }
    | undefined;
  const m = record?.metrics ?? {};

  const num = (v: unknown): number | null => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  return {
    lcpMs: num(m.largest_contentful_paint?.percentiles?.p75),
    inpMs: num(m.interaction_to_next_paint?.percentiles?.p75),
    cls: num(m.cumulative_layout_shift?.percentiles?.p75),
  };
}

export function checkCruxMetrics(metrics: CruxMetrics): Issue[] {
  const issues: Issue[] = [];

  if (metrics.lcpMs !== null) {
    if (metrics.lcpMs > 4000) {
      issues.push({
        code: "CRUX_LCP_POOR",
        severity: "high",
        message: `Real-user LCP (p75) is ${Math.round(metrics.lcpMs)}ms — Google's "Poor" threshold is 4000ms.`,
        recommendation: "Optimize the largest contentful paint: preload the hero image, reduce render-blocking JS/CSS, improve server TTFB.",
      });
    } else if (metrics.lcpMs > 2500) {
      issues.push({
        code: "CRUX_LCP_NEEDS_IMPROVEMENT",
        severity: "medium",
        message: `Real-user LCP (p75) is ${Math.round(metrics.lcpMs)}ms — Google's "Good" threshold is 2500ms.`,
        recommendation: "Improve LCP toward 2500ms: faster server response, image optimization, fewer render-blocking resources.",
      });
    }
  }

  if (metrics.inpMs !== null) {
    if (metrics.inpMs > 500) {
      issues.push({
        code: "CRUX_INP_POOR",
        severity: "high",
        message: `Real-user INP (p75) is ${Math.round(metrics.inpMs)}ms — Google's "Poor" threshold is 500ms.`,
        recommendation: "Reduce JS execution time on interaction: break up long tasks, defer non-critical scripts, avoid expensive event handlers.",
      });
    } else if (metrics.inpMs > 200) {
      issues.push({
        code: "CRUX_INP_NEEDS_IMPROVEMENT",
        severity: "medium",
        message: `Real-user INP (p75) is ${Math.round(metrics.inpMs)}ms — Google's "Good" threshold is 200ms.`,
        recommendation: "Reduce input delay: profile long tasks during interaction, defer third-party scripts.",
      });
    }
  }

  if (metrics.cls !== null) {
    if (metrics.cls > 0.25) {
      issues.push({
        code: "CRUX_CLS_POOR",
        severity: "high",
        message: `Real-user CLS (p75) is ${metrics.cls.toFixed(3)} — Google's "Poor" threshold is 0.25.`,
        recommendation: "Reserve space for images/iframes (width+height attrs), avoid inserting content above existing layout, use font-display: optional.",
      });
    } else if (metrics.cls > 0.1) {
      issues.push({
        code: "CRUX_CLS_NEEDS_IMPROVEMENT",
        severity: "medium",
        message: `Real-user CLS (p75) is ${metrics.cls.toFixed(3)} — Google's "Good" threshold is 0.10.`,
        recommendation: "Reduce layout shifts: explicit image dimensions, no late-loaded ads in flow content, stable web fonts.",
      });
    }
  }

  return issues;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/crux.test.ts`

Expected: 8 tests pass.

- [ ] **Step 5: Full suite + build**

Run: `npm test`

Expected: 83 total.

Run: `npm run build`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/crux.ts tests/crux.test.ts
git commit -m "feat: add CrUX response parser and metrics threshold check"
```

---

## Task 2: queryCrux network function

**Files:**
- Modify: `src/crux.ts`
- Modify: `tests/crux.test.ts`

- [ ] **Step 1: Failing test (mocked fetch)**

Append to `tests/crux.test.ts`:

```ts
import { queryCrux } from "../src/crux.js";

describe("queryCrux", () => {
  it("calls the CrUX API with the provided origin and returns parsed metrics", async () => {
    const fakeFetch: typeof fetch = async (input, _init) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toContain("chromeuxreport.googleapis.com");
      expect(url).toContain("key=test-key");
      return new Response(
        JSON.stringify({
          record: {
            key: { origin: "https://x" },
            metrics: {
              largest_contentful_paint: { percentiles: { p75: 2200 } },
              cumulative_layout_shift: { percentiles: { p75: "0.05" } },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const result = await queryCrux("https://x", "test-key", fakeFetch);
    expect(result).toEqual({ lcpMs: 2200, inpMs: null, cls: 0.05 });
  });

  it("returns null metrics on a 404 (no CrUX data for origin)", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
    const result = await queryCrux("https://nodata", "k", fakeFetch);
    expect(result).toEqual({ lcpMs: null, inpMs: null, cls: null });
  });

  it("throws on non-200 non-404 errors", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("rate limited", { status: 429 });
    await expect(queryCrux("https://x", "k", fakeFetch)).rejects.toThrow(/429/);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/crux.test.ts`

Expected: 8 prior pass + 3 new fail.

- [ ] **Step 3: Implement**

Append to `src/crux.ts`:

```ts
const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

export async function queryCrux(
  origin: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CruxMetrics> {
  const url = `${CRUX_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin }),
  });

  if (response.status === 404) {
    return { lcpMs: null, inpMs: null, cls: null };
  }

  if (!response.ok) {
    throw new Error(`CrUX API returned ${response.status}`);
  }

  const json = await response.json();
  return parseCruxResponse(json);
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/crux.test.ts`

Expected: 11 pass.

- [ ] **Step 5: Full + build**

Run: `npm test && npm run build`

Expected: 86 total, clean build.

- [ ] **Step 6: Commit**

```bash
git add src/crux.ts tests/crux.test.ts
git commit -m "feat: add queryCrux network function"
```

---

## Task 3: CLI flag + analyzer integration

**Files:**
- Modify: `src/types.ts`
- Modify: `src/cli.ts`
- Modify: `src/analyzer.ts`

- [ ] **Step 1: Extend AnalyzeOptions**

In `src/types.ts`, add to `AnalyzeOptions`:

```ts
crux?: boolean;
cruxApiKey?: string;
```

- [ ] **Step 2: CLI flag + env var**

In `src/cli.ts`:

a) Add to `CliOptions` interface:

```ts
crux: boolean;
```

b) Initialize default in `parseArgs`:

```ts
crux: false,
```

c) Add parsing case:

```ts
if (arg === "--crux") {
  options.crux = true;
  continue;
}
```

d) Add to help text:

```
  --crux                     Query Google's CrUX API for real-user Core Web Vitals (requires CRUX_API_KEY env var)
```

e) When passing options to `analyzeSite`, include:

```ts
crux: options.crux,
...(process.env.CRUX_API_KEY ? { cruxApiKey: process.env.CRUX_API_KEY } : {}),
```

- [ ] **Step 3: Wire into analyzer**

In `src/analyzer.ts`:

a) Add import at top with other check imports:

```ts
import { queryCrux, checkCruxMetrics } from "./crux.js";
```

b) Inside `analyzeSite`, after `inspectInfrastructure` resolves and before/around the start-page fetch, add the CrUX query (one call per origin):

```ts
if (rawOptions.crux && rawOptions.cruxApiKey) {
  try {
    const origin = new URL(normalizedStartUrl).origin;
    const metrics = await queryCrux(origin, rawOptions.cruxApiKey);
    for (const issue of checkCruxMetrics(metrics)) {
      pushIssue(infrastructureResult.report.issues, issue);
    }
  } catch (err) {
    pushIssue(
      infrastructureResult.report.issues,
      makeIssue(
        "CRUX_QUERY_FAILED",
        "low",
        `CrUX API query failed: ${(err as Error).message}`,
        "Verify the CRUX_API_KEY env var is valid and that the origin has CrUX field data.",
      ),
    );
  }
}
```

The variable names (`infrastructureResult`, `normalizedStartUrl`, `pushIssue`, `makeIssue`) must match what's in scope inside `analyzeSite`. Adjust to actual names.

If `--crux` is on but no `cruxApiKey` is set, emit:

```ts
} else if (rawOptions.crux && !rawOptions.cruxApiKey) {
  pushIssue(
    infrastructureResult.report.issues,
    makeIssue(
      "CRUX_API_KEY_MISSING",
      "medium",
      "--crux was passed but CRUX_API_KEY env var is not set — skipping field-data audit.",
      "Set CRUX_API_KEY in your environment to a valid Google API key with CrUX access.",
    ),
  );
}
```

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: clean.

- [ ] **Step 5: Tests**

Run: `npm test`

Expected: 86 still pass.

- [ ] **Step 6: Smoke (without --crux)**

Run: `npm run dev -- https://example.com --max-pages 2`

Expected: works as before. No CrUX call.

- [ ] **Step 7: Smoke (with --crux but no key)**

Run: `npm run dev -- https://example.com --crux --max-pages 2 2>&1 | tail -10`

Expected: report includes `CRUX_API_KEY_MISSING` infrastructure issue. No crash.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/cli.ts src/analyzer.ts
git commit -m "feat: add --crux CLI flag and origin-level CrUX integration"
```

---

## Task 4: README + final verification

- [ ] **Step 1: Append to README "What It Checks"**

```
- real-user Core Web Vitals from Google CrUX (LCP/INP/CLS p75) when `--crux` is enabled and `CRUX_API_KEY` is set
```

- [ ] **Step 2: Add CrUX example to "Useful Options"**

After the `--render` example, add:

````markdown
```bash
# Query Google's CrUX API for real-user Core Web Vitals (requires CRUX_API_KEY env var)
CRUX_API_KEY=your-google-api-key npm run dev -- https://example.com --crux --max-pages 5
```
````

- [ ] **Step 3: Verify**

Run: `npm test && npm run build`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document --crux flag and CrUX field-data check"
```

- [ ] **Step 5: Branch summary**

Run: `git log --oneline feature/phase1-test-harness ^main | wc -l`

Expected: total commit count for the branch.

---

## Self-Review Notes

- **Spec coverage:** parseCruxResponse + checkCruxMetrics tested in pure isolation. queryCrux tested via injected fake fetch. CLI flag + env var path. Origin-level query (per Phase 1 roadmap). Threshold issues for LCP, INP, CLS at both Needs-Improvement and Poor levels.
- **Placeholder scan:** All steps have concrete code. Variable names in Task 3 Step 3b need to be matched to whatever `analyzeSite` exposes locally — implementer must verify.
- **Type consistency:** `CruxMetrics` defined once. `Issue` from types.ts.
