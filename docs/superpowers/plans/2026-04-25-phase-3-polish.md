# Phase 3 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-persist every audit to `~/.config/seo-audit/crawls/<host>/<timestamp>.json`, add `seo-audit diff <url>` auto-pick, and extend `--fail-on` to fresh-audit mode (compare against the previous persisted crawl).

**Architecture:** New `src/persist.ts` module handles disk I/O via `node:fs/promises` (no new deps). New pure helper `evaluateFailOn` in `src/diff.ts` makes the regression-gate logic unit-testable. The CLI integrates both via three thin extensions: a `--no-persist` flag, an auto-persist hook in the analyze flow, and a URL-detection branch in the existing `diff` subcommand.

**Tech Stack:** TypeScript (Node ≥20), `node:fs/promises` + `node:os` + `node:path` (no new top-level deps), vitest.

**Spec:** `docs/superpowers/specs/2026-04-25-phase-3-polish-design.md`

---

## File Structure

**New files:**
- `src/persist.ts` — `persistCrawl`, `loadCrawl`, `listCrawls`, `recentCrawlsForUrl`, `hostKeyFromUrl`, `resolveCrawlsDir`, plus the `CrawlEntry` and `PersistResult` types.
- `tests/persist.test.ts` — unit tests covering host-key normalization, write/read roundtrip, listing order, recent-N convenience, same-millisecond collision, directory permissions.

**Modified files:**
- `src/diff.ts` — add `evaluateFailOn(current, previous, severity)` pure helper plus the `FailOnDecision` type. Existing functions untouched.
- `tests/diff.test.ts` — extend with 4 `evaluateFailOn` cases reusing the existing `fixture` helper.
- `src/cli.ts` — add `--no-persist` flag (parse + interface field), add auto-persist hook after each `analyze()` call, extend `--fail-on` branch to fresh-audit mode, add URL-detection branch to the existing `diff` subcommand parser, update help text. Imports `persistCrawl`, `loadCrawl`, `recentCrawlsForUrl` from `./persist.js` and `evaluateFailOn` from `./diff.js`.
- `README.md` — add a "Persistence" subsection under Privacy, document the `--no-persist` flag and `SEO_AUDIT_NO_PERSIST` / `SEO_AUDIT_CRAWLS_DIR` env vars, call out the `--fail-on` behavior change, add a v0.4.0 CHANGELOG block.

---

## Task 1: `evaluateFailOn` helper in `src/diff.ts`

**Files:**
- Modify: `src/diff.ts` (add type + function at the bottom of the file, exported)
- Modify: `tests/diff.test.ts` (add a new `describe("evaluateFailOn", ...)` block at the bottom; reuse the existing `fixture` helper at lines 5-26)

This task is pure — no filesystem, no async. TDD strictly.

- [ ] **Step 1: Add the failing tests**

Append to `tests/diff.test.ts`:

```ts
import { evaluateFailOn } from "../src/diff.js";

describe("evaluateFailOn", () => {
  it("does not fail when previous is null (first run)", () => {
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, null, "high");
    expect(decision.shouldFail).toBe(false);
    expect(decision.reason).toMatch(/skipping/i);
    expect(decision.delta).toBe(0);
  });

  it("does not fail when severity delta is zero", () => {
    const previous = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 2, medium: 0, low: 0 } } });
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 2, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, previous, "high");
    expect(decision.shouldFail).toBe(false);
    expect(decision.delta).toBe(0);
  });

  it("fails when severity delta is positive (regression)", () => {
    const previous = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 2, medium: 0, low: 0 } } });
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, previous, "high");
    expect(decision.shouldFail).toBe(true);
    expect(decision.delta).toBe(3);
    expect(decision.reason).toMatch(/3 more high/i);
  });

  it("does not fail when severity delta is negative (improvement)", () => {
    const previous = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 5, medium: 0, low: 0 } } });
    const current = fixture({ summary: { ...fixture({}).summary, issueTotals: { high: 3, medium: 0, low: 0 } } });
    const decision = evaluateFailOn(current, previous, "high");
    expect(decision.shouldFail).toBe(false);
    expect(decision.delta).toBe(-2);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/diff.test.ts`

Expected: 4 new tests fail with "Cannot find module ../src/diff.js" or "evaluateFailOn is not a function" (the helper doesn't exist yet).

- [ ] **Step 3: Implement `evaluateFailOn`**

Append to `src/diff.ts` (after `renderDiffJson`, at the bottom of the file):

```ts
export interface FailOnDecision {
  shouldFail: boolean;
  reason: string;
  delta: number;
}

export function evaluateFailOn(
  current: SiteReport,
  previous: SiteReport | null,
  severity: "high" | "medium" | "low",
): FailOnDecision {
  if (!previous) {
    return {
      shouldFail: false,
      reason: "No prior crawl found; skipping regression check.",
      delta: 0,
    };
  }
  const diff = diffSiteReports(previous, current);
  const delta = diff.severityDelta[severity];
  if (delta > 0) {
    return {
      shouldFail: true,
      reason: `${delta} more ${severity}-severity issue(s) than previous crawl.`,
      delta,
    };
  }
  return {
    shouldFail: false,
    reason: `No regression at ${severity} severity.`,
    delta,
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/diff.test.ts`

Expected: all tests in the file pass — the original 8 plus the 4 new `evaluateFailOn` tests.

Run: `npm test`

Expected: full suite still green (171 + 4 = 175 passed, 2 skipped).

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts tests/diff.test.ts
git commit -m "$(cat <<'EOF'
feat(diff): add evaluateFailOn pure helper

Returns a FailOnDecision describing whether a fresh audit regresses
relative to a previous one for a given severity. Three branches:
- previous === null → skip check
- delta > 0 → shouldFail with a "<delta> more <severity>" reason
- delta <= 0 → no fail

CLI will use this in fresh-audit mode (next tasks); diff-mode keeps
its inline check for now to minimize blast radius.
EOF
)"
```

---

## Task 2: `src/persist.ts` pure helpers — `hostKeyFromUrl` + `resolveCrawlsDir`

**Files:**
- Create: `src/persist.ts`
- Create: `tests/persist.test.ts`

TDD on the pure helpers first; filesystem code in Tasks 3-4.

- [ ] **Step 1: Create `tests/persist.test.ts` with the host-key + dir-resolver tests**

Create the file:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostKeyFromUrl, resolveCrawlsDir } from "../src/persist.js";

describe("hostKeyFromUrl", () => {
  it("lowercases the hostname", () => {
    expect(hostKeyFromUrl("https://Example.COM/")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(hostKeyFromUrl("https://www.example.com/")).toBe("example.com");
  });

  it("preserves non-default ports as host_port", () => {
    expect(hostKeyFromUrl("http://localhost:3000")).toBe("localhost_3000");
    expect(hostKeyFromUrl("https://example.com:8443/")).toBe("example.com_8443");
  });

  it("strips default ports (80 over http, 443 over https)", () => {
    expect(hostKeyFromUrl("http://example.com:80")).toBe("example.com");
    expect(hostKeyFromUrl("https://example.com:443/")).toBe("example.com");
  });

  it("returns punycode form for IDN hosts", () => {
    expect(hostKeyFromUrl("https://例え.テスト/")).toBe("xn--r8jz45g.xn--zckzah");
  });

  it("throws on unparseable input", () => {
    expect(() => hostKeyFromUrl("not-a-url")).toThrow();
  });

  it("does not strip www inside the hostname (only leading)", () => {
    expect(hostKeyFromUrl("https://blog.www.example.com/")).toBe("blog.www.example.com");
  });
});

describe("resolveCrawlsDir", () => {
  let tmp: string;
  const ORIGINAL_ENV = process.env.SEO_AUDIT_CRAWLS_DIR;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "seo-audit-test-"));
  });

  afterEach(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env.SEO_AUDIT_CRAWLS_DIR;
    else process.env.SEO_AUDIT_CRAWLS_DIR = ORIGINAL_ENV;
    await rm(tmp, { recursive: true, force: true });
  });

  it("honors SEO_AUDIT_CRAWLS_DIR when set", () => {
    process.env.SEO_AUDIT_CRAWLS_DIR = tmp;
    expect(resolveCrawlsDir()).toBe(tmp);
  });

  it("defaults to ~/.config/seo-audit/crawls when env is unset", () => {
    delete process.env.SEO_AUDIT_CRAWLS_DIR;
    const result = resolveCrawlsDir();
    expect(result.endsWith(join(".config", "seo-audit", "crawls"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/persist.test.ts`

Expected: FAIL with "Cannot find module ../src/persist.js" (the source file doesn't exist yet).

- [ ] **Step 3: Create `src/persist.ts` with the pure helpers**

Create the file:

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveCrawlsDir(): string {
  const override = process.env.SEO_AUDIT_CRAWLS_DIR;
  if (override && override.trim().length > 0) return override;
  return join(homedir(), ".config", "seo-audit", "crawls");
}

export function hostKeyFromUrl(url: string): string {
  const parsed = new URL(url);
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  const port = parsed.port;
  const isDefaultPort =
    port === "" ||
    (parsed.protocol === "http:" && port === "80") ||
    (parsed.protocol === "https:" && port === "443");

  return isDefaultPort ? host : `${host}_${port}`;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/persist.test.ts`

Expected: 9 tests pass (7 host-key + 2 dir-resolver).

Run: `npm test`

Expected: full suite still green (175 + 9 = 184 passed, 2 skipped).

- [ ] **Step 5: Commit**

```bash
git add src/persist.ts tests/persist.test.ts
git commit -m "$(cat <<'EOF'
feat(persist): add hostKeyFromUrl + resolveCrawlsDir helpers

Pure helpers for the upcoming crawl-persistence layer. Host keys
normalize URL → directory name (lowercase, strip leading www,
preserve non-default ports as host_port, IDN as punycode). The dir
resolver honors SEO_AUDIT_CRAWLS_DIR for testing and power-user
overrides; otherwise points at ~/.config/seo-audit/crawls/.
EOF
)"
```

---

## Task 3: `src/persist.ts` — `persistCrawl` + `loadCrawl`

**Files:**
- Modify: `src/persist.ts` (add types + two functions)
- Modify: `tests/persist.test.ts` (add roundtrip + return-contract + collision tests)

- [ ] **Step 1: Append the failing tests**

Append to `tests/persist.test.ts`:

```ts
import { mkdir, writeFile, stat } from "node:fs/promises";
import { persistCrawl, loadCrawl } from "../src/persist.js";
import type { SiteReport } from "../src/types.js";

function fixtureReport(startUrl: string): SiteReport {
  return {
    startUrl,
    infrastructure: {
      robotsTxt: { url: "", present: true, status: 200, sitemaps: [], blocksAllCrawlers: false },
      sitemap: { url: "", present: true, status: 200, urlCount: 0, knownUrls: 0, coverageLimited: false, isIndex: false },
      llmsTxt: { url: "", present: false, status: 404, isEmpty: false },
      issues: [],
    },
    summary: {
      crawledPages: 1,
      issueTotals: { high: 0, medium: 0, low: 0 },
      pagesWithNoindex: 0, pagesMissingTitle: 0, pagesMissingDescription: 0,
      internalLinksChecked: 0, pagesWithBrokenInternalLinks: 0,
      pagesWithRedirectingInternalLinks: 0, pagesWithAnchorTextIssues: 0,
      pagesWithFewIncomingInternalLinks: 0, orphanCandidatePages: 0,
      pagesMissingFromSitemap: 0, pagesWithHreflangIssues: 0,
      topIssues: [], duplicateTitles: [], duplicateMetaDescriptions: [],
    },
    pages: [],
    lighthouse: [],
  };
}

describe("persistCrawl + loadCrawl", () => {
  let tmp: string;
  const ORIGINAL_ENV = process.env.SEO_AUDIT_CRAWLS_DIR;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "seo-audit-test-"));
    process.env.SEO_AUDIT_CRAWLS_DIR = tmp;
  });

  afterEach(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env.SEO_AUDIT_CRAWLS_DIR;
    else process.env.SEO_AUDIT_CRAWLS_DIR = ORIGINAL_ENV;
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes a JSON file under <crawlsDir>/<host>/", async () => {
    const report = fixtureReport("https://example.com/");
    const result = await persistCrawl(report);
    expect(result.path.startsWith(join(tmp, "example.com"))).toBe(true);
    expect(result.path.endsWith(".json")).toBe(true);
  });

  it("roundtrips: loadCrawl returns a report deep-equal to the original", async () => {
    const report = fixtureReport("https://example.com/");
    const result = await persistCrawl(report);
    const loaded = await loadCrawl(result.path);
    expect(loaded).toEqual(report);
  });

  it("returns isFirstForHost: true on the first persist for a host", async () => {
    const report = fixtureReport("https://example.com/");
    const result = await persistCrawl(report);
    expect(result.isFirstForHost).toBe(true);
    expect(result.previousPath).toBe(null);
  });

  it("returns isFirstForHost: false and previousPath on the second persist", async () => {
    const report = fixtureReport("https://example.com/");
    const first = await persistCrawl(report, { now: () => new Date("2026-04-25T12:00:00.000Z") });
    const second = await persistCrawl(report, { now: () => new Date("2026-04-25T12:00:01.000Z") });
    expect(second.isFirstForHost).toBe(false);
    expect(second.previousPath).toBe(first.path);
  });

  it("treats different hosts as independent (per-host first-run bookkeeping)", async () => {
    await persistCrawl(fixtureReport("https://example.com/"));
    const result = await persistCrawl(fixtureReport("https://other.com/"));
    expect(result.isFirstForHost).toBe(true);
  });

  it("creates the host directory with mode 0o700", async () => {
    const report = fixtureReport("https://example.com/");
    await persistCrawl(report);
    const hostDir = join(tmp, "example.com");
    const info = await stat(hostDir);
    // Mask file-type bits; compare permission bits only.
    expect(info.mode & 0o777).toBe(0o700);
  });

  it("appends a millisecond when a same-timestamp file already exists", async () => {
    const report = fixtureReport("https://example.com/");
    const frozen = new Date("2026-04-25T12:00:00.000Z");
    const first = await persistCrawl(report, { now: () => frozen });
    const second = await persistCrawl(report, { now: () => frozen });
    expect(second.path).not.toBe(first.path);
    // Both files exist; both load.
    expect((await loadCrawl(first.path)).startUrl).toBe(report.startUrl);
    expect((await loadCrawl(second.path)).startUrl).toBe(report.startUrl);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/persist.test.ts`

Expected: 7 new tests fail (the existing 9 still pass) with "persistCrawl is not a function" / "loadCrawl is not a function".

- [ ] **Step 3: Implement `persistCrawl` and `loadCrawl`**

Append to `src/persist.ts`:

```ts
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import type { SiteReport } from "./types.js";

export interface PersistResult {
  path: string;
  isFirstForHost: boolean;
  previousPath: string | null;
}

export interface PersistOptions {
  now?: () => Date;
}

export async function persistCrawl(
  report: SiteReport,
  opts: PersistOptions = {},
): Promise<PersistResult> {
  const host = hostKeyFromUrl(report.startUrl);
  const hostDir = join(resolveCrawlsDir(), host);

  // Track whether the host directory existed before we touched it.
  let hostExisted = true;
  try {
    await stat(hostDir);
  } catch {
    hostExisted = false;
  }

  await mkdir(hostDir, { recursive: true, mode: 0o700 });

  // Find the latest existing crawl for this host BEFORE we add ours.
  // We need this for both `isFirstForHost` (no entries) and for `previousPath`.
  const existingEntries = hostExisted ? await listCrawlsInDir(hostDir, host) : [];
  const previousPath = existingEntries[0]?.path ?? null;
  const isFirstForHost = existingEntries.length === 0;

  // Build the filename. On collision, advance by 1 millisecond and retry.
  const nowFn = opts.now ?? (() => new Date());
  let when = nowFn();
  let path = filenameFor(hostDir, when);
  while (await pathExists(path)) {
    when = new Date(when.getTime() + 1);
    path = filenameFor(hostDir, when);
  }

  await writeFile(path, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });

  return { path, isFirstForHost, previousPath };
}

export async function loadCrawl(path: string): Promise<SiteReport> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as SiteReport;
}

function filenameFor(hostDir: string, when: Date): string {
  // ISO with `:` and `.` swapped to `-` for filesystem safety on Windows.
  // Example: 2026-04-25T19-34-56-789Z.json
  const iso = when.toISOString().replace(/[:.]/g, "-");
  return join(hostDir, `${iso}.json`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Forward-declared; the real listCrawls is added in the next task.
// listCrawlsInDir is a low-level helper used both by listCrawls and by
// persistCrawl's "find previous" lookup.
async function listCrawlsInDir(_hostDir: string, _host: string): Promise<CrawlEntry[]> {
  // Placeholder — Task 4 implements this. Until then, persistCrawl's
  // first-run/previousPath behavior is exercised end-to-end by the tests
  // above using mkdir + (eventual) listCrawlsInDir.
  return [];
}

export interface CrawlEntry {
  path: string;
  timestamp: string;
  host: string;
  size: number;
  mtime: Date;
}
```

**Note:** the `listCrawlsInDir` placeholder above means the "second persist returns previousPath" and "appends a millisecond on collision" tests will not yet pass — they need Task 4's listing implementation. Run the tests anyway to confirm the OTHER 5 new tests pass; 2 will fail (those involving `previousPath` populated and the in-place collision detection that depends on listing).

Actually, looking at the implementation more carefully: the collision detection uses `pathExists` (a direct stat), NOT `listCrawlsInDir`. So the collision test SHOULD pass. Only the "previousPath populated on second persist" test depends on listing.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/persist.test.ts`

Expected: of the 7 new tests, 6 pass. The one that fails: "returns isFirstForHost: false and previousPath on the second persist" (depends on `listCrawlsInDir` returning real entries; Task 4 implements it).

This is acceptable mid-task TDD state: Task 4 finishes the loop. Don't worry about the one failure here — it disappears in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/persist.ts tests/persist.test.ts
git commit -m "$(cat <<'EOF'
feat(persist): add persistCrawl + loadCrawl

Writes the audit JSON to <crawlsDir>/<host>/<ISO-timestamp>.json
with mode 0600 inside a 0700 host directory. Collisions on the same
millisecond advance by 1ms until an unused filename is found
(deterministic in tests via `opts.now`).

Returns isFirstForHost (drives the CLI's first-run notice) and
previousPath (drives --fail-on in fresh-audit mode). previousPath
relies on a listCrawlsInDir stub that's filled in by the next task.
EOF
)"
```

---

## Task 4: `src/persist.ts` — `listCrawls` + `recentCrawlsForUrl`

**Files:**
- Modify: `src/persist.ts` (replace the `listCrawlsInDir` stub; add public `listCrawls` and `recentCrawlsForUrl`)
- Modify: `tests/persist.test.ts` (add 3 listing tests)

- [ ] **Step 1: Append the failing tests**

Append to `tests/persist.test.ts`:

```ts
import { listCrawls, recentCrawlsForUrl } from "../src/persist.js";

describe("listCrawls + recentCrawlsForUrl", () => {
  let tmp: string;
  const ORIGINAL_ENV = process.env.SEO_AUDIT_CRAWLS_DIR;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "seo-audit-test-"));
    process.env.SEO_AUDIT_CRAWLS_DIR = tmp;
  });

  afterEach(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env.SEO_AUDIT_CRAWLS_DIR;
    else process.env.SEO_AUDIT_CRAWLS_DIR = ORIGINAL_ENV;
    await rm(tmp, { recursive: true, force: true });
  });

  it("returns [] for a host with no directory", async () => {
    expect(await listCrawls("never-persisted.com")).toEqual([]);
  });

  it("returns entries newest-first after multiple persists", async () => {
    const report = fixtureReport("https://example.com/");
    const t1 = new Date("2026-04-01T12:00:00.000Z");
    const t2 = new Date("2026-04-15T12:00:00.000Z");
    const t3 = new Date("2026-04-25T12:00:00.000Z");
    await persistCrawl(report, { now: () => t1 });
    await persistCrawl(report, { now: () => t2 });
    await persistCrawl(report, { now: () => t3 });
    const entries = await listCrawls("example.com");
    expect(entries).toHaveLength(3);
    // Newest-first: t3, t2, t1
    expect(entries[0].timestamp).toContain("2026-04-25");
    expect(entries[1].timestamp).toContain("2026-04-15");
    expect(entries[2].timestamp).toContain("2026-04-01");
  });

  it("recentCrawlsForUrl returns the N newest", async () => {
    const report = fixtureReport("https://example.com/");
    for (let i = 1; i <= 5; i += 1) {
      await persistCrawl(report, { now: () => new Date(`2026-04-${String(i).padStart(2, "0")}T12:00:00.000Z`) });
    }
    const recent = await recentCrawlsForUrl("https://example.com/", 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].timestamp).toContain("2026-04-05");
    expect(recent[1].timestamp).toContain("2026-04-04");
  });

  it("recentCrawlsForUrl returns fewer entries if N exceeds the count", async () => {
    const report = fixtureReport("https://example.com/");
    await persistCrawl(report);
    const recent = await recentCrawlsForUrl("https://example.com/", 5);
    expect(recent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run tests/persist.test.ts`

Expected: 4 new tests fail (`listCrawls` / `recentCrawlsForUrl` not exported). The Task-3 "previousPath on second persist" test ALSO still fails (it depends on the real `listCrawlsInDir`). All others pass.

- [ ] **Step 3: Replace the `listCrawlsInDir` stub and add the public functions**

In `src/persist.ts`, replace the `listCrawlsInDir` placeholder and add the public listing functions. Add `readdir` to the imports at the top of the file.

Updated import line:
```ts
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
```

Replace the placeholder `async function listCrawlsInDir(...)` with the real implementation, and add `listCrawls` + `recentCrawlsForUrl`:

```ts
async function listCrawlsInDir(hostDir: string, host: string): Promise<CrawlEntry[]> {
  let names: string[];
  try {
    names = await readdir(hostDir);
  } catch {
    return [];
  }
  const entries: CrawlEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = join(hostDir, name);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    entries.push({
      path: full,
      timestamp: name.slice(0, -".json".length),
      host,
      size: info.size,
      mtime: info.mtime,
    });
  }
  // Newest-first by filename (timestamps are lexicographic-sortable ISO strings).
  entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return entries;
}

export async function listCrawls(host: string): Promise<CrawlEntry[]> {
  const hostDir = join(resolveCrawlsDir(), host);
  return listCrawlsInDir(hostDir, host);
}

export async function recentCrawlsForUrl(
  url: string,
  count: number,
): Promise<CrawlEntry[]> {
  const host = hostKeyFromUrl(url);
  const all = await listCrawls(host);
  return all.slice(0, Math.max(0, count));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/persist.test.ts`

Expected: ALL persist tests pass — 9 (helpers) + 7 (Task 3) + 4 (Task 4) = 20 passing. The "previousPath on second persist" test from Task 3 now passes too (the real `listCrawlsInDir` returns the prior entry).

Run: `npm test`

Expected: full suite green (175 + 20 = 195 passed, 2 skipped).

- [ ] **Step 5: Commit**

```bash
git add src/persist.ts tests/persist.test.ts
git commit -m "$(cat <<'EOF'
feat(persist): listCrawls + recentCrawlsForUrl

Lists persisted crawls for a host newest-first (lexicographic sort
on the ISO-timestamp filename matches chronological order).
recentCrawlsForUrl is the URL-keyed convenience used by the CLI's
diff <url> auto-pick and --fail-on regression check.

Replaces the listCrawlsInDir stub from the prior commit; the
"previousPath on second persist" test now passes end-to-end.
EOF
)"
```

---

## Task 5: CLI analyze-flow — `--no-persist` flag, auto-persist hook, `--fail-on` extension

**Files:**
- Modify: `src/cli.ts` — adds the new flag, new imports, the auto-persist hook in the per-URL flow, and the fresh-mode `--fail-on` branch.

This is the largest CLI change. No new test file (the underlying logic is covered by `evaluateFailOn` + `persistCrawl` unit tests; the CLI is thin glue).

- [ ] **Step 1: Add `--no-persist` to the `CliOptions` interface**

In `src/cli.ts` around lines 17-57, find the `CliOptions` interface. Add `noPersist: boolean;` near the other booleans (e.g., after `lighthouse: boolean;` or just place it alphabetically):

```ts
  noPersist: boolean;
```

- [ ] **Step 2: Add the default value**

In the options initial-state object inside `parseArgs` (around line 145-180; look for `options: CliOptions = { ... }`), add:

```ts
    noPersist: false,
```

- [ ] **Step 3: Add the help text**

In the `printHelp` function (the multiline `console.log` block), add this line just below `--output <file>`:

```
  --no-persist               Skip persisting the crawl to ~/.config/seo-audit/crawls/.
                             Default: every successful audit is persisted.
                             Env: SEO_AUDIT_NO_PERSIST=1 sets the same.
```

Also update the `--fail-on` help line to:
```
  --fail-on <severity>       Exit non-zero if issues at <severity> increased.
                             Fresh-audit mode: compares to the previous persisted crawl.
                             Diff mode: compares the two passed report files.
                             One of: high, medium, low.
```

- [ ] **Step 4: Add the parse branch**

In the argv-loop near where other booleans are parsed (search for `if (arg === "--render")` to find the area), add:

```ts
    if (arg === "--no-persist") {
      options.noPersist = true;
      continue;
    }
```

- [ ] **Step 5: Add the new imports at the top of `src/cli.ts`**

Find the existing import block (line 1+). Add the persist + diff helpers:

```ts
import { persistCrawl, loadCrawl, recentCrawlsForUrl } from "./persist.js";
import { evaluateFailOn } from "./diff.js";
```

(`./diff.js` may already be imported via dynamic `import` further down — those dynamic imports for `diffSiteReports` etc. can stay; the static import here is for `evaluateFailOn` only.)

- [ ] **Step 6: Add the auto-persist hook + fresh-mode `--fail-on` branch in `main()`**

In the `main()` function, after the URL loop populates `reports` (around line 1077, just after the closing `}` of the `for (const url of options.urls)` loop) and BEFORE the existing `const output = options.json ? ...` line, insert:

```ts
    // Phase 3: persist every report first, then run fail-on checks. Two-pass
    // ordering matters in the multi-URL case: if URL1 regresses, we don't want
    // to skip persisting URL2 just because process.exit fires mid-loop.
    const persistDisabled =
      options.noPersist ||
      process.env.SEO_AUDIT_NO_PERSIST === "1" ||
      process.env.SEO_AUDIT_NO_PERSIST === "true";

    const previousByReport = new Map<SiteReport, string | null>();

    for (const report of reports) {
      let previousPath: string | null = null;
      if (!persistDisabled) {
        try {
          const result = await persistCrawl(report);
          previousPath = result.previousPath;
          if (result.isFirstForHost) {
            console.error(
              `Persisting crawl to ${result.path}. Use --no-persist (or SEO_AUDIT_NO_PERSIST=1) to opt out.`,
            );
          }
        } catch (err) {
          console.error(`Warning: failed to persist crawl: ${(err as Error).message}`);
        }
      } else if (options.failOnSeverity) {
        const recent = await recentCrawlsForUrl(report.startUrl, 1);
        previousPath = recent[0]?.path ?? null;
      }
      previousByReport.set(report, previousPath);
    }

    if (options.failOnSeverity) {
      for (const report of reports) {
        const previousPath = previousByReport.get(report) ?? null;
        const previous = previousPath ? await loadCrawl(previousPath) : null;
        const decision = evaluateFailOn(report, previous, options.failOnSeverity);
        if (!previous) {
          console.error(
            `No prior crawl found for ${report.startUrl}; skipping --fail-on regression check.`,
          );
        } else if (decision.shouldFail) {
          console.error(`--fail-on ${options.failOnSeverity}: ${decision.reason}`);
          process.exit(1);
        }
      }
    }
```

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: clean (zero errors).

If errors appear, investigate. Common issues:
- Missing import — confirm Step 5's imports are at the top.
- Type narrowing on `options.failOnSeverity` — it's `"high" | "medium" | "low" | null`; the `if (options.failOnSeverity)` narrows it correctly inside the block.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`

Expected: full suite green (195 passed, 2 skipped). No new tests added in this task.

- [ ] **Step 9: Smoke-test manually**

```bash
# Build the dist so npx tsx isn't required if you prefer, but tsx works too:
unset SEO_AUDIT_CRAWLS_DIR
TEST_DIR=$(mktemp -d)
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR npx tsx src/cli.ts https://example.com --max-pages 1 2>&1 | tail -5
# Expect a "Persisting crawl to ..." stderr line on first run.

ls -la $TEST_DIR/example.com/
# Expect one .json file.

# Second run — silent persist, no first-run notice
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR npx tsx src/cli.ts https://example.com --max-pages 1 2>&1 | tail -5

ls -la $TEST_DIR/example.com/
# Expect two .json files.

# --no-persist opt-out
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR npx tsx src/cli.ts https://example.com --max-pages 1 --no-persist 2>&1 | tail -5

ls -la $TEST_DIR/example.com/
# Still two .json files (no third one written).

# --fail-on with no prior crawl for a different host
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR npx tsx src/cli.ts https://other.com --max-pages 1 --fail-on high 2>&1 | tail -5
# Expect "No prior crawl found for https://other.com; skipping --fail-on regression check." stderr line.

# Clean up
rm -rf $TEST_DIR
```

- [ ] **Step 10: Commit**

```bash
git add src/cli.ts
git commit -m "$(cat <<'EOF'
feat(cli): auto-persist crawls + extend --fail-on to fresh-audit mode

Every successful audit is now persisted to
~/.config/seo-audit/crawls/<host>/<timestamp>.json (mode 0700).
Opt out via --no-persist or SEO_AUDIT_NO_PERSIST=1 env var.

The first persist for a given host prints a one-line stderr notice
pointing at the opt-out. Subsequent persists are silent.

--fail-on now applies in fresh-audit mode: compares the new audit
against the previous persisted crawl via evaluateFailOn and exits
non-zero on regression. First run for a host warns and exits 0.
Disk-write failures don't fail the audit (warning only).

Diff-mode behavior of --fail-on is unchanged.
EOF
)"
```

---

## Task 6: CLI `seo-audit diff <url>` URL-detection branch

**Files:**
- Modify: `src/cli.ts` — extends the existing `diff` subcommand parser to accept a single URL argument, and adds the auto-pick logic in the diff runner.

- [ ] **Step 1: Add `diffAutoUrl` to the `CliOptions` interface**

Near the existing `diffOldPath` / `diffNewPath` fields (around line 53-55):

```ts
  diffAutoUrl: string | null;
```

Add the default in the options literal:
```ts
    diffAutoUrl: null,
```

- [ ] **Step 2: Add the `isHttpUrl` helper near other small helpers**

Pick a sensible location near other top-level helper functions in `src/cli.ts` (e.g., near `requireValue`, around line 119). Add:

```ts
function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Update the `diff` subcommand parser**

Find the existing diff parsing block (around lines 193-196):

```ts
  if (argv[0] === "diff") {
    options.diffMode = true;
    options.diffOldPath = argv[1] ?? null;
    options.diffNewPath = argv[2] ?? null;
    // ... existing arg-loop continues for other --flags ...
  }
```

Replace the three assignment lines with a URL-detection branch:

```ts
  if (argv[0] === "diff") {
    options.diffMode = true;
    const arg1 = argv[1];
    const arg2 = argv[2];
    if (arg1 && isHttpUrl(arg1) && !arg2) {
      options.diffAutoUrl = arg1;
    } else if (arg1 && arg2) {
      options.diffOldPath = arg1;
      options.diffNewPath = arg2;
    }
    // If neither form matched, both stay null and the runner errors below.
    // ... the rest of the existing diff-mode arg-parse loop continues unchanged ...
  }
```

(Keep the rest of the existing diff-mode parse loop intact — it parses additional flags like `--json`, `--output`, `--fail-on`.)

- [ ] **Step 4: Update the `Subcommands` block in `printHelp`**

Find the existing help text:
```
Subcommands:
  diff <old.json> <new.json>  Compare two report JSON files
```

Replace with:
```
Subcommands:
  diff <url>                  Compare the two most recent persisted crawls for <url>
  diff <old.json> <new.json>  Compare two report JSON files explicitly
```

- [ ] **Step 5: Update the diff runner in `main()`**

Find the existing diff-mode block (around lines 1002-1029). Replace it with:

```ts
    if (options.diffMode) {
      const { diffSiteReports, renderDiffText, renderDiffJson } = await import("./diff.js");
      let oldReport: SiteReport;
      let newReport: SiteReport;

      if (options.diffAutoUrl) {
        const recent = await recentCrawlsForUrl(options.diffAutoUrl, 2);
        if (recent.length < 2) {
          throw new Error(
            `Need at least 2 persisted crawls for ${options.diffAutoUrl} (have ${recent.length}). ` +
            `Run \`seo-audit ${options.diffAutoUrl}\` first, or pass explicit paths: ` +
            `\`seo-audit diff <old.json> <new.json>\`.`,
          );
        }
        oldReport = await loadCrawl(recent[1].path);
        newReport = await loadCrawl(recent[0].path);
        console.error(`Comparing ${recent[1].timestamp} → ${recent[0].timestamp}`);
      } else if (options.diffOldPath && options.diffNewPath) {
        const [oldRaw, newRaw] = await Promise.all([
          readFile(options.diffOldPath, "utf8"),
          readFile(options.diffNewPath, "utf8"),
        ]);
        const oldParsed = JSON.parse(oldRaw);
        const newParsed = JSON.parse(newRaw);
        oldReport = Array.isArray(oldParsed) ? oldParsed[0] : oldParsed;
        newReport = Array.isArray(newParsed) ? newParsed[0] : newParsed;
      } else {
        throw new Error("diff requires either <url> or <old.json> <new.json>");
      }

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

(`recentCrawlsForUrl` and `loadCrawl` were already imported in Task 5 Step 5. Confirm they are.)

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: clean.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`

Expected: full suite green (195 passed, 2 skipped).

- [ ] **Step 8: Smoke-test the auto-pick form**

```bash
TEST_DIR=$(mktemp -d)

# Persist two crawls for example.com
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR npx tsx src/cli.ts https://example.com --max-pages 1
sleep 1
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR npx tsx src/cli.ts https://example.com --max-pages 1

# Auto-pick diff
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR npx tsx src/cli.ts diff https://example.com 2>&1 | head -10
# Expect "Comparing <ts1> → <ts2>" stderr + a diff text-report.

# Auto-pick when only one crawl exists
TEST_DIR2=$(mktemp -d)
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR2 npx tsx src/cli.ts https://example.com --max-pages 1
SEO_AUDIT_CRAWLS_DIR=$TEST_DIR2 npx tsx src/cli.ts diff https://example.com 2>&1 | head -3
# Expect Error: "Need at least 2 persisted crawls for https://example.com (have 1) ..."

# Explicit-path form still works
JSON1=$TEST_DIR/example.com/$(ls $TEST_DIR/example.com | head -1)
JSON2=$TEST_DIR/example.com/$(ls $TEST_DIR/example.com | tail -1)
npx tsx src/cli.ts diff $JSON1 $JSON2 2>&1 | head -5

rm -rf $TEST_DIR $TEST_DIR2
```

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts
git commit -m "$(cat <<'EOF'
feat(cli): seo-audit diff <url> auto-picks the two most recent crawls

`seo-audit diff <url>` (one-arg URL form) loads the two newest
persisted crawls for the host and diffs them. Falls back to a clear
error when fewer than 2 crawls exist, with the exact command to run
to fix it.

The existing `seo-audit diff <old.json> <new.json>` (two-arg paths)
form is unchanged — used for explicit comparisons (e.g., before/after
a remediation engagement).
EOF
)"
```

---

## Task 7: README + CHANGELOG (v0.4.0)

**Files:**
- Modify: `README.md` — adds a Persistence subsection under Privacy, documents the new flags + env vars, calls out the `--fail-on` behavior change, adds a v0.4.0 CHANGELOG block.

- [ ] **Step 1: Add the `--no-persist` flag row to the GitHub Action Inputs table**

The `action.yml` does NOT need a new input for this — the persistence runs in the Action's runtime by default. CI users who want to opt out would set `SEO_AUDIT_NO_PERSIST=1` in their workflow's `env` block. Document this in the GitHub Action section of the README only; no `action.yml` change.

In `README.md`, find the "Useful Options" section (around line 101). After the existing `--output` / `--fail-on` rows, add the new row:

```
| `--no-persist` | Skip persisting the crawl to `~/.config/seo-audit/crawls/`. Default: every successful audit is persisted. Set `SEO_AUDIT_NO_PERSIST=1` to default the same. |
```

(Match the existing flag-row format. If the README's table syntax differs, adapt to it; the semantics are what matters.)

- [ ] **Step 2: Update the existing `--fail-on` row**

The current row likely reads something like:
```
| `--fail-on <severity>` | Exit non-zero if issues at this severity increased between two reports... |
```

Update to:
```
| `--fail-on <severity>` | Exit non-zero if issues at `<severity>` increased. Fresh-audit mode: compares to the previous persisted crawl. Diff mode: compares the two passed report files. One of: `high`, `medium`, `low`. |
```

- [ ] **Step 3: Add a "Persistence" subsection under "Privacy"**

Find the "Privacy" section (around line 365). Add a subsection at the end of it:

```markdown
### Persistence

Every successful audit is auto-saved to `~/.config/seo-audit/crawls/<host>/<timestamp>.json`
(mode `0700`, alongside the existing `gsc-key.json`). This enables:

- `seo-audit diff <url>` — compare the two most recent crawls of a host without
  having to remember file paths.
- `seo-audit <url> --fail-on <severity>` — gate cron / CI runs against
  regressions vs. the previous persisted crawl.

**The persisted JSON contains everything the audit captured**, including page
metadata, GSC/GA4 traffic data when enriched (`--gsc` / `--ga4`), and the full
body text per page. Treat the directory as you would any other client-data
artifact.

**Opt out** with `--no-persist` per run, or `SEO_AUDIT_NO_PERSIST=1` (or
`SEO_AUDIT_NO_PERSIST=true`) in your environment.

**Override the location** with `SEO_AUDIT_CRAWLS_DIR=<path>` — useful when the
default `$HOME/.config/` doesn't fit (sandboxed CI runners, separate volume, XDG
preferences).

**Retention:** none. Crawls accumulate forever. At ~5 MB per crawl × 250 weekly
crawls × 5 years per host, the footprint is around 1.3 GB per host long-term —
manageable. `rm -rf ~/.config/seo-audit/crawls/<host>/` if you ever want to
reset.
```

- [ ] **Step 4: Add a CHANGELOG entry for v0.4.0**

Find the existing CHANGELOG section (search for `## CHANGELOG`). Add a new top-level entry above `### v0.3.0`:

```markdown
### v0.4.0 — 2026-04-25

- **Added:** every successful audit is now persisted to
  `~/.config/seo-audit/crawls/<host>/<timestamp>.json` (mode `0700`).
  Opt out via `--no-persist` or `SEO_AUDIT_NO_PERSIST=1`.
- **Added:** `seo-audit diff <url>` auto-picks the two most recent
  persisted crawls of the host. The existing
  `seo-audit diff <old.json> <new.json>` form still works for
  explicit comparisons.
- **Added:** `SEO_AUDIT_CRAWLS_DIR` env var overrides the default
  crawls directory location.
- **Added:** `evaluateFailOn` helper exported from `dist/diff.js`
  for programmatic consumers.
- **Changed:** `--fail-on <severity>` now applies in fresh-audit mode
  too. It compares the new audit against the previous persisted crawl
  and exits non-zero if issues at the named severity increased. On the
  first run for a host, prints a "skipping regression check" warning
  and exits `0`. (Diff-mode behavior is unchanged.)
```

- [ ] **Step 5: Run the full test suite + build**

Run: `npm test`

Expected: 195 passed, 2 skipped.

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: clean.

Run: `npm run build`

Expected: builds cleanly to `dist/`.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: Phase 3 polish — persistence, --no-persist, --fail-on extension

Adds a Persistence subsection under Privacy explaining where crawls
live, what they contain, and how to opt out. Updates the --fail-on
table row to call out fresh-audit-mode behavior. Adds a v0.4.0
CHANGELOG block flagging the persistence side effect, the
`seo-audit diff <url>` auto-pick, the SEO_AUDIT_CRAWLS_DIR override,
and the --fail-on behavior change.
EOF
)"
```

---

## Verification (after Task 7)

Run the full test suite, typecheck, and build once more:

```bash
npm test
npx tsc --noEmit -p tsconfig.json
npm run build
```

Then run the manual smoke test (the one in §5.4 of the spec; commands also embedded in Task 5 Step 9 and Task 6 Step 8 above).

---

## Spec Coverage Self-Check

| Spec section | Implemented in |
|---|---|
| `~/.config/seo-audit/crawls/<host>/<timestamp>.json` location | Task 2 (`resolveCrawlsDir`), Task 3 (`persistCrawl`) |
| Mode `0o700` on host directory | Task 3 (`mkdir { mode: 0o700 }`) |
| Filename format with millisecond precision | Task 3 (`filenameFor`) |
| Same-millisecond collision handling (advance by 1ms) | Task 3 (`while (await pathExists(path))`) |
| `hostKeyFromUrl` rules (lowercase, www-strip, port handling, IDN) | Task 2 |
| `SEO_AUDIT_CRAWLS_DIR` override | Task 2 (`resolveCrawlsDir`) |
| `persistCrawl` returns `{ path, isFirstForHost, previousPath }` | Task 3 |
| `loadCrawl(path) → SiteReport` | Task 3 |
| `listCrawls(host)` returns newest-first; `[]` for missing dir | Task 4 |
| `recentCrawlsForUrl(url, count)` | Task 4 |
| Keep all forever, no auto-prune | Implied (no prune logic added in any task) |
| `--no-persist` flag + `SEO_AUDIT_NO_PERSIST` env | Task 5 |
| Auto-persist hook after each `analyze()` | Task 5 |
| First-run-per-host stderr notice | Task 5 |
| Disk-write failure → warning, audit completes | Task 5 (`try/catch`) |
| `--fail-on` extension to fresh-audit mode | Task 5 |
| First-run + `--fail-on` warns and exits 0 | Task 5 (the `if (!previous)` branch) |
| `--no-persist` + `--fail-on` still loads previous crawl | Task 5 (`else if (options.failOnSeverity)`) |
| `seo-audit diff <url>` auto-pick | Task 6 |
| `seo-audit diff` ambiguous error message | Task 6 (the `throw new Error("diff requires either ...")`) |
| `seo-audit diff <url>` with <2 crawls error | Task 6 |
| `evaluateFailOn` pure helper in `src/diff.ts` | Task 1 |
| README Persistence subsection + CHANGELOG | Task 7 |
| `--fail-on` help text update | Task 5 (Step 3) and Task 7 (Step 2) |
| Diff subcommand help text update | Task 6 (Step 4) |
| Tests for `hostKeyFromUrl` (8 cases) | Task 2 |
| Tests for `persistCrawl + loadCrawl` roundtrip + return contract + collision + permissions | Task 3 |
| Tests for `listCrawls` + `recentCrawlsForUrl` | Task 4 |
| Tests for `evaluateFailOn` (4 cases) | Task 1 |
| Manual smoke test | Task 5 Step 9 + Task 6 Step 8 |
| v0.4.0 CHANGELOG | Task 7 |
