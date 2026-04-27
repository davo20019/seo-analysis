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
