# Test Harness Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vitest as the project's test harness and establish the testing pattern with characterization tests for existing pure functions, so all subsequent Phase 1 plans can follow strict TDD.

**Architecture:** Install vitest as a devDependency. Tests live in a top-level `tests/` directory mirroring `src/` structure. Vitest compiles TypeScript on the fly via esbuild, so no changes to the production `tsconfig.json` are required — the build (`npm run build`) continues to emit only `src/` as before. Two npm scripts added: `npm test` (single run, CI-friendly) and `npm run test:watch` (interactive).

**Tech Stack:** vitest (latest stable), TypeScript 6 (existing), Node.js ESM (existing).

**Prerequisites / assumptions:**
- Node.js 20+ available locally (vitest 3.x requires Node 18.17+).
- Project is clean (`git status` shows no uncommitted changes before starting).
- No worktree required; harness setup is non-destructive.

**Out of scope:** Backfilling tests for all existing modules. Plan 0 creates only the minimum characterization tests needed to prove the harness works end-to-end. Feature plans (Plan 1–5) add tests for their own functionality via TDD.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | Add vitest devDep; add `test` and `test:watch` scripts |
| `vitest.config.ts` | Create | Minimal config: include path, node environment |
| `tests/keywords.test.ts` | Create | Characterization tests for `keywords.ts` pure functions — proves imports, assertions, object equality all work |
| `.gitignore` | Modify (if needed) | Ensure `coverage/` is ignored (vitest default output dir) |

No changes to `tsconfig.json`, `src/`, or any analyzer logic in this plan.

---

## Task 1: Install vitest and add npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest as a devDependency**

Run: `npm install --save-dev vitest`

Expected: `vitest` appears in `devDependencies` in `package.json`, `package-lock.json` updates.

- [ ] **Step 2: Add `test` and `test:watch` scripts**

Edit `package.json` scripts block from:

```json
"scripts": {
  "dev": "tsx src/cli.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/cli.js"
}
```

to:

```json
"scripts": {
  "dev": "tsx src/cli.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/cli.js",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Verify the harness runs (no tests yet)**

Run: `npm test`

Expected output contains one of:
- `No test files found, exiting with code 0` (vitest 3.x default for empty matches)
- Or: vitest reports `Test Files  0 passed` with exit code 0.

If exit code is non-zero or vitest is not found, investigate before proceeding.

- [ ] **Step 4: Confirm the build still works**

Run: `npm run build`

Expected: `dist/` is produced without errors, same as before. This confirms vitest install did not affect the production build.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest test harness"
```

---

## Task 2: Add vitest config

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create `vitest.config.ts`**

Create the file at the project root with exactly this content:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Verify config is picked up**

Run: `npm test`

Expected: vitest runs and reports `No test files found` (or `0 passed`) with exit code 0. The `include` pattern now explicitly scopes to `tests/**/*.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config for tests/ directory"
```

---

## Task 3: First characterization test — `countOccurrences`

**Files:**
- Create: `tests/keywords.test.ts`

**Why this function first:** `countOccurrences` in `src/keywords.ts:63` is a pure synchronous function with clear inputs/outputs. It's the lowest-risk way to prove that imports, TypeScript compilation, and assertions all work inside vitest.

- [ ] **Step 1: Create the test file with one passing test**

Create `tests/keywords.test.ts` with exactly this content:

```ts
import { describe, it, expect } from "vitest";
import { countOccurrences } from "../src/keywords.js";

describe("countOccurrences", () => {
  it("counts non-overlapping case-insensitive matches", () => {
    expect(countOccurrences("SEO seo SEO", "seo")).toBe(3);
  });
});
```

Note: The import path uses `../src/keywords.js` (not `.ts`) because the project is strict ESM (`"type": "module"` + `NodeNext` module resolution). Vitest resolves this correctly via its TS transform.

- [ ] **Step 2: Run and verify the test passes**

Run: `npm test`

Expected output contains:
- `Test Files  1 passed (1)`
- `Tests  1 passed (1)`
- Exit code 0.

If the import fails with "Cannot find module" or similar, the issue is ESM resolution — verify the `.js` extension is in the import path, not `.ts`.

- [ ] **Step 3: Add a zero-match test case**

Append to `tests/keywords.test.ts` inside the existing `describe` block:

```ts
  it("returns 0 when keyword is empty", () => {
    expect(countOccurrences("some text", "")).toBe(0);
  });

  it("returns 0 when keyword is not present", () => {
    expect(countOccurrences("hello world", "seo")).toBe(0);
  });
```

Final file content:

```ts
import { describe, it, expect } from "vitest";
import { countOccurrences } from "../src/keywords.js";

describe("countOccurrences", () => {
  it("counts non-overlapping case-insensitive matches", () => {
    expect(countOccurrences("SEO seo SEO", "seo")).toBe(3);
  });

  it("returns 0 when keyword is empty", () => {
    expect(countOccurrences("some text", "")).toBe(0);
  });

  it("returns 0 when keyword is not present", () => {
    expect(countOccurrences("hello world", "seo")).toBe(0);
  });
});
```

- [ ] **Step 4: Run and verify all three tests pass**

Run: `npm test`

Expected:
- `Test Files  1 passed (1)`
- `Tests  3 passed (3)`
- Exit code 0.

- [ ] **Step 5: Commit**

```bash
git add tests/keywords.test.ts
git commit -m "test: add characterization tests for countOccurrences"
```

---

## Task 4: Second characterization test — `matchKeywordsOnPage`

**Files:**
- Create: `tests/keywords-match.test.ts`

**Why this second:** Exercises deep object equality and multi-field result shape — confirms vitest's `toEqual` works the way we expect, and establishes the pattern for testing richer return types (needed in Plan 1–5).

- [ ] **Step 1: Create the test file**

Create `tests/keywords-match.test.ts` with exactly this content:

```ts
import { describe, it, expect } from "vitest";
import { matchKeywordsOnPage, type PageTextContent } from "../src/keywords.js";

describe("matchKeywordsOnPage", () => {
  it("counts occurrences per location and totals them", () => {
    const content: PageTextContent = {
      title: "SEO guide",
      metaDescription: "A short SEO description",
      h1Text: "SEO",
      bodyText: "SEO is about SEO fundamentals.",
    };

    const result = matchKeywordsOnPage(["seo"], content);

    expect(result).toEqual([
      {
        keyword: "seo",
        locations: { title: 1, h1: 1, metaDescription: 1, body: 2 },
        totalOccurrences: 5,
      },
    ]);
  });

  it("returns zero counts for a keyword that does not appear", () => {
    const content: PageTextContent = {
      title: "About us",
      metaDescription: "Company profile",
      h1Text: "About",
      bodyText: "We are a company.",
    };

    const result = matchKeywordsOnPage(["seo"], content);

    expect(result).toEqual([
      {
        keyword: "seo",
        locations: { title: 0, h1: 0, metaDescription: 0, body: 0 },
        totalOccurrences: 0,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run and verify tests pass**

Run: `npm test`

Expected:
- `Test Files  2 passed (2)`
- `Tests  5 passed (5)` (3 from Task 3 + 2 new)
- Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add tests/keywords-match.test.ts
git commit -m "test: add characterization tests for matchKeywordsOnPage"
```

---

## Task 5: Prove the harness catches real failures

**Files:**
- Modify: `tests/keywords.test.ts` (temporarily, then revert)

**Purpose:** Confirm end-to-end that a failing assertion produces a non-zero exit code and a readable diff. This is a one-off sanity check — do not commit the failing version.

- [ ] **Step 1: Introduce a deliberately wrong assertion**

In `tests/keywords.test.ts`, change the first test's expected value from `3` to `999`:

```ts
  it("counts non-overlapping case-insensitive matches", () => {
    expect(countOccurrences("SEO seo SEO", "seo")).toBe(999);
  });
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test`

Expected:
- `Tests  1 failed | 4 passed (5)`
- Failure output shows `Expected: 999` vs `Received: 3`.
- Exit code is non-zero.

If the above does not happen, the harness is not reporting failures correctly — investigate before proceeding.

- [ ] **Step 3: Revert the assertion**

Change the value back to `3`:

```ts
  it("counts non-overlapping case-insensitive matches", () => {
    expect(countOccurrences("SEO seo SEO", "seo")).toBe(3);
  });
```

- [ ] **Step 4: Verify all tests pass again**

Run: `npm test`

Expected:
- `Tests  5 passed (5)`
- Exit code 0.

- [ ] **Step 5: Do NOT commit**

`git status` should show no staged changes and no modified files (the file is back to its committed state). Run `git diff tests/keywords.test.ts` to confirm empty output.

---

## Task 6: Update `.gitignore` if needed

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Check current `.gitignore`**

Run: `cat .gitignore`

Expected: file exists. Check whether `coverage/` is already listed.

- [ ] **Step 2: Add `coverage/` if not present**

If `coverage/` is not in `.gitignore`, append it:

```
coverage/
```

If `.gitignore` does not exist, create it with:

```
node_modules/
dist/
coverage/
```

- [ ] **Step 3: Commit if changed**

If the file was modified:

```bash
git add .gitignore
git commit -m "chore: ignore vitest coverage output"
```

If no change was needed, skip this commit.

---

## Task 7: Final verification

- [ ] **Step 1: Clean run of all tests**

Run: `npm test`

Expected:
- `Test Files  2 passed (2)`
- `Tests  5 passed (5)`
- Exit code 0.

- [ ] **Step 2: Confirm the production build still works**

Run: `npm run build`

Expected: `dist/` is regenerated without errors. TypeScript compiles only `src/`, not `tests/`.

- [ ] **Step 3: Confirm the CLI still runs**

Run: `npm run dev -- --help` (or equivalent smoke command from README)

Expected: CLI prints help output. This confirms the runtime is not broken by the new devDependency.

- [ ] **Step 4: Review commit history**

Run: `git log --oneline -n 10`

Expected: 3–4 new commits, all scoped to test harness setup (chore/test prefixes, no unrelated changes).

---

## Self-Review Notes

- **Spec coverage:** The only requirement is "set up a test harness with TDD-capable characterization tests for the existing codebase." Tasks 1–2 install and configure vitest; Tasks 3–4 add characterization tests; Task 5 proves failure detection works; Tasks 6–7 handle cleanup and final verification. Complete.
- **Placeholder scan:** No TBD, no "add appropriate error handling," no "similar to Task N." All test code is fully written out.
- **Type consistency:** `countOccurrences` signature (`(text: string, keyword: string) => number`) and `PageTextContent` shape match `src/keywords.ts:63` and `src/keywords.ts:49` exactly.
- **TDD note for subsequent plans:** Plans 1–5 (feature plans) will follow strict TDD — write failing test for new behavior → verify it fails → implement → verify it passes. Plan 0 is intentionally characterization-only because it backfills tests for code that already exists and is presumed correct.
