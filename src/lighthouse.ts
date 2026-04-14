import { spawn } from "node:child_process";

import type { LighthouseMetrics, LighthouseReport, LighthouseScores } from "./types.js";

const LIGHTHOUSE_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const LIGHTHOUSE_TIMEOUT_MS = 120_000;

function createEmptyScores(): LighthouseScores {
  return {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null
  };
}

function createEmptyMetrics(): LighthouseMetrics {
  return {
    firstContentfulPaintMs: null,
    largestContentfulPaintMs: null,
    totalBlockingTimeMs: null,
    cumulativeLayoutShift: null,
    speedIndexMs: null,
    interactiveMs: null
  };
}

function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.round(value * 100);
}

function normalizeMetric(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function buildErrorReport(requestedUrl: string, message: string): LighthouseReport {
  return {
    requestedUrl,
    finalUrl: requestedUrl,
    fetchTime: null,
    scores: createEmptyScores(),
    metrics: createEmptyMetrics(),
    error: message
  };
}

function parseReport(requestedUrl: string, rawJson: string): LighthouseReport {
  const parsed = JSON.parse(rawJson) as {
    finalDisplayedUrl?: unknown;
    fetchTime?: unknown;
    categories?: Record<string, { score?: unknown }>;
    audits?: Record<string, { numericValue?: unknown }>;
  };

  return {
    requestedUrl,
    finalUrl:
      typeof parsed.finalDisplayedUrl === "string" && parsed.finalDisplayedUrl.length > 0
        ? parsed.finalDisplayedUrl
        : requestedUrl,
    fetchTime: typeof parsed.fetchTime === "string" ? parsed.fetchTime : null,
    scores: {
      performance: normalizeScore(parsed.categories?.performance?.score),
      accessibility: normalizeScore(parsed.categories?.accessibility?.score),
      bestPractices: normalizeScore(parsed.categories?.["best-practices"]?.score),
      seo: normalizeScore(parsed.categories?.seo?.score)
    },
    metrics: {
      firstContentfulPaintMs: normalizeMetric(parsed.audits?.["first-contentful-paint"]?.numericValue),
      largestContentfulPaintMs: normalizeMetric(parsed.audits?.["largest-contentful-paint"]?.numericValue),
      totalBlockingTimeMs: normalizeMetric(parsed.audits?.["total-blocking-time"]?.numericValue),
      cumulativeLayoutShift: normalizeMetric(parsed.audits?.["cumulative-layout-shift"]?.numericValue),
      speedIndexMs: normalizeMetric(parsed.audits?.["speed-index"]?.numericValue),
      interactiveMs: normalizeMetric(parsed.audits?.interactive?.numericValue)
    },
    error: null
  };
}

async function runSingleLighthouseAudit(url: string): Promise<LighthouseReport> {
  return new Promise((resolve) => {
    const args = [
      "lighthouse",
      url,
      "--quiet",
      `--only-categories=${LIGHTHOUSE_CATEGORIES.join(",")}`,
      "--output=json",
      "--output-path=stdout",
      "--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage"
    ];
    const child = spawn("npx", args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let settled = false;
    const finish = (report: LighthouseReport): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(report);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        buildErrorReport(
          url,
          `Lighthouse timed out after ${Math.round(LIGHTHOUSE_TIMEOUT_MS / 1000)} seconds.`
        )
      );
    }, LIGHTHOUSE_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish(buildErrorReport(url, error.message));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const details = stderr.trim() || `Lighthouse exited with status ${code}.`;
        finish(buildErrorReport(url, details));
        return;
      }

      try {
        finish(parseReport(url, stdout));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to parse Lighthouse JSON.";
        finish(buildErrorReport(url, message));
      }
    });
  });
}

export async function runLighthouseAudits(urls: string[]): Promise<LighthouseReport[]> {
  const uniqueUrls = [...new Set(urls)];

  if (uniqueUrls.length === 0) {
    return [];
  }

  const reports: LighthouseReport[] = [];

  for (const url of uniqueUrls) {
    reports.push(await runSingleLighthouseAudit(url));
  }

  return reports;
}
