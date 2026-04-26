import { createHash } from "node:crypto";
import type {
  ContentCluster,
  ContentClusterMember,
  ContentDedupReport,
  PageReport,
} from "../types.js";

export const SHINGLE_SIZE = 5;
export const MIN_WORDS = 50;
export const SIMILARITY_THRESHOLD = 0.85;
export const NUM_HASHES = 128;
export const LSH_BANDS = 16;
export const LSH_ROWS_PER_BAND = 8;  // LSH_BANDS * LSH_ROWS_PER_BAND === NUM_HASHES

const SALTS: string[] = Array.from({ length: NUM_HASHES }, (_, i) => `seo-audit-minhash-salt-${i}`);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

export function shingle(tokens: string[], k: number): Set<string> {
  if (tokens.length < k) return new Set();
  const out = new Set<string>();
  for (let i = 0; i <= tokens.length - k; i += 1) {
    out.add(tokens.slice(i, i + k).join(" "));
  }
  return out;
}

function hashShingle(salt: string, s: string): number {
  const h = createHash("md5").update(salt + "|" + s).digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

function minHashSignature(shingles: Set<string>): number[] {
  const sig = new Array<number>(NUM_HASHES).fill(Number.MAX_SAFE_INTEGER);
  for (const s of shingles) {
    for (let i = 0; i < NUM_HASHES; i += 1) {
      const h = hashShingle(SALTS[i], s);
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

function jaccardFromSignatures(a: number[], b: number[]): number {
  let agree = 0;
  for (let i = 0; i < NUM_HASHES; i += 1) {
    if (a[i] === b[i]) agree += 1;
  }
  return agree / NUM_HASHES;
}

interface PageRecord {
  page: PageReport;
  signature: number[];
  wordCount: number;
}

export function buildContentDedupReport(pages: PageReport[]): ContentDedupReport {
  // Build per-page records (skipping pages that don't qualify).
  const records: PageRecord[] = [];
  let pagesSkipped = 0;
  for (const page of pages) {
    if (page.checks.bodyText === null) {
      pagesSkipped += 1;
      continue;
    }
    const tokens = tokenize(page.checks.bodyText);
    if (tokens.length < MIN_WORDS) {
      pagesSkipped += 1;
      continue;
    }
    const shingles = shingle(tokens, SHINGLE_SIZE);
    if (shingles.size === 0) {
      pagesSkipped += 1;
      continue;
    }
    const signature = minHashSignature(shingles);
    records.push({ page, signature, wordCount: tokens.length });
  }

  if (records.length < 2) {
    return {
      clusters: [],
      totalNearDuplicatePages: 0,
      pagesAnalyzed: records.length,
      pagesSkipped,
    };
  }

  // LSH bucketing — bands of LSH_ROWS_PER_BAND.
  const buckets = new Map<string, number[]>();
  for (let r = 0; r < records.length; r += 1) {
    const sig = records[r].signature;
    for (let band = 0; band < LSH_BANDS; band += 1) {
      const start = band * LSH_ROWS_PER_BAND;
      const slice = sig.slice(start, start + LSH_ROWS_PER_BAND).join(",");
      const key = `${band}:${slice}`;
      const list = buckets.get(key);
      if (list) list.push(r);
      else buckets.set(key, [r]);
    }
  }

  // Verify candidate pairs with full Jaccard.
  const candidates = new Set<string>();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const i = Math.min(list[a], list[b]);
        const j = Math.max(list[a], list[b]);
        candidates.add(`${i},${j}`);
      }
    }
  }

  const verified: Array<{ i: number; j: number; sim: number }> = [];
  for (const k of candidates) {
    const [iStr, jStr] = k.split(",");
    const i = Number(iStr);
    const j = Number(jStr);
    const sim = jaccardFromSignatures(records[i].signature, records[j].signature);
    if (sim >= SIMILARITY_THRESHOLD) verified.push({ i, j, sim });
  }

  // Union-find clustering.
  const parent = Array.from({ length: records.length }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const v of verified) union(v.i, v.j);

  // Group into connected components.
  const componentsByRoot = new Map<number, number[]>();
  for (let i = 0; i < records.length; i += 1) {
    const root = find(i);
    const list = componentsByRoot.get(root);
    if (list) list.push(i);
    else componentsByRoot.set(root, [i]);
  }

  // Build cluster objects (only for components ≥ 2 members).
  const clusters: ContentCluster[] = [];
  for (const indices of componentsByRoot.values()) {
    if (indices.length < 2) continue;

    // Pick representative: longest wordCount, ties by URL lex.
    let repIdx = indices[0];
    for (const i of indices) {
      const a = records[i];
      const b = records[repIdx];
      if (a.wordCount > b.wordCount) repIdx = i;
      else if (a.wordCount === b.wordCount && a.page.finalUrl < b.page.finalUrl) repIdx = i;
    }
    const repSignature = records[repIdx].signature;

    const members: ContentClusterMember[] = indices.map((i) => ({
      url: records[i].page.finalUrl,
      similarityToRepresentative:
        i === repIdx ? 1.0 : jaccardFromSignatures(records[i].signature, repSignature),
    }));

    clusters.push({
      representativeUrl: records[repIdx].page.finalUrl,
      members,
      shingleSize: SHINGLE_SIZE,
      threshold: SIMILARITY_THRESHOLD,
    });
  }

  // Sort by member count desc, ties by representative URL.
  clusters.sort((a, b) => {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return a.representativeUrl.localeCompare(b.representativeUrl);
  });

  // Push per-member issue.
  const recordByUrl = new Map<string, PageRecord>();
  for (const r of records) recordByUrl.set(r.page.finalUrl, r);
  let totalNearDuplicatePages = 0;
  for (const c of clusters) {
    totalNearDuplicatePages += c.members.length;
    for (const m of c.members) {
      const rec = recordByUrl.get(m.url);
      if (!rec) continue;
      rec.page.issues.push({
        code: "CONTENT_NEAR_DUPLICATE",
        severity: "medium",
        message: `Page is part of a ${c.members.length}-page near-duplicate cluster (representative: ${c.representativeUrl}).`,
        recommendation:
          "Review whether these pages should be consolidated, canonicalized, or differentiated. Common causes: templated content with thin unique text, scraped/syndicated content, parameter variants without canonical tags.",
      });
    }
  }

  return {
    clusters,
    totalNearDuplicatePages,
    pagesAnalyzed: records.length,
    pagesSkipped,
  };
}
