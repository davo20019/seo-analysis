import { describe, it, expect } from "vitest";
import { GscEnrichmentSource, pickBestProperty } from "../../src/enrichment/gsc.js";
import { GoogleServiceAccountAuth } from "../../src/enrichment/google-auth.js";
import { applyEnrichment } from "../../src/enrichment/index.js";
import type { PageReport } from "../../src/types.js";

function makePage(url: string): PageReport {
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    redirectChain: [],
    checks: {
      title: null,
      titleLength: 0,
      metaDescription: null,
      metaDescriptionLength: 0,
      canonical: null,
      htmlLang: null,
      expectedLocale: null,
      hreflang: [],
      robotsMeta: null,
      h1s: [],
      wordCount: 0,
      imagesTotal: 0,
      imagesMissingAlt: 0,
      internalLinks: 0,
      incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0,
      internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0,
      inSitemap: false,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: [],
      bodyText: null,
    },
    issues: [],
    discoveredLinks: [],
  };
}

describe("pickBestProperty", () => {
  it("picks a domain property matching the host", () => {
    const property = pickBestProperty("https://www.example.com", [
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://other.com/", permissionLevel: "siteOwner" },
    ]);
    expect(property).toBe("sc-domain:example.com");
  });

  it("picks the longest matching URL-prefix property", () => {
    const property = pickBestProperty("https://example.com/blog/post", [
      { siteUrl: "https://example.com/", permissionLevel: "siteOwner" },
      { siteUrl: "https://example.com/blog/", permissionLevel: "siteOwner" },
    ]);
    expect(property).toBe("https://example.com/blog/");
  });

  it("ignores unverified properties", () => {
    const property = pickBestProperty("https://example.com/", [
      { siteUrl: "https://example.com/", permissionLevel: "siteUnverifiedUser" },
    ]);
    expect(property).toBeNull();
  });

  it("returns null when no property matches", () => {
    expect(pickBestProperty("https://example.com/", [])).toBeNull();
  });
});

describe("GscEnrichmentSource", () => {
  it("queries searchAnalytics and returns URL-keyed metrics", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (url.endsWith("/sites")) {
        return new Response(
          JSON.stringify({
            siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/searchAnalytics/query")) {
        return new Response(
          JSON.stringify({
            rows: [
              { keys: ["https://example.com/foo"], clicks: 10, impressions: 100, ctr: 0.1, position: 5.5 },
              { keys: ["https://example.com/bar"], clicks: 0, impressions: 30, ctr: 0, position: 18 },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({ access_token: "fake-token", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const source = new GscEnrichmentSource({
      days: 30,
      auth: new GoogleServiceAccountAuth({ json: testServiceAccountJson() }, mockFetch),
      fetcher: mockFetch,
    });

    const map = await source.fetch("https://example.com", "https://example.com/");
    expect(map.size).toBeGreaterThanOrEqual(2);
    expect(map.get("https://example.com/foo")).toEqual({
      clicks: 10,
      impressions: 100,
      ctr: 0.1,
      position: 5.5,
    });
    expect(source.lastResult?.totalRows).toBe(2);
    expect(source.lastResult?.property).toBe("sc-domain:example.com");
  });

  it("attaches metrics onto pages via applyEnrichment", async () => {
    const sharedMock = mockFetchWithRows([
      { keys: ["https://example.com/foo/"], clicks: 5, impressions: 50, ctr: 0.1, position: 7 },
    ]);
    const source = new GscEnrichmentSource({
      property: "sc-domain:example.com",
      days: 30,
      auth: new GoogleServiceAccountAuth({ json: testServiceAccountJson() }, sharedMock),
      fetcher: sharedMock,
    });
    const data = await source.fetch("https://example.com", "https://example.com/");
    const pages = [makePage("https://example.com/foo")];
    const { matched } = applyEnrichment(pages, source, data);
    expect(matched).toBe(1);
    expect(pages[0].metrics?.gsc).toEqual({ clicks: 5, impressions: 50, ctr: 0.1, position: 7 });
  });
});

function mockFetchWithRows(rows: unknown[]): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({ access_token: "fake-token", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/searchAnalytics/query")) {
      return new Response(JSON.stringify({ rows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

/**
 * RSA-SHA256 service-account key. The JWT signing path needs a real RSA key,
 * so this is a deterministic test fixture (NOT a credential — it has no
 * permissions anywhere). Generated with: openssl genrsa 2048.
 */
function testServiceAccountJson(): string {
  return JSON.stringify({
    type: "service_account",
    client_email: "test@example.iam.gserviceaccount.com",
    private_key: TEST_PRIVATE_KEY,
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDB9xZK3VbFfNDb
58gFlAqe93ExdEMEbsPgJoJ3WsJ/2IvLjHt6tYbEWokrAAvZvN5zDgZyNyBGvOnv
ub09b73R+gXmxVoTJIpITxqAtelIozcVbwuT2DxV4wTRyWKgJQO9Al8kw+N8uQ7e
4MZA7ZNYMMudaDF/2Yy0QcYSpSAEbN/JxZZDzIWKSqxR2VLFG9cF+WZdmXGEOLpk
ScmDg7TT4T/lyJCmWf+l4PhlMVNzPxxFbS/J8cdIyQHvWcwfPC1Pmg0NE9Tjcwd6
Oo8zXyuKvc8ot+RSCZW2sRJGRUMWpWfZuZQ34IurTkkX6ehGbJEZlVNB5T9JDQEM
2SrtQ2L3AgMBAAECggEABugHdUdUwgcTeTRnxXM7tNhelvAyXWBmK04A6XmnHxqi
gCyWKr6cZpdLcz9mwdDFCH56b9kYG8xyqvHC2T2BOC5oc2LcZsrNg+DHi4f5QApr
KgN5KlLyaY8d36e1k8sYcsaAyBaJv2jCHobDs+P0Nos6w7yC/tYgbdAfzz3ITMpd
9M22wO4aS/G81lI8Sp+IZIeisMhwZHgQjzhIH/+ouY7fvthm3F4Iwjg11/QJ3iwn
m0mXd8+xMFUkMFJV5dTKnhLBPNXGyOhDKULrCk0pJ1A50NAbwuzhX/FZIXvpKfTs
XOtoy8HHF+dHTVQVCbrcYABGHW6ftORXG8fb4FVAqQKBgQDyPF/4aJTimUWLxsgF
3fNqnfMRaedu+1tIbV2p5ENeeXlRQS3FoSZF6BR1u9p+4hNsVa78czrsTd8rrljL
hHRtA+DVrJ1Ba8b13eaIdvIz3ML4KYHHUwxnWvc5R4aHhGFBjPoqxVHfytfQI9ku
+zWxWHbWvXPN0TzfgPuJSIBxdQKBgQDM5qf+8NA1wbCgmNUL/8eEU9nM5jjSsv4t
N6dlnLzRovwaRmubT45oKVsXnQ7lnyKLxKaXWP0J91+8kXa10KnEsMGoQWzrFb3z
mxSvoMqJArWP6S3tUdt0M03y6qV04EX6YA/AS+YIrfMdwy65eCeAY1qSoLSfIIcY
PrU+SiZWuwKBgGo3DFEM+tCmSBqXsAfwIB+eHWfeaSxzIi3ApdvTgAQ7cmehv3Wj
sTwrrvF0WTyN7hMyJ6tDH9Z23VLwzZl6Kp4IySPzCfyIbttlgqXDzbZ47Op7CQDn
XlFJZqFkIqMInfPPQt9SkEbnA5YyAayKzLlRuKHbm2tdN3UBthXTrqUlAoGAGEUv
gzfufFvtuPe8JuTbCtkkLcvm+zyl83WlyCGgfM8btmwEpz5J7GD9EPm07e6rCM8H
jRD8aLGRYW0JkY1B/dNgodNsjoGEnujfWqnB/wEPjKrFZh+ovDh5TPZSwQUxQmtY
GIo4qkjJzc2mt1xR6LYKZ4DbKWE6kgRkoWIzUH8CgYEAlqMXBxjKkmcqe4o6ZBIy
6lUeQvE1KE+4F9zb/k81pcFb3kgfbA7LHFiX42kdlW+5PDSU6bWRrE9otOjP63MS
1SUTV0PMDXIoaF0XF8s2r7VtQc/lIA5QlW7uxa2dt+FIyP30jRVybSI2+mmGsnNF
2OoZ8VrwR2hb2k8YCbMmGtA=
-----END PRIVATE KEY-----`;
