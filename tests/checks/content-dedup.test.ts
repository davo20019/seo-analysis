import { describe, it, expect } from "vitest";
import {
  buildContentDedupReport,
  tokenize,
  shingle,
  SHINGLE_SIZE,
  MIN_WORDS,
  SIMILARITY_THRESHOLD,
} from "../../src/checks/content-dedup.js";
import type { PageReport } from "../../src/types.js";

function makePage(url: string, bodyText: string | null): PageReport {
  return {
    url, finalUrl: url, status: 200, contentType: "text/html",
    redirectChain: [], discoveredLinks: [],
    checks: {
      title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0,
      canonical: null, htmlLang: null, expectedLocale: null, hreflang: [],
      robotsMeta: null, h1s: [], wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
      imagesTotal: 0, imagesMissingAlt: 0,
      internalLinks: 0, incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0,
      internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0, inSitemap: false,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: [], bodyText,
    },
    issues: [],
  };
}

// 60 unique words for "long enough to pass MIN_WORDS" tests.
const BODY_60 = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");

describe("tokenize", () => {
  it("lowercases and strips non-alphanumeric", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });

  it("drops sub-2-char tokens", () => {
    expect(tokenize("a hi I you 12")).toEqual(["hi", "you", "12"]);
  });
});

describe("shingle", () => {
  it("produces n-k+1 shingles for n>=k tokens", () => {
    const s = shingle(["a", "b", "c", "d", "e", "f", "g"], 5);
    expect(s.size).toBe(3);
    expect(s.has("a b c d e")).toBe(true);
    expect(s.has("c d e f g")).toBe(true);
  });

  it("returns empty set for n<k tokens", () => {
    expect(shingle(["a", "b", "c"], 5).size).toBe(0);
  });
});

describe("buildContentDedupReport — skip rules", () => {
  it("skips pages with bodyText === null", () => {
    const r = buildContentDedupReport([makePage("https://x/a", null)]);
    expect(r.pagesAnalyzed).toBe(0);
    expect(r.pagesSkipped).toBe(1);
    expect(r.clusters).toEqual([]);
  });

  it("skips pages with bodyText shorter than MIN_WORDS tokens", () => {
    const short = Array.from({ length: MIN_WORDS - 1 }, (_, i) => `word${i}`).join(" ");
    const r = buildContentDedupReport([makePage("https://x/a", short)]);
    expect(r.pagesAnalyzed).toBe(0);
    expect(r.pagesSkipped).toBe(1);
  });

  it("includes pages with exactly MIN_WORDS tokens", () => {
    const exact = Array.from({ length: MIN_WORDS }, (_, i) => `word${i}`).join(" ");
    const r = buildContentDedupReport([makePage("https://x/a", exact)]);
    expect(r.pagesAnalyzed).toBe(1);
    expect(r.pagesSkipped).toBe(0);
  });
});

describe("buildContentDedupReport — cluster construction", () => {
  it("identical-body pages form one cluster with similarity 1.0", () => {
    const r = buildContentDedupReport([
      makePage("https://x/a", BODY_60),
      makePage("https://x/b", BODY_60),
    ]);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].members).toHaveLength(2);
    for (const m of r.clusters[0].members) {
      expect(m.similarityToRepresentative).toBeCloseTo(1.0, 5);
    }
  });

  it("disjoint-body pages produce no clusters", () => {
    const a = Array.from({ length: 60 }, (_, i) => `alpha${i}`).join(" ");
    const b = Array.from({ length: 60 }, (_, i) => `beta${i}`).join(" ");
    const r = buildContentDedupReport([makePage("https://x/a", a), makePage("https://x/b", b)]);
    expect(r.clusters).toEqual([]);
  });

  it("transitive similarity merges into one cluster", () => {
    // A and B share 90% shingles; B and C share 90%; A and C share ~80%.
    // All three should be in ONE cluster via union-find.
    const base = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const aText = base + " unique-a unique-a-2 unique-a-3 unique-a-4";
    const bText = base + " unique-b unique-b-2 unique-b-3 unique-b-4";
    const cText = base + " unique-c unique-c-2 unique-c-3 unique-c-4";
    const r = buildContentDedupReport([
      makePage("https://x/a", aText),
      makePage("https://x/b", bText),
      makePage("https://x/c", cText),
    ]);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].members).toHaveLength(3);
  });

  it("scales to 50 identical pages in one cluster", () => {
    const pages = Array.from({ length: 50 }, (_, i) => makePage(`https://x/p${i}`, BODY_60));
    const r = buildContentDedupReport(pages);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].members).toHaveLength(50);
    expect(r.totalNearDuplicatePages).toBe(50);
  });
});

describe("buildContentDedupReport — representative selection", () => {
  it("picks the longest-body page as representative", () => {
    const short = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    // Add only 10 extra unique tokens so Jaccard stays >= 0.85 (56/66 ≈ 0.848 is too low;
    // we need <=13 extra tokens → real Jaccard ≈ 56/62 ≈ 0.90 for 6 extra shingles from 10 tokens).
    // With 8 extra tokens → 4 extra shingles → Jaccard = 56/60 ≈ 0.933 ✓
    const longBody = short + " " + Array.from({ length: 8 }, (_, i) => `extra${i}`).join(" ");
    const pages = [
      makePage("https://x/a", short),
      makePage("https://x/b", longBody),
    ];
    const r = buildContentDedupReport(pages);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].representativeUrl).toBe("https://x/b");
  });
});

describe("buildContentDedupReport — issue generation", () => {
  it("pushes CONTENT_NEAR_DUPLICATE onto each cluster member", () => {
    const pages = [
      makePage("https://x/a", BODY_60),
      makePage("https://x/b", BODY_60),
    ];
    buildContentDedupReport(pages);
    for (const p of pages) {
      const issue = p.issues.find((i) => i.code === "CONTENT_NEAR_DUPLICATE");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("medium");
      expect(issue!.message).toContain("2-page");
    }
  });
});

describe("buildContentDedupReport — determinism", () => {
  it("returns equal reports across two consecutive calls", () => {
    const buildPages = () => [
      makePage("https://x/a", BODY_60),
      makePage("https://x/b", BODY_60),
    ];
    const r1 = buildContentDedupReport(buildPages());
    const r2 = buildContentDedupReport(buildPages());
    expect(r1.clusters).toEqual(r2.clusters);
    expect(r1.totalNearDuplicatePages).toEqual(r2.totalNearDuplicatePages);
  });
});

describe("buildContentDedupReport — empty / single-page", () => {
  it("handles 0-page input without crash", () => {
    const r = buildContentDedupReport([]);
    expect(r).toEqual({
      clusters: [],
      totalNearDuplicatePages: 0,
      pagesAnalyzed: 0,
      pagesSkipped: 0,
    });
  });

  it("returns no clusters for 1-page input", () => {
    const r = buildContentDedupReport([makePage("https://x/a", BODY_60)]);
    expect(r.clusters).toEqual([]);
    expect(r.pagesAnalyzed).toBe(1);
  });
});
