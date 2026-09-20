/**
 * Pure-logic tests. No network, no credentials.
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFilename } from "../src/filing.ts";
import { escapeLike } from "../src/db.ts";
import { ExtractionSchema, RETENTION_STATUSES, DOCUMENT_TYPES } from "../src/extract.ts";
import { base64url, pemToPkcs8 } from "../src/google-auth.ts";
import { sign, verify, encrypt, decrypt, readSession, createSessionCookie } from "../src/session.ts";
import { isRetryable, UpstreamError, withRetry } from "../src/retry.ts";
import { cleanName, newInviteToken } from "../src/spaces.ts";
import type { Env } from "../src/types.ts";

const env = { SESSION_SECRET: "test-secret-not-real" } as Env;

const sample = {
  title: "固定資産税納税通知書",
  document_type: "tax_notice",
  issuer: "上越市",
  document_date: "2026-09-01",
  summary: "Property and city planning tax notice",
  action_required: true,
  action_type: "payment",
  action_date: "2026-09-30",
  retention: "keep_original",
  retention_reason: "Tax document",
  categories: ["tax", "property"],
  amount: 128400,
  currency: "JPY",
  due_date: null,
  reference_number: null,
  other_fields: [{ key: "年度", value: "令和8年度" }],
};

test("filename: date_issuer_title with unsafe characters stripped", () => {
  const x = ExtractionSchema.parse({ ...sample, title: "請求書: 9/2026 <draft>" });
  assert.equal(buildFilename(x, "image/jpeg", "2026-09-18"), "2026-09-01_上越市_請求書_ 9_2026 _draft_.jpg");
});

test("filename: falls back to today and 'document' when fields are missing", () => {
  const x = ExtractionSchema.parse({ ...sample, document_date: null, issuer: null, title: "" });
  assert.equal(buildFilename(x, "application/pdf", "2026-09-18"), "2026-09-18.pdf");
});

test("escapeLike: metacharacters mean themselves", () => {
  assert.equal(escapeLike("100%_x\\y"), "100\\%\\_x\\\\y");
  assert.equal(escapeLike("固定資産税"), "固定資産税");
});

test("extraction schema: accepts the brief's example and rejects an unknown type", () => {
  assert.ok(ExtractionSchema.safeParse(sample).success);
  assert.equal(ExtractionSchema.safeParse({ ...sample, document_type: "taxes" }).success, false);
  assert.ok((RETENTION_STATUSES as readonly string[]).includes("unsure"));
  assert.ok((DOCUMENT_TYPES as readonly string[]).includes("other"));
});

test("base64url: no padding, url-safe alphabet, round-trips", () => {
  const bytes = new Uint8Array([251, 255, 254, 0, 1]);
  const s = base64url(bytes);
  assert.doesNotMatch(s, /[+/=]/);
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  assert.equal(atob(std + "=".repeat((4 - (std.length % 4)) % 4)), String.fromCharCode(...bytes));
});

test("pemToPkcs8: accepts real newlines and literal backslash-n", () => {
  const body = btoa("hello");
  const real = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  const literal = real.replace(/\n/g, "\\n");
  assert.deepEqual(new Uint8Array(pemToPkcs8(real)), new TextEncoder().encode("hello"));
  assert.deepEqual(new Uint8Array(pemToPkcs8(literal)), new TextEncoder().encode("hello"));
});

test("session: sign/verify round-trips; tampering and garbage both yield null", async () => {
  const signed = await sign(env, "user:123");
  assert.equal(await verify(env, signed), "user:123");
  assert.equal(await verify(env, signed.slice(0, -2) + "zz"), null);
  assert.equal(await verify(env, "not.valid"), null);
  assert.equal(await verify(env, "nodot"), null);
  assert.equal(await verify(env, null), null);
});

test("session: cookie is read back for the same secret and rejected for another", async () => {
  const cookie = await createSessionCookie(env, "u-1");
  const req = (c: string) => new Request("http://x/", { headers: { Cookie: c } });
  assert.equal(await readSession(req(cookie.split(";")[0]), env), "u-1");
  const other = { SESSION_SECRET: "different" } as Env;
  assert.equal(await readSession(req(cookie.split(";")[0]), other), null);
  assert.equal(await readSession(req("pa_session=garbage"), env), null);
});

test("encrypt/decrypt: round-trips and uses a fresh IV each time", async () => {
  const a = await encrypt(env, "refresh-token");
  const b = await encrypt(env, "refresh-token");
  assert.notEqual(a, b);
  assert.equal(await decrypt(env, a), "refresh-token");
  await assert.rejects(decrypt({ SESSION_SECRET: "other" } as Env, a));
});

test("retry: retries 429/5xx and network errors, not 4xx", async () => {
  assert.ok(isRetryable(new UpstreamError("x", 429, "")));
  assert.ok(isRetryable(new UpstreamError("x", 503, "")));
  assert.ok(isRetryable(new TypeError("fetch failed")));
  assert.equal(isRetryable(new UpstreamError("x", 400, "")), false);
  assert.equal(isRetryable(new Error("logic")), false);

  let calls = 0;
  const v = await withRetry("t", async () => {
    calls++;
    if (calls < 3) throw new UpstreamError("x", 500, "boom");
    return "ok";
  }, { attempts: 3, baseMs: 1 });
  assert.equal(v, "ok");
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    withRetry("t", async () => { calls++; throw new UpstreamError("x", 400, "no"); }, { attempts: 3, baseMs: 1 }),
  );
  assert.equal(calls, 1);
});

test("spaces: cleanName trims, collapses whitespace, strips control chars, bounds length", () => {
  assert.equal(cleanName("  田中家   "), "田中家");
  assert.equal(cleanName("Fam\u0007ily   Office"), "Family Office");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanName(null), null);
  assert.equal(cleanName("x".repeat(61)), null);
  assert.equal(cleanName("x".repeat(60)), "x".repeat(60));
});

test("spaces: invite tokens are url-safe, 32 chars, and unique", () => {
  const a = newInviteToken(), b = newInviteToken();
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, b);
});
