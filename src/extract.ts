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
