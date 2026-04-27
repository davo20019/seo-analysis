# v0.7.0 Implementation Plan — Custom Extraction Rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSS-selector-based custom extractions to the audit. Users define rules via `--extract '<json>'`, `--extract-file <path>`, or `AnalyzeOptions.extract`. Per-page values land in JSON; a small summary lands in HTML/text. `required: true` emits a low-severity `EXTRACTION_MISSING_REQUIRED` issue that integrates with `--fail-on`.

**Architecture:** One new pure module `src/extract.ts` (parser + runner + summarizer). The analyzer calls `runExtractions` once per page, immediately after the existing `cheerio.load(html)` at `src/analyzer.ts:1149`, and calls `summarizeExtractions` once after the crawl completes. CLI parses both flags into the same internal shape and forwards them via `AnalyzeOptions.extract`. Report renderer adds one summary section. No new dependencies.

**Tech Stack:** TypeScript (Node ≥20), cheerio (already loaded per page), vitest.

**Spec:** `docs/superpowers/specs/2026-04-26-custom-extractions-design.md`

---

## File Structure

**New files:**
- `src/extract.ts` — `parseExtractionRules`, `parseSelectorGrammar`, `runExtractions`, `summarizeExtractions`. Pure module, no I/O. ~150 lines.
- `tests/extract.test.ts` — unit tests for all four functions. ~250 lines.
- `tests/extract-integration.test.ts` — end-to-end through `analyzeSite` against a fixture HTML.

**Modified files:**
- `src/types.ts` — add `ExtractionRule`, `ExtractionResult`, `ExtractionSummary`; extend `PageReport.extracted?`, `SiteReport.extractionSummary?`, `AnalyzeOptions.extract?`.
- `src/analyzer.ts` — pass `extractionRules` into `analyzeHtml`, call `runExtractions`, push `EXTRACTION_MISSING_REQUIRED` issues, call `summarizeExtractions` after the page loop and attach to `SiteReport.extractionSummary`.
- `src/cli.ts` — add `--extract` / `--extract-file` parsing, mutual-exclusion check, JSON validation via `parseExtractionRules`, forward to `analyzeSite`.
- `src/report.ts` — add `renderExtractionsSection` (HTML) and `formatExtractions` (text), splice into the existing report assembly between Internal Link Equity and Priority Issues.
- `src/index.ts` — re-export the three new types.
- `README.md` — add "Custom extractions" section and v0.7.0 CHANGELOG block.
- `package.json` / `package-lock.json` — bump to `0.7.0`.

---

## Task 1: Type additions in `src/types.ts`

**Files:**
- Modify: `src/types.ts`

Type-only task. After this task, `npx tsc --noEmit` must stay clean.

- [ ] **Step 1: Add the new types**

Append to `src/types.ts` (anywhere before `AnalyzeOptions`; recommend just after `LinkGraphReport`):

```ts
export interface ExtractionRule {
  selector: string;
  attr?: string;
  html?: boolean;
  all?: boolean;
  required?: boolean;
}

export type ExtractionResult = Record<string, string | string[] | null>;

export interface ExtractionSummary {
  rules: string[];
  pagesEvaluated: number;
  matchCounts: Record<string, number>;
  missingRequiredCounts: Record<string, number>;
  pagesWithMissingRequired: number;
}
```

- [ ] **Step 2: Extend `PageReport`**

In `src/types.ts`, locate `export interface PageReport {` (around line 81). Add at the end of the interface:

```ts
  extracted?: ExtractionResult;
```

- [ ] **Step 3: Extend `SiteReport`**

Locate `export interface SiteReport {` (around line 299). Add at the end of the interface:

```ts
  extractionSummary?: ExtractionSummary;
```

- [ ] **Step 4: Extend `AnalyzeOptions`**

Locate `export interface AnalyzeOptions {` (the existing list ends with `onProgress?: ...`). Add:

```ts
  extract?: Record<string, string | ExtractionRule>;
```

- [ ] **Step 5: Verify the build is clean**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "types: add ExtractionRule + ExtractionResult + ExtractionSummary"
```

---

## Task 2: Selector-grammar parser (TDD)

**Files:**
- Create: `src/extract.ts`
- Create: `tests/extract.test.ts`

This task implements **only** `parseSelectorGrammar`. The full `parseExtractionRules` arrives in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tests/extract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSelectorGrammar } from "../src/extract.js";

describe("parseSelectorGrammar", () => {
  it("returns selector only for plain text grammar", () => {
    expect(parseSelectorGrammar("h1")).toEqual({ selector: "h1" });
    expect(parseSelectorGrammar(".product .price")).toEqual({ selector: ".product .price" });
  });

  it("parses @attr suffix", () => {
    expect(parseSelectorGrammar("meta[name=author]@content")).toEqual({
      selector: "meta[name=author]",
      attr: "content"
    });
  });

  it("ignores @ and # inside attribute selector brackets", () => {
    expect(parseSelectorGrammar('a[href$=".pdf"]@href')).toEqual({
      selector: 'a[href$=".pdf"]',
      attr: "href"
    });
    expect(parseSelectorGrammar('a[href*="#section"]')).toEqual({
      selector: 'a[href*="#section"]'
    });
  });

  it("parses #html suffix", () => {
    expect(parseSelectorGrammar("article > p:first-of-type#html")).toEqual({
      selector: "article > p:first-of-type",
      html: true
    });
  });

  it("preserves hyphens and dots in attribute names", () => {
    expect(parseSelectorGrammar("div@data-product-id")).toEqual({
      selector: "div",
      attr: "data-product-id"
    });
  });

  it("rejects empty attribute name", () => {
    expect(() => parseSelectorGrammar("div@")).toThrow(/empty attribute name/);
  });

  it("rejects unsupported # suffix", () => {
    expect(() => parseSelectorGrammar("div#text")).toThrow(/Unsupported "#" suffix/);
  });

  it("rejects combined @attr and #html", () => {
    expect(() => parseSelectorGrammar("a@href#html")).toThrow(/Cannot combine/);
  });

  it("rejects empty selector before suffix", () => {
    expect(() => parseSelectorGrammar("@href")).toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/extract.test.ts`
Expected: FAIL — `Cannot find module '../src/extract.js'`.

- [ ] **Step 3: Implement `parseSelectorGrammar`**

Create `src/extract.ts`:

```ts
import type { ExtractionRule } from "./types.js";

export function parseSelectorGrammar(input: string): ExtractionRule {
  let depth = 0;
  for (let i = input.length - 1; i >= 0; i--) {
    const c = input[i];
    if (c === "]") {
      depth++;
      continue;
    }
    if (c === "[") {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (c !== "@" && c !== "#") continue;

    const selector = input.slice(0, i).trim();
    const suffix = input.slice(i + 1).trim();
    if (!selector) {
      throw new Error(`Selector is empty before "${c}${suffix}"`);
    }
    if (containsTopLevel(selector, "@") || containsTopLevel(selector, "#")) {
      throw new Error(`Cannot combine \`@attr\` and \`#html\` in selector "${input}"`);
    }
    if (c === "#") {
      if (suffix !== "html") {
        throw new Error(`Unsupported "#" suffix "${suffix}" in selector "${input}" — only "#html" is allowed`);
      }
      return { selector, html: true };
    }
    if (!suffix) {
      throw new Error(`Selector "${input}" has empty attribute name after "@"`);
    }
    return { selector, attr: suffix };
  }
  return { selector: input.trim() };
}

function containsTopLevel(s: string, ch: "@" | "#"): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (depth === 0 && c === ch) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/extract.test.ts`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/extract.ts tests/extract.test.ts
git commit -m "feat(extract): selector-grammar parser"
```

---

## Task 3: Rule normalization — `parseExtractionRules` (TDD)

**Files:**
- Modify: `src/extract.ts`
- Modify: `tests/extract.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/extract.test.ts`:

```ts
import { parseExtractionRules } from "../src/extract.js";

describe("parseExtractionRules", () => {
  it("returns empty object for null/undefined/empty", () => {
    expect(parseExtractionRules(null)).toEqual({});
    expect(parseExtractionRules(undefined)).toEqual({});
    expect(parseExtractionRules({})).toEqual({});
  });

  it("normalizes string shorthand", () => {
    const out = parseExtractionRules({ h1: "h1", price: "[itemprop=price]@content" });
    expect(out).toEqual({
      h1: { selector: "h1" },
      price: { selector: "[itemprop=price]", attr: "content" }
    });
  });

  it("accepts a JSON string at the top level", () => {
    const out = parseExtractionRules('{"h1":"h1"}');
    expect(out).toEqual({ h1: { selector: "h1" } });
  });

  it("normalizes object form with all + required", () => {
    const out = parseExtractionRules({
      faqQuestions: { selector: ".faq h3", all: true },
      title: { selector: "title", required: true }
    });
    expect(out).toEqual({
      faqQuestions: { selector: ".faq h3", all: true },
      title: { selector: "title", required: true }
    });
  });

  it("merges grammar with object-form flags", () => {
    const out = parseExtractionRules({
      images: { selector: "img@src", all: true }
    });
    expect(out).toEqual({
      images: { selector: "img", attr: "src", all: true }
    });
  });

  it("rejects non-object input", () => {
    expect(() => parseExtractionRules(42)).toThrow(/must be a JSON object/);
    expect(() => parseExtractionRules([1, 2])).toThrow(/must be a JSON object/);
  });

  it("rejects invalid JSON string", () => {
    expect(() => parseExtractionRules("{ not json")).toThrow(/Invalid extraction JSON/);
  });

  it("rejects invalid field names", () => {
    expect(() => parseExtractionRules({ "my.field": "h1" })).toThrow(/Invalid extraction field name/);
    expect(() => parseExtractionRules({ "price tag": "h1" })).toThrow(/Invalid extraction field name/);
    expect(() => parseExtractionRules({ "1abc": "h1" })).toThrow(/Invalid extraction field name/);
  });

  it("rejects object form missing selector", () => {
    expect(() => parseExtractionRules({ x: { all: true } })).toThrow(/missing string "selector"/);
  });

  it("rejects non-string-non-object values", () => {
    expect(() => parseExtractionRules({ x: 42 })).toThrow(/must be a string or object/);
    expect(() => parseExtractionRules({ x: null })).toThrow(/must be a string or object/);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/extract.test.ts`
Expected: 10 new tests fail with `parseExtractionRules is not a function`.

- [ ] **Step 3: Implement `parseExtractionRules`**

Append to `src/extract.ts`:

```ts
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function parseExtractionRules(input: unknown): Record<string, ExtractionRule> {
  if (input === null || input === undefined) return {};

  if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (err) {
      throw new Error(`Invalid extraction JSON: ${(err as Error).message}`);
    }
    return parseExtractionRules(parsed);
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Extraction rules must be a JSON object of { name: rule }");
  }

  const out: Record<string, ExtractionRule> = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (!FIELD_NAME.test(name)) {
      throw new Error(
        `Invalid extraction field name "${name}" — must match /^[A-Za-z_][A-Za-z0-9_-]*$/`
      );
    }
    out[name] = normalizeRule(name, value);
  }
  return out;
}

function normalizeRule(name: string, value: unknown): ExtractionRule {
  if (typeof value === "string") {
    return parseSelectorGrammar(value);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Extraction rule "${name}" must be a string or object`);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.selector !== "string") {
    throw new Error(`Extraction rule "${name}" missing string "selector"`);
  }
  const grammar = parseSelectorGrammar(obj.selector);
  const rule: ExtractionRule = { ...grammar };
  if (obj.all !== undefined) rule.all = Boolean(obj.all);
  if (obj.required !== undefined) rule.required = Boolean(obj.required);
  return rule;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/extract.test.ts`
Expected: 19 tests pass total (9 from Task 2 + 10 new).

- [ ] **Step 5: Commit**

```bash
git add src/extract.ts tests/extract.test.ts
git commit -m "feat(extract): parseExtractionRules normalizer"
```

---

## Task 4: `runExtractions` (TDD)

**Files:**
- Modify: `src/extract.ts`
- Modify: `tests/extract.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/extract.test.ts`:

```ts
import { load } from "cheerio";
import { runExtractions } from "../src/extract.js";

const FIXTURE = `
<html>
  <head>
    <title>Sample page</title>
    <meta name="author" content="Jane Doe" />
  </head>
  <body>
    <h1>Headline</h1>
    <article>
      <p>First paragraph with <em>emphasis</em>.</p>
      <p>Second.</p>
    </article>
    <ul class="faq"><li><h3>Q1</h3></li><li><h3>Q2</h3></li></ul>
    <span itemprop="price" content="19.99">$19.99</span>
  </body>
</html>
`;

describe("runExtractions", () => {
  const $ = load(FIXTURE);

  it("returns text for plain selector", () => {
    const rules = parseExtractionRules({ h1: "h1" });
    expect(runExtractions($, rules).result).toEqual({ h1: "Headline" });
  });

  it("returns attribute value for @attr", () => {
    const rules = parseExtractionRules({
      author: "meta[name=author]@content",
      price: "[itemprop=price]@content"
    });
    expect(runExtractions($, rules).result).toEqual({
      author: "Jane Doe",
      price: "19.99"
    });
  });

  it("returns inner HTML for #html", () => {
    const rules = parseExtractionRules({
      intro: "article > p:first-of-type#html"
    });
    expect(runExtractions($, rules).result.intro).toBe("First paragraph with <em>emphasis</em>.");
  });

  it("returns null when no element matches", () => {
    const rules = parseExtractionRules({ missing: ".nope" });
    expect(runExtractions($, rules).result).toEqual({ missing: null });
  });

  it("returns null when attribute is absent on the matched element", () => {
    const rules = parseExtractionRules({ alt: "h1@alt" });
    expect(runExtractions($, rules).result).toEqual({ alt: null });
  });

  it("returns array for all: true", () => {
    const rules = parseExtractionRules({
      faq: { selector: ".faq h3", all: true }
    });
    expect(runExtractions($, rules).result).toEqual({ faq: ["Q1", "Q2"] });
  });

  it("returns empty array for all: true with no matches", () => {
    const rules = parseExtractionRules({
      none: { selector: ".nope", all: true }
    });
    expect(runExtractions($, rules).result).toEqual({ none: [] });
  });

  it("flags required + missing", () => {
    const rules = parseExtractionRules({
      title: { selector: "title", required: true },
      missing: { selector: ".nope", required: true }
    });
    const out = runExtractions($, rules);
    expect(out.result.title).toBe("Sample page");
    expect(out.result.missing).toBeNull();
    expect(out.missingRequired).toEqual(["missing"]);
  });

  it("flags required + all: true with empty array", () => {
    const rules = parseExtractionRules({
      faqs: { selector: ".nope", all: true, required: true }
    });
    const out = runExtractions($, rules);
    expect(out.result.faqs).toEqual([]);
    expect(out.missingRequired).toEqual(["faqs"]);
  });

  it("does not flag non-required missing", () => {
    const rules = parseExtractionRules({ x: ".nope" });
    expect(runExtractions($, rules).missingRequired).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/extract.test.ts`
Expected: 10 new tests fail with `runExtractions is not a function`.

- [ ] **Step 3: Implement `runExtractions`**

Append to `src/extract.ts`:

```ts
import type { load as cheerioLoad } from "cheerio";
import type { ExtractionResult } from "./types.js";

type CheerioRoot = ReturnType<typeof cheerioLoad>;

const failedRulesLogged = new Set<string>();

export function runExtractions(
  $: CheerioRoot,
  rules: Record<string, ExtractionRule>
): { result: ExtractionResult; missingRequired: string[] } {
  const result: ExtractionResult = {};
  const missingRequired: string[] = [];

  for (const [name, rule] of Object.entries(rules)) {
    let value: string | string[] | null;
    try {
      value = evaluateRule($, rule);
    } catch (err) {
      if (!failedRulesLogged.has(name)) {
        failedRulesLogged.add(name);
        process.stderr.write(
          `Extraction rule "${name}" failed: ${(err as Error).message}\n`
        );
      }
      value = rule.all ? [] : null;
    }
    result[name] = value;
    if (rule.required && isMissing(value)) {
      missingRequired.push(name);
    }
  }
  return { result, missingRequired };
}

function evaluateRule(
  $: CheerioRoot,
  rule: ExtractionRule
): string | string[] | null {
  const matched = $(rule.selector);
  if (rule.all) {
    const out: string[] = [];
    matched.each((_, el) => {
      const v = readNode($(el), rule);
      if (v !== null) out.push(v);
    });
    return out;
  }
  if (matched.length === 0) return null;
  return readNode(matched.first(), rule);
}

function readNode(
  node: ReturnType<CheerioRoot>,
  rule: ExtractionRule
): string | null {
  if (rule.attr) {
    const v = node.attr(rule.attr);
    return v === undefined ? null : v;
  }
  if (rule.html) {
    const v = node.html();
    return v === null ? null : v;
  }
  const text = node.text().replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function isMissing(value: string | string[] | null): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
```

NOTE: there is one merge concern — the `import type { ExtractionRule } from "./types.js"` from Task 2 still applies; only the cheerio + `ExtractionResult` imports are new. Make sure the resulting file has exactly one `import type ... from "./types.js"` line (combine the two `ExtractionRule` and `ExtractionResult` imports).

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/extract.test.ts`
Expected: 29 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add src/extract.ts tests/extract.test.ts
git commit -m "feat(extract): runExtractions with required/all/attr/html"
```

---

## Task 5: `summarizeExtractions` (TDD)

**Files:**
- Modify: `src/extract.ts`
- Modify: `tests/extract.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `tests/extract.test.ts`:

```ts
import { summarizeExtractions } from "../src/extract.js";
import type { PageReport } from "../src/types.js";

function makePage(url: string, extracted: PageReport["extracted"]): PageReport {
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    redirectChain: [],
    checks: {} as PageReport["checks"],
    issues: [],
    discoveredLinks: [],
    extracted
  };
}

describe("summarizeExtractions", () => {
  it("counts matches and missing-required across pages", () => {
    const rules = parseExtractionRules({
      h1: "h1",
      title: { selector: "title", required: true },
      faqs: { selector: ".faq h3", all: true, required: true }
    });
    const pages: PageReport[] = [
      makePage("https://a", { h1: "A", title: "Title A", faqs: ["q1"] }),
      makePage("https://b", { h1: null, title: null, faqs: [] }),
      makePage("https://c", { h1: "C", title: "Title C", faqs: [] })
    ];
    const summary = summarizeExtractions(pages, rules);

    expect(summary.rules).toEqual(["h1", "title", "faqs"]);
    expect(summary.pagesEvaluated).toBe(3);
    expect(summary.matchCounts).toEqual({ h1: 2, title: 2, faqs: 1 });
    expect(summary.missingRequiredCounts).toEqual({ h1: 0, title: 1, faqs: 2 });
    expect(summary.pagesWithMissingRequired).toBe(2);
  });

  it("ignores pages without an extracted field", () => {
    const rules = parseExtractionRules({ h1: "h1" });
    const pages: PageReport[] = [
      makePage("https://a", { h1: "A" }),
      makePage("https://b", undefined)
    ];
    const summary = summarizeExtractions(pages, rules);
    expect(summary.pagesEvaluated).toBe(1);
    expect(summary.matchCounts).toEqual({ h1: 1 });
  });

  it("returns zeroed summary for empty rules", () => {
    expect(summarizeExtractions([], {})).toEqual({
      rules: [],
      pagesEvaluated: 0,
      matchCounts: {},
      missingRequiredCounts: {},
      pagesWithMissingRequired: 0
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/extract.test.ts`
Expected: 3 new tests fail with `summarizeExtractions is not a function`.

- [ ] **Step 3: Implement `summarizeExtractions`**

Append to `src/extract.ts` (consolidate the type imports if needed):

```ts
import type { ExtractionSummary, PageReport } from "./types.js";

export function summarizeExtractions(
  pages: PageReport[],
  rules: Record<string, ExtractionRule>
): ExtractionSummary {
  const ruleNames = Object.keys(rules);
  const matchCounts: Record<string, number> = {};
  const missingRequiredCounts: Record<string, number> = {};
  for (const name of ruleNames) {
    matchCounts[name] = 0;
    missingRequiredCounts[name] = 0;
  }

  let pagesEvaluated = 0;
  let pagesWithMissingRequired = 0;
  for (const page of pages) {
    if (!page.extracted) continue;
    pagesEvaluated++;
    let pageHasMissing = false;
    for (const name of ruleNames) {
      const value = page.extracted[name] ?? null;
      const rule = rules[name];
      if (!isMissing(value)) {
        matchCounts[name]++;
      }
      if (rule.required && isMissing(value)) {
        missingRequiredCounts[name]++;
        pageHasMissing = true;
      }
    }
    if (pageHasMissing) pagesWithMissingRequired++;
  }

  return {
    rules: ruleNames,
    pagesEvaluated,
    matchCounts,
    missingRequiredCounts,
    pagesWithMissingRequired
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/extract.test.ts`
Expected: 32 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add src/extract.ts tests/extract.test.ts
git commit -m "feat(extract): summarizeExtractions"
```

---

## Task 6: Wire extractions into the analyzer

**Files:**
- Modify: `src/analyzer.ts`

This task threads the parsed rules through to `analyzeHtml`, runs them against each page's cheerio tree, emits the issue, and attaches the site-level summary at the end.

- [ ] **Step 1: Import the extract module and `ExtractionRule`**

In `src/analyzer.ts`, near the existing `import type { ... } from "./types.js"` block (around line 44–80):

Add to the type import list:
```ts
  ExtractionRule,
```

Add a value import near the other check imports (after the cheerio import at line 1):
```ts
import { parseExtractionRules, runExtractions, summarizeExtractions } from "./extract.js";
```

- [ ] **Step 2: Parse + thread the rules through `analyzeSite`**

Locate the section in `analyzeSite` where `rawOptions` is unpacked into local variables (search for `const extractTermsEnabled = rawOptions.extractTerms ?? false;` near line 2464). Add immediately after it:

```ts
  const extractionRules = parseExtractionRules(rawOptions.extract);
  const extractionRulesEntries = Object.entries(extractionRules);
  const hasExtractions = extractionRulesEntries.length > 0;
```

- [ ] **Step 3: Pass the rules into every `analyzeHtml` call site**

`analyzeHtml` signature gets one new optional parameter. Update the signature at `src/analyzer.ts:1141`:

```ts
function analyzeHtml(
  requestedUrl: string,
  response: FetchResult,
  html: string,
  allowedHosts: Set<string>,
  robotsRules: RobotsRules,
  userAgent: string,
  extractionRules: Record<string, ExtractionRule> = {}
): PageReport {
```

In the body of `analyzeHtml`, immediately after `const $ = load(html);` at `src/analyzer.ts:1149`:

```ts
  const extracted = Object.keys(extractionRules).length > 0
    ? runExtractions($, extractionRules)
    : null;
```

In the existing `return { ... }` block at `src/analyzer.ts:1658`, add inside the object (just before the closing `}`):

```ts
    ...(extracted ? { extracted: extracted.result } : {}),
```

Then, after the existing per-check `pushIssue` calls (around line 1656, after `for (const issue of checkJsonLdValidation(...))`), add:

```ts
  if (extracted) {
    for (const name of extracted.missingRequired) {
      const rule = extractionRules[name];
      pushIssue(issues, {
        code: "EXTRACTION_MISSING_REQUIRED",
        severity: "low",
        message: `Required extraction "${name}" returned no match for selector "${rule.selector}"`,
        recommendation: `Confirm the selector is correct or remove "required" from the rule "${name}".`
      });
    }
  }
```

Now thread `extractionRules` into every `analyzeHtml` caller. Search `src/analyzer.ts` for `analyzeHtml(` invocations (there should be one or two inside `analyzePage` / cached-render branches). For each call, append `extractionRules` as the final argument. If a caller doesn't have access to `extractionRules` (e.g., it's nested inside `analyzePage`), thread it through `analyzePage`'s signature too:

```ts
async function analyzePage(
  url: string,
  allowedHosts: Set<string>,
  options: FetchOptions,
  robotsRules: RobotsRules = {},
  renderBrowser: import("playwright").Browser | null = null,
  extractionRules: Record<string, ExtractionRule> = {}
): Promise<PageReport> {
```

…and forward `extractionRules` to every `analyzeHtml(...)` call inside `analyzePage`. Then pass it from the outer `analyzeSite` crawl loop into `analyzePage`.

- [ ] **Step 4: Attach the site-level summary after the crawl loop**

Locate the part of `analyzeSite` where the `SiteReport` is being assembled (search for `const summary = buildSummary(` or look near line 2761 where `topTerms` is computed). After the page loop and before the final `return` from `analyzeSite`, add:

```ts
  const extractionSummary = hasExtractions
    ? summarizeExtractions(pages, extractionRules)
    : undefined;
```

In the final `SiteReport` return object, add:

```ts
    ...(extractionSummary ? { extractionSummary } : {}),
```

- [ ] **Step 5: Verify the build is clean**

Run: `npx tsc --noEmit`
Expected: no output, exit 0. If any `analyzeHtml` or `analyzePage` call site is missing the new arg, fix it now.

- [ ] **Step 6: Run the existing test suite to confirm no regressions**

Run: `npx vitest run`
Expected: all existing tests still pass; 32 extract tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/analyzer.ts
git commit -m "feat(analyzer): wire extractions into per-page + site report"
```

---

## Task 7: End-to-end integration test

**Files:**
- Create: `tests/extract-integration.test.ts`

Verifies that `analyzeSite` produces `PageReport.extracted`, the `EXTRACTION_MISSING_REQUIRED` issue, and `SiteReport.extractionSummary`. Uses the existing test-server pattern from `tests/render.test.ts` or `tests/keywords-match.test.ts` — choose whichever harness is in use.

- [ ] **Step 1: Inspect existing integration tests for the harness pattern**

Run: `head -40 tests/keywords-match.test.ts`
Note the imports, the way an HTTP server / fixture is set up, and how `analyzeSite` is invoked. Reuse that harness exactly for this test (the goal here is to prove wiring, not to invent infrastructure).

- [ ] **Step 2: Write the integration test**

Create `tests/extract-integration.test.ts` modeled after the harness from Step 1. The body must assert:

- Two-page fixture: page A has `<h1>Hello</h1>` + `<title>A</title>`; page B has only `<title>B</title>` (no `<h1>`).
- Run `analyzeSite` with:
  ```ts
  extract: {
    h1: { selector: "h1", required: true },
    title: "title"
  }
  ```
- Assert: page A has `extracted: { h1: "Hello", title: "A" }` and **no** `EXTRACTION_MISSING_REQUIRED` issue.
- Assert: page B has `extracted: { h1: null, title: "B" }` and **exactly one** `EXTRACTION_MISSING_REQUIRED` issue with `severity: "low"`.
- Assert: `report.extractionSummary` is `{ rules: ["h1","title"], pagesEvaluated: 2, matchCounts: { h1: 1, title: 2 }, missingRequiredCounts: { h1: 1, title: 0 }, pagesWithMissingRequired: 1 }`.
- Assert: when run **without** the `extract` option, neither page has `extracted` and `report.extractionSummary` is undefined.

- [ ] **Step 3: Run the test and verify it passes**

Run: `npx vitest run tests/extract-integration.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/extract-integration.test.ts
git commit -m "test(extract): end-to-end integration via analyzeSite"
```

---

## Task 8: CLI flags `--extract` and `--extract-file`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Inspect existing flag-parsing patterns**

Run: `grep -n "fail-on\|--no-progress\|--render\|case \"--" src/cli.ts | head -30`
Note how option arguments are read (typically a `case "--xxx":` branch followed by `i++; const value = argv[i]`).

- [ ] **Step 2: Add the new flag parsing**

In the option-parsing switch block, add (between `--render` and `--no-progress`, or wherever fits the existing alphabetical/grouped order):

```ts
      case "--extract": {
        i++;
        if (i >= argv.length) {
          throw new Error("--extract requires a JSON value");
        }
        extractInline = argv[i];
        break;
      }
      case "--extract-file": {
        i++;
        if (i >= argv.length) {
          throw new Error("--extract-file requires a path");
        }
        extractFile = argv[i];
        break;
      }
```

Declare `extractInline: string | null = null;` and `extractFile: string | null = null;` at the top of the option-parsing block (near where other option locals are declared).

- [ ] **Step 3: Validate, parse, and pass through**

Below the parse loop (after all flags have been read, before `analyzeSite` is called), add:

```ts
let extractRules: Record<string, ExtractionRule> | undefined;
if (extractInline !== null && extractFile !== null) {
  console.error("Use --extract or --extract-file, not both.");
  process.exit(1);
}
if (extractFile !== null) {
  try {
    const contents = await fs.readFile(extractFile, "utf8");
    extractRules = parseExtractionRules(contents);
  } catch (err) {
    console.error(`Failed to load --extract-file: ${(err as Error).message}`);
    process.exit(1);
  }
}
if (extractInline !== null) {
  try {
    extractRules = parseExtractionRules(extractInline);
  } catch (err) {
    console.error(`Failed to parse --extract: ${(err as Error).message}`);
    process.exit(1);
  }
}
```

Add the imports at the top of `src/cli.ts` if not already present:
```ts
import { parseExtractionRules } from "./extract.js";
import type { ExtractionRule } from "./types.js";
import { promises as fs } from "node:fs";  // only if not already imported
```

(Check the existing imports first — `node:fs/promises` may already be in use under a different alias.)

In the `analyzeSite` options object passed by the CLI, add:
```ts
  ...(extractRules ? { extract: extractRules } : {}),
```

- [ ] **Step 4: Update the CLI help text**

Find the help/usage block (search for `--no-progress` or `Useful Options` or similar). Add two lines:

```
  --extract <json>           Inline JSON of extraction rules.
  --extract-file <path>      JSON file of extraction rules. Mutually exclusive with --extract.
```

- [ ] **Step 5: Smoke-test the CLI**

Build first:
```bash
npm run build
```
Then run an extraction against a real page (or against a `file://` URL fixture):
```bash
node dist/cli.js https://example.com --max-pages 1 --extract '{"h1":"h1","domain":"meta[property=\"og:type\"]@content"}' --json | jq '.pages[0].extracted'
```
Expected output (shape — exact values depend on the page):
```json
{
  "h1": "Example Domain",
  "domain": null
}
```

Then test the mutual-exclusion error:
```bash
node dist/cli.js https://example.com --extract '{}' --extract-file foo.json
```
Expected: stderr `Use --extract or --extract-file, not both.` and exit code 1.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): --extract + --extract-file flags"
```

---

## Task 9: Report rendering (HTML + text)

**Files:**
- Modify: `src/report.ts`

- [ ] **Step 1: Inspect existing section renderers**

Run: `grep -n "renderContentDedupSection\|renderLinkGraphSection" src/report.ts`
These are the closest precedents. Match their style.

- [ ] **Step 2: Add the HTML section renderer**

Append to `src/report.ts` (alongside the other `renderXxxSection` helpers):

```ts
function renderExtractionsSection(s: ExtractionSummary): string {
  if (s.rules.length === 0) return "";
  const coverageRows = s.rules
    .map((name) => {
      const matched = s.matchCounts[name] ?? 0;
      const pct = s.pagesEvaluated === 0 ? 0 : Math.round((matched / s.pagesEvaluated) * 100);
      return `<tr><td>${escapeHtml(name)}</td><td>${pct}% (${matched}/${s.pagesEvaluated})</td></tr>`;
    })
    .join("\n");
  const missingRows = s.rules
    .filter((name) => (s.missingRequiredCounts[name] ?? 0) > 0)
    .map((name) => `<li>${escapeHtml(name)}: ${s.missingRequiredCounts[name]}</li>`)
    .join("\n");
  return `
<p>Rules: ${s.rules.map((n) => `<code>${escapeHtml(n)}</code>`).join(", ")} (${s.rules.length})</p>
<table>
<thead><tr><th>Rule</th><th>Match coverage</th></tr></thead>
<tbody>
${coverageRows}
</tbody>
</table>
${
  s.pagesWithMissingRequired > 0
    ? `<p>Pages with missing required fields: <strong>${s.pagesWithMissingRequired}</strong></p>\n<ul>\n${missingRows}\n</ul>`
    : `<p>No pages with missing required fields.</p>`
}
`.trim();
}
```

Add the import at the top of `src/report.ts`:
```ts
import type { ExtractionSummary } from "./types.js";
```
…or extend the existing types import block.

- [ ] **Step 3: Splice the HTML section into the report assembly**

Locate the `renderHtmlReport` template (the function that assembles all `<h2>...</h2>` sections — see existing lines around 92–93). Add a new line after the link-graph section:

```ts
${report.extractionSummary ? `\n<h2>Custom extractions</h2>\n${renderExtractionsSection(report.extractionSummary)}` : ""}
```

- [ ] **Step 4: Add the text formatter**

Find `formatTextReport` (or equivalent text renderer). Add a new helper:

```ts
function formatExtractions(s: ExtractionSummary): string {
  if (s.rules.length === 0) return "";
  const lines: string[] = ["Custom extractions"];
  lines.push(`  Rules: ${s.rules.join(", ")} (${s.rules.length})`);
  lines.push("  Match coverage:");
  for (const name of s.rules) {
    const matched = s.matchCounts[name] ?? 0;
    const pct = s.pagesEvaluated === 0 ? 0 : Math.round((matched / s.pagesEvaluated) * 100);
    lines.push(`    ${name.padEnd(20)} ${pct}% (${matched}/${s.pagesEvaluated})`);
  }
  if (s.pagesWithMissingRequired > 0) {
    lines.push(`  Pages with missing required fields: ${s.pagesWithMissingRequired}`);
    for (const name of s.rules) {
      const m = s.missingRequiredCounts[name] ?? 0;
      if (m > 0) lines.push(`    ${name}: ${m}`);
    }
  }
  return lines.join("\n");
}
```

Splice it into the text-report assembly the same way as the HTML version (look for where `formatLinkGraph` or similar is concatenated into the output and add `report.extractionSummary ? formatExtractions(report.extractionSummary) : ""` alongside it, joined with `\n\n`).

- [ ] **Step 5: Add a regression test**

Append to `tests/report.test.ts`:

```ts
import { renderHtmlReport, formatTextReport } from "../src/report.js";
import type { SiteReport } from "../src/types.js";

describe("extractionSummary in reports", () => {
  function siteReportWithExtractions(): SiteReport {
    // Reuse the existing minimal-fixture builder if one already exists in this file;
    // otherwise construct a SiteReport with the minimum non-optional fields plus:
    return {
      // … minimum SiteReport scaffold from existing tests …
      extractionSummary: {
        rules: ["h1", "title"],
        pagesEvaluated: 2,
        matchCounts: { h1: 1, title: 2 },
        missingRequiredCounts: { h1: 1, title: 0 },
        pagesWithMissingRequired: 1
      }
    } as SiteReport;
  }

  it("renders the Custom extractions section in HTML", () => {
    const html = renderHtmlReport(siteReportWithExtractions());
    expect(html).toContain("<h2>Custom extractions</h2>");
    expect(html).toContain("Pages with missing required fields");
    expect(html).toContain("h1");
  });

  it("renders the Custom extractions section in text", () => {
    const text = formatTextReport(siteReportWithExtractions());
    expect(text).toContain("Custom extractions");
    expect(text).toContain("Pages with missing required fields: 1");
  });

  it("omits the section when summary is absent", () => {
    const minimal = { ...siteReportWithExtractions(), extractionSummary: undefined };
    const html = renderHtmlReport(minimal);
    expect(html).not.toContain("Custom extractions");
  });
});
```

NOTE: the placeholder `// minimum SiteReport scaffold from existing tests` must be filled with the real fixture builder used elsewhere in `tests/report.test.ts` (look for the helper that constructs the simplest passing `SiteReport`; reuse it).

- [ ] **Step 6: Run the report tests**

Run: `npx vitest run tests/report.test.ts`
Expected: all existing tests pass; 3 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat(report): Custom extractions HTML + text section"
```

---

## Task 10: Re-export new types

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the type re-exports**

In `src/index.ts`, locate the existing `export type { ... } from "./types.js"` block. Add three names alphabetically:

```ts
  ExtractionResult,
  ExtractionRule,
  ExtractionSummary,
```

- [ ] **Step 2: Verify the build is clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "exports: re-export ExtractionRule + ExtractionResult + ExtractionSummary"
```

---

## Task 11: README + CHANGELOG

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the "Custom extractions" section under "Useful Options"**

Locate the "Useful Options" table in `README.md`. Add two new rows:

```
| `--extract <json>` | Inline JSON of extraction rules. Mutually exclusive with `--extract-file`. |
| `--extract-file <path>` | JSON file of extraction rules. |
```

Below the table (or in a new "Custom extractions" subsection — match the doc style of "Crawl diff" and similar features):

````markdown
### Custom extractions

Define CSS-selector-based field extractions and pull them off every crawled page.

```bash
seo-audit https://example.com \
  --extract '{"h1":"h1","price":"[itemprop=price]@content"}' \
  --json --output report.json
```

Or, with a file:

```bash
echo '{"h1":"h1","author":"meta[name=author]@content"}' > extractions.json
seo-audit https://example.com --extract-file extractions.json --json
```

**Selector grammar** (suffix optional):

| Suffix    | Returns                                       |
|-----------|-----------------------------------------------|
| *(none)*  | Trimmed text content                          |
| `@attr`   | Attribute value (e.g. `meta@content`)         |
| `#html`   | Inner HTML                                    |

**Object form** unlocks `all` (multi-match) and `required` (emits a low-severity `EXTRACTION_MISSING_REQUIRED` issue if no match — integrates with `--fail-on low`):

```json
{
  "faqQuestions": { "selector": ".faq h3", "all": true },
  "title": { "selector": "title", "required": true }
}
```

Per-page values appear under `pages[].extracted` in the JSON report. A summary appears at `extractionSummary`.
````

- [ ] **Step 2: Add the v0.7.0 CHANGELOG block**

Insert immediately above `### v0.6.0 — 2026-04-26`:

```markdown
### v0.7.0 — 2026-04-26

- **Added:** custom extraction rules. Define CSS-selector-based field
  extractions with `--extract '<json>'` or `--extract-file <path>`. Selector
  grammar: `selector` (text), `selector@attr` (attribute), `selector#html`
  (inner HTML). Object form supports `all: true` (multi-match) and
  `required: true` (low-severity `EXTRACTION_MISSING_REQUIRED` issue,
  integrates with `--fail-on`).
- **Added:** `AnalyzeOptions.extract` for library consumers, plus
  `PageReport.extracted` and `SiteReport.extractionSummary` in the JSON
  report.
- **Added:** "Custom extractions" summary section in HTML/text/PDF reports.
  Full per-page detail remains in JSON.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(v0.7): README + CHANGELOG for custom extractions"
```

---

## Task 12: Version bump + final verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Bump the version**

Run:
```bash
npm version 0.7.0 --no-git-tag-version
```
Expected: `package.json` and `package-lock.json` both updated to `0.7.0`. No commit/tag is created (we'll commit manually).

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all suites pass, including the new extract + integration tests.

- [ ] **Step 3: Run the full build**

Run: `npm run build`
Expected: clean build, exit 0. `dist/cli.js` exists and runs.

- [ ] **Step 4: End-to-end smoke test**

Run:
```bash
node dist/cli.js https://example.com --max-pages 1 --extract '{"h1":"h1"}' --json | jq '.pages[0].extracted, .extractionSummary'
```
Expected: real values for `h1`, sensible summary object.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: release v0.7.0"
```

(Do **not** tag or push. The user runs `git push` and `npm publish` manually.)

---

## Self-Review

**Spec coverage check:**
- CSS-only selector grammar — Tasks 2, 4. ✅
- `--extract` and `--extract-file`, mutually exclusive — Task 8. ✅
- String shorthand + object form (`all`, `required`) — Tasks 3, 4. ✅
- `selector` / `selector@attr` / `selector#html` parsing — Task 2. ✅
- `EXTRACTION_MISSING_REQUIRED` issue with `low` severity — Task 6. ✅
- JSON output (`PageReport.extracted`, `SiteReport.extractionSummary`) — Tasks 1, 6. ✅
- HTML/text summary section — Task 9. ✅
- Field-name validation regex — Task 3. ✅
- Per-rule runtime-error handling (log once, treat as no match) — Task 4. ✅
- Library-API access (`AnalyzeOptions.extract`) — Tasks 1, 6. ✅
- Type re-exports — Task 10. ✅
- README + CHANGELOG — Task 11. ✅
- Version bump — Task 12. ✅

**Type-name consistency check:**
- `ExtractionRule`, `ExtractionResult`, `ExtractionSummary` used identically across Tasks 1, 2, 3, 4, 5, 6, 7, 9, 10. ✅
- Issue code: `EXTRACTION_MISSING_REQUIRED` (Tasks 6 + 11) — matches.

**Placeholder scan:**
- Task 7 Step 2 contains a structural sketch ("must assert: …") rather than a complete fixture. This is intentional because the existing test harness pattern lives in this codebase and the engineer must mirror it (Step 1 explicitly directs them to read it first). The assertions, however, are fully spelled out.
- Task 9 Step 5 has an inline `// minimum SiteReport scaffold from existing tests` — the engineer is told explicitly where to find the existing helper. Acceptable for the same reason.

No other placeholders.
