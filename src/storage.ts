import type { Env } from "./types.ts";
import { sign, verify } from "./session.ts";

/**
 * Originals live in an R2 bucket (decided 2026-09-20, replacing the owner's
 * Google Drive): one key per document, written BEFORE OCR runs, never
 * re-encoded. R2 has no egress fee and the Worker is the only reader, so
 * access control is the session (space membership) — the bucket is private.
 *
 * Keys: spaces/<space id>/<document id>.<ext>. The document id is known
 * first (the row is inserted, then the bytes are put), so a key never has
 * to be guessed back from a filename.
 */

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function extensionFor(mimeType: string): string {
  return EXT[mimeType] ?? "bin";
}

export function originalKey(spaceId: string, documentId: string, mimeType: string): string {
  return `spaces/${spaceId}/${documentId}.${extensionFor(mimeType)}`;
}

export async function putOriginal(env: Env, key: string, bytes: ArrayBuffer, mimeType: string, filename: string | null): Promise<void> {
  await env.ORIGINALS.put(key, bytes, {
    httpMetadata: { contentType: mimeType, contentDisposition: filename ? `inline; filename*=UTF-8''${encodeURIComponent(filename)}` : undefined },
  });
}

export async function getOriginal(env: Env, key: string): Promise<{ body: ReadableStream; bytes: () => Promise<ArrayBuffer>; mimeType: string; size: number } | null> {
  const obj = await env.ORIGINALS.get(key);
  if (!obj) return null;
  return {
    body: obj.body,
    bytes: () => obj.arrayBuffer(),
    mimeType: obj.httpMetadata?.contentType ?? "application/octet-stream",
    size: obj.size,
  };
}

export async function deleteOriginal(env: Env, key: string): Promise<void> {
  await env.ORIGINALS.delete(key);
}

/**
 * Short-lived links for readers that have no session cookie (MCP clients,
 * "open in another app"). The link is the document id plus an expiry, signed
 * with the session secret; the Worker still resolves the key from the
 * database, so a link never names a bucket path.
 */
export const LINK_TTL_SECONDS = 10 * 60;

export async function signedLink(env: Env, origin: string, documentId: string, ttl = LINK_TTL_SECONDS): Promise<{ url: string; expires_at: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token = await sign(env, `${documentId}.${exp}`);
  return { url: `${origin}/f/${documentId}?t=${encodeURIComponent(token)}`, expires_at: new Date(exp * 1000).toISOString() };
}

/** The document id the link is for, or null if the signature or expiry fails. */
export async function verifyLink(env: Env, documentId: string, token: string | null): Promise<boolean> {
  const value = await verify(env, token);
  if (!value) return false;
  const [id, exp] = value.split(".");
  return id === documentId && Number(exp) > Math.floor(Date.now() / 1000);
}
