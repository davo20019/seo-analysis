import type { load as cheerioLoad } from "cheerio";
import type { ExtractionRule, ExtractionResult } from "./types.js";

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
