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
