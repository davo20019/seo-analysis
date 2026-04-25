# Plan 1 — Static HTML Audit Expansions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four new categories of static HTML / HTTP audit checks (image audit, mobile viewport, response headers, robots.txt URL evaluation) without further bloating `analyzer.ts`.

**Architecture:** New checks live in focused modules under `src/checks/` as pure functions that take parsed input (Cheerio instance, response headers, parsed robots rules) and return `Issue[]`. `analyzer.ts` imports and calls them — it becomes an orchestrator, not the place where new logic is added. This makes every new check directly unit-testable.

**Tech Stack:** TypeScript 6 ESM, cheerio 1.2, vitest 4.1 (already installed in Plan 0).

**Scope exclusions:**
- Tap-target sizing and font-size minimums — require rendered layout measurement; move to Plan 5 (Playwright).
- Background/visual regression of existing checks — out of scope.
- Rewriting existing inline checks in `analyzer.ts` — don't unilaterally refactor; only extract what this plan touches.

---

## File Structure

New files:
- `src/checks/image-checks.ts` — pure functions: `checkImageDimensions`, `checkImageLazyLoading`, `checkImageFormats`
- `src/checks/mobile-checks.ts` — pure functions: `checkViewportMeta`
- `src/checks/header-checks.ts` — pure functions: `checkResponseHeaders`, `checkXRobotsTag`
- `src/checks/robots-checks.ts` — pure functions: `parseRobotsRules`, `isUrlAllowed`, `checkUrlAgainstRobots`
- `tests/checks/image-checks.test.ts`
- `tests/checks/mobile-checks.test.ts`
- `tests/checks/header-checks.test.ts`
- `tests/checks/robots-checks.test.ts`

Modified files:
- `src/types.ts` — add new Issue code strings (documentation only; `code` is already `string`).
- `src/analyzer.ts` — minimal surgical edits at known integration points: extend `FetchResult` with headers, wire new check calls into `analyzeHtml()` and `inspectInfrastructure()`.

---

## Task 1: Image-checks module — dimensions

**Files:**
- Create: `src/checks/image-checks.ts`
- Create: `tests/checks/image-checks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/checks/image-checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { checkImageDimensions } from "../../src/checks/image-checks.js";

describe("checkImageDimensions", () => {
  it("flags images missing both width and height", () => {
    const $ = load(`<html><body>
      <img src="a.jpg">
      <img src="b.jpg" width="100" height="50">
    </body></html>`);
    const issues = checkImageDimensions($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("IMAGES_MISSING_DIMENSIONS");
    expect(issues[0].severity).toBe("low");
  });

  it("returns no issues when every image has dimensions", () => {
    const $ = load(`<img src="a.jpg" width="1" height="1">`);
    expect(checkImageDimensions($)).toEqual([]);
  });

  it("returns no issues when there are no images", () => {
    const $ = load(`<html><body><p>no images</p></body></html>`);
    expect(checkImageDimensions($)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail (module doesn't exist)**

Run: `npm test -- tests/checks/image-checks.test.ts`

Expected: failure with "Cannot find module" or "Failed to resolve import".

- [ ] **Step 3: Implement**

Create `src/checks/image-checks.ts`:

```ts
import type { CheerioAPI } from "cheerio";
import type { Issue } from "../types.js";

export function checkImageDimensions($: CheerioAPI): Issue[] {
  const offenders = $("img").toArray().filter((el) => {
    const hasWidth = !!$(el).attr("width");
    const hasHeight = !!$(el).attr("height");
    return !hasWidth && !hasHeight;
  });
  if (offenders.length === 0) return [];
  return [{
    code: "IMAGES_MISSING_DIMENSIONS",
    severity: "low",
    message: `${offenders.length} image(s) are missing explicit width/height attributes.`,
    recommendation: "Add width and height attributes so the browser can reserve layout space and avoid CLS.",
  }];
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/image-checks.test.ts`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/image-checks.ts tests/checks/image-checks.test.ts
git commit -m "feat: add image dimension check"
```

---

## Task 2: Image-checks — lazy loading

**Files:**
- Modify: `src/checks/image-checks.ts`
- Modify: `tests/checks/image-checks.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/checks/image-checks.test.ts` (outside the first `describe`):

```ts
import { checkImageLazyLoading } from "../../src/checks/image-checks.js";

describe("checkImageLazyLoading", () => {
  it("flags images without loading=lazy", () => {
    const $ = load(`<img src="a.jpg"><img src="b.jpg" loading="lazy">`);
    const issues = checkImageLazyLoading($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("IMAGES_MISSING_LAZY_LOADING");
  });

  it("does not flag when all images opt into lazy or eager loading", () => {
    const $ = load(`<img src="a.jpg" loading="lazy"><img src="b.jpg" loading="eager">`);
    expect(checkImageLazyLoading($)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/image-checks.test.ts`

Expected: new describe block fails; existing 3 tests still pass.

- [ ] **Step 3: Implement**

Append to `src/checks/image-checks.ts`:

```ts
export function checkImageLazyLoading($: CheerioAPI): Issue[] {
  const offenders = $("img").toArray().filter((el) => !$(el).attr("loading"));
  if (offenders.length === 0) return [];
  return [{
    code: "IMAGES_MISSING_LAZY_LOADING",
    severity: "low",
    message: `${offenders.length} image(s) have no loading attribute (set loading="lazy" for below-the-fold images).`,
    recommendation: 'Add loading="lazy" to non-critical images to defer off-screen loading.',
  }];
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/image-checks.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/image-checks.ts tests/checks/image-checks.test.ts
git commit -m "feat: add image lazy-loading check"
```

---

## Task 3: Image-checks — modern formats

**Files:**
- Modify: `src/checks/image-checks.ts`
- Modify: `tests/checks/image-checks.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/checks/image-checks.test.ts`:

```ts
import { checkImageFormats } from "../../src/checks/image-checks.js";

describe("checkImageFormats", () => {
  it("flags legacy formats (.jpg/.jpeg/.png/.gif)", () => {
    const $ = load(`<img src="/a.jpg"><img src="/b.webp"><img src="/c.PNG">`);
    const issues = checkImageFormats($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("IMAGES_LEGACY_FORMAT");
    expect(issues[0].message).toContain("2");
  });

  it("ignores non-image src values (data: URIs, missing src)", () => {
    const $ = load(`<img src="data:image/svg+xml;base64,PHN2Zy8+"><img>`);
    expect(checkImageFormats($)).toEqual([]);
  });

  it("does not flag webp/avif", () => {
    const $ = load(`<img src="/a.webp"><img src="/b.avif">`);
    expect(checkImageFormats($)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/image-checks.test.ts`

- [ ] **Step 3: Implement**

Append to `src/checks/image-checks.ts`:

```ts
const LEGACY_IMAGE_EXT = /\.(jpe?g|png|gif)(\?|#|$)/i;

export function checkImageFormats($: CheerioAPI): Issue[] {
  const offenders = $("img").toArray().filter((el) => {
    const src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return false;
    return LEGACY_IMAGE_EXT.test(src);
  });
  if (offenders.length === 0) return [];
  return [{
    code: "IMAGES_LEGACY_FORMAT",
    severity: "low",
    message: `${offenders.length} image(s) use legacy formats (jpg/png/gif). Modern formats (webp/avif) reduce page weight.`,
    recommendation: "Serve images in webp or avif with a <picture> fallback for older browsers.",
  }];
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/image-checks.test.ts`

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/image-checks.ts tests/checks/image-checks.test.ts
git commit -m "feat: add image modern-format check"
```

---

## Task 4: Mobile-checks module — viewport meta

**Files:**
- Create: `src/checks/mobile-checks.ts`
- Create: `tests/checks/mobile-checks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/checks/mobile-checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { checkViewportMeta } from "../../src/checks/mobile-checks.js";

describe("checkViewportMeta", () => {
  it("flags pages with no viewport meta", () => {
    const $ = load(`<html><head></head></html>`);
    const issues = checkViewportMeta($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MOBILE_VIEWPORT_MISSING");
    expect(issues[0].severity).toBe("medium");
  });

  it("flags viewport meta without width=device-width", () => {
    const $ = load(`<meta name="viewport" content="initial-scale=1">`);
    const issues = checkViewportMeta($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MOBILE_VIEWPORT_WEAK");
  });

  it("flags viewport that locks user-scalable", () => {
    const $ = load(`<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">`);
    const issues = checkViewportMeta($);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("MOBILE_VIEWPORT_LOCKS_ZOOM");
    expect(issues[0].severity).toBe("medium");
  });

  it("accepts a standard responsive viewport", () => {
    const $ = load(`<meta name="viewport" content="width=device-width, initial-scale=1">`);
    expect(checkViewportMeta($)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/mobile-checks.test.ts`

- [ ] **Step 3: Implement**

Create `src/checks/mobile-checks.ts`:

```ts
import type { CheerioAPI } from "cheerio";
import type { Issue } from "../types.js";

export function checkViewportMeta($: CheerioAPI): Issue[] {
  const content = $('meta[name="viewport"]').attr("content");

  if (!content) {
    return [{
      code: "MOBILE_VIEWPORT_MISSING",
      severity: "medium",
      message: "Page has no viewport meta tag — mobile browsers will render at desktop width.",
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>.',
    }];
  }

  const normalized = content.toLowerCase().replace(/\s+/g, "");
  const issues: Issue[] = [];

  if (!normalized.includes("width=device-width")) {
    issues.push({
      code: "MOBILE_VIEWPORT_WEAK",
      severity: "medium",
      message: "Viewport meta is missing width=device-width — page will not scale to the device.",
      recommendation: 'Use content="width=device-width, initial-scale=1".',
    });
  }

  if (normalized.includes("user-scalable=no") || normalized.includes("maximum-scale=1")) {
    issues.push({
      code: "MOBILE_VIEWPORT_LOCKS_ZOOM",
      severity: "medium",
      message: "Viewport disables zoom, which is an accessibility problem (WCAG 1.4.4).",
      recommendation: "Remove user-scalable=no and maximum-scale to let users zoom.",
    });
  }

  return issues;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/mobile-checks.test.ts`

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/mobile-checks.ts tests/checks/mobile-checks.test.ts
git commit -m "feat: add mobile viewport meta check"
```

---

## Task 5: Extend FetchResult with response headers

**Files:**
- Modify: `src/analyzer.ts` (around lines 336–373, the `fetchText` function and `FetchResult` type)

This is a narrowly scoped infrastructure change needed by Tasks 6–7. No new checks yet.

- [ ] **Step 1: Write the failing test**

Create `tests/fetch-headers.test.ts` to verify the *exported* behavior via a round-trip. Since `fetchText` is not exported, this task adds a small exported helper `extractHeaderMap`.

```ts
import { describe, it, expect } from "vitest";
import { extractHeaderMap } from "../src/analyzer.js";

describe("extractHeaderMap", () => {
  it("lowercases header names and returns a plain object", () => {
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    });
    expect(extractHeaderMap(headers)).toEqual({
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    });
  });

  it("returns an empty object for empty headers", () => {
    expect(extractHeaderMap(new Headers())).toEqual({});
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/fetch-headers.test.ts`

Expected: "extractHeaderMap is not a function" or "Cannot find named export".

- [ ] **Step 3: Implement**

In `src/analyzer.ts`:

1. Find the `FetchResult` type (it's declared around line 72–78 per the exploration). Add a `headers: Record<string, string>` field:

```ts
export type FetchResult = {
  contentType: string | null;
  finalUrl: string;
  redirectChain: RedirectHop[];
  status: number;
  text: string;
  headers: Record<string, string>;
};
```

2. Export a new helper at the top of the file (after imports):

```ts
export function extractHeaderMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}
```

3. In `fetchText` (around line 366 per exploration), before the final return, populate `headers`:

```ts
const headers = extractHeaderMap(response.headers);
return { contentType, finalUrl, redirectChain, status, text, headers };
```

- [ ] **Step 4: Run — tests pass, build still works**

Run: `npm test`

Expected: all tests pass (including 2 new).

Run: `npm run build`

Expected: clean build (no TS errors — every `FetchResult` construction site must now include `headers`; if the build fails, grep for `FetchResult` and fix missing fields).

- [ ] **Step 5: Commit**

```bash
git add src/analyzer.ts tests/fetch-headers.test.ts
git commit -m "feat: capture response headers in FetchResult"
```

---

## Task 6: Header-checks module — X-Robots-Tag

**Files:**
- Create: `src/checks/header-checks.ts`
- Create: `tests/checks/header-checks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/checks/header-checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkXRobotsTag } from "../../src/checks/header-checks.js";

describe("checkXRobotsTag", () => {
  it("flags noindex in X-Robots-Tag", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "noindex" });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("HEADER_X_ROBOTS_NOINDEX");
    expect(issues[0].severity).toBe("high");
  });

  it("flags nofollow in X-Robots-Tag", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "nofollow" });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("HEADER_X_ROBOTS_NOFOLLOW");
  });

  it("parses comma-separated directives", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "noindex, nofollow" });
    expect(issues.map((i) => i.code).sort()).toEqual([
      "HEADER_X_ROBOTS_NOFOLLOW",
      "HEADER_X_ROBOTS_NOINDEX",
    ]);
  });

  it("ignores googlebot-scoped directives by default", () => {
    const issues = checkXRobotsTag({ "x-robots-tag": "googlebot: noindex" });
    expect(issues).toEqual([]);
  });

  it("returns no issues when header is absent", () => {
    expect(checkXRobotsTag({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/header-checks.test.ts`

- [ ] **Step 3: Implement**

Create `src/checks/header-checks.ts`:

```ts
import type { Issue } from "../types.js";

export function checkXRobotsTag(headers: Record<string, string>): Issue[] {
  const raw = headers["x-robots-tag"];
  if (!raw) return [];

  const issues: Issue[] = [];
  const directives = raw.split(",").map((s) => s.trim().toLowerCase());
  for (const directive of directives) {
    if (directive.includes(":")) continue;
    if (directive === "noindex") {
      issues.push({
        code: "HEADER_X_ROBOTS_NOINDEX",
        severity: "high",
        message: "X-Robots-Tag header contains noindex — page is excluded from search results.",
        recommendation: "Remove noindex from the X-Robots-Tag response header unless exclusion is intentional.",
      });
    }
    if (directive === "nofollow") {
      issues.push({
        code: "HEADER_X_ROBOTS_NOFOLLOW",
        severity: "medium",
        message: "X-Robots-Tag header contains nofollow — links on this page won't pass authority.",
        recommendation: "Remove nofollow from the X-Robots-Tag response header unless intentional.",
      });
    }
  }
  return issues;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/header-checks.test.ts`

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/header-checks.ts tests/checks/header-checks.test.ts
git commit -m "feat: add X-Robots-Tag header check"
```

---

## Task 7: Header-checks — cache-control, HSTS, content-type sanity

**Files:**
- Modify: `src/checks/header-checks.ts`
- Modify: `tests/checks/header-checks.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `tests/checks/header-checks.test.ts`:

```ts
import { checkResponseHeaders } from "../../src/checks/header-checks.js";

describe("checkResponseHeaders", () => {
  it("flags missing HSTS on HTTPS", () => {
    const issues = checkResponseHeaders("https://example.com/", { "content-type": "text/html" });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("HEADER_HSTS_MISSING");
  });

  it("does not flag HSTS on HTTP", () => {
    const issues = checkResponseHeaders("http://example.com/", { "content-type": "text/html" });
    expect(issues.map((i) => i.code)).not.toContain("HEADER_HSTS_MISSING");
  });

  it("flags missing content-type", () => {
    const issues = checkResponseHeaders("https://example.com/", { "strict-transport-security": "max-age=31536000" });
    expect(issues.map((i) => i.code)).toContain("HEADER_CONTENT_TYPE_MISSING");
  });

  it("flags no-cache for HTML but allows aggressive caching", () => {
    const issues = checkResponseHeaders("https://example.com/", {
      "content-type": "text/html",
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
      "strict-transport-security": "max-age=31536000",
    });
    expect(issues.map((i) => i.code)).toContain("HEADER_CACHE_CONTROL_AGGRESSIVE_NOCACHE");
  });

  it("returns empty when all headers are healthy", () => {
    const issues = checkResponseHeaders("https://example.com/", {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
    });
    expect(issues).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/header-checks.test.ts`

- [ ] **Step 3: Implement**

Append to `src/checks/header-checks.ts`:

```ts
export function checkResponseHeaders(
  url: string,
  headers: Record<string, string>,
): Issue[] {
  const issues: Issue[] = [];
  const isHttps = url.startsWith("https://");

  if (isHttps && !headers["strict-transport-security"]) {
    issues.push({
      code: "HEADER_HSTS_MISSING",
      severity: "low",
      message: "HTTPS response is missing the Strict-Transport-Security (HSTS) header.",
      recommendation: "Add Strict-Transport-Security: max-age=31536000; includeSubDomains on HTTPS responses.",
    });
  }

  if (!headers["content-type"]) {
    issues.push({
      code: "HEADER_CONTENT_TYPE_MISSING",
      severity: "medium",
      message: "Response has no Content-Type header.",
      recommendation: "Set Content-Type (e.g. text/html; charset=utf-8) so browsers and crawlers parse correctly.",
    });
  }

  const cache = headers["cache-control"]?.toLowerCase() ?? "";
  if (cache.includes("no-store") && cache.includes("no-cache") && cache.includes("max-age=0")) {
    issues.push({
      code: "HEADER_CACHE_CONTROL_AGGRESSIVE_NOCACHE",
      severity: "low",
      message: "Cache-Control combines no-store, no-cache, and max-age=0 — overly defensive for an HTML page.",
      recommendation: "Pick one caching strategy (e.g. public, max-age=3600) unless content is truly uncacheable.",
    });
  }

  return issues;
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/header-checks.test.ts`

Expected: 10 tests pass (5 X-Robots + 5 general).

- [ ] **Step 5: Commit**

```bash
git add src/checks/header-checks.ts tests/checks/header-checks.test.ts
git commit -m "feat: add cache-control, HSTS, content-type header checks"
```

---

## Task 8: Robots-checks module — parse rules by user-agent

**Files:**
- Create: `src/checks/robots-checks.ts`
- Create: `tests/checks/robots-checks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/checks/robots-checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseRobotsRules, isUrlAllowed } from "../../src/checks/robots-checks.js";

describe("parseRobotsRules", () => {
  it("groups rules by user-agent", () => {
    const rules = parseRobotsRules(`
User-agent: *
Disallow: /admin/
Allow: /admin/public/

User-agent: Googlebot
Disallow: /private/
`);
    expect(rules["*"]).toEqual([
      { type: "disallow", path: "/admin/" },
      { type: "allow", path: "/admin/public/" },
    ]);
    expect(rules["googlebot"]).toEqual([
      { type: "disallow", path: "/private/" },
    ]);
  });

  it("handles comments and blank lines", () => {
    const rules = parseRobotsRules(`
# a comment
User-agent: *

Disallow: /x   # inline comment
`);
    expect(rules["*"]).toEqual([{ type: "disallow", path: "/x" }]);
  });
});

describe("isUrlAllowed", () => {
  const rules = {
    "*": [
      { type: "disallow" as const, path: "/admin/" },
      { type: "allow" as const, path: "/admin/public/" },
    ],
    "googlebot": [
      { type: "disallow" as const, path: "/secret/" },
    ],
  };

  it("allows URLs that do not match any disallow", () => {
    expect(isUrlAllowed("https://site.com/about", "googlebot", rules)).toBe(true);
  });

  it("blocks URLs matching a disallow for the requested UA", () => {
    expect(isUrlAllowed("https://site.com/secret/page", "googlebot", rules)).toBe(false);
  });

  it("falls back to * rules when UA-specific rules are silent", () => {
    expect(isUrlAllowed("https://site.com/admin/secret", "googlebot", rules)).toBe(false);
  });

  it("longest-match allow beats shorter disallow", () => {
    expect(isUrlAllowed("https://site.com/admin/public/x", "googlebot", rules)).toBe(true);
  });

  it("is case-insensitive on user-agent", () => {
    expect(isUrlAllowed("https://site.com/secret/x", "GoogleBot", rules)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/robots-checks.test.ts`

- [ ] **Step 3: Implement**

Create `src/checks/robots-checks.ts`:

```ts
export type RobotsRule = { type: "allow" | "disallow"; path: string };
export type RobotsRules = Record<string, RobotsRule[]>;

export function parseRobotsRules(text: string): RobotsRules {
  const rules: RobotsRules = {};
  let currentUAs: string[] = [];

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) { currentUAs = []; continue; }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      const ua = value.toLowerCase();
      currentUAs.push(ua);
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

  const applicable = rules[ua] ?? rules["*"] ?? [];
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
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/robots-checks.test.ts`

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/robots-checks.ts tests/checks/robots-checks.test.ts
git commit -m "feat: add robots.txt per-UA rule parser and URL allow-check"
```

---

## Task 9: Robots-checks — per-page check for disallowed URLs

**Files:**
- Modify: `src/checks/robots-checks.ts`
- Modify: `tests/checks/robots-checks.test.ts`

- [ ] **Step 1: Append failing test**

Append to `tests/checks/robots-checks.test.ts`:

```ts
import { checkUrlAgainstRobots } from "../../src/checks/robots-checks.js";

describe("checkUrlAgainstRobots", () => {
  const rules = { "*": [{ type: "disallow" as const, path: "/admin/" }] };

  it("flags a disallowed URL", () => {
    const issues = checkUrlAgainstRobots("https://site.com/admin/x", "googlebot", rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("ROBOTS_DISALLOWS_URL");
    expect(issues[0].severity).toBe("high");
  });

  it("does not flag an allowed URL", () => {
    expect(checkUrlAgainstRobots("https://site.com/about", "googlebot", rules)).toEqual([]);
  });

  it("returns empty when there are no rules at all", () => {
    expect(checkUrlAgainstRobots("https://site.com/x", "googlebot", {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — must fail**

Run: `npm test -- tests/checks/robots-checks.test.ts`

- [ ] **Step 3: Implement**

Append to `src/checks/robots-checks.ts`:

```ts
import type { Issue } from "../types.js";

export function checkUrlAgainstRobots(
  url: string,
  userAgent: string,
  rules: RobotsRules,
): Issue[] {
  if (Object.keys(rules).length === 0) return [];
  if (isUrlAllowed(url, userAgent, rules)) return [];
  return [{
    code: "ROBOTS_DISALLOWS_URL",
    severity: "high",
    message: `robots.txt disallows this URL for user-agent "${userAgent}" — it will not be crawled by compliant bots.`,
    recommendation: "If the page should be indexed, update robots.txt to allow this path.",
  }];
}
```

- [ ] **Step 4: Run — must pass**

Run: `npm test -- tests/checks/robots-checks.test.ts`

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checks/robots-checks.ts tests/checks/robots-checks.test.ts
git commit -m "feat: add per-URL robots.txt check"
```

---

## Task 10: Wire all new checks into `analyzer.ts`

**Files:**
- Modify: `src/analyzer.ts`

**Integration points (verified from the earlier exploration):**
- `analyzeHtml` around line 1049–1586 is where per-page checks live.
- `parseRobotsTxt` around line 445 is where robots text is fetched; we need to also stash the raw text so the new parser can see it.
- `inspectInfrastructure` hands off the parsed robots rules to the page loop.

- [ ] **Step 1: Add imports at the top of `src/analyzer.ts`**

```ts
import {
  checkImageDimensions,
  checkImageLazyLoading,
  checkImageFormats,
} from "./checks/image-checks.js";
import { checkViewportMeta } from "./checks/mobile-checks.js";
import { checkXRobotsTag, checkResponseHeaders } from "./checks/header-checks.js";
import {
  parseRobotsRules,
  checkUrlAgainstRobots,
  type RobotsRules,
} from "./checks/robots-checks.js";
```

- [ ] **Step 2: Capture raw robots text and rules**

Locate `parseRobotsTxt` (around line 445). It currently returns `{ present, status, sitemaps, blocksAllCrawlers }`. Extend its return value to also include `rules: RobotsRules` and the raw `text: string`. Inside the function, after fetching the text, add:

```ts
const rules = parseRobotsRules(text);
```

and include `rules` in the return. (Do NOT remove existing fields — downstream code depends on them.)

Add the field to any internal type/interface representing the robots result.

- [ ] **Step 3: Thread `robotsRules` through the crawl loop**

In `analyzeSite` (around line 2091), where infrastructure is inspected and pages are analyzed, capture `robotsRules` from the infrastructure result and pass it into `analyzePage` (around line 1588) as an additional parameter.

Update `analyzePage`'s signature:

```ts
async function analyzePage(
  url: string,
  options: AnalyzeOptions,
  robotsRules: RobotsRules,
): Promise<PageReport> { ... }
```

And forward it into `analyzeHtml`.

- [ ] **Step 4: Call the new checks inside `analyzeHtml`**

Locate the section where `issues` is built (the final `pushIssue` calls before the return — around line 1553–1585). Add:

```ts
for (const i of checkImageDimensions($)) pushIssue(issues, i);
for (const i of checkImageLazyLoading($)) pushIssue(issues, i);
for (const i of checkImageFormats($)) pushIssue(issues, i);
for (const i of checkViewportMeta($)) pushIssue(issues, i);
for (const i of checkXRobotsTag(fetchResult.headers)) pushIssue(issues, i);
for (const i of checkResponseHeaders(fetchResult.finalUrl, fetchResult.headers)) pushIssue(issues, i);
for (const i of checkUrlAgainstRobots(fetchResult.finalUrl, userAgent, robotsRules)) pushIssue(issues, i);
```

(`userAgent` must be in scope — if not, thread it from `options.userAgent ?? "googlebot"` through to `analyzeHtml`.)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`

Expected: all existing tests plus all new check tests pass.

Run: `npm run build`

Expected: no TS errors. Any build failure is a signal you missed a call site for the new signature — fix before proceeding.

- [ ] **Step 6: End-to-end smoke test**

Run: `npm run dev -- https://example.com --max-pages 2`

Expected: CLI runs, crawls 1–2 pages, and the JSON/summary output now contains at least some of the new codes if relevant conditions exist. No crash, no hang.

- [ ] **Step 7: Commit**

```bash
git add src/analyzer.ts
git commit -m "feat: wire image/mobile/header/robots checks into analyzer"
```

---

## Task 11: Final verification and README mention

**Files:**
- Modify: `README.md` (append to the "What It Checks" list)

- [ ] **Step 1: Run the full suite**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: clean.

- [ ] **Step 2: Append new checks to README**

Open `README.md` and in the "What It Checks" bullet list add (keeping the existing bullet style):

```
- images missing explicit width and height attributes
- images without loading="lazy" hints
- images served in legacy formats instead of webp/avif
- missing or zoom-blocking viewport meta (mobile audit)
- missing or misconfigured response headers (Content-Type, HSTS, Cache-Control)
- X-Robots-Tag noindex/nofollow directives in HTTP responses
- URLs explicitly disallowed by robots.txt for Googlebot
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: list new static-audit checks from Plan 1"
```

- [ ] **Step 4: Confirm branch history is clean**

Run: `git log --oneline feature/phase1-test-harness ^main`

Expected: commits from Plan 0 + 11 new commits from Plan 1, all with clear `feat:`, `chore:`, `docs:`, or `test:` prefixes.

---

## Self-Review Notes

- **Spec coverage:** All four Phase 1 Plan 1 subsystems are covered — image audit (Tasks 1–3), mobile viewport (Task 4), response headers + X-Robots-Tag (Tasks 5–7), robots.txt URL evaluation (Tasks 8–9). Tasks 10–11 are integration + docs. Tap-target / font-size audits are explicitly deferred to Plan 5 (Playwright) in the Scope exclusions section above — acceptable because static HTML cannot measure rendered layout.
- **Placeholder scan:** Every task has complete code in every step. No TBD, no "similar to above."
- **Type consistency:** `Issue` shape from `src/types.ts` is used consistently across every check module. `RobotsRule` and `RobotsRules` types are defined once in Task 8 and reused in Task 9 and Task 10. `CheerioAPI` is imported where needed.
- **Test pattern:** Each new function gets a test file in `tests/checks/` mirroring `src/checks/`. Tests are focused and exercise real behavior via real cheerio parsing — not mocks.
