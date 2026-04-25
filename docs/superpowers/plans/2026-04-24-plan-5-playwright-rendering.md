# Plan 5 — JS Rendering via Playwright

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--render` CLI flag that routes page fetching through a headless Playwright/Chromium browser instead of Node's `fetch`. This unlocks SPAs, Cloudflare JS-challenge sites, and any page whose final DOM depends on JavaScript execution.

**Architecture:** A new `src/render.ts` module exports a single async function `renderPage(url, options, context)` that returns the existing `FetchResult` shape, so downstream `analyzeHtml` logic needs zero changes. The browser is launched once at the top of `analyzeSite` and closed in a `finally` block. Each page gets a fresh `BrowserContext` (isolated cookies/cache) and a fresh `Page`, so no cross-page state leaks.

**Tech Stack:** `playwright` (bundled Chromium auto-download), existing TypeScript 6 + ESM + vitest setup.

**Scope exclusions:**
- Residential proxy / IP rotation — outside this plan; would be a separate flag (`--proxy`).
- Stealth plugins / fingerprint modification — default Chromium fingerprint is what's needed for Cloudflare JS challenges; stealth patches are an escalation if base rendering isn't enough.
- Resource blocking for speed — no blocking by default (we need images/CSS for image audit). Future `--render-block-assets` flag can be added.
- Capturing the full redirect chain during rendering — v1 sets `redirectChain: []` for rendered fetches. The `finalUrl` is still captured correctly (whatever Playwright navigated to). Documented limitation.
- Automated browser integration tests — gated behind `RUN_BROWSER_TESTS=1` env var so CI and the default `npm test` don't spin up Chromium.

---

## File Structure

New files:
- `src/render.ts` — exports `renderPage(url, options, context): Promise<FetchResult>` and helper `launchRenderBrowser(options): Promise<Browser>`.
- `tests/render.test.ts` — unit tests for pure adapter logic (timeout mapping, status extraction). Browser integration test behind env gate.

Modified files:
- `package.json` — add `playwright` to `dependencies`.
- `src/types.ts` — add `render?: boolean` and `renderTimeoutMs?: number` to `AnalyzeOptions`.
- `src/analyzer.ts` — launch browser once when `options.render === true`; route `analyzePage` through `renderPage` instead of `fetchText` when browser is present; close browser in `finally`.
- `src/cli.ts` — add `--render` and `--render-timeout-ms` flags; pass `render: true` in parsed options.
- `README.md` — document `--render` flag, install size, known limitations.

---

## Task 1: Install playwright and scaffold the render module

**Files:**
- Modify: `package.json`
- Create: `src/render.ts`
- Create: `tests/render.test.ts`

- [ ] **Step 1: Install playwright as a dependency (not devDep)**

Run: `npm install --save playwright`

Expected: `playwright` in `dependencies` in `package.json`. `package-lock.json` updates. The `postinstall` script auto-downloads Chromium (~300MB) — this may take a minute.

If the download fails in CI or behind a proxy, the user can skip via `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`, and then run `npx playwright install chromium` later. Note this in the README in Task 5.

- [ ] **Step 2: Write failing test**

Create `tests/render.test.ts` with EXACTLY:

```ts
import { describe, it, expect } from "vitest";
import { renderPage } from "../src/render.js";

describe("renderPage", () => {
  it("is exported as an async function", () => {
    expect(typeof renderPage).toBe("function");
    expect(renderPage.constructor.name).toBe("AsyncFunction");
  });
});
```

- [ ] **Step 3: Run — must fail (module does not exist)**

Run: `npm test -- tests/render.test.ts`

Expected: "Cannot find module '../src/render.js'".

- [ ] **Step 4: Implement stub**

Create `src/render.ts` with EXACTLY:

```ts
import type { BrowserContext } from "playwright";
import type { FetchResult } from "./analyzer.js";

export interface RenderOptions {
  timeoutMs: number;
  userAgent: string;
}

export async function renderPage(
  url: string,
  options: RenderOptions,
  context: BrowserContext,
): Promise<FetchResult> {
  throw new Error("renderPage not implemented yet — see Task 2");
}
```

- [ ] **Step 5: Run — must pass (the test only asserts the function exists)**

Run: `npm test -- tests/render.test.ts`

Expected: 1 test passes.

- [ ] **Step 6: Run full suite + build**

Run: `npm test && npm run build`

Expected: all 40 tests pass (39 prior + 1 new), build clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/render.ts tests/render.test.ts
git commit -m "feat: scaffold playwright render module"
```

---

## Task 2: Implement `renderPage` — real navigation

**Files:**
- Modify: `src/render.ts`
- Modify: `tests/render.test.ts`

- [ ] **Step 1: Append integration test gated by env var**

Append to `tests/render.test.ts`:

```ts
import { chromium } from "playwright";

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === "1";
const maybeDescribe = RUN_BROWSER_TESTS ? describe : describe.skip;

maybeDescribe("renderPage (integration)", () => {
  it("renders example.com and returns populated FetchResult", async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    try {
      const result = await renderPage(
        "https://example.com/",
        { timeoutMs: 30000, userAgent: "Mozilla/5.0 (test)" },
        context,
      );
      expect(result.status).toBe(200);
      expect(result.finalUrl).toMatch(/example\.com/);
      expect(result.text).toContain("<html");
      expect(result.headers["content-type"]).toMatch(/text\/html/i);
      expect(result.contentType).toMatch(/text\/html/i);
    } finally {
      await browser.close();
    }
  }, 60000);
});
```

This test only runs when `RUN_BROWSER_TESTS=1` is set — default `npm test` skips it.

- [ ] **Step 2: Run the regular suite (integration test should be skipped)**

Run: `npm test`

Expected: all tests pass; the new integration describe is listed as skipped (no browser launched).

- [ ] **Step 3: Implement `renderPage` fully**

Replace the stub in `src/render.ts`:

```ts
import type { BrowserContext, Response as PlaywrightResponse } from "playwright";
import type { FetchResult } from "./analyzer.js";

export interface RenderOptions {
  timeoutMs: number;
  userAgent: string;
}

export async function renderPage(
  url: string,
  options: RenderOptions,
  context: BrowserContext,
): Promise<FetchResult> {
  const page = await context.newPage();
  try {
    await page.setExtraHTTPHeaders({ "user-agent": options.userAgent });

    const response = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: options.timeoutMs,
    });

    if (!response) {
      throw new Error(`renderPage: no response for ${url}`);
    }

    const status = response.status();
    const finalUrl = page.url();
    const text = await page.content();
    const headers = normalizeHeaders(await response.allHeaders());
    const contentType = headers["content-type"] ?? null;

    return {
      contentType,
      finalUrl,
      redirectChain: [],
      status,
      text,
      headers,
    };
  } finally {
    await page.close();
  }
}

function normalizeHeaders(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
```

Note: the stub test from Task 1 still passes (`typeof renderPage === "function"`). The integration test only runs when gated env var is set.

- [ ] **Step 4: Run the regular suite**

Run: `npm test`

Expected: all non-gated tests still pass; integration test is skipped.

- [ ] **Step 5: Run the integration test manually**

Run: `RUN_BROWSER_TESTS=1 npm test -- tests/render.test.ts`

Expected: 1 skipped test becomes active; it launches Chromium, renders example.com, passes. Approx runtime: 5–15 seconds depending on network.

If this fails with "Executable doesn't exist" errors, run `npx playwright install chromium` and retry.

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat: implement renderPage with playwright navigation"
```

---

## Task 3: Launch a browser in `launchRenderBrowser`

**Files:**
- Modify: `src/render.ts`

A small helper so `analyzer.ts` doesn't have to know which engine to launch.

- [ ] **Step 1: Append helper**

Append to `src/render.ts`:

```ts
import { chromium, type Browser } from "playwright";

export interface BrowserLaunchOptions {
  headless?: boolean;
}

export async function launchRenderBrowser(
  options: BrowserLaunchOptions = {},
): Promise<Browser> {
  return chromium.launch({ headless: options.headless ?? true });
}
```

(Move the top import of `chromium` into the existing imports block if cleaner; the file ends up with a single playwright import block.)

- [ ] **Step 2: Build check**

Run: `npm run build`

Expected: clean.

Run: `npm test`

Expected: all non-gated tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/render.ts
git commit -m "feat: add launchRenderBrowser helper"
```

---

## Task 4: Thread `render` option through `AnalyzeOptions` + analyzer

**Files:**
- Modify: `src/types.ts`
- Modify: `src/analyzer.ts`

- [ ] **Step 1: Extend AnalyzeOptions**

In `src/types.ts`, locate `AnalyzeOptions` (around line 180–196). Add two optional fields:

```ts
render?: boolean;
renderTimeoutMs?: number;
```

- [ ] **Step 2: Launch browser in `analyzeSite` when render is enabled**

In `src/analyzer.ts`, locate `analyzeSite` (around line 2091). Near the top of the function, before the crawl begins, add:

```ts
let renderBrowser: import("playwright").Browser | null = null;
try {
  if (options.render) {
    const { launchRenderBrowser } = await import("./render.js");
    renderBrowser = await launchRenderBrowser();
  }

  // ... existing crawl logic, passing renderBrowser into analyzePage ...

} finally {
  if (renderBrowser) {
    await renderBrowser.close();
  }
}
```

Wrap the existing crawl body (from where it was before your edit down to the final return) in the `try`. The `finally` ensures the browser closes even if the crawl throws.

The dynamic `import("./render.js")` is deliberate — it avoids forcing playwright to be loaded into memory when `--render` is off. Costs a ~20ms first-use latency; saves ~50MB of resident RAM.

- [ ] **Step 3: Route `analyzePage` through `renderPage` when browser is provided**

Still in `src/analyzer.ts`, find `analyzePage` (around line 1588). Add `renderBrowser: Browser | null = null` as a parameter (after existing params; default null for backward compat).

Inside `analyzePage`, where `fetchText` is currently called, branch:

```ts
let fetchResult: FetchResult;
if (renderBrowser) {
  const { renderPage } = await import("./render.js");
  const context = await renderBrowser.newContext();
  try {
    fetchResult = await renderPage(
      url,
      {
        timeoutMs: options.renderTimeoutMs ?? options.timeoutMs ?? 30000,
        userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
      },
      context,
    );
  } finally {
    await context.close();
  }
} else {
  fetchResult = await fetchText(url, { /* existing args */ });
}
```

Keep the existing retry / redirect-chain logic for the non-render path untouched. Rendered pages do not use the retry wrapper in v1 — Playwright's own timeout handles transient failures. Document this in a comment if it feels surprising.

- [ ] **Step 4: Thread `renderBrowser` through call sites**

`analyzePage` is called at two sites in `analyzeSite` (start page + crawl loop). Update both to pass `renderBrowser`.

- [ ] **Step 5: Run the full suite + build**

Run: `npm test`

Expected: all non-gated tests still pass. No new tests needed for this task — the existing tests don't exercise `--render` (they exercise the check modules, which don't care how the HTML arrived).

Run: `npm run build`

Expected: clean. The dynamic import shouldn't produce new TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/analyzer.ts
git commit -m "feat: route analyzePage through playwright when render enabled"
```

---

## Task 5: Add `--render` CLI flag

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add flag parsing**

In `src/cli.ts`, find the CLI arg parser (likely a `for` loop iterating over `process.argv` or similar). Add handling for:

- `--render` — sets `options.render = true` (no value required).
- `--render-timeout-ms <n>` — sets `options.renderTimeoutMs = Number(n)`.

Follow the existing style (other boolean flags like `--full-sitemap` are a reference).

- [ ] **Step 2: Add help text**

Find the `--help` output block. Append:

```
  --render                   Render pages with headless Chromium (Playwright) instead of raw fetch — needed for SPAs and JS-challenge sites
  --render-timeout-ms <n>    Timeout per page render in milliseconds (default: 30000)
```

- [ ] **Step 3: Run smoke test with rendering**

Run: `npm run dev -- https://example.com --render --max-pages 2`

Expected: CLI launches Chromium (first run may print a Chromium-download message if browsers aren't cached yet), crawls 1–2 pages via rendering, emits the report with no crash. Should take 5–15 seconds on a warm cache.

If it fails with "Executable doesn't exist": run `npx playwright install chromium` and retry.

- [ ] **Step 4: Run the non-render smoke test (regression check)**

Run: `npm run dev -- https://example.com --max-pages 2`

Expected: works exactly as before. No browser launched. Same speed as pre-Plan 5.

- [ ] **Step 5: Run the full suite + build**

Run: `npm test && npm run build`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --render CLI flag"
```

---

## Task 6: Documentation + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the flag**

In `README.md`, under "Useful Options" (the section with the `npm run dev -- ...` examples), add:

````markdown
```bash
# Render pages with headless Chromium (Playwright) — needed for SPAs,
# JS-challenge sites (Cloudflare turnstile), and pages whose final DOM
# depends on JS. Slower and heavier than the default static fetch.
npm run dev -- https://example.com --render --max-pages 5
```

Notes on `--render`:
- First `npm install` auto-downloads Chromium (~300MB). To skip (e.g. CI), set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and run `npx playwright install chromium` later.
- Rendering is slower than raw fetch (typical: 2–10s per page). Use `--max-pages` to scope.
- Known limitation: `redirectChain` is not captured for rendered pages in v1. The `finalUrl` is still accurate.
````

Also under "What It Checks", no new bullet is needed — rendering changes HOW pages are fetched, not which issues are checked.

- [ ] **Step 2: Run the full suite + build**

Run: `npm test && npm run build`

Expected: all 40 tests pass, build clean.

- [ ] **Step 3: Targeted smoke test against a Cloudflare-blocked site**

If there's a site that previously returned `FETCH_FAILED` without rendering (the user's `ricepolak` report is the canonical example), try:

```bash
npm run dev -- https://<that-site> --render --max-pages 5
```

Expected: some previously-blocked pages now return 200 and real HTML. If the site is blocking by IP reputation, `--render` alone won't help — escalate to proxy support (out of scope).

Paste a before/after summary in the final commit-ready report.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document --render flag and its tradeoffs"
```

- [ ] **Step 5: Branch history check**

Run: `git log --oneline feature/phase1-test-harness ^main`

Expected: prior Plan 0 + Plan 1 commits + the Plan 5 commits (scaffold, implement, launch helper, wire through analyzer, CLI flag, docs). All clearly labeled with `feat:`, `chore:`, or `docs:` prefixes.

---

## Self-Review Notes

- **Spec coverage:** The single Phase 1 roadmap item for Plan 5 is "`--render` CLI flag; JS rendering via Playwright." Tasks 1–5 deliver that. Task 6 covers documentation and manual verification against the actual use case (Cloudflare block).
- **Placeholder scan:** Every task has concrete code; no "TBD" or "similar to above." The `// ... existing args ...` in Task 4 Step 3 is intentional — the existing `fetchText` call's arguments should stay untouched; only the branch around it is new.
- **Type consistency:** `FetchResult` is imported from `src/analyzer.ts` in `src/render.ts` (it's already exported there per Plan 1 Task 5). `RenderOptions` is a new interface scoped to rendering; it intentionally differs from `AnalyzeOptions` (narrower, no crawl-level options needed).
- **Tests:** Unit test for export presence (Task 1). Integration test gated behind env var (Task 2). No unit tests for the CLI parsing beyond smoke testing — aligns with project convention (no existing CLI unit tests).
- **Playwright dep vs playwright-core:** Chose `playwright` for the simpler user experience. Documented the opt-out in README. Can migrate to `playwright-core` later if install size becomes a complaint.
