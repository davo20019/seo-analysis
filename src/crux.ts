import type { Issue } from "./types.js";

export interface CruxMetrics {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
}

export function parseCruxResponse(raw: unknown): CruxMetrics {
  const record = (raw as { record?: unknown })?.record as
    | { metrics?: Record<string, { percentiles?: { p75?: unknown } }> }
    | undefined;
  const m = record?.metrics ?? {};

  const num = (v: unknown): number | null => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  return {
    lcpMs: num(m.largest_contentful_paint?.percentiles?.p75),
    inpMs: num(m.interaction_to_next_paint?.percentiles?.p75),
    cls: num(m.cumulative_layout_shift?.percentiles?.p75),
  };
}

export function checkCruxMetrics(metrics: CruxMetrics): Issue[] {
  const issues: Issue[] = [];

  if (metrics.lcpMs !== null) {
    if (metrics.lcpMs > 4000) {
      issues.push({
        code: "CRUX_LCP_POOR",
        severity: "high",
        message: `Real-user LCP (p75) is ${Math.round(metrics.lcpMs)}ms — Google's "Poor" threshold is 4000ms.`,
        recommendation: "Optimize the largest contentful paint: preload the hero image, reduce render-blocking JS/CSS, improve server TTFB.",
      });
    } else if (metrics.lcpMs > 2500) {
      issues.push({
        code: "CRUX_LCP_NEEDS_IMPROVEMENT",
        severity: "medium",
        message: `Real-user LCP (p75) is ${Math.round(metrics.lcpMs)}ms — Google's "Good" threshold is 2500ms.`,
        recommendation: "Improve LCP toward 2500ms: faster server response, image optimization, fewer render-blocking resources.",
      });
    }
  }

  if (metrics.inpMs !== null) {
    if (metrics.inpMs > 500) {
      issues.push({
        code: "CRUX_INP_POOR",
        severity: "high",
        message: `Real-user INP (p75) is ${Math.round(metrics.inpMs)}ms — Google's "Poor" threshold is 500ms.`,
        recommendation: "Reduce JS execution time on interaction: break up long tasks, defer non-critical scripts, avoid expensive event handlers.",
      });
    } else if (metrics.inpMs > 200) {
      issues.push({
        code: "CRUX_INP_NEEDS_IMPROVEMENT",
        severity: "medium",
        message: `Real-user INP (p75) is ${Math.round(metrics.inpMs)}ms — Google's "Good" threshold is 200ms.`,
        recommendation: "Reduce input delay: profile long tasks during interaction, defer third-party scripts.",
      });
    }
  }

  if (metrics.cls !== null) {
    if (metrics.cls > 0.25) {
      issues.push({
        code: "CRUX_CLS_POOR",
        severity: "high",
        message: `Real-user CLS (p75) is ${metrics.cls.toFixed(3)} — Google's "Poor" threshold is 0.25.`,
        recommendation: "Reserve space for images/iframes (width+height attrs), avoid inserting content above existing layout, use font-display: optional.",
      });
    } else if (metrics.cls > 0.1) {
      issues.push({
        code: "CRUX_CLS_NEEDS_IMPROVEMENT",
        severity: "medium",
        message: `Real-user CLS (p75) is ${metrics.cls.toFixed(3)} — Google's "Good" threshold is 0.10.`,
        recommendation: "Reduce layout shifts: explicit image dimensions, no late-loaded ads in flow content, stable web fonts.",
      });
    }
  }

  return issues;
}
