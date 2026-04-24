import type { BrowserContext } from "playwright";
import type { FetchResult } from "./analyzer.js";

export interface RenderOptions {
  timeoutMs: number;
  userAgent: string;
}

export async function renderPage(
  _url: string,
  _options: RenderOptions,
  _context: BrowserContext,
): Promise<FetchResult> {
  throw new Error("renderPage not implemented yet — see Task 2");
}
