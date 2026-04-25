# Plan 6 — Render Retry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Wrap `renderPage` in retry-with-backoff so transient Playwright failures (timeouts, navigation errors, ad-script hangs) don't permanently mark a page as `FETCH_FAILED`. Mirrors the existing `fetchTextWithRetry` pattern (analyzer.ts:406).

**Architecture:** New `renderPageWithRetry` function in `src/render.ts` accepts an injectable `renderImpl` (defaults to `renderPage`) for testability. Retries on thrown errors only — does NOT retry based on HTTP status (Playwright already returns the status; if the page rendered with status 500, retrying won't help). Uses `options.retries` already on `FetchOptions`. Backoff: 250ms × 2^attempt, matching the existing `RETRY_BASE_DELAY_MS` cadence.

**Tech Stack:** Same as prior plans.

**Scope exclusions:**
- Smarter error classification (e.g., distinguishing `net::ERR_*` from generic timeouts) — v1 retries any thrown error.
- User-configurable backoff multiplier — uses the same constant the raw fetch uses.

---

## File Structure

Modified:
- `src/render.ts` — add `renderPageWithRetry`.
- `tests/render.test.ts` — tests for the retry function with a mocked renderImpl.
- `src/analyzer.ts` — replace the direct `renderPage` call in `analyzePage` with `renderPageWithRetry`.

---

## Task 1: renderPageWithRetry + tests

**Files:**
- Modify: `src/render.ts`
- Modify: `tests/render.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/render.test.ts` (place AFTER the existing describe blocks but BEFORE the integration `maybeDescribe` block, since this is unit-test territory):

```ts
import { renderPageWithRetry } from "../src/render.js";
import type { BrowserContext } from "playwright";

describe("renderPageWithRetry", () => {
  const fakeContext = {} as BrowserContext;
  const goodResult = {
    contentType: "text/html",
    finalUrl: "https://x/",
    redirectChain: [],
    status: 200,
    text: "<html></html>",
    headers: { "content-type": "text/html" },
  };

  it("returns immediately on success", async () => {
    let calls = 0;
    const renderImpl = async () => {
      calls++;
      return goodResult;
    };
    const result = await renderPageWithRetry(
      "https://x/",
      { timeoutMs: 1000, userAgent: "x" },
      fakeContext,
      3,
      renderImpl,
    );
    expect(result).toEqual(goodResult);
    expect(calls).toBe(1);
  });

  it("retries on thrown errors and eventually succeeds", async () => {
    let calls = 0;
    const renderImpl = async () => {
      calls++;
      if (calls < 3) throw new Error("timeout");
      return goodResult;
    };
    const result = await renderPageWithRetry(
      "https://x/",
      { timeoutMs: 1000, userAgent: "x" },
      fakeContext,
      3,
      renderImpl,
    );
    expect(result).toEqual(goodResult);
    expect(calls).toBe(3);
  });

  it("throws if all retries are exhausted", async () => {
    let calls = 0;
    const renderImpl = async () => {
      calls++;
      throw new Error("persistent failure");
    };
    await expect(
      renderPageWithRetry(
        "https://x/",
        { timeoutMs: 1000, userAgent: "x" },
        fakeContext,
        2,
        renderImpl,
      ),
    ).rejects.toThrow("persistent failure");
    expect(calls).toBe(3); // initial + 2 retries
  });

  it("does not retry on a successful render with non-2xx status (status is a final answer)", async () => {
    let calls = 0;
    const errResult = { ...goodResult, status: 500 };
    const renderImpl = async () => {
      calls++;
      return errResult;
    };
    const result = await renderPageWithRetry(
      "https://x/",
      { timeoutMs: 1000, userAgent: "x" },
      fakeContext,
      3,
      renderImpl,
    );
    expect(result.status).toBe(500);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/render.test.ts`

Expected: 1 prior pass + 4 new fail (renderPageWithRetry not exported).

- [ ] **Step 3: Implement**

Append to `src/render.ts` at END:

```ts
const RENDER_RETRY_BASE_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function renderPageWithRetry(
  url: string,
  options: RenderOptions,
  context: BrowserContext,
  retries: number,
  renderImpl: typeof renderPage = renderPage,
): Promise<FetchResult> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await renderImpl(url, options, context);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
      await sleep(RENDER_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw (lastError instanceof Error ? lastError : new Error(`Unable to render ${url}`));
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/render.test.ts`

Expected: 5 unit tests pass (1 prior + 4 new). The integration test stays skipped.

- [ ] **Step 5: Full suite + build**

Run: `npm test`

Expected: 90 total (86 prior + 4 new).

Run: `npm run build`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/render.ts tests/render.test.ts
git commit -m "feat: add renderPageWithRetry with exponential backoff"
```

---

## Task 2: Wire into analyzer.ts

**Files:**
- Modify: `src/analyzer.ts`

- [ ] **Step 1: Update import**

Locate the existing dynamic import in `analyzePage` (around the render branch added in Plan 5). It currently imports `renderPage`:

```ts
const { renderPage } = await import("./render.js");
```

Replace with:

```ts
const { renderPageWithRetry } = await import("./render.js");
```

- [ ] **Step 2: Replace the call**

In the same block, change:

```ts
response = await renderPage(
  url,
  { timeoutMs: ..., userAgent: ... },
  context,
);
```

to:

```ts
response = await renderPageWithRetry(
  url,
  { timeoutMs: ..., userAgent: ... },
  context,
  options.retries ?? 0,
);
```

`options.retries` is already on `FetchOptions` and is set via `rawOptions.retries ?? DEFAULT_RETRIES` in `analyzeSite` (around line 2160). Reuse that — no new option needed.

- [ ] **Step 3: Build + tests**

Run: `npm run build`

Expected: clean.

Run: `npm test`

Expected: 90 still pass.

- [ ] **Step 4: Smoke (no render)**

Run: `npm run dev -- https://example.com --max-pages 2 2>&1 | tail -3`

Expected: works as before.

- [ ] **Step 5: Smoke (render)**

Run: `npm run dev -- https://example.com --render --max-pages 2 2>&1 | tail -3`

Expected: works as before. example.com is a stable host so retry doesn't kick in but the path is exercised.

- [ ] **Step 6: Commit**

```bash
git add src/analyzer.ts
git commit -m "feat: use renderPageWithRetry for rendered pages"
```

---

## Task 3: README note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the `--render` notes block**

Find the "Notes on `--render`:" block in README.md. Replace its bullets with:

```
- First `npm install` auto-downloads Chromium (~300MB). To skip (e.g. CI), set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` and run `npx playwright install chromium` later.
- Rendering is slower than raw fetch (typical: 2–10s per page). Use `--max-pages` to scope.
- Render uses `--retries` (default 3) with exponential backoff on transient failures (navigation timeouts, ad-script hangs).
- Known limitation: `redirectChain` is not captured for rendered pages in v1. The `finalUrl` is still accurate.
```

(The third bullet is new; preserves the others.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: note render retry behavior"
```

---

## Self-Review Notes

- **Spec coverage:** Retry wrapper with exponential backoff (Task 1), wired into analyzer (Task 2), documented (Task 3). Reuses `options.retries` so no new CLI flag.
- **Placeholder scan:** All steps complete. Variable names in Task 2 (`url`, `options.retries`, `context`) need to match what's in scope at the existing call site — implementer should verify by reading the surrounding lines.
- **Type consistency:** `renderImpl: typeof renderPage` keeps the signature aligned even if `renderPage` evolves.
