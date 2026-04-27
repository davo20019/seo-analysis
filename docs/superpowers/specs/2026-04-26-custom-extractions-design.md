# v0.7.0 — Custom extraction rules

**Date:** 2026-04-26
**Status:** Approved, pending implementation plan
**Target version:** v0.7.0

## Goal

Let users define CSS-selector-based extraction rules to pull arbitrary fields off every crawled page. Output:

- Full per-page extracted values in the JSON report (`PageReport.extracted`).
- A site-level summary in the JSON report (`SiteReport.extractionSummary`).
- A small "Custom extractions" summary block in the HTML/text/PDF reports — counts only, never per-page dumps.
- Optional per-rule `required: true` emits a low-severity `EXTRACTION_MISSING_REQUIRED` issue, hooking into the existing `--fail-on` machinery.

Closes the largest remaining feature gap against Screaming Frog SEO Spider for technical-SEO crawling and is the v0.7 differentiator: scriptable extractions that gate CI builds.

## Non-goals

- **No XPath.** CSS-only for v0.7. CSS covers ~90% of real-world extractions and adds zero dependencies. XPath is a follow-up if user feedback demands it.
- **No per-rule transforms** (regex extract, trim, parseInt, lowercase, etc.). Selector grammar stays minimal — text / attribute / inner HTML. Post-processing is the consumer's job (jq, scripts, etc.). Revisit only after real demand.
- **No extraction-only mode.** `analyzeSite` always runs the full crawl + checks; extractions are an additive pass over the same DOM. A "just extract, skip everything else" mode is a follow-up if asked.
- **No live selector validation against a remote DOM.** Validation happens at parse time (field name + selector grammar shape) and at runtime (per-page; bad selectors don't kill the crawl). No "test your selector before crawling" UX.
- **No nested rules / scoped extraction** (e.g., "for each `.product`, extract its `.price` and `.sku` as a record"). Flat rule namespace only. Nested extraction is a meaningful design problem and a candidate for v0.8+.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Selector syntax | CSS only (cheerio native). No XPath. |
| 2 | Configuration surface | Both `--extract '<json>'` (inline) and `--extract-file <path>` (file). Mutually exclusive; error if both set. |
| 3 | Rule shape | String shorthand for the simple case + object form for `all` (multi-match) and `required`. |
| 4 | Selector grammar | `selector` (text), `selector@attr` (attribute), `selector#html` (inner HTML). Suffix splits on the *last* top-level `@` or `#` (ignoring anything inside `[…]`). |
| 5 | Human report integration | Summary section only — rule list, match coverage, missing-required counts. Full per-page detail stays in JSON. |
| 6 | Missing required fields | Low-severity `EXTRACTION_MISSING_REQUIRED` issue per page per missing required rule. Hooks into existing `--fail-on` automatically. |
| 7 | Default behavior | Off. No rules = no `extracted` on pages, no summary, no work done. |

### Open-source upgrade considerations

The package is published to npm as `@davo20019/seo-audit` (current v0.6.0 → planned v0.7.0). Extractions are **opt-in**: no rules = identical behavior to v0.6.0. Three OSS-relevant considerations:

- **JSON shape grows additively only when in use.** New optional `PageReport.extracted` and `SiteReport.extractionSummary`. Both omitted when no rules are configured. v0.6 consumers ignoring unknown fields are unaffected.
- **No new `--fail-on` regression risk.** The `EXTRACTION_MISSING_REQUIRED` issue only fires when the user opts into a `required: true` rule. Existing `--fail-on` users without any `--extract*` flag see no behavior change.
- **No new dependencies.** Uses the cheerio instance already loaded per page in `analyzer.ts`.

## Public API

### CLI

```
--extract '<json>'         Inline JSON of rules. Mutually exclusive with --extract-file.
--extract-file <path>      Path to a JSON file of rules.
```

Validation runs at startup. Invalid JSON, invalid field names, or invalid selector grammar fail fast with an actionable error message and a non-zero exit code before the crawl begins.

### Library

New optional field on `AnalyzeOptions`:

```ts
extract?: Record<string, string | ExtractionRule>;
```

Accepts the same shape as the JSON config. `parseExtractionRules` normalizes both forms into `Record<string, ExtractionRule>` internally.

### Config format

String shorthand for the simple case; object form when you need `all` or `required`:

```jsonc
{
  "h1":           "h1",                                   // text, first match
  "price":        "[itemprop=price]@content",             // attribute value
  "intro":        "article > p:first-of-type#html",       // inner HTML
  "faqQuestions": { "selector": ".faq h3", "all": true },
  "title":        { "selector": "title", "required": true }
}
```

### Selector grammar

Suffix on the CSS selector, optional:

| Suffix      | Returns                                                 |
|-------------|---------------------------------------------------------|
| *(none)*    | `$(selector).first().text().trim()`                     |
| `@attr`     | `$(selector).first().attr(attr) ?? null`                |
| `#html`     | `$(selector).first().html() ?? null` (inner HTML)       |

Parser splits on the **last top-level** `@` or `#`, ignoring anything inside `[…]`. This keeps attribute selectors like `a[href$=".pdf"]@href` working correctly. `@attr` and `#html` are mutually exclusive — combining them is a parse error.

### Field-name validation

`^[A-Za-z_][A-Za-z0-9_-]*$`. Disallows dots, spaces, and JSON-unfriendly characters. Errors list the offending name.

## New types (in `src/types.ts`)

```ts
export interface ExtractionRule {
  selector: string;       // raw CSS, e.g. ".faq h3"
  attr?: string;          // present when grammar was `@attr`
  html?: boolean;         // present when grammar was `#html`
  all?: boolean;          // multi-match → string[]
  required?: boolean;     // missing → low-severity issue
}

export type ExtractionResult = Record<string, string | string[] | null>;

export interface ExtractionSummary {
  rules: string[];                                  // rule names in declaration order
  pagesEvaluated: number;                           // pages where extractions actually ran
  matchCounts: Record<string, number>;              // pages where rule produced a non-null/non-empty result
  missingRequiredCounts: Record<string, number>;    // pages where a required rule produced no match
  pagesWithMissingRequired: number;                 // distinct pages with ≥1 missing-required hit
}
```

Added (optional) to existing types:

- `PageReport.extracted?: ExtractionResult`
- `SiteReport.extractionSummary?: ExtractionSummary`
- `AnalyzeOptions.extract?: Record<string, string | ExtractionRule>`

Re-exported from `src/index.ts`.

## Components

### `src/extract.ts` (new)

Pure module, three exports:

```ts
parseExtractionRules(input: unknown): Record<string, ExtractionRule>
runExtractions(
  $: CheerioAPI,
  rules: Record<string, ExtractionRule>
): { result: ExtractionResult; missingRequired: string[] }
summarizeExtractions(
  pages: PageReport[],
  rules: Record<string, ExtractionRule>
): ExtractionSummary
```

`parseExtractionRules` accepts any of: a JSON string, a parsed object, an `AnalyzeOptions.extract` object. Validates field names, parses selector grammar, throws `Error` with a clear message on invalid input. Used by both the CLI (after JSON.parse on `--extract` / file contents) and the library entry point.

`runExtractions` is invoked once per page, *after* the page's cheerio instance is loaded. Returns the per-page result and the list of required rule names that came back empty (for issue emission). Catches per-rule errors so one bad selector doesn't kill the crawl — failed rules return `null`. The first failure for any given rule is logged once to stderr (`Extraction rule "<name>" failed: <error>`); subsequent failures of the same rule are silently swallowed to avoid log spam.

`summarizeExtractions` is invoked once after the crawl, by the analyzer, before the final report assembly. Pure function over `PageReport[]`.

### `src/analyzer.ts` changes

- Accept `options.extract` (already-parsed `Record<string, ExtractionRule>` if from library, or pre-parsed by CLI).
- After the existing `cheerio.load(html)` at line 1149, call `runExtractions` and attach `extracted` to the page's report.
- For each name in `missingRequired`, append an issue with code `EXTRACTION_MISSING_REQUIRED`, severity `low`, message `Required extraction "<name>" returned no match for selector "<selector>"`.
- After the page loop, if rules are configured, call `summarizeExtractions(pages, rules)` and attach to `SiteReport.extractionSummary`.

### `src/cli.ts` changes

- Add `--extract` and `--extract-file` flags. Mutually exclusive — error if both are set.
- Read input (inline JSON or file contents), `JSON.parse`, hand to `parseExtractionRules`.
- Pass the parsed rules into `analyzeSite` via `options.extract`.
- All validation errors print a friendly, single-line message and exit non-zero before crawling begins.

### `src/report.ts` changes

- Add a "Custom extractions" section to text and HTML reports, rendered only when `extractionSummary` is present. Format:

  ```
  Custom extractions
    Rules: h1, price, faqQuestions, title (4)
    Match coverage:
      h1            100% (50/50)
      price          87% (43/50)
      faqQuestions   12% (6/50)
      title         100% (50/50)
    Pages with missing required fields: 3
      title: 3
  ```

- HTML uses an `<h2>Custom extractions</h2>` heading consistent with existing sections.
- Per-page extraction values are NOT rendered in HTML/text/PDF — only the summary.

## Issue code

```ts
{
  code: "EXTRACTION_MISSING_REQUIRED",
  severity: "low",
  url: <page url>,
  message: `Required extraction "<name>" returned no match for selector "<selector>"`
}
```

Hooks into `--fail-on low` automatically. Documented in README and CHANGELOG.

## Errors / edge cases

| Case | Behavior |
|---|---|
| `--extract` and `--extract-file` both set | Error before crawl: "Use --extract or --extract-file, not both." Exit 1. |
| Invalid JSON in `--extract` or file | Error with parse position from the JSON.parse exception. Exit 1. |
| Invalid field name (e.g. `"my.field"`, `"price tag"`) | Error: `Invalid extraction field name "my.field" — must match /^[A-Za-z_][A-Za-z0-9_-]*$/`. Exit 1. |
| `selector@attr#html` (combined suffixes) | Parse error: "Cannot combine `@attr` and `#html`." Exit 1. |
| Empty rules object `{}` | No-op. No `extracted` on pages, no summary. Crawl proceeds normally. |
| Selector that throws inside cheerio at runtime | Caught per page, treated as no match. The first failure of a given rule logs a single stderr warning (`Extraction rule "<name>" failed: <message>`); subsequent failures of the same rule are silenced. Crawl continues. |
| Required rule with no match | Page's `extracted[name] = null`, missing-required issue emitted. |
| Required rule with `all: true` and zero matches | Treated as missing → empty array AND missing-required issue emitted. |
| Non-required rule with no match | `extracted[name] = null` (or `[]` for `all: true`). No issue. |
| Rendering on/off | Extractions run against whatever DOM cheerio is loading — same as every other check. JS-rendered content is included when `--render` is on. No extra plumbing. |

## Testing strategy

### Unit tests

`tests/extract.test.ts`:

- `parseExtractionRules`:
  - String shorthand for plain text / `@attr` / `#html`.
  - Object form with `all`, `required`, both, neither.
  - Mixed shorthand and object form in one config.
  - Empty object → empty map.
  - Error: invalid field name (`"my.field"`, `"price tag"`, `"123abc"`).
  - Error: combined `@attr` and `#html`.
  - Error: non-string selector in object form.
  - Error: non-object input at top level.
- Selector-grammar parser:
  - Plain selector → `{ selector, attr: undefined, html: false }`.
  - `meta[name=author]@content` → `{ selector: "meta[name=author]", attr: "content" }` — verifies the `]` inside brackets does not confuse the parser.
  - `a[href$=".pdf"]@href` — same edge case with quoted `]` substring.
  - `article p:first-of-type#html` → `{ html: true }`.
  - Attribute name with hyphens / dots (`@data-product-id`) → preserved as-is.
- `runExtractions`:
  - First match (default).
  - All-mode (`all: true`) returning empty array, single, multiple.
  - Attribute extraction returning `null` for missing attributes.
  - HTML extraction.
  - Required + missing → returned in `missingRequired`.
  - Required + present → not returned in `missingRequired`.
  - Non-required + missing → not in `missingRequired`.

### Integration test

`tests/extract-integration.test.ts` (or extend an existing analyzer test):

- Run `analyzeSite` against a small fixture HTML with two pages.
- Assert each page's `PageReport.extracted` matches expected values.
- Assert `EXTRACTION_MISSING_REQUIRED` issue is emitted on the page where a required field is absent.
- Assert `SiteReport.extractionSummary` matches expected counts.
- Assert no `extracted` / `extractionSummary` fields when `extract` option is omitted.

### CLI tests

- `--extract` with valid inline JSON → rules applied.
- `--extract-file` with valid file → rules applied.
- Both flags → error, exit 1.
- Invalid JSON → error, exit 1.
- Invalid field name → error, exit 1.

## Documentation

### README

New "Custom extractions" section under "Useful Options" with:

- Two-line pitch (what it does, why).
- Full inline-JSON and `--extract-file` examples.
- Selector-grammar table.
- Object-form example with `all` and `required`.
- Note that `required` integrates with `--fail-on low`.

### CHANGELOG (in README)

```
### v0.7.0 — <date>

- **Added:** custom extraction rules. Define CSS-selector-based field extractions
  with `--extract '<json>'` or `--extract-file <path>`. Selector grammar:
  `selector` (text), `selector@attr` (attribute), `selector#html` (inner HTML).
  Object form supports `all: true` (multi-match) and `required: true`
  (low-severity `EXTRACTION_MISSING_REQUIRED` issue, integrates with `--fail-on`).
- **Added:** `AnalyzeOptions.extract` for library consumers, plus
  `PageReport.extracted` and `SiteReport.extractionSummary` in the JSON report.
- **Added:** "Custom extractions" summary section in HTML/text/PDF reports.
  Full per-page detail remains in JSON.
```

## Out of scope (deferred)

- XPath
- Per-rule transforms (regex, trim, parseInt, lowercase)
- Extraction-only mode (skip checks, just extract)
- Nested / scoped extraction (extract record-of-records, e.g., per-`.product`)
- Live selector validation against a remote DOM
- Per-rule severity override (always `low` for now)
