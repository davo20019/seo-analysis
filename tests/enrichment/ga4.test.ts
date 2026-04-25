import { describe, it, expect } from "vitest";
import { Ga4EnrichmentSource, pickBestGa4Property } from "../../src/enrichment/ga4.js";
import { GoogleServiceAccountAuth } from "../../src/enrichment/google-auth.js";
import type { PageReport } from "../../src/types.js";

describe("pickBestGa4Property", () => {
  it("matches a single web data stream by host", () => {
    const result = pickBestGa4Property("https://example.com", [
      {
        property: "properties/123",
        displayName: "Example",
        webStreams: [{ defaultUri: "https://example.com" }],
      },
    ]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.property).toBe("properties/123");
  });

  it("strips leading www. on either side of the comparison", () => {
    const result = pickBestGa4Property("https://example.com", [
      {
        property: "properties/123",
        displayName: "Example",
        webStreams: [{ defaultUri: "https://www.example.com" }],
      },
    ]);
    expect(result.kind).toBe("ok");
  });

  it("returns ambiguous with the candidate list when multiple properties match", () => {
    const result = pickBestGa4Property("https://example.com", [
      {
        property: "properties/123",
        displayName: "Prod",
        webStreams: [{ defaultUri: "https://example.com" }],
      },
      {
        property: "properties/456",
        displayName: "Staging",
        webStreams: [{ defaultUri: "https://example.com" }],
      },
    ]);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((c) => c.property)).toEqual([
        "properties/123",
        "properties/456",
      ]);
    }
  });

  it("returns none when no web data stream matches the origin", () => {
    const result = pickBestGa4Property("https://example.com", [
      {
        property: "properties/789",
        displayName: "Other",
        webStreams: [{ defaultUri: "https://other.com" }],
      },
    ]);
    expect(result.kind).toBe("none");
  });
});

describe("Ga4EnrichmentSource Admin-API auto-resolve", () => {
  it("auto-resolves a single matching property and skips Admin calls when override given", async () => {
    let adminCalls = 0;
    let dataCalls = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "fake-token", expires_in: 3600 });
      }
      if (url.startsWith("https://analyticsadmin.googleapis.com/")) {
        adminCalls += 1;
        if (url.endsWith("/accountSummaries")) {
          return jsonResponse({
            accountSummaries: [
              {
                account: "accounts/1",
                propertySummaries: [
                  { property: "properties/111", displayName: "Example" },
                ],
              },
            ],
          });
        }
        if (url.endsWith("/properties/111/dataStreams")) {
          return jsonResponse({
            dataStreams: [
              { type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://example.com" } },
            ],
          });
        }
      }
      if (url.includes(":runReport")) {
        dataCalls += 1;
        return jsonResponse({
          rows: [
            {
              dimensionValues: [{ value: "https://example.com/foo" }],
              metricValues: [{ value: "10" }, { value: "20" }, { value: "8" }, { value: "0.7" }],
            },
          ],
          rowCount: 1,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const source = new Ga4EnrichmentSource({
      days: 30,
      auth: new GoogleServiceAccountAuth({ json: testServiceAccountJson() }, mockFetch),
      fetcher: mockFetch,
    });
    await source.fetch("https://example.com", "https://example.com/");
    // Task 4 only verifies the resolution wiring; row-content assertions are in Task 5.
    expect(adminCalls).toBe(2);
    expect(dataCalls).toBe(1);
    expect(source.lastResult?.property).toBe("properties/111");
  });

  it("with property override, skips Admin calls entirely", async () => {
    let adminCalls = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "fake-token", expires_in: 3600 });
      }
      if (url.startsWith("https://analyticsadmin.googleapis.com/")) {
        adminCalls += 1;
        throw new Error("Admin API should not be called when property is set");
      }
      if (url.includes(":runReport")) {
        return jsonResponse({ rows: [], rowCount: 0 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const source = new Ga4EnrichmentSource({
      property: "properties/999",
      days: 7,
      auth: new GoogleServiceAccountAuth({ json: testServiceAccountJson() }, mockFetch),
      fetcher: mockFetch,
    });
    await source.fetch("https://example.com", "https://example.com/");
    expect(adminCalls).toBe(0);
    expect(source.lastResult?.property).toBe("properties/999");
  });

  it("throws with the candidate list when multiple properties match", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "fake-token", expires_in: 3600 });
      }
      if (url.endsWith("/accountSummaries")) {
        return jsonResponse({
          accountSummaries: [
            {
              account: "accounts/1",
              propertySummaries: [
                { property: "properties/111", displayName: "Prod" },
                { property: "properties/222", displayName: "Staging" },
              ],
            },
          ],
        });
      }
      if (url.endsWith("/properties/111/dataStreams") || url.endsWith("/properties/222/dataStreams")) {
        return jsonResponse({
          dataStreams: [
            { type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://example.com" } },
          ],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const source = new Ga4EnrichmentSource({
      auth: new GoogleServiceAccountAuth({ json: testServiceAccountJson() }, mockFetch),
      fetcher: mockFetch,
    });
    await expect(source.fetch("https://example.com", "https://example.com/")).rejects.toThrow(
      /properties\/111.*properties\/222/s,
    );
  });

  it("throws with a grant-URL hint when no property matches", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "fake-token", expires_in: 3600 });
      }
      if (url.endsWith("/accountSummaries")) {
        return jsonResponse({ accountSummaries: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const source = new Ga4EnrichmentSource({
      auth: new GoogleServiceAccountAuth({ json: testServiceAccountJson() }, mockFetch),
      fetcher: mockFetch,
    });
    await expect(source.fetch("https://example.com", "https://example.com/")).rejects.toThrow(
      /--ga4-property/,
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makePage(url: string): PageReport {
  return {
    url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    redirectChain: [],
    checks: {
      title: null, titleLength: 0, metaDescription: null, metaDescriptionLength: 0,
      canonical: null, htmlLang: null, expectedLocale: null, hreflang: [],
      robotsMeta: null, h1s: [], wordCount: 0, imagesTotal: 0, imagesMissingAlt: 0,
      internalLinks: 0, incomingInternalLinks: 0,
      internalLinksWithoutAnchorText: 0, internalLinksWithNonDescriptiveAnchorText: 0,
      externalLinks: 0, inSitemap: false,
      openGraph: { title: null, description: null, image: null },
      schemaTypes: [], bodyText: null,
    },
    issues: [],
    discoveredLinks: [],
  };
}

// Same RSA-SHA256 fixture used by gsc.test.ts. The JWT signing path needs
// a real key. NOT a credential — has no permissions anywhere.
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

export { makePage, testServiceAccountJson };
