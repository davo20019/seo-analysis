import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostKeyFromUrl, resolveCrawlsDir } from "../src/persist.js";

describe("hostKeyFromUrl", () => {
  it("lowercases the hostname", () => {
    expect(hostKeyFromUrl("https://Example.COM/")).toBe("example.com");
  });

  it("strips a leading www.", () => {
    expect(hostKeyFromUrl("https://www.example.com/")).toBe("example.com");
  });

  it("preserves non-default ports as host_port", () => {
    expect(hostKeyFromUrl("http://localhost:3000")).toBe("localhost_3000");
    expect(hostKeyFromUrl("https://example.com:8443/")).toBe("example.com_8443");
  });

  it("strips default ports (80 over http, 443 over https)", () => {
    expect(hostKeyFromUrl("http://example.com:80")).toBe("example.com");
    expect(hostKeyFromUrl("https://example.com:443/")).toBe("example.com");
  });

  it("returns punycode form for IDN hosts", () => {
    expect(hostKeyFromUrl("https://例え.テスト/")).toBe("xn--r8jz45g.xn--zckzah");
  });

  it("throws on unparseable input", () => {
    expect(() => hostKeyFromUrl("not-a-url")).toThrow();
  });

  it("does not strip www inside the hostname (only leading)", () => {
    expect(hostKeyFromUrl("https://blog.www.example.com/")).toBe("blog.www.example.com");
  });
});

describe("resolveCrawlsDir", () => {
  let tmp: string;
  const ORIGINAL_ENV = process.env.SEO_AUDIT_CRAWLS_DIR;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "seo-audit-test-"));
  });

  afterEach(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env.SEO_AUDIT_CRAWLS_DIR;
    else process.env.SEO_AUDIT_CRAWLS_DIR = ORIGINAL_ENV;
    await rm(tmp, { recursive: true, force: true });
  });

  it("honors SEO_AUDIT_CRAWLS_DIR when set", () => {
    process.env.SEO_AUDIT_CRAWLS_DIR = tmp;
    expect(resolveCrawlsDir()).toBe(tmp);
  });

  it("defaults to ~/.config/seo-audit/crawls when env is unset", () => {
    delete process.env.SEO_AUDIT_CRAWLS_DIR;
    const result = resolveCrawlsDir();
    expect(result.endsWith(join(".config", "seo-audit", "crawls"))).toBe(true);
  });
});
