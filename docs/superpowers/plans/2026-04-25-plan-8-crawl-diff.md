# Plan 8 — Crawl Diffing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add a `diff` subcommand that compares two SiteReport JSON files and emits a regression-aware report showing new issues, resolved issues, persistent issues, page changes, and severity-count deltas. Turns one-shot audits into ongoing engagements: "What changed since last week?"

**Architecture:** New `src/diff.ts` exports pure `diffSiteReports(oldReport, newReport): SiteReportDiff` and `renderDiffText(diff): string` and `renderDiffJson(diff): string`. CLI gets a new subcommand: `npm run dev -- diff <old.json> <new.json> [--json] [--output <file>] [--fail-on <severity>]`. The first positional arg `diff` activates diff mode and bypasses normal URL crawling.

**Tech Stack:** Same as prior plans. No new deps.

**Scope exclusions:**
- HTML diff output — v1 ships text + JSON. HTML diff (visualizing changes) is a follow-up if asked.
- Per-page detail diffs (every check field) — v1 focuses on issue codes + counts + page set changes.
- Three-way merge / rebase — out of scope.

---

## File Structure

New:
- `src/diff.ts` — `diffSiteReports`, `renderDiffText`, `renderDiffJson`, types `SiteReportDiff`, `IssueDelta`, `PageDelta`.
- `tests/diff.test.ts`.

Modified:
- `src/cli.ts` — add `diff` subcommand handling at the top of `main()` (before URL parsing). Add `--fail-on <severity>` flag.
- `README.md`.

---

## Task 1: diffSiteReports + types + tests

**Files:**
- Create: `src/diff.ts`
- Create: `tests/diff.test.ts`

The diff structure:

```ts
interface SiteReportDiff {
  oldUrl: string;
  newUrl: string;
  pageSet: { added: string[]; removed: string[]; common: number };
  issuesByCode: {
    new: IssueDelta[];      // codes that appear in new but not old
    resolved: IssueDelta[]; // codes that appeared in old but not new
    increased: IssueDelta[];// codes whose count went up
    decreased: IssueDelta[];// codes whose count went down
    unchanged: IssueDelta[];// codes whose count is identical
  };
  severityDelta: { high: number; medium: number; low: number }; // newCount - oldCount
  statusChanges: PageDelta[]; // pages where final HTTP status changed
}

interface IssueDelta { code: string; oldCount: number; newCount: number; }
interface PageDelta { url: string; oldStatus: number | null; newStatus: number | null; }
```

- [ ] **Step 1: Failing tests**

Create `tests/diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffSiteReports } from "../src/diff.js";
import type { SiteReport } from "../src/types.js";

function fixture(overrides: Partial<SiteReport>): SiteReport {
  const base: SiteReport = {
    startUrl: "https://x/",
    infrastructure: {
      robotsTxt: { url: "", present: true, status: 200, sitemaps: [], blocksAllCrawlers: false },
      sitemap: { url: "", present: true, status: 200, urlCount: 0, knownUrls: 0, coverageLimited: false, isIndex: false },
      llmsTxt: { url: "", present: false, status: 404, isEmpty: false },
      issues: [],
    },
    summary: {
      crawledPages: 0,
      issueTotals: { high: 0, medium: 0, low: 0 },
      pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 0,
      internalLinksChecked: 0, pagesWithBrokenInternalLinks: 0, pagesWithRedirectingInternalLinks: 0,
      pagesWithAnchorTextIssues: 0, pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
      pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
      topIssues: [], duplicateTitles: [], duplicateMetaDescriptions: [],
    },
    pages: [], lighthouse: [],
  };
  return { ...base, ...overrides };
}

function page(url: string, status: number, codes: string[] = []) {
  return {
    url, finalUrl: url, status, contentType: "text/html",
    redirectChain: [],
    checks: {
      title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0,
      canonical: null, htmlLang: null, expectedLocale: null, hreflang: [],
      robotsMeta: null, h1s: [], wordCount: 0,
      imagesTotal: 0, imagesMissingAlt: 0,
      internalLinks: 0, incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0, internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0, inSitemap: true,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: [], bodyText: null,
    },
    issues: codes.map((code) => ({ code, severity: "medium" as const, message: "", recommendation: "" })),
    discoveredLinks: [],
  };
}

describe("diffSiteReports", () => {
  it("detects added and removed pages", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200), page("https://x/b", 200)] });
    const newR = fixture({ pages: [page("https://x/a", 200), page("https://x/c", 200)] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.pageSet.added).toEqual(["https://x/c"]);
    expect(diff.pageSet.removed).toEqual(["https://x/b"]);
    expect(diff.pageSet.common).toBe(1);
  });

  it("detects new and resolved issue codes", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200, ["TITLE_MISSING"])] });
    const newR = fixture({ pages: [page("https://x/a", 200, ["IMAGES_MISSING_ALT"])] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.issuesByCode.new.map((d) => d.code)).toEqual(["IMAGES_MISSING_ALT"]);
    expect(diff.issuesByCode.resolved.map((d) => d.code)).toEqual(["TITLE_MISSING"]);
  });

  it("detects increased and decreased counts", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200, ["X"]), page("https://x/b", 200, ["Y", "Y"])] });
    const newR = fixture({ pages: [page("https://x/a", 200, ["X", "X", "X"]), page("https://x/b", 200, ["Y"])] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.issuesByCode.increased.map((d) => d.code)).toEqual(["X"]);
    expect(diff.issuesByCode.decreased.map((d) => d.code)).toEqual(["Y"]);
  });

  it("computes severity deltas from summaries", () => {
    const oldR = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 3, medium: 5, low: 10 } } });
    const newR = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 4, low: 10 } } });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.severityDelta).toEqual({ high: 2, medium: -1, low: 0 });
  });

  it("detects status code changes on common pages", () => {
    const oldR = fixture({ pages: [page("https://x/a", 200), page("https://x/b", 200)] });
    const newR = fixture({ pages: [page("https://x/a", 404), page("https://x/b", 200)] });
    const diff = diffSiteReports(oldR, newR);
    expect(diff.statusChanges).toEqual([{ url: "https://x/a", oldStatus: 200, newStatus: 404 }]);
  });

  it("returns empty deltas for identical reports", () => {
    const sameR = fixture({ pages: [page("https://x/a", 200, ["X"])] });
    const diff = diffSiteReports(sameR, sameR);
    expect(diff.issuesByCode.new).toEqual([]);
    expect(diff.issuesByCode.resolved).toEqual([]);
    expect(diff.issuesByCode.increased).toEqual([]);
    expect(diff.issuesByCode.decreased).toEqual([]);
    expect(diff.pageSet.added).toEqual([]);
    expect(diff.pageSet.removed).toEqual([]);
    expect(diff.statusChanges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/diff.test.ts`

Expected: "Cannot find module".

- [ ] **Step 3: Implement**

Create `src/diff.ts`:

```ts
import type { SiteReport } from "./types.js";

export interface IssueDelta {
  code: string;
  oldCount: number;
  newCount: number;
}

export interface PageDelta {
  url: string;
  oldStatus: number | null;
  newStatus: number | null;
}

export interface SiteReportDiff {
  oldUrl: string;
  newUrl: string;
  pageSet: { added: string[]; removed: string[]; common: number };
  issuesByCode: {
    new: IssueDelta[];
    resolved: IssueDelta[];
    increased: IssueDelta[];
    decreased: IssueDelta[];
    unchanged: IssueDelta[];
  };
  severityDelta: { high: number; medium: number; low: number };
  statusChanges: PageDelta[];
}

function countIssuesByCode(report: SiteReport): Map<string, number> {
  const map = new Map<string, number>();
  for (const page of report.pages) {
    for (const issue of page.issues) {
      map.set(issue.code, (map.get(issue.code) ?? 0) + 1);
    }
  }
  return map;
}

function pageStatusMap(report: SiteReport): Map<string, number> {
  const map = new Map<string, number>();
  for (const page of report.pages) {
    map.set(page.finalUrl, page.status);
  }
  return map;
}

export function diffSiteReports(oldReport: SiteReport, newReport: SiteReport): SiteReportDiff {
  const oldUrls = new Set(oldReport.pages.map((p) => p.finalUrl));
  const newUrls = new Set(newReport.pages.map((p) => p.finalUrl));
  const added = [...newUrls].filter((u) => !oldUrls.has(u)).sort();
  const removed = [...oldUrls].filter((u) => !newUrls.has(u)).sort();
  const common = [...oldUrls].filter((u) => newUrls.has(u)).length;

  const oldCounts = countIssuesByCode(oldReport);
  const newCounts = countIssuesByCode(newReport);
  const allCodes = new Set([...oldCounts.keys(), ...newCounts.keys()]);

  const newIssues: IssueDelta[] = [];
  const resolved: IssueDelta[] = [];
  const increased: IssueDelta[] = [];
  const decreased: IssueDelta[] = [];
  const unchanged: IssueDelta[] = [];

  for (const code of allCodes) {
    const oldCount = oldCounts.get(code) ?? 0;
    const newCount = newCounts.get(code) ?? 0;
    const delta: IssueDelta = { code, oldCount, newCount };
    if (oldCount === 0 && newCount > 0) newIssues.push(delta);
    else if (oldCount > 0 && newCount === 0) resolved.push(delta);
    else if (newCount > oldCount) increased.push(delta);
    else if (newCount < oldCount) decreased.push(delta);
    else unchanged.push(delta);
  }

  const sortByCode = (a: IssueDelta, b: IssueDelta) => a.code.localeCompare(b.code);
  newIssues.sort(sortByCode);
  resolved.sort(sortByCode);
  increased.sort(sortByCode);
  decreased.sort(sortByCode);
  unchanged.sort(sortByCode);

  const oldStatuses = pageStatusMap(oldReport);
  const newStatuses = pageStatusMap(newReport);
  const statusChanges: PageDelta[] = [];
  for (const url of oldUrls) {
    if (!newUrls.has(url)) continue;
    const oldStatus = oldStatuses.get(url) ?? null;
    const newStatus = newStatuses.get(url) ?? null;
    if (oldStatus !== newStatus) {
      statusChanges.push({ url, oldStatus, newStatus });
    }
  }
  statusChanges.sort((a, b) => a.url.localeCompare(b.url));

  return {
    oldUrl: oldReport.startUrl,
    newUrl: newReport.startUrl,
    pageSet: { added, removed, common },
    issuesByCode: { new: newIssues, resolved, increased, decreased, unchanged },
    severityDelta: {
      high: newReport.summary.issueTotals.high - oldReport.summary.issueTotals.high,
      medium: newReport.summary.issueTotals.medium - oldReport.summary.issueTotals.medium,
      low: newReport.summary.issueTotals.low - oldReport.summary.issueTotals.low,
    },
    statusChanges,
  };
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/diff.test.ts`

Expected: 6 tests pass.

- [ ] **Step 5: Full + build**

Run: `npm test && npm run build`

Expected: clean, all 104 tests pass (98 prior + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/diff.ts tests/diff.test.ts
git commit -m "feat: add diffSiteReports for crawl-to-crawl comparison"
```

---

## Task 2: renderDiffText + renderDiffJson

**Files:**
- Modify: `src/diff.ts`
- Modify: `tests/diff.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/diff.test.ts`:

```ts
import { renderDiffText, renderDiffJson } from "../src/diff.js";

describe("renderDiffText", () => {
  it("highlights regressions with - and improvements with +", () => {
    const oldR = fixture({
      pages: [page("https://x/a", 200, ["FOO"])],
      summary: { ...fixture({}).summary, issueTotals: { high: 1, medium: 0, low: 0 } },
    });
    const newR = fixture({
      pages: [page("https://x/a", 200, ["FOO", "FOO", "BAR"])],
      summary: { ...fixture({}).summary, issueTotals: { high: 3, medium: 0, low: 0 } },
    });
    const diff = diffSiteReports(oldR, newR);
    const text = renderDiffText(diff);
    expect(text).toContain("New issues");
    expect(text).toContain("BAR");
    expect(text).toContain("Increased");
    expect(text).toContain("FOO");
    expect(text).toContain("high: +2");
  });

  it("reports a healthy diff cleanly", () => {
    const sameR = fixture({});
    const diff = diffSiteReports(sameR, sameR);
    const text = renderDiffText(diff);
    expect(text).toContain("No regressions");
  });
});

describe("renderDiffJson", () => {
  it("returns a valid JSON string round-trippable to the diff", () => {
    const oldR = fixture({});
    const newR = fixture({ pages: [page("https://x/new", 200)] });
    const diff = diffSiteReports(oldR, newR);
    const json = renderDiffJson(diff);
    expect(JSON.parse(json)).toEqual(diff);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/diff.test.ts`

- [ ] **Step 3: Implement**

Append to `src/diff.ts`:

```ts
export function renderDiffText(diff: SiteReportDiff): string {
  const lines: string[] = [];
  lines.push(`Diff: ${diff.oldUrl} → ${diff.newUrl}`);
  lines.push(`Severity totals delta: high: ${signed(diff.severityDelta.high)}  medium: ${signed(diff.severityDelta.medium)}  low: ${signed(diff.severityDelta.low)}`);
  lines.push("");

  const hasRegressions =
    diff.issuesByCode.new.length > 0 ||
    diff.issuesByCode.increased.length > 0 ||
    diff.statusChanges.some((s) => regressed(s));

  if (!hasRegressions && diff.issuesByCode.resolved.length === 0 && diff.issuesByCode.decreased.length === 0 &&
      diff.pageSet.added.length === 0 && diff.pageSet.removed.length === 0) {
    lines.push("No regressions and no improvements — reports are equivalent.");
    return lines.join("\n");
  }

  if (!hasRegressions) {
    lines.push("No regressions.");
  }

  if (diff.issuesByCode.new.length > 0) {
    lines.push(`New issues (${diff.issuesByCode.new.length}):`);
    for (const d of diff.issuesByCode.new) lines.push(`  - ${d.code}: 0 → ${d.newCount}`);
    lines.push("");
  }

  if (diff.issuesByCode.increased.length > 0) {
    lines.push(`Increased (${diff.issuesByCode.increased.length}):`);
    for (const d of diff.issuesByCode.increased) lines.push(`  - ${d.code}: ${d.oldCount} → ${d.newCount}`);
    lines.push("");
  }

  if (diff.issuesByCode.resolved.length > 0) {
    lines.push(`Resolved (${diff.issuesByCode.resolved.length}):`);
    for (const d of diff.issuesByCode.resolved) lines.push(`  + ${d.code}: ${d.oldCount} → 0`);
    lines.push("");
  }

  if (diff.issuesByCode.decreased.length > 0) {
    lines.push(`Decreased (${diff.issuesByCode.decreased.length}):`);
    for (const d of diff.issuesByCode.decreased) lines.push(`  + ${d.code}: ${d.oldCount} → ${d.newCount}`);
    lines.push("");
  }

  if (diff.statusChanges.length > 0) {
    lines.push(`Status code changes (${diff.statusChanges.length}):`);
    for (const s of diff.statusChanges) lines.push(`  ${regressed(s) ? "-" : "+"} ${s.url}: ${s.oldStatus} → ${s.newStatus}`);
    lines.push("");
  }

  if (diff.pageSet.added.length > 0) {
    lines.push(`Pages added (${diff.pageSet.added.length}):`);
    for (const u of diff.pageSet.added.slice(0, 20)) lines.push(`  + ${u}`);
    if (diff.pageSet.added.length > 20) lines.push(`  ... and ${diff.pageSet.added.length - 20} more`);
    lines.push("");
  }

  if (diff.pageSet.removed.length > 0) {
    lines.push(`Pages removed (${diff.pageSet.removed.length}):`);
    for (const u of diff.pageSet.removed.slice(0, 20)) lines.push(`  - ${u}`);
    if (diff.pageSet.removed.length > 20) lines.push(`  ... and ${diff.pageSet.removed.length - 20} more`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function regressed(s: PageDelta): boolean {
  if (s.oldStatus == null || s.newStatus == null) return false;
  return s.oldStatus < 400 && s.newStatus >= 400;
}

export function renderDiffJson(diff: SiteReportDiff): string {
  return JSON.stringify(diff, null, 2);
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/diff.test.ts`

Expected: 9 tests pass (6 prior + 3 new).

- [ ] **Step 5: Full + build**

Run: `npm test && npm run build`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/diff.ts tests/diff.test.ts
git commit -m "feat: add renderDiffText and renderDiffJson"
```

---

## Task 3: CLI subcommand + --fail-on flag

**Files:**
- Modify: `src/cli.ts`

The diff subcommand should be triggered by `npm run dev -- diff <old.json> <new.json>`. Bypass URL crawling. Honor `--json` and `--output`. Add `--fail-on <severity>` for CI gating: exit non-zero if specified severity has positive delta.

- [ ] **Step 1: Add to CliOptions interface**

```ts
diffMode: boolean;
diffOldPath: string | null;
diffNewPath: string | null;
failOnSeverity: "high" | "medium" | "low" | null;
```

- [ ] **Step 2: Initialize defaults**

```ts
diffMode: false,
diffOldPath: null,
diffNewPath: null,
failOnSeverity: null,
```

- [ ] **Step 3: Detect `diff` subcommand at top of parseArgs**

Inside `parseArgs`, BEFORE the existing argv loop, add:

```ts
if (argv[0] === "diff") {
  options.diffMode = true;
  options.diffOldPath = argv[1] ?? null;
  options.diffNewPath = argv[2] ?? null;
  // Continue parsing remaining args (--json, --output, --fail-on) starting from index 3
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--output") {
      options.outputPath = requireValue(argv, index, "--output");
      index += 1; continue;
    }
    if (arg.startsWith("--output=")) { options.outputPath = arg.split("=").slice(1).join("="); continue; }
    if (arg === "--fail-on") {
      const v = requireValue(argv, index, "--fail-on");
      if (v !== "high" && v !== "medium" && v !== "low") throw new Error("--fail-on must be high|medium|low");
      options.failOnSeverity = v;
      index += 1; continue;
    }
    if (arg === "--help" || arg === "-h") { options.help = true; continue; }
    throw new Error(`Unknown option in diff mode: ${arg}`);
  }
  return options;
}
```

(`options.help` may not exist — if it doesn't, drop that line; help is handled differently in this CLI. Inspect existing handling and adapt.)

- [ ] **Step 4: Add to help text**

In `printHelp()`, add at the top above existing options or as a separate section:

```
Subcommands:
  diff <old.json> <new.json>  Compare two report JSON files (use --json/--output/--fail-on)

Options:
  ... existing options ...
  --fail-on <severity>       Exit non-zero if diff increased issues at this severity (high|medium|low). Diff mode only.
```

- [ ] **Step 5: Handle diff mode in main()**

At the very top of `main()`, before any URL handling:

```ts
if (options.diffMode) {
  if (!options.diffOldPath || !options.diffNewPath) {
    throw new Error("diff requires two arguments: <old.json> <new.json>");
  }
  const [oldRaw, newRaw] = await Promise.all([
    readFile(options.diffOldPath, "utf8"),
    readFile(options.diffNewPath, "utf8"),
  ]);
  const oldReport = JSON.parse(oldRaw);
  const newReport = JSON.parse(newRaw);
  const { diffSiteReports, renderDiffText, renderDiffJson } = await import("./diff.js");
  const diff = diffSiteReports(oldReport, newReport);
  const out = options.json ? renderDiffJson(diff) : renderDiffText(diff);
  if (options.outputPath) {
    await writeFile(options.outputPath, out, "utf8");
  } else {
    console.log(out);
  }
  if (options.failOnSeverity) {
    const delta = diff.severityDelta[options.failOnSeverity];
    if (delta > 0) {
      console.error(`fail-on: ${options.failOnSeverity} severity increased by ${delta}`);
      process.exit(1);
    }
  }
  return;
}
```

`readFile` should already be imported from `node:fs/promises`. Verify with grep.

- [ ] **Step 6: Build + tests**

Run: `npm run build && npm test`

Expected: clean.

- [ ] **Step 7: Smoke — set up two fixtures**

Run: 

```bash
npm run dev -- https://example.com --max-pages 2 --json --output /tmp/old-report.json
npm run dev -- https://example.com --max-pages 2 --json --output /tmp/new-report.json
```

Both should produce identical JSON.

- [ ] **Step 8: Smoke — diff identical reports**

Run: `npm run dev -- diff /tmp/old-report.json /tmp/new-report.json`

Expected: output mentions "No regressions" or "equivalent". Exit 0.

- [ ] **Step 9: Smoke — diff with --fail-on**

Run: `npm run dev -- diff /tmp/old-report.json /tmp/new-report.json --fail-on high`

Expected: exit 0 (no regressions).

Then create a fake regressed file:

```bash
node -e 'const j=require("/tmp/old-report.json"); j.summary.issueTotals.high += 5; require("fs").writeFileSync("/tmp/worse.json", JSON.stringify(j));'
```

Run: `npm run dev -- diff /tmp/old-report.json /tmp/worse.json --fail-on high`

Expected: prints diff text including `high: +5`, exits non-zero.

- [ ] **Step 10: Smoke — JSON output**

Run: `npm run dev -- diff /tmp/old-report.json /tmp/new-report.json --json`

Expected: parseable JSON to stdout.

- [ ] **Step 11: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add diff subcommand and --fail-on for CI gating"
```

## CRITICAL
- Do not touch untracked files.
- Only `src/cli.ts` in the commit.

## Self-Review

- diff subcommand triggers when first arg is `diff`?
- Both `--json` and `--output` work in diff mode?
- `--fail-on` exits non-zero on regression at the specified severity?
- All 107 tests still pass?
- Build clean?
- Help text updated?
- Only `src/cli.ts` in commit?

## Report

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Step 6 build + test results
- Step 8 (identical diff) output
- Step 9 (regression + fail-on) — paste exit code and output
- Step 10 (JSON output) — first line of JSON
- Git SHA + `git show --stat HEAD`
- Concerns

---

## Task 4: README

- [ ] **Step 1: Add a Diff section after Useful Options**

In `README.md`, add a new `## Diff Reports` section after `## Useful Options`:

```markdown
## Diff Reports

Compare two crawl reports to see what changed between runs:

\`\`\`bash
# Compare last week's crawl to this week's
npm run dev -- diff old-report.json new-report.json

# Output as JSON for piping into another tool
npm run dev -- diff old.json new.json --json --output diff.json

# Fail (non-zero exit) if any high-severity issues were added — useful in CI
npm run dev -- diff old.json new.json --fail-on high
\`\`\`

The diff highlights:
- New issue codes (didn't appear in old)
- Resolved issue codes (appeared in old, not in new)
- Counts that increased or decreased
- HTTP status changes on common pages
- Pages added or removed from the crawl
```

(Keep code blocks as triple backticks, not escaped backticks — that's a markdown rendering note for the implementer; just write triple backticks.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document diff subcommand and --fail-on flag"
```

---

## Self-Review Notes

- **Spec coverage:** Pure diff function (Task 1), text + JSON formatters (Task 2), CLI subcommand + fail-on (Task 3), docs (Task 4).
- **Placeholder scan:** All steps have complete code. CLI changes are surgical.
- **Type consistency:** `SiteReport` from types.ts. `SiteReportDiff` defined once in diff.ts.
- **Backward compat:** `diff` is a new subcommand at position 0; existing URL-based invocations are unaffected.
