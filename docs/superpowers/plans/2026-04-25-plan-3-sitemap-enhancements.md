# Plan 3 — Nested Sitemap Index + Lastmod Staleness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Parse sitemap entries (URL + lastmod) and sitemap-index entries (nested sitemap URLs) cleanly. Walk one level of sitemap indexes to enumerate all underlying URLs. Flag entries whose `lastmod` is stale (>12 months old).

**Architecture:** New `src/checks/sitemap-checks.ts` exports pure parsers (`parseSitemapXml`, `parseSitemapIndex`) and a staleness check. `analyzer.ts` already fetches `sitemap.xml`; this plan adds: detect-index → enumerate-children (capped at 50 nested URLs) → parse each as a regular sitemap. Lastmod staleness emits a per-page or summary-level issue.

**Tech Stack:** Same as prior plans. No new deps — XML parsed with the existing regex approach (sitemaps are regular enough that a real XML parser is overkill for v1).

**Scope exclusions:**
- Recursing more than one level deep — sitemap indexes containing other indexes is non-standard; we don't follow it. v2 if anyone asks.
- Validating XML schema rigorously — we extract what we need; malformed XML is just empty results.
- Per-URL lastmod issues attached to PageReport — for v1, lastmod staleness is reported as a single summary issue ("N URLs in sitemap have lastmod older than 12 months") to avoid issue-list noise.

---

## File Structure

New:
- `src/checks/sitemap-checks.ts`
- `tests/checks/sitemap-checks.test.ts`

Modified:
- `src/analyzer.ts` — replace the current `urlCount` regex (line 935) and `isIndex` regex (line 936) with the new parsers; add nested-index walking + lastmod staleness check.
- `README.md`

---

## Task 1: parseSitemapXml + parseSitemapIndex

**Files:**
- Create: `src/checks/sitemap-checks.ts`
- Create: `tests/checks/sitemap-checks.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/checks/sitemap-checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSitemapXml, parseSitemapIndex } from "../../src/checks/sitemap-checks.js";

describe("parseSitemapXml", () => {
  it("extracts loc + lastmod entries", () => {
    const xml = `
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://x.com/a</loc><lastmod>2025-01-01</lastmod></url>
        <url><loc>https://x.com/b</loc></url>
      </urlset>`;
    expect(parseSitemapXml(xml)).toEqual([
      { url: "https://x.com/a", lastmod: "2025-01-01" },
      { url: "https://x.com/b", lastmod: null },
    ]);
  });

  it("returns an empty array when there are no <url> entries", () => {
    expect(parseSitemapXml(`<urlset></urlset>`)).toEqual([]);
    expect(parseSitemapXml("")).toEqual([]);
  });

  it("ignores entries without a <loc>", () => {
    const xml = `<urlset><url><lastmod>2025-01-01</lastmod></url><url><loc>https://x.com/a</loc></url></urlset>`;
    expect(parseSitemapXml(xml)).toEqual([{ url: "https://x.com/a", lastmod: null }]);
  });
});

describe("parseSitemapIndex", () => {
  it("extracts nested sitemap URLs", () => {
    const xml = `
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://x.com/a.xml</loc></sitemap>
        <sitemap><loc>https://x.com/b.xml</loc></sitemap>
      </sitemapindex>`;
    expect(parseSitemapIndex(xml)).toEqual(["https://x.com/a.xml", "https://x.com/b.xml"]);
  });

  it("returns an empty array when no nested sitemaps", () => {
    expect(parseSitemapIndex(`<sitemapindex></sitemapindex>`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/sitemap-checks.test.ts`

- [ ] **Step 3: Implement**

Create `src/checks/sitemap-checks.ts`:

```ts
import type { Issue } from "../types.js";

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

const URL_RE = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
const SITEMAP_RE = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
const LOC_RE = /<loc>\s*([\s\S]*?)\s*<\/loc>/i;
const LASTMOD_RE = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i;

export function parseSitemapXml(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  if (!xml) return out;
  for (const match of xml.matchAll(URL_RE)) {
    const block = match[1];
    const loc = block.match(LOC_RE)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = block.match(LASTMOD_RE)?.[1]?.trim() ?? null;
    out.push({ url: loc, lastmod });
  }
  return out;
}

export function parseSitemapIndex(xml: string): string[] {
  const out: string[] = [];
  if (!xml) return out;
  for (const match of xml.matchAll(SITEMAP_RE)) {
    const loc = match[1].match(LOC_RE)?.[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/sitemap-checks.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Full suite**

Run: `npm test`

Expected: 71 total (66 prior + 5).

- [ ] **Step 6: Commit**

```bash
git add src/checks/sitemap-checks.ts tests/checks/sitemap-checks.test.ts
git commit -m "feat: add sitemap and sitemap-index XML parsers"
```

---

## Task 2: Lastmod staleness check

**Files:**
- Modify: `src/checks/sitemap-checks.ts`
- Modify: `tests/checks/sitemap-checks.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/checks/sitemap-checks.test.ts`:

```ts
import { checkSitemapLastmod } from "../../src/checks/sitemap-checks.js";

describe("checkSitemapLastmod", () => {
  const now = new Date("2026-04-25T00:00:00Z");

  it("flags entries with lastmod older than 12 months", () => {
    const issues = checkSitemapLastmod([
      { url: "https://x/a", lastmod: "2024-01-01" }, // > 12 months
      { url: "https://x/b", lastmod: "2026-01-01" }, // recent
    ], now);
    expect(issues.map((i) => i.code)).toContain("SITEMAP_LASTMOD_STALE");
    expect(issues[0].message).toContain("1");
  });

  it("ignores entries without lastmod (no false positives)", () => {
    expect(checkSitemapLastmod([{ url: "https://x/a", lastmod: null }], now)).toEqual([]);
  });

  it("returns no issue when nothing is stale", () => {
    expect(checkSitemapLastmod([
      { url: "https://x/a", lastmod: "2026-01-01" },
    ], now)).toEqual([]);
  });

  it("ignores unparseable lastmod values", () => {
    expect(checkSitemapLastmod([{ url: "https://x/a", lastmod: "not-a-date" }], now)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/sitemap-checks.test.ts`

- [ ] **Step 3: Implement**

Append to `src/checks/sitemap-checks.ts`:

```ts
const STALE_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000; // 12 months

export function checkSitemapLastmod(entries: SitemapEntry[], now: Date = new Date()): Issue[] {
  let staleCount = 0;
  for (const entry of entries) {
    if (!entry.lastmod) continue;
    const ts = Date.parse(entry.lastmod);
    if (Number.isNaN(ts)) continue;
    if (now.getTime() - ts > STALE_THRESHOLD_MS) staleCount++;
  }
  if (staleCount === 0) return [];
  return [{
    code: "SITEMAP_LASTMOD_STALE",
    severity: "low",
    message: `${staleCount} URL(s) in the sitemap have a lastmod older than 12 months — search engines may treat them as low-priority.`,
    recommendation: "Refresh lastmod values for URLs whose content has changed, or remove URLs that are no longer relevant.",
  }];
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/sitemap-checks.test.ts`

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/sitemap-checks.ts tests/checks/sitemap-checks.test.ts
git commit -m "feat: add sitemap lastmod staleness check"
```

---

## Task 3: Wire into analyzer with nested-index walking

**Files:**
- Modify: `src/analyzer.ts`

This is the integration. The current code in `analyzer.ts` lines 933–936 detects sitemap presence and counts `<loc>` matches. We replace those primitives with the new parsers and add nested-index walking (one level deep, capped).

- [ ] **Step 1: Orient**

Run: `grep -n "sitemap.xml\|inspectInfrastructure\|sitemapResult\|isIndex\|urlCount" src/analyzer.ts | head -25`

You're looking for:
- The function that fetches sitemap.xml (likely uses `fetchText`)
- The block that sets `sitemap.present`, `sitemap.urlCount`, `sitemap.isIndex` (around line 930–936)
- Where `inspectInfrastructure` returns its result

- [ ] **Step 2: Add imports**

At the top of `src/analyzer.ts`, with the other check imports:

```ts
import {
  parseSitemapXml,
  parseSitemapIndex,
  checkSitemapLastmod,
} from "./checks/sitemap-checks.js";
```

- [ ] **Step 3: Replace the existing parse logic + add nested walking**

Locate the block around lines 933–936 that handles a successful sitemap fetch. Replace:

```ts
sitemap.present = true;
sitemap.urlCount = (sitemapResult.value.text.match(/<loc>/gi) ?? []).length;
sitemap.isIndex = /<sitemapindex[\s>]/i.test(sitemapResult.value.text);
```

with logic that:
1. Detects whether it's an index using the existing regex (or a slightly cleaner `text.includes("<sitemapindex")`).
2. If NOT an index: parse with `parseSitemapXml` directly, set urlCount = entries.length, run `checkSitemapLastmod`.
3. If IT IS an index: parse with `parseSitemapIndex` to get nested sitemap URLs (cap at 50). For each (in parallel via `Promise.allSettled`, with `fetchText` and the existing fetch options), parse each child with `parseSitemapXml`, aggregate entries, sum urlCount.

Concrete implementation:

```ts
sitemap.present = true;
const xml = sitemapResult.value.text;
sitemap.isIndex = /<sitemapindex[\s>]/i.test(xml);

let allEntries: import("./checks/sitemap-checks.js").SitemapEntry[];

if (sitemap.isIndex) {
  const NESTED_CAP = 50;
  const nestedUrls = parseSitemapIndex(xml).slice(0, NESTED_CAP);
  const nestedResults = await Promise.allSettled(
    nestedUrls.map((u) => fetchText(u, fetchOptions))
  );
  allEntries = [];
  for (const r of nestedResults) {
    if (r.status === "fulfilled" && r.value.status >= 200 && r.value.status < 300) {
      allEntries.push(...parseSitemapXml(r.value.text));
    }
  }
  sitemap.urlCount = allEntries.length;
  sitemap.coverageLimited = parseSitemapIndex(xml).length > NESTED_CAP;
} else {
  allEntries = parseSitemapXml(xml);
  sitemap.urlCount = allEntries.length;
}

for (const issue of checkSitemapLastmod(allEntries)) {
  pushIssue(issues, issue);
}
```

The `fetchOptions` variable name must match what's already in scope in `inspectInfrastructure` — adjust accordingly. If the function doesn't have access to `fetchOptions`, thread it in or use a sane default object — investigate the surrounding context and pick the minimal-diff approach.

If a Cap of 50 isn't constant somewhere, define it as a `const NESTED_SITEMAP_CAP = 50;` near the top of the function.

- [ ] **Step 4: Build + tests + smoke**

Run: `npm run build`

Expected: clean. If TS errors mention missing types or fetchOptions, fix them; do not use `as any`.

Run: `npm test`

Expected: 75 total still pass.

Run: `npm run dev -- https://example.com --max-pages 2 2>&1 | tail -5`

Expected: works without crash. example.com has no sitemap so the path that doesn't trigger anything new is exercised.

- [ ] **Step 5: Commit**

```bash
git add src/analyzer.ts
git commit -m "feat: walk sitemap index nested sitemaps + emit lastmod staleness"
```

---

## Task 4: README

- [ ] **Step 1: Append bullets to "What It Checks"**

In `README.md`, under "What It Checks", add at the end of the list:

```
- nested sitemap-index resolution (walks one level of nested sitemaps, capped at 50 children)
- sitemap entries with `lastmod` older than 12 months
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: list new sitemap audit capabilities"
```

---

## Self-Review Notes

- **Spec coverage:** Nested sitemap walking (Task 3, capped at 50). Lastmod parsing (Task 1) and staleness check (Task 2). Both wired into analyzer (Task 3).
- **Placeholder scan:** All steps have concrete code. The implementer must inspect `inspectInfrastructure`'s scope to determine the exact `fetchOptions` reference.
- **Type consistency:** `SitemapEntry` defined once, reused. `Issue` from types.ts.
