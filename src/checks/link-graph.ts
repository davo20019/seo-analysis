import type { LinkGraphReport, LinkGraphTopEntry, PageReport } from "../types.js";

export const PAGERANK_DAMPING = 0.85;
export const PAGERANK_ITERATIONS = 20;
export const TOP_N = 10;

export function buildLinkGraphReport(pages: PageReport[]): LinkGraphReport {
  const N = pages.length;
  if (N === 0) {
    return {
      pagesAnalyzed: 0,
      edges: 0,
      iterations: PAGERANK_ITERATIONS,
      damping: PAGERANK_DAMPING,
      topPages: [],
      underLinkedImportantPages: [],
    };
  }

  // URL → index for O(1) edge resolution.
  const indexByUrl = new Map<string, number>();
  for (let i = 0; i < N; i += 1) indexByUrl.set(pages[i].finalUrl, i);

  // Outgoing edges (after dropping external + self-loops).
  const outgoing: number[][] = pages.map(() => []);
  let edgeCount = 0;
  for (let i = 0; i < N; i += 1) {
    for (const target of pages[i].discoveredLinks) {
      const j = indexByUrl.get(target);
      if (j === undefined) continue; // external or not crawled
      if (j === i) continue; // self-loop
      outgoing[i].push(j);
      edgeCount += 1;
    }
  }

  // Incoming edges (transpose) for fast iteration.
  const incoming: number[][] = pages.map(() => []);
  for (let i = 0; i < N; i += 1) {
    for (const j of outgoing[i]) incoming[j].push(i);
  }

  // PageRank iteration with dangling-mass redistribution.
  let pr = new Array<number>(N).fill(1 / N);
  const dangling = pages.map((_, i) => i).filter((i) => outgoing[i].length === 0);

  for (let iter = 0; iter < PAGERANK_ITERATIONS; iter += 1) {
    const next = new Array<number>(N).fill((1 - PAGERANK_DAMPING) / N);
    let danglingMass = 0;
    for (const i of dangling) danglingMass += pr[i];
    const danglingPerPage = (PAGERANK_DAMPING * danglingMass) / N;
    for (let i = 0; i < N; i += 1) {
      next[i] += danglingPerPage;
      let inSum = 0;
      for (const j of incoming[i]) {
        inSum += pr[j] / outgoing[j].length;
      }
      next[i] += PAGERANK_DAMPING * inSum;
    }
    pr = next;
  }

  // Normalize so sum === 1.0 (corrects floating-point drift).
  const sum = pr.reduce((a, b) => a + b, 0);
  for (let i = 0; i < N; i += 1) pr[i] /= sum;

  // Mutate each PageReport.
  for (let i = 0; i < N; i += 1) {
    pages[i].linkGraph = { pageRank: pr[i] };
  }

  // Build top-N by PageRank.
  const allEntries: LinkGraphTopEntry[] = pages.map((p, i) => ({
    url: p.finalUrl,
    pageRank: pr[i],
    wordCount: p.checks.wordCount,
    incomingInternalLinks: p.checks.incomingInternalLinks,
  }));
  const topPages = [...allEntries]
    .sort((a, b) => b.pageRank - a.pageRank)
    .slice(0, TOP_N);

  // Underlinked important pages: above-median wordCount + below-median pageRank.
  const medianWords = median(pages.map((p) => p.checks.wordCount));
  const medianRank = median(pr);
  const underLinkedImportantPages = allEntries
    .filter((_e, i) => pages[i].checks.wordCount > medianWords && pr[i] <= medianRank)
    .sort((a, b) => b.wordCount - a.wordCount)
    .slice(0, TOP_N);

  return {
    pagesAnalyzed: N,
    edges: edgeCount,
    iterations: PAGERANK_ITERATIONS,
    damping: PAGERANK_DAMPING,
    topPages,
    underLinkedImportantPages,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
