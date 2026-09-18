import type { Env } from "./types.ts";

/**
 * Interim API auth: a single shared bearer token, until Google sign-in exists.
 *
 * The endpoints behind this call Document AI and Claude, both billed per
 * request, on a public hostname. Without this, anyone on the internet can
 * spend the budget. The GCP budget alerts; it does not stop spend.
 */
export async function requireBearer(request: Request, env: Env): Promise<Response | null> {
  if (!env.APP_BEARER_TOKEN) {
    // Fail closed. A missing secret must not mean an open endpoint.
    return new Response(JSON.stringify({ error: "server auth not configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const header = request.headers.get("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(env.APP_BEARER_TOKEN);
  const ok = constantTimeEqual(a, b);

  if (!ok) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" },
    });
  }
  return null;
}

/**
 * Portable constant-time comparison. crypto.subtle.timingSafeEqual exists on
 * Cloudflare Workers but is not standard Web Crypto, and the tests run on Node.
 * Length is compared without early exit; the loop always runs over the longer.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
