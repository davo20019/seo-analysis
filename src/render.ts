import { chromium, type BrowserContext, type Browser, type Response as PlaywrightResponse } from "playwright";
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

export interface BrowserLaunchOptions {
  headless?: boolean;
}

export async function launchRenderBrowser(
  options: BrowserLaunchOptions = {},
): Promise<Browser> {
  return chromium.launch({ headless: options.headless ?? true });
}

const RENDER_RETRY_BASE_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function renderPageWithRetry(
  url: string,
  options: RenderOptions,
  context: BrowserContext,
  retries: number,
  renderImpl: typeof renderPage = renderPage,
): Promise<FetchResult> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await renderImpl(url, options, context);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
      await sleep(RENDER_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw (lastError instanceof Error ? lastError : new Error(`Unable to render ${url}`));
}
