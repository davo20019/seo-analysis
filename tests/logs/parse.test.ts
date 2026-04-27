import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { detectLogFormat, parseLogStream } from "../../src/logs/parse.js";

const FIXTURES = join(__dirname, "../fixtures/logs");

function streamFromString(s: string): Readable {
  return Readable.from(s);
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("detectLogFormat", () => {
  it("detects Combined Log Format", () => {
    const sample = readFileSync(join(FIXTURES, "combined.log"), "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .slice(0, 5);
    expect(detectLogFormat(sample)).toBe("combined");
  });

  it("returns 'unknown' for unrecognized content", () => {
    expect(detectLogFormat(["hello", "world"])).toBe("unknown");
  });

  it("handles empty input", () => {
    expect(detectLogFormat([])).toBe("unknown");
  });
});

describe("parseLogStream — combined", () => {
  it("yields one entry per valid line", async () => {
    const src = readFileSync(join(FIXTURES, "combined.log"), "utf8");
    const entries = await collect(parseLogStream(streamFromString(src), "combined"));
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({
      ip: "66.249.66.1",
      method: "GET",
      url: "/index.html",
      status: 200,
    });
    expect(entries[0].userAgent).toContain("Googlebot");
    expect(entries[0].timestamp).toMatch(/^2026-04-25T10:15:23/);
  });

  it("counts garbled lines as no-yields", async () => {
    const src =
      "garbage line 1\n" +
      `66.249.66.1 - - [25/Apr/2026:10:15:23 +0000] "GET /a HTTP/1.1" 200 1 "-" "Googlebot"\n` +
      "another garbage line\n";
    const entries = await collect(parseLogStream(streamFromString(src), "combined"));
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("/a");
  });

  it("preserves quoted strings containing spaces", async () => {
    const src = `1.2.3.4 - - [25/Apr/2026:10:15:23 +0000] "GET /a b HTTP/1.1" 200 1 "-" "Mozilla/5.0 (foo bar)"\n`;
    const entries = await collect(parseLogStream(streamFromString(src), "combined"));
    expect(entries[0].userAgent).toBe("Mozilla/5.0 (foo bar)");
    expect(entries[0].url).toBe("/a b");
  });
});
