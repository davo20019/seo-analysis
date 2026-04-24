import type { BrowserContext, Response as PlaywrightResponse } from "playwright";
import type { FetchResult } from "./analyzer.js";

export interface RenderOptions {
  timeoutMs: number;
  userAgent: string;
}

export async function renderPage(
  url: string,
  options: RenderOptions,
  context: BrowserContext,
): Promise<FetchResult> {
  const page = await context.newPage();
  try {
    await page.setExtraHTTPHeaders({ "user-agent": options.userAgent });

    const response: PlaywrightResponse | null = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: options.timeoutMs,
    });

    if (!response) {
      throw new Error(`renderPage: no response for ${url}`);
    }

    const status = response.status();
    const finalUrl = page.url();
    const text = await page.content();
    const headers = normalizeHeaders(await response.allHeaders());
    const contentType = headers["content-type"] ?? null;

    return {
      contentType,
      finalUrl,
      redirectChain: [],
      status,
      text,
      headers,
    };
  } finally {
    await page.close();
  }
}

function normalizeHeaders(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
