import type { Env } from "./types";

/**
 * Service-account auth for the Cloudflare Workers runtime.
 *
 * The `googleapis` Node SDK does not run here, so we mint the JWT ourselves:
 * build the assertion, sign RS256 with Web Crypto, exchange it at Google's
 * token endpoint. This is the piece that eats an afternoon if you discover it
 * mid-build.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

// Tokens last an hour; a Worker isolate may serve many requests in that time.
let cached: { token: string; expiresAt: number } | null = null;

export function base64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  // Chunked: String.fromCharCode(...bytes) blows the stack on large inputs.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pemToPkcs8(pem: string): ArrayBuffer {
  // A private key pasted into an env var usually arrives with literal
  // backslash-n rather than real newlines. Normalise before stripping, or the
  // base64 body silently keeps two-character "\n" sequences and importKey
  // fails with an opaque DataError.
  const normalised = pem.replace(/\\n/g, "\n");
  const body = normalised
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  if (!env.GCP_SA_CLIENT_EMAIL || !env.GCP_SA_PRIVATE_KEY) {
    throw new Error(
      "Service account not configured. Set GCP_SA_CLIENT_EMAIL and GCP_SA_PRIVATE_KEY.",
    );
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.GCP_SA_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims),
  )}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(env.GCP_SA_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  const assertion = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}
