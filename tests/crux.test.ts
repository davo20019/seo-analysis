import { describe, it, expect } from "vitest";
import { parseCruxResponse, checkCruxMetrics } from "../src/crux.js";

describe("parseCruxResponse", () => {
  it("extracts p75 metrics", () => {
    const result = parseCruxResponse({
      record: {
        key: { origin: "https://x" },
        metrics: {
          largest_contentful_paint: { percentiles: { p75: 2400 } },
          interaction_to_next_paint: { percentiles: { p75: 180 } },
          cumulative_layout_shift: { percentiles: { p75: "0.05" } },
        },
      },
    });
    expect(result).toEqual({ lcpMs: 2400, inpMs: 180, cls: 0.05 });
  });

  it("returns nulls for missing metrics", () => {
    expect(parseCruxResponse({ record: { metrics: {} } })).toEqual({
      lcpMs: null, inpMs: null, cls: null,
    });
  });

  it("returns all-null for an empty/invalid response", () => {
    expect(parseCruxResponse({})).toEqual({ lcpMs: null, inpMs: null, cls: null });
    expect(parseCruxResponse(null)).toEqual({ lcpMs: null, inpMs: null, cls: null });
  });
});

describe("checkCruxMetrics", () => {
  it("flags LCP poor (>4000ms)", () => {
    const issues = checkCruxMetrics({ lcpMs: 4500, inpMs: 100, cls: 0.05 });
    expect(issues.find((i) => i.code === "CRUX_LCP_POOR")).toBeDefined();
  });

  it("flags LCP needs-improvement (>2500ms, <=4000ms)", () => {
    const issues = checkCruxMetrics({ lcpMs: 3000, inpMs: 100, cls: 0.05 });
    expect(issues.find((i) => i.code === "CRUX_LCP_NEEDS_IMPROVEMENT")).toBeDefined();
  });

  it("flags INP and CLS thresholds", () => {
    const issues = checkCruxMetrics({ lcpMs: 1000, inpMs: 600, cls: 0.3 });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("CRUX_INP_POOR");
    expect(codes).toContain("CRUX_CLS_POOR");
  });

  it("returns empty when all metrics are good", () => {
    expect(checkCruxMetrics({ lcpMs: 2000, inpMs: 100, cls: 0.05 })).toEqual([]);
  });

  it("returns empty when metrics are null", () => {
    expect(checkCruxMetrics({ lcpMs: null, inpMs: null, cls: null })).toEqual([]);
  });
});
