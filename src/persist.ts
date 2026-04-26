import { homedir } from "node:os";
import { join } from "node:path";

export function resolveCrawlsDir(): string {
  const override = process.env.SEO_AUDIT_CRAWLS_DIR;
  if (override && override.trim().length > 0) return override;
  return join(homedir(), ".config", "seo-audit", "crawls");
}

export function hostKeyFromUrl(url: string): string {
  const parsed = new URL(url);
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);

  const port = parsed.port;
  const isDefaultPort =
    port === "" ||
    (parsed.protocol === "http:" && port === "80") ||
    (parsed.protocol === "https:" && port === "443");

  return isDefaultPort ? host : `${host}_${port}`;
}
