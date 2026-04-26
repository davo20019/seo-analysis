import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { analyzeSite } from "../src/analyzer.js";
import type { AnalyzeProgressEvent } from "../src/types.js";

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

describe("analyzeSite progress", () => {
  it("emits structured crawl progress events", async () => {
    const events: AnalyzeProgressEvent[] = [];

    await withServer((req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");

      if (req.url === "/") {
        res.end(`<html><head><title>Home</title></head><body><a href="/about">About</a></body></html>`);
        return;
      }

      if (req.url === "/about") {
        res.end(`<html><head><title>About</title></head><body>About page</body></html>`);
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    }, async (origin) => {
      const report = await analyzeSite(origin, {
        maxPages: 2,
        concurrency: 1,
        retries: 0,
        contentDedup: false,
        linkGraph: false,
        onProgress: (event) => events.push(event),
      });

      expect(report.pages).toHaveLength(2);
    });

    expect(events.map((event) => event.phase)).toContain("crawl-start");
    expect(events.map((event) => event.phase)).toContain("page-start");
    expect(events.map((event) => event.phase)).toContain("page-complete");
    expect(events.map((event) => event.phase)).toContain("crawl-complete");
    expect(events.every((event) => event.maxPages === 2)).toBe(true);
    expect(events.filter((event) => event.phase === "page-complete").at(-1)).toMatchObject({
      crawledPages: 2,
      queuedUrls: 0,
    });
  });
});
