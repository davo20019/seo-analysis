export type RobotsRule = { type: "allow" | "disallow"; path: string };
export type RobotsRules = Record<string, RobotsRule[]>;

export function parseRobotsRules(text: string): RobotsRules {
  const rules: RobotsRules = {};
  let currentUAs: string[] = [];

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      const ua = value.toLowerCase();
      // Start fresh for a new user-agent block
      currentUAs = [ua];
      if (!rules[ua]) rules[ua] = [];
    } else if (key === "disallow" || key === "allow") {
      if (currentUAs.length === 0) continue;
      const rule: RobotsRule = { type: key, path: value };
      for (const ua of currentUAs) rules[ua].push(rule);
    }
  }
  return rules;
}

export function isUrlAllowed(
  url: string,
  userAgent: string,
  rules: RobotsRules,
): boolean {
  const ua = userAgent.toLowerCase();
  const path = new URL(url).pathname;

  // Check UA-specific rules first, then fall back to *
  const uaRules = rules[ua] ?? [];
  const wildcardRules = rules["*"] ?? [];
  const applicable = [...uaRules, ...wildcardRules];

  let bestMatch: { rule: RobotsRule; length: number } | null = null;
  for (const rule of applicable) {
    if (!rule.path) continue;
    if (path.startsWith(rule.path)) {
      if (!bestMatch || rule.path.length > bestMatch.length) {
        bestMatch = { rule, length: rule.path.length };
      }
    }
  }
  if (!bestMatch) return true;
  return bestMatch.rule.type === "allow";
}
