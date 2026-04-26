# Phase 3 polish — crawl persistence + auto-diff + fresh-mode `--fail-on`

**Date:** 2026-04-25
**Status:** Approved, pending implementation plan
**Target version:** v0.4.0

## Goal

Turn the seo-audit CLI from a one-shot audit tool into a recurring monitoring tool by persisting every audit to disk and letting `--fail-on` gate fresh audits against the previous persisted run.

This closes the third Phase 3 item in `ROADMAP.md` ("Persist each crawl as timestamped JSON in a `.seo-audit/` directory") and extends the `--fail-on` flag from diff-mode-only to also work in fresh-audit mode — the cron/CI use case the roadmap calls "ContentKing-lite monitor for anyone with a scheduler."

## Non-goals

- No retention/pruning policy. Crawls are kept forever; users manage disk via `rm` if they ever care. Adding pruning later is straightforward; doing it now is a feature with non-zero failure modes (e.g., losing your only baseline because you ran 51 quick test audits in one afternoon).
- No `seo-audit history <url>` visibility command. The data lives at `~/.config/seo-audit/crawls/<host>/` as plain JSON files; `ls -lh` and `jq` cover the visibility need with standard tools. Easy to add in a follow-up if a real workflow demands it.
- No SQLite/embedded database. The JSON files already are the source of truth.
- No `--from <timestamp> --to <timestamp>` for arbitrary date-range diffs. `seo-audit diff <old.json> <new.json>` already covers explicit comparisons; the new auto-pick form covers "what changed since last time."

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Persistence location | Global at `~/.config/seo-audit/crawls/<host>/<timestamp>.json`, mirroring where the GSC wizard already writes its key. Cron-friendly (no CWD discipline required). |
| 2 | Retention | Keep all forever. No auto-prune. |
| 3 | Diff syntax | `seo-audit diff <url>` auto-picks the two most recent crawls. Existing `seo-audit diff <old.json> <new.json>` form retained for explicit comparisons. |
| 4 | Persistence default | Always-on. Opt-out via `--no-persist` flag or `SEO_AUDIT_NO_PERSIST=1` env var. |
| 5 | `--fail-on` in fresh-audit mode | Diff against the previous persisted crawl. Print a one-line "skipping regression check" warning on the first run for a host. |

### Open-source backwards-compatibility constraints

The package is published to npm as `@davo20019/seo-audit` and ships v0.3.0 in production. Phase 3 polish has three OSS-relevant considerations:

- **New disk side effect.** Today, `seo-audit https://example.com` writes nothing to disk unless `--output` is passed. Persistence-by-default is a behavior change. Mitigations:
  - One-line stderr notice on the **first persist for a given host** pointing at `--no-persist` and the env var. Silent thereafter.
  - `SEO_AUDIT_NO_PERSIST=1` env var as an alias for the flag (set once in cron/CI environments).
  - README "Privacy" subsection documenting where files live, what they contain, and how to opt out.

- **`--fail-on` behavior change.** Today the help text reads "Diff mode only." After v0.4 the same flag also gates fresh-audit mode against the previous persisted crawl. Anyone who scripted `seo-audit https://site.com --fail-on high` today gets `0` (flag silently no-ops); after v0.4 they get a real exit code based on regressions. CHANGELOG records this under **Changed:**, not **Added:**.

- **Crawl directory permissions.** Persisted crawls contain whatever the audit captured — page metadata, GSC/GA4 traffic data when enriched, full body text. That's per-client sensitive for a consultant. The `mkdir` for the crawls directory and per-host subdirectories sets mode `0o700` (user-only), matching the permission posture the existing GSC wizard uses on the key file.

- **Layout compatibility.** v0.3 users already have `~/.config/seo-audit/gsc-key.json`. Adding `~/.config/seo-audit/crawls/<host>/` as a sibling is fully additive — no migration, the existing key is untouched. README calls this out so anyone reviewing the change sees we're not touching their key.

## Architecture

### Module layout

```
src/persist.ts           (NEW)
  PersistedCrawl helpers, host-key normalization, listing, loading.

src/diff.ts              (MODIFIED)
  Adds evaluateFailOn(current, previous, severity): FailOnDecision
  pure helper. Existing diff/render functions unchanged.

src/cli.ts               (MODIFIED)
  - Adds --no-persist flag and SEO_AUDIT_NO_PERSIST env-var handling.
  - Auto-persist hook after analyze() succeeds (per URL).
  - Extended --fail-on branch for fresh-audit mode.
  - `seo-audit diff <url>` URL-detection branch (auto-pick).
  - Help-text updates for both --fail-on and the diff subcommand.

tests/persist.test.ts    (NEW)
  hostKeyFromUrl rules, persist/load roundtrip, listCrawls ordering,
  recentCrawlsForUrl, same-ms collision, dir permissions.

tests/diff.test.ts       (EXTENDED)
  4 new evaluateFailOn cases (no previous, zero delta, positive delta,
  improvement).

README.md                (MODIFIED)
  - "Persistence" subsection under Privacy.
  - --no-persist + SEO_AUDIT_NO_PERSIST docs.
  - --fail-on extended-behavior callout.
  - CHANGELOG v0.4.0 entry.
```

### Module dependency direction

One-way: `cli → persist`, `cli → diff`. `persist` depends only on `node:fs/promises`, `node:os`, `node:path`. `diff` already depends only on `./types.js`. No new top-level package dependencies.

## Data model (`src/persist.ts`)

```ts
import type { SiteReport } from "./types.js";

export interface CrawlEntry {
  path: string;       // absolute file path
  timestamp: string;  // ISO from filename, e.g. "2026-04-25T19-34-56-789Z"
  host: string;       // host key the entry belongs to
  size: number;       // bytes
  mtime: Date;        // filesystem mtime
}

export interface PersistResult {
  path: string;                // where this crawl landed
  isFirstForHost: boolean;     // drives the stderr notice
  previousPath: string | null; // path of prior most-recent, or null on first run
}

export function resolveCrawlsDir(): string;          // honors SEO_AUDIT_CRAWLS_DIR
export function hostKeyFromUrl(url: string): string;
export async function persistCrawl(
  report: SiteReport,
  opts?: { now?: () => Date },
): Promise<PersistResult>;
export async function listCrawls(host: string): Promise<CrawlEntry[]>;  // newest-first
export async function loadCrawl(path: string): Promise<SiteReport>;
export async function recentCrawlsForUrl(
  url: string,
  count: number,
): Promise<CrawlEntry[]>;
```

### `hostKeyFromUrl` rules

- Lowercase the hostname.
- Strip leading `www.` (so `www.example.com` and `example.com` share history).
- Default ports (80/443) dropped; non-default ports preserved as `host_port` (e.g. `localhost_3000`).
- IDN/Unicode hosts kept in their punycode form (what `new URL().hostname` returns), which is already filesystem-safe.
- Throws on unparseable URLs (defensive — `analyze()` would have caught this earlier in production).

### Filename format

`{ISO-with-colons-and-dots-replaced-by-dashes}.json`, e.g. `2026-04-25T19-34-56-789Z.json`. Millisecond precision avoids same-second collisions in scripted runs; lexicographic sort matches chronological sort. If a same-millisecond collision somehow occurs, append `-1`, `-2`, etc.

### Directory layout

```
~/.config/seo-audit/
├── gsc-key.json                        (existing — untouched)
└── crawls/                             (new, mode 0o700)
    └── <host-key>/                     (mode 0o700)
        ├── 2026-04-25T19-34-56-789Z.json
        ├── 2026-05-02T08-15-22-104Z.json
        └── ...
```

`mkdir { mode: 0o700, recursive: true }` on first write per host. The `recursive: true` is safe-additive against an existing `~/.config/seo-audit/`.

### `SEO_AUDIT_CRAWLS_DIR` override

`resolveCrawlsDir()` honors the `SEO_AUDIT_CRAWLS_DIR` env var when set. Used by tests (set to a temp dir in `beforeEach`) and exposed as a documented power-user override (e.g., for users who prefer XDG `$XDG_CONFIG_HOME` semantics or who want the crawls on a different volume).

## CLI changes (`src/cli.ts`)

### New flag: `--no-persist`

Added to `CliOptions`:
```ts
  noPersist: boolean;
```

Help text:
```
--no-persist               Skip persisting the crawl to ~/.config/seo-audit/crawls/.
                           Default: every successful audit is persisted.
                           Env: SEO_AUDIT_NO_PERSIST=1 sets the same.
```

Parse branch alongside other booleans. Runtime check:
```ts
const persistDisabled =
  options.noPersist ||
  process.env.SEO_AUDIT_NO_PERSIST === "1" ||
  process.env.SEO_AUDIT_NO_PERSIST === "true";
```

### Auto-persist hook

In the per-URL loop, immediately after `analyze()` returns:

```ts
let previousPath: string | null = null;
const shouldPersist = !persistDisabled;

if (shouldPersist) {
  try {
    const result = await persistCrawl(report);
    previousPath = result.previousPath;
    if (result.isFirstForHost) {
      process.stderr.write(
        `Persisting crawl to ${result.path}. Use --no-persist (or SEO_AUDIT_NO_PERSIST=1) to opt out.\n`,
      );
    }
  } catch (err) {
    // disk write failures don't fail the audit
    process.stderr.write(`Warning: failed to persist crawl: ${(err as Error).message}\n`);
  }
} else if (options.failOnSeverity) {
  // user opted out of persistence but wants fail-on — find previous without writing
  const recent = await recentCrawlsForUrl(report.startUrl, 1);
  previousPath = recent[0]?.path ?? null;
}
```

### `--fail-on` extension to fresh-audit mode

Right after the persist hook:

```ts
if (options.failOnSeverity && !options.diffMode) {
  let previous: SiteReport | null = null;
  if (previousPath) previous = await loadCrawl(previousPath);
  const decision = evaluateFailOn(report, previous, options.failOnSeverity);
  if (!previous) {
    process.stderr.write(
      `No prior crawl found for ${report.startUrl}; skipping --fail-on regression check.\n`,
    );
  } else if (decision.shouldFail) {
    process.stderr.write(
      `--fail-on ${options.failOnSeverity}: ${decision.reason}\n`,
    );
    process.exit(1);
  }
}
```

Updated help text for the existing `--fail-on` flag:
```
--fail-on <severity>       Exit non-zero if issues at <severity> increased.
                           Fresh-audit mode: compares to the previous persisted crawl.
                           Diff mode: compares the two passed report files.
                           One of: high, medium, low.
```

### `seo-audit diff <url>` auto-pick branch

Current parser at `src/cli.ts:193-196`:
```ts
if (argv[0] === "diff") {
  options.diffMode = true;
  options.diffOldPath = argv[1] ?? null;
  options.diffNewPath = argv[2] ?? null;
}
```

Becomes:
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
  // else: leave both null; the runner below errors with usage hint
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
```

The diff runner extends to handle the auto-pick path:
```ts
if (options.diffMode) {
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
    oldReport = await loadCrawl(recent[1].path);  // older
    newReport = await loadCrawl(recent[0].path);  // newer
    process.stderr.write(`Comparing ${recent[1].timestamp} → ${recent[0].timestamp}\n`);
  } else if (options.diffOldPath && options.diffNewPath) {
    // existing explicit-path logic intact
    const [oldRaw, newRaw] = await Promise.all([
      readFile(options.diffOldPath, "utf8"),
      readFile(options.diffNewPath, "utf8"),
    ]);
    oldReport = JSON.parse(oldRaw);
    newReport = JSON.parse(newRaw);
  } else {
    throw new Error("diff requires either <url> or <old.json> <new.json>");
  }

  // existing renderDiffText/renderDiffJson + fail-on gating intact
}
```

Updated help-text Subcommands block:
```
Subcommands:
  diff <url>                  Compare the two most recent persisted crawls for <url>
  diff <old.json> <new.json>  Compare two report JSON files explicitly
```

## New helper in `src/diff.ts`: `evaluateFailOn`

Added to keep the CLI's fail-on conditional logic testable in pure form:

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

## End-to-end walkthroughs

### Cron monitor for a single client

Daily cron:
```sh
seo-audit https://client-site.com --gsc --ga4 --fail-on high
```

**Day 1 (first run):** analyze → persist (`isFirstForHost: true`, `previousPath: null`) → stderr first-run notice → `--fail-on` skips with "no prior crawl" warning → exit 0.

**Day 2 (no regressions):** analyze → persist (silent) → load previous → diff → `severityDelta.high === 0` → exit 0.

**Day 9 (regression after deploy):** analyze (5 high vs 2 previous) → persist → load previous → diff → `severityDelta.high = +3` → stderr `--fail-on high: 3 more high-severity issue(s) than previous crawl.` → `process.exit(1)` → cron job fails.

### Smoke test — opt-out of persistence, still gate

```sh
seo-audit https://staging.client.com --gsc --no-persist --fail-on high
```

`shouldPersist === false` → skip `persistCrawl`. The else branch: `recentCrawlsForUrl(url, 1)` finds the latest persisted prod crawl. Diff fresh-staging vs. last-prod. Exit code based on regression. Nothing added to history.

### Disk-write failure

`persistCrawl` throws (EACCES, ENOSPC, etc.). The try/catch swallows it: stderr `Warning: failed to persist crawl: <message>`. `previousPath` stays null. Audit still prints its report; exit 0 (audit succeeded). If `--fail-on` was set, the no-prior-crawl warning fires; CI doesn't lose the report but does lose the regression gate for that run.

### `seo-audit diff <url>` with only one prior crawl

`recentCrawlsForUrl(..., 2)` returns 1 entry. Throws actionable message:
```
Need at least 2 persisted crawls for https://client-site.com (have 1).
Run `seo-audit https://client-site.com` first, or pass explicit paths:
`seo-audit diff <old.json> <new.json>`.
```
Exit non-zero. No state mutation.

### v0.3 user upgrading

Existing `~/.config/seo-audit/gsc-key.json` remains untouched. First run after upgrade creates `~/.config/seo-audit/crawls/<host>/` (mode 0700). First-host stderr notice fires once. Subsequent runs are silent persist.

## Tests

### `tests/persist.test.ts` (NEW)

Setup: `beforeEach` creates a temp dir via `mkdtemp`, sets `SEO_AUDIT_CRAWLS_DIR`. `afterEach` cleans up via `rm -rf`.

**`hostKeyFromUrl` table** (8 cases): default-vs-non-default ports, www stripping, lowercasing, IDN punycode, throws on unparseable.

**Roundtrip:** `persistCrawl(report)` → `loadCrawl(result.path)` deep-equals the original. File at expected path. Host directory is mode `0o700`.

**Return contract:** first persist → `{ isFirstForHost: true, previousPath: null }`; second → `{ isFirstForHost: false, previousPath: <first path> }`; first persist for a different host → `isFirstForHost: true` again (per-host bookkeeping).

**`listCrawls`:** missing dir returns `[]`; three persists return 3 entries newest-first.

**`recentCrawlsForUrl`:** N=2 after 5 persists returns 2; N=2 after 1 persist returns 1 (no padding).

**Same-ms collision:** inject frozen clock via `opts.now`; two persists, second gets `-1` suffix; both readable; `listCrawls` parses both timestamps correctly.

### `tests/diff.test.ts` (EXTEND)

Add 4 `evaluateFailOn` cases:
1. `previous === null` → no fail, "skipping" reason, delta 0.
2. previous + delta 0 → no fail.
3. previous + delta +3 → fail, reason mentions "3 more high-severity".
4. previous + delta -2 (improvement) → no fail.

### Why no dedicated CLI integration tests

The CLI changes are thin glue:
- `--no-persist` boolean parsing — same pattern as 30+ existing flags.
- Auto-persist hook — a single try/catch around `persistCrawl(report)`.
- `seo-audit diff <url>` URL detection — `isHttpUrl(s)` is 3 lines.

Each piece's interesting logic lives in unit-tested helpers (`persistCrawl`, `evaluateFailOn`). The CLI is a thin caller. Following the codebase's existing convention (no `tests/cli.test.ts` today), the integration is verified by the smoke test below rather than a dedicated CLI test file.

### Manual smoke test (run once before merging)

```sh
unset SEO_AUDIT_CRAWLS_DIR
rm -rf ~/.config/seo-audit/crawls/example.com 2>/dev/null

# First run — first-host notice, no fail-on diff
seo-audit https://example.com --max-pages 3 --fail-on high

# Verify file
ls -la ~/.config/seo-audit/crawls/example.com/

# Second run — silent persist, fail-on does the comparison
seo-audit https://example.com --max-pages 3 --fail-on high

# Diff auto-pick
seo-audit diff https://example.com

# Opt-out
seo-audit https://example.com --max-pages 3 --no-persist
ls -la ~/.config/seo-audit/crawls/example.com/  # unchanged from prior step
```

## CHANGELOG plan (for v0.4.0)

```markdown
### v0.4.0 — 2026-04-25 (planned)

- **Added:** every successful audit is now persisted to
  `~/.config/seo-audit/crawls/<host>/<timestamp>.json` (mode 0700).
  Opt out via `--no-persist` or `SEO_AUDIT_NO_PERSIST=1`.
- **Added:** `seo-audit diff <url>` auto-picks the two most recent
  persisted crawls of the host. Existing
  `seo-audit diff <old.json> <new.json>` still works for explicit
  comparisons.
- **Added:** `SEO_AUDIT_CRAWLS_DIR` env var overrides the default
  crawls directory location.
- **Changed:** `--fail-on <severity>` now applies in fresh-audit mode
  too. It compares the new audit against the previous persisted crawl
  and exits non-zero if issues at the named severity increased. On the
  first run for a host, prints a "skipping regression check" warning
  and exits 0. (Diff-mode behavior is unchanged.)
- **Added:** `evaluateFailOn` helper exported from `dist/diff.js` for
  programmatic consumers.
```

## Risks & open questions

- **Sandboxed environments and read-only home directories.** `persistCrawl` errors are caught and turned into a stderr warning rather than failing the audit. Worst case for a CI runner with a read-only `$HOME`: every run prints the warning. The user can `export SEO_AUDIT_NO_PERSIST=1` once in the runner config to silence it. Worth testing on a representative CI runner before release.
- **Disk usage growth at scale.** Estimated ~5MB per crawl × ~250 weekly crawls/year = ~1.3GB after five years for one host. Multiply across N clients. Real but easily managed with `rm -rf <old-host>/` if it ever matters. The roadmap explicitly defers retention to a follow-up.
- **`SEO_AUDIT_CRAWLS_DIR` user-facing complexity.** Documented but rarely needed. Worth flagging in README so power users know the escape valve exists; not worth promoting in any "getting started" docs.
- **First-run notice frequency.** A user running audits across many one-off domains (e.g., quick competitive checks) will see the first-host notice repeatedly until each new host has been persisted once. Acceptable: the notice is one line and tells them how to silence it.
