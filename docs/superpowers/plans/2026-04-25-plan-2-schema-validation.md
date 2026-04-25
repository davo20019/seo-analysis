# Plan 2 — Schema.org / JSON-LD Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current presence-only JSON-LD detection with real validation against Google's rich-result requirements for the six schema types most clients care about: Product, Article, FAQPage, BreadcrumbList, Organization, LocalBusiness.

**Architecture:** New `src/checks/schema-checks.ts` exports a `parseJsonLd(scripts: string[])` function plus per-type validators (`validateProduct`, `validateArticle`, etc.) — all pure. A top-level `checkJsonLdValidation(scripts)` orchestrator routes each parsed object to the validator matching its `@type` and returns `Issue[]`. `analyzer.ts` calls the orchestrator. Existing `extractSchemaTypes` stays as-is.

**Tech Stack:** Same as Plan 1 — TS 6 ESM, vitest 4.

**Scope exclusions:**
- Schema types beyond the 6 listed. Adding more is mechanical; we ship the high-value ones.
- Validation against Google's full Structured Data Testing Tool ruleset — we cover the documented required props per type, not every nuance.
- Rendered-page support: validation runs on whatever JSON-LD comes back from the fetch (static or rendered). Plan 5's `--render` already handles the fetch part.

---

## File Structure

New:
- `src/checks/schema-checks.ts` — `parseJsonLd`, six validators, `checkJsonLdValidation` orchestrator
- `tests/checks/schema-checks.test.ts`

Modified:
- `src/analyzer.ts` — call `checkJsonLdValidation` inside `analyzeHtml` (alongside other checks)
- `README.md` — note the new validation capability

---

## Task 1: parseJsonLd + scaffold module

**Files:**
- Create: `src/checks/schema-checks.ts`
- Create: `tests/checks/schema-checks.test.ts`

- [ ] **Step 1: Failing tests for `parseJsonLd`**

Create `tests/checks/schema-checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseJsonLd } from "../../src/checks/schema-checks.js";

describe("parseJsonLd", () => {
  it("parses a single object script", () => {
    const result = parseJsonLd([`{"@context":"https://schema.org","@type":"Product","name":"X"}`]);
    expect(result).toHaveLength(1);
    expect(result[0]["@type"]).toBe("Product");
  });

  it("parses an array script (multiple objects in one tag)", () => {
    const result = parseJsonLd([`[{"@type":"Product","name":"A"},{"@type":"Article","headline":"B"}]`]);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o["@type"]).sort()).toEqual(["Article", "Product"]);
  });

  it("walks @graph wrappers", () => {
    const result = parseJsonLd([
      `{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"X"},{"@type":"FAQPage"}]}`,
    ]);
    expect(result.map((o) => o["@type"]).sort()).toEqual(["FAQPage", "Product"]);
  });

  it("ignores invalid JSON without throwing", () => {
    expect(parseJsonLd([`{not json`, `{"@type":"Product"}`])).toHaveLength(1);
  });

  it("returns an empty array when no scripts contain valid objects", () => {
    expect(parseJsonLd([])).toEqual([]);
    expect(parseJsonLd(["null", "42"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/schema-checks.test.ts`

Expected: "Cannot find module".

- [ ] **Step 3: Implement**

Create `src/checks/schema-checks.ts`:

```ts
import type { Issue } from "../types.js";

export type JsonLdObject = Record<string, unknown> & { "@type"?: string | string[] };

export function parseJsonLd(rawScripts: string[]): JsonLdObject[] {
  const objects: JsonLdObject[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as JsonLdObject;
    if (typeof record["@type"] === "string" || Array.isArray(record["@type"])) {
      objects.push(record);
    }
    if (Array.isArray(record["@graph"])) {
      record["@graph"].forEach(visit);
    }
  };

  for (const script of rawScripts) {
    try {
      visit(JSON.parse(script));
    } catch {
      // Ignore unparseable scripts — the existing analyzer already flags missing/empty schema separately.
    }
  }

  return objects;
}

function getType(obj: JsonLdObject): string[] {
  const t = obj["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

export function hasType(obj: JsonLdObject, type: string): boolean {
  return getType(obj).includes(type);
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/schema-checks.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/schema-checks.ts tests/checks/schema-checks.test.ts
git commit -m "feat: add JSON-LD parser for schema validation"
```

---

## Task 2: Product + Article validators

**Files:**
- Modify: `src/checks/schema-checks.ts`
- Modify: `tests/checks/schema-checks.test.ts`

Per Google's docs:
- **Product** required: `name`, `image`, `offers` (with `price` and `priceCurrency`).
- **Article** required: `headline`, `image`, `datePublished`, `author`.

- [ ] **Step 1: Failing tests**

Append to `tests/checks/schema-checks.test.ts`:

```ts
import { validateProduct, validateArticle } from "../../src/checks/schema-checks.js";

describe("validateProduct", () => {
  it("flags missing offers", () => {
    const issues = validateProduct({ "@type": "Product", name: "X", image: "https://x/img.jpg" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_PRODUCT_MISSING_OFFERS");
  });

  it("flags offers without price/priceCurrency", () => {
    const issues = validateProduct({
      "@type": "Product",
      name: "X",
      image: "https://x/img.jpg",
      offers: { "@type": "Offer" },
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_PRODUCT_OFFERS_MISSING_PRICE");
  });

  it("returns empty for a complete Product", () => {
    expect(validateProduct({
      "@type": "Product",
      name: "X",
      image: "https://x/img.jpg",
      offers: { "@type": "Offer", price: "9.99", priceCurrency: "USD" },
    })).toEqual([]);
  });
});

describe("validateArticle", () => {
  it("flags missing datePublished", () => {
    const issues = validateArticle({
      "@type": "Article",
      headline: "X",
      image: "https://x/img.jpg",
      author: { name: "A" },
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_ARTICLE_MISSING_DATE_PUBLISHED");
  });

  it("flags missing author", () => {
    const issues = validateArticle({
      "@type": "Article",
      headline: "X",
      image: "https://x/img.jpg",
      datePublished: "2024-01-01",
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_ARTICLE_MISSING_AUTHOR");
  });

  it("returns empty for a complete Article", () => {
    expect(validateArticle({
      "@type": "Article",
      headline: "X",
      image: "https://x/img.jpg",
      datePublished: "2024-01-01",
      author: { name: "A" },
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail (functions don't exist)**

Run: `npm test -- tests/checks/schema-checks.test.ts`

- [ ] **Step 3: Implement**

Append to `src/checks/schema-checks.ts`:

```ts
function makeIssue(code: string, severity: "high" | "medium" | "low", message: string, recommendation: string): Issue {
  return { code, severity, message, recommendation };
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function validateProduct(obj: JsonLdObject): Issue[] {
  const issues: Issue[] = [];
  if (!isPresent(obj.name)) {
    issues.push(makeIssue("SCHEMA_PRODUCT_MISSING_NAME", "medium",
      "Product schema is missing the required `name` field.",
      "Add a `name` property to the Product JSON-LD."));
  }
  if (!isPresent(obj.image)) {
    issues.push(makeIssue("SCHEMA_PRODUCT_MISSING_IMAGE", "medium",
      "Product schema is missing the required `image` field.",
      "Add at least one `image` URL to the Product JSON-LD."));
  }
  if (!isPresent(obj.offers)) {
    issues.push(makeIssue("SCHEMA_PRODUCT_MISSING_OFFERS", "medium",
      "Product schema is missing `offers` — required for rich-result eligibility.",
      "Add an `offers` object (or array) with `price` and `priceCurrency`."));
    return issues;
  }
  const offersList = Array.isArray(obj.offers) ? obj.offers : [obj.offers];
  for (const o of offersList) {
    if (!o || typeof o !== "object") continue;
    const offer = o as Record<string, unknown>;
    if (!isPresent(offer.price) && !isPresent(offer.lowPrice)) {
      issues.push(makeIssue("SCHEMA_PRODUCT_OFFERS_MISSING_PRICE", "medium",
        "Product offers entry is missing `price` (or `lowPrice` for AggregateOffer).",
        "Add a `price` field with a numeric string."));
      break;
    }
    if (!isPresent(offer.priceCurrency)) {
      issues.push(makeIssue("SCHEMA_PRODUCT_OFFERS_MISSING_CURRENCY", "medium",
        "Product offers entry is missing `priceCurrency`.",
        "Add a `priceCurrency` field (3-letter ISO 4217 code, e.g. USD)."));
      break;
    }
  }
  return issues;
}

export function validateArticle(obj: JsonLdObject): Issue[] {
  const issues: Issue[] = [];
  if (!isPresent(obj.headline)) {
    issues.push(makeIssue("SCHEMA_ARTICLE_MISSING_HEADLINE", "medium",
      "Article schema is missing the required `headline` field.",
      "Add a `headline` property (max 110 characters per Google guidelines)."));
  }
  if (!isPresent(obj.image)) {
    issues.push(makeIssue("SCHEMA_ARTICLE_MISSING_IMAGE", "medium",
      "Article schema is missing the required `image` field.",
      "Add at least one `image` URL to the Article JSON-LD."));
  }
  if (!isPresent(obj.datePublished)) {
    issues.push(makeIssue("SCHEMA_ARTICLE_MISSING_DATE_PUBLISHED", "medium",
      "Article schema is missing `datePublished`.",
      "Add a `datePublished` field in ISO-8601 format."));
  }
  if (!isPresent(obj.author)) {
    issues.push(makeIssue("SCHEMA_ARTICLE_MISSING_AUTHOR", "medium",
      "Article schema is missing `author`.",
      "Add an `author` object with at least `name` (or `@type: Person`/`Organization` with name)."));
  }
  return issues;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/schema-checks.test.ts`

Expected: 11 tests pass total (5 from Task 1 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/checks/schema-checks.ts tests/checks/schema-checks.test.ts
git commit -m "feat: add Product and Article JSON-LD validators"
```

---

## Task 3: FAQPage + BreadcrumbList validators

**Files:**
- Modify: `src/checks/schema-checks.ts`
- Modify: `tests/checks/schema-checks.test.ts`

- [ ] **Step 1: Failing tests**

Append to `tests/checks/schema-checks.test.ts`:

```ts
import { validateFaq, validateBreadcrumb } from "../../src/checks/schema-checks.js";

describe("validateFaq", () => {
  it("flags FAQPage with no mainEntity", () => {
    const issues = validateFaq({ "@type": "FAQPage" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_FAQ_NO_QUESTIONS");
  });

  it("flags Q&A entries missing question text or answer", () => {
    const issues = validateFaq({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "" },
        { "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "" } },
      ],
    });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("SCHEMA_FAQ_QUESTION_INCOMPLETE");
  });

  it("returns empty for a valid FAQ", () => {
    expect(validateFaq({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } },
      ],
    })).toEqual([]);
  });
});

describe("validateBreadcrumb", () => {
  it("flags missing itemListElement", () => {
    const issues = validateBreadcrumb({ "@type": "BreadcrumbList" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_BREADCRUMB_NO_ITEMS");
  });

  it("flags items missing position or name or item", () => {
    const issues = validateBreadcrumb({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home" },
      ],
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_BREADCRUMB_ITEM_INCOMPLETE");
  });

  it("accepts a valid breadcrumb", () => {
    expect(validateBreadcrumb({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://x.com/" },
        { "@type": "ListItem", position: 2, name: "Products", item: "https://x.com/p" },
      ],
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/schema-checks.test.ts`

- [ ] **Step 3: Implement**

Append to `src/checks/schema-checks.ts`:

```ts
export function validateFaq(obj: JsonLdObject): Issue[] {
  const issues: Issue[] = [];
  const entities = obj.mainEntity;
  if (!Array.isArray(entities) || entities.length === 0) {
    issues.push(makeIssue("SCHEMA_FAQ_NO_QUESTIONS", "medium",
      "FAQPage schema has no `mainEntity` questions — required for rich-result eligibility.",
      "Add a `mainEntity` array of Question objects, each with `name` and an `acceptedAnswer.text`."));
    return issues;
  }
  for (const q of entities) {
    if (!q || typeof q !== "object") continue;
    const question = q as Record<string, unknown>;
    const hasName = isPresent(question.name);
    const answer = question.acceptedAnswer as Record<string, unknown> | undefined;
    const hasAnswer = !!answer && isPresent(answer.text);
    if (!hasName || !hasAnswer) {
      issues.push(makeIssue("SCHEMA_FAQ_QUESTION_INCOMPLETE", "medium",
        "One or more FAQ Question entries are missing `name` or `acceptedAnswer.text`.",
        "Each Question must have a non-empty `name` and an `acceptedAnswer` with non-empty `text`."));
      break;
    }
  }
  return issues;
}

export function validateBreadcrumb(obj: JsonLdObject): Issue[] {
  const issues: Issue[] = [];
  const items = obj.itemListElement;
  if (!Array.isArray(items) || items.length === 0) {
    issues.push(makeIssue("SCHEMA_BREADCRUMB_NO_ITEMS", "medium",
      "BreadcrumbList has no `itemListElement` entries.",
      "Add a non-empty `itemListElement` array of ListItem objects."));
    return issues;
  }
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const item = it as Record<string, unknown>;
    if (!isPresent(item.position) || !isPresent(item.name) || !isPresent(item.item)) {
      issues.push(makeIssue("SCHEMA_BREADCRUMB_ITEM_INCOMPLETE", "medium",
        "One or more breadcrumb items are missing `position`, `name`, or `item`.",
        "Each ListItem must have a numeric `position`, a `name`, and an `item` URL."));
      break;
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/schema-checks.test.ts`

Expected: 17 tests pass total (11 prior + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/checks/schema-checks.ts tests/checks/schema-checks.test.ts
git commit -m "feat: add FAQPage and BreadcrumbList validators"
```

---

## Task 4: Organization + LocalBusiness validators

**Files:**
- Modify: `src/checks/schema-checks.ts`
- Modify: `tests/checks/schema-checks.test.ts`

LocalBusiness extends Organization in schema.org. Both share `name`, `url`, `logo`. LocalBusiness additionally needs `address` and a contact channel (`telephone`).

- [ ] **Step 1: Failing tests**

Append to `tests/checks/schema-checks.test.ts`:

```ts
import { validateOrganization, validateLocalBusiness } from "../../src/checks/schema-checks.js";

describe("validateOrganization", () => {
  it("flags missing name", () => {
    const issues = validateOrganization({ "@type": "Organization" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_ORG_MISSING_NAME");
  });

  it("flags missing logo", () => {
    const issues = validateOrganization({ "@type": "Organization", name: "Acme", url: "https://acme" });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_ORG_MISSING_LOGO");
  });

  it("accepts a complete Organization", () => {
    expect(validateOrganization({
      "@type": "Organization",
      name: "Acme",
      url: "https://acme.com",
      logo: "https://acme.com/logo.png",
    })).toEqual([]);
  });
});

describe("validateLocalBusiness", () => {
  it("flags missing address", () => {
    const issues = validateLocalBusiness({
      "@type": "LocalBusiness",
      name: "Diner",
      url: "https://d",
      logo: "https://d/l",
      telephone: "+1-555",
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_LOCALBUSINESS_MISSING_ADDRESS");
  });

  it("flags missing telephone", () => {
    const issues = validateLocalBusiness({
      "@type": "LocalBusiness",
      name: "Diner",
      url: "https://d",
      logo: "https://d/l",
      address: { "@type": "PostalAddress", streetAddress: "1 Main", addressLocality: "Town", addressCountry: "US" },
    });
    expect(issues.map((i) => i.code)).toContain("SCHEMA_LOCALBUSINESS_MISSING_TELEPHONE");
  });

  it("accepts a complete LocalBusiness", () => {
    expect(validateLocalBusiness({
      "@type": "LocalBusiness",
      name: "Diner",
      url: "https://d",
      logo: "https://d/l",
      address: { "@type": "PostalAddress", streetAddress: "1 Main", addressLocality: "Town", addressCountry: "US" },
      telephone: "+1-555-1234",
    })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/schema-checks.test.ts`

- [ ] **Step 3: Implement**

Append to `src/checks/schema-checks.ts`:

```ts
export function validateOrganization(obj: JsonLdObject): Issue[] {
  const issues: Issue[] = [];
  if (!isPresent(obj.name)) {
    issues.push(makeIssue("SCHEMA_ORG_MISSING_NAME", "medium",
      "Organization schema is missing `name`.",
      "Add a `name` property identifying the organization."));
  }
  if (!isPresent(obj.url)) {
    issues.push(makeIssue("SCHEMA_ORG_MISSING_URL", "low",
      "Organization schema is missing `url`.",
      "Add a `url` property pointing to the canonical home page."));
  }
  if (!isPresent(obj.logo)) {
    issues.push(makeIssue("SCHEMA_ORG_MISSING_LOGO", "medium",
      "Organization schema is missing `logo` — required for many rich-result surfaces.",
      "Add a `logo` URL (or an ImageObject)."));
  }
  return issues;
}

export function validateLocalBusiness(obj: JsonLdObject): Issue[] {
  const issues: Issue[] = validateOrganization(obj);
  if (!isPresent(obj.address)) {
    issues.push(makeIssue("SCHEMA_LOCALBUSINESS_MISSING_ADDRESS", "medium",
      "LocalBusiness schema is missing `address`.",
      "Add a PostalAddress object with at least streetAddress, addressLocality, addressCountry."));
  }
  if (!isPresent(obj.telephone) && !isPresent(obj.contactPoint)) {
    issues.push(makeIssue("SCHEMA_LOCALBUSINESS_MISSING_TELEPHONE", "medium",
      "LocalBusiness schema is missing a contact channel (`telephone` or `contactPoint`).",
      "Add a `telephone` field or a `contactPoint` object."));
  }
  return issues;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/schema-checks.test.ts`

Expected: 23 tests pass total (17 + 6).

- [ ] **Step 5: Commit**

```bash
git add src/checks/schema-checks.ts tests/checks/schema-checks.test.ts
git commit -m "feat: add Organization and LocalBusiness validators"
```

---

## Task 5: Orchestrator + analyzer integration

**Files:**
- Modify: `src/checks/schema-checks.ts`
- Modify: `tests/checks/schema-checks.test.ts`
- Modify: `src/analyzer.ts`

- [ ] **Step 1: Failing tests for orchestrator**

Append to `tests/checks/schema-checks.test.ts`:

```ts
import { checkJsonLdValidation } from "../../src/checks/schema-checks.js";

describe("checkJsonLdValidation (orchestrator)", () => {
  it("dispatches each object to the right validator", () => {
    const scripts = [
      `{"@type":"Product","name":"X"}`,
      `{"@type":"Article","headline":"Y"}`,
    ];
    const codes = checkJsonLdValidation(scripts).map((i) => i.code);
    expect(codes).toContain("SCHEMA_PRODUCT_MISSING_IMAGE");
    expect(codes).toContain("SCHEMA_ARTICLE_MISSING_AUTHOR");
  });

  it("returns empty when there is no JSON-LD at all", () => {
    expect(checkJsonLdValidation([])).toEqual([]);
  });

  it("ignores @types we do not validate", () => {
    expect(checkJsonLdValidation([`{"@type":"WebPage","name":"X"}`])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/schema-checks.test.ts`

- [ ] **Step 3: Implement orchestrator**

Append to `src/checks/schema-checks.ts`:

```ts
export function checkJsonLdValidation(rawScripts: string[]): Issue[] {
  const objects = parseJsonLd(rawScripts);
  const issues: Issue[] = [];
  for (const obj of objects) {
    if (hasType(obj, "Product")) issues.push(...validateProduct(obj));
    if (hasType(obj, "Article") || hasType(obj, "BlogPosting") || hasType(obj, "NewsArticle")) {
      issues.push(...validateArticle(obj));
    }
    if (hasType(obj, "FAQPage")) issues.push(...validateFaq(obj));
    if (hasType(obj, "BreadcrumbList")) issues.push(...validateBreadcrumb(obj));
    if (hasType(obj, "LocalBusiness")) {
      issues.push(...validateLocalBusiness(obj));
    } else if (hasType(obj, "Organization")) {
      issues.push(...validateOrganization(obj));
    }
  }
  return issues;
}
```

(LocalBusiness check is exclusive — don't double-report Organization issues for the same object.)

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/schema-checks.test.ts`

Expected: 26 tests pass.

- [ ] **Step 5: Wire into analyzer.ts**

In `src/analyzer.ts`:

a) Add import at the top with the other check imports:

```ts
import { checkJsonLdValidation } from "./checks/schema-checks.js";
```

b) Find the line near `extractSchemaTypes` (around line 1125–1126):

```ts
const schemaTypes = extractSchemaTypes(
  $('script[type="application/ld+json"]')
```

The argument is the cheerio result of script tags. We need the raw script TEXT. Right after `extractSchemaTypes` is called, capture the same scripts as a `string[]` and pass them into the validator call. Look at how extractSchemaTypes consumes its argument — it likely takes a Cheerio object and reads `.html()` or similar. Mirror that to get raw text:

```ts
const ldScripts: string[] = $('script[type="application/ld+json"]')
  .toArray()
  .map((el) => $(el).html() ?? "");
```

(If `extractSchemaTypes` already does this internally, you may need to refactor it slightly to expose the raw scripts. Pick the path with the smallest diff — if its signature is `(rawScripts: string[]) => string[]`, then `ldScripts` is already what's passed in; reuse the variable. If it takes a Cheerio object, leave it alone and compute `ldScripts` separately for the new call.)

c) Near the bottom of `analyzeHtml`, where other checks are pushed via `for (const issue of checkX(...)) pushIssue(...)`, add:

```ts
for (const issue of checkJsonLdValidation(ldScripts)) pushIssue(issues, issue);
```

- [ ] **Step 6: Run full suite + build**

Run: `npm test`

Expected: all 65 tests still pass (39 prior + 23 schema-checks + 3 orchestrator). Adjust the count if extractSchemaTypes ended up needing a tweak.

Run: `npm run build`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/checks/schema-checks.ts tests/checks/schema-checks.test.ts src/analyzer.ts
git commit -m "feat: validate JSON-LD against rich-result requirements"
```

---

## Task 6: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add new bullets under "What It Checks"**

Locate the "What It Checks" list. Append these bullets (after the Plan 1 bullets that are already there):

```
- JSON-LD validation: missing required fields on Product, Article (BlogPosting/NewsArticle), FAQPage, BreadcrumbList, Organization, and LocalBusiness
- JSON-LD Product offers without `price` or `priceCurrency`
```

Replace the older bullet `- missing JSON-LD schema presence` with the more accurate `- missing or invalid JSON-LD structured data` since presence + validation are now both covered.

- [ ] **Step 2: Verify**

Run: `npm test && npm run build`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: list new JSON-LD validation checks"
```

---

## Self-Review Notes

- **Spec coverage:** Six schema types validated (Product, Article + BlogPosting/NewsArticle aliases, FAQPage, BreadcrumbList, Organization, LocalBusiness). Each has tests for missing-required-field detection and a complete-object happy path. Orchestrator dispatches by `@type`.
- **Placeholder scan:** Every task has complete code. The only conditional branch is in Task 5 Step 5b — the implementer needs to choose between reusing `extractSchemaTypes`'s argument or computing a fresh `ldScripts` variable; both paths are explicit.
- **Type consistency:** `Issue` shape from `src/types.ts` is used uniformly. `JsonLdObject` is defined once in Task 1 and reused.
