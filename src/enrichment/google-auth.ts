import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * Service-account-based authentication for Google APIs.
 *
 * Avoids the heavy `googleapis` / `google-auth-library` SDKs (~50MB combined)
 * by hand-rolling the JWT bearer flow described at:
 * https://developers.google.com/identity/protocols/oauth2/service-account
 *
 * Token endpoint:  POST https://oauth2.googleapis.com/token
 * JWT lifetime:    1 hour (we cache and refresh ~30s before expiry)
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface ServiceAccountSource {
  /** Raw JSON string of the service-account key (preferred for CI). */
  json?: string;
  /** Path to a service-account JSON key file. */
  filePath?: string;
}

export class GoogleServiceAccountAuth {
  private cached: Map<string, CachedToken> = new Map();
  private keyPromise: Promise<ServiceAccountKey> | null = null;
  private fetcher: typeof fetch;

  constructor(private source: ServiceAccountSource, fetcher?: typeof fetch) {
    this.fetcher = fetcher ?? fetch;
  }

  async getAccessToken(scopes: string[]): Promise<string> {
    const cacheKey = scopes.slice().sort().join(" ");
    const cached = this.cached.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now + 30_000) {
      return cached.accessToken;
    }

    const key = await this.loadKey();
    const assertion = signJwt(key, scopes);
    const tokenUri = key.token_uri ?? "https://oauth2.googleapis.com/token";

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });

    const response = await this.fetcher(tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Google token exchange failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as { access_token: string; expires_in: number };
    const token: CachedToken = {
      accessToken: payload.access_token,
      expiresAt: now + payload.expires_in * 1000,
    };
    this.cached.set(cacheKey, token);
    return token.accessToken;
  }

  private async loadKey(): Promise<ServiceAccountKey> {
    if (!this.keyPromise) {
      this.keyPromise = (async () => {
        let raw: string;
        if (this.source.json) {
          raw = this.source.json;
        } else if (this.source.filePath) {
          raw = await readFile(this.source.filePath, "utf8");
        } else {
          throw new Error("No service-account credentials configured.");
        }
        const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
        if (!parsed.client_email || !parsed.private_key) {
          throw new Error(
            "Service-account key missing required `client_email` or `private_key` fields.",
          );
        }
        return parsed as ServiceAccountKey;
      })();
    }
    return this.keyPromise;
  }
}

function signJwt(key: ServiceAccountKey, scopes: string[]): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const issuedAt = Math.floor(Date.now() / 1000);
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: key.token_uri ?? "https://oauth2.googleapis.com/token",
      exp: issuedAt + 3600,
      iat: issuedAt,
    }),
  );
  const signingInput = `${header}.${claim}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(key.private_key.replace(/\\n/g, "\n"));
  return `${signingInput}.${base64UrlEncodeBuffer(signature)}`;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBuffer(Buffer.from(value, "utf8"));
}

function base64UrlEncodeBuffer(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function resolveServiceAccountSource(
  jsonOverride: string | null | undefined,
  filePathOverride: string | null | undefined,
): ServiceAccountSource | null {
  const json =
    jsonOverride ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? process.env.GSC_SERVICE_ACCOUNT_KEY ?? null;
  if (json && json.trim().length > 0) {
    return { json: json.trim() };
  }
  const filePath = filePathOverride ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null;
  if (filePath && filePath.trim().length > 0) {
    return { filePath: filePath.trim() };
  }
  return null;
}
