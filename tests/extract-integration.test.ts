import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { analyzeSite } from "../src/analyzer.js";

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    await run(origin);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function makeHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");

    if (req.url === "/") {
      res.end(
        `<html><head><title>A</title></head><body><h1>Hello</h1><a href="/b">B</a></body></html>`,
      );
      return;
    }

    if (req.url === "/b") {
      res.end(
        `<html><head><title>B</title></head><body>No headline</body></html>`,
      );
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  };
}

describe("analyzeSite custom extractions", () => {
  it("populates extracted fields and extractionSummary correctly", async () => {
    await withServer(makeHandler(), async (origin) => {
      const report = await analyzeSite(origin, {
        maxPages: 2,
        concurrency: 1,
        retries: 0,
        contentDedup: false,
        linkGraph: false,
        extract: {
          h1: { selector: "h1", required: true },
          title: "title",
        },
      });

      expect(report.pages).toHaveLength(2);

      const pageA = report.pages.find((p) => p.finalUrl.endsWith("/"));
      const pageB = report.pages.find((p) => p.finalUrl.endsWith("/b"));

      expect(pageA).toBeDefined();
      expect(pageB).toBeDefined();

      // Page A assertions
      expect(pageA!.extracted).toEqual({ h1: "Hello", title: "A" });
      expect(
        pageA!.issues.some((i) => i.code === "EXTRACTION_MISSING_REQUIRED"),
      ).toBe(false);

      // Page B assertions
      expect(pageB!.extracted).toEqual({ h1: null, title: "B" });
      const missingIssues = pageB!.issues.filter(
        (i) => i.code === "EXTRACTION_MISSING_REQUIRED",
      );
      expect(missingIssues).toHaveLength(1);
      expect(missingIssues[0].severity).toBe("low");
      expect(missingIssues[0].message).toContain("h1");

      // extractionSummary assertions
      expect(report.extractionSummary).toEqual({
        rules: ["h1", "title"],
        pagesEvaluated: 2,
        matchCounts: { h1: 1, title: 2 },
        missingRequiredCounts: { h1: 1, title: 0 },
        pagesWithMissingRequired: 1,
      });
    });
  });

  it("leaves extracted and extractionSummary undefined when extract option is omitted", async () => {
    await withServer(makeHandler(), async (origin) => {
      const report = await analyzeSite(origin, {
        maxPages: 2,
        concurrency: 1,
        retries: 0,
        contentDedup: false,
        linkGraph: false,
      });

      expect(report.pages).toHaveLength(2);

      for (const page of report.pages) {
        expect(page.extracted).toBeUndefined();
        expect(
          page.issues.some((i) => i.code === "EXTRACTION_MISSING_REQUIRED"),
        ).toBe(false);
      }

      expect(report.extractionSummary).toBeUndefined();
    });
  });
});
