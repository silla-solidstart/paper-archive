import type { Env } from "./types";

/** Signed cookies and at-rest encryption, both keyed from SESSION_SECRET. */

const enc = new TextEncoder();

export function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function requireSecret(env: Env): string {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET not configured");
  return env.SESSION_SECRET;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(requireSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sign(env: Env, value: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), enc.encode(value));
  return `${value}.${b64url(sig)}`;
}

export async function verify(env: Env, signed: string | null): Promise<string | null> {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  // A malformed signature (anyone can send any cookie) is a non-session, not
  // a crash: atob throws on bad base64, and HMAC verify on a bad length.
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(env),
      unb64url(signed.slice(i + 1)),
      enc.encode(value),
    );
    return ok ? value : null;
  } catch {
    return null;
  }
}

// AES-GCM for the Google refresh token at rest. A leaked database dump must
// not be a leaked Drive grant. The key is derived, never the secret itself.
async function aesKey(env: Env): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("refresh-token-v1:" + requireSecret(env)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(env: Env, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(plain));
  return `${b64url(iv)}.${b64url(ct)}`;
}

export async function decrypt(env: Env, blob: string): Promise<string> {
  const [iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv) }, await aesKey(env), unb64url(ct));
  return new TextDecoder().decode(pt);
}

// --- cookies ---

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function setCookie(name: string, value: string, opts: { maxAge: number; path?: string }): string {
  return `${name}=${encodeURIComponent(value)}; Path=${opts.path ?? "/"}; Max-Age=${opts.maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export const SESSION_COOKIE = "pa_session";
const SESSION_DAYS = 30;

export async function createSessionCookie(env: Env, userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return setCookie(SESSION_COOKIE, await sign(env, `${userId}:${exp}`), { maxAge: SESSION_DAYS * 86400 });
}

export async function readSession(request: Request, env: Env): Promise<string | null> {
  if (!env.SESSION_SECRET) return null;
  const value = await verify(env, getCookie(request, SESSION_COOKIE));
  if (!value) return null;
  const [userId, exp] = value.split(":");
  if (!userId || Number(exp) < Date.now() / 1000) return null;
  return userId;
}

export function clearSessionCookie(): string {
  return setCookie(SESSION_COOKIE, "", { maxAge: 0 });
}
