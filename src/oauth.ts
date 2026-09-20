import type { Env } from "./types.ts";
import type { UserRow } from "./db.ts";
import { updateUserTokens, upsertGoogleUser } from "./db.ts";
import { accessFor } from "./allow.ts";
import { notInvitedPage } from "./gate.ts";
import {
  b64url,
  clearSessionCookie,
  createSessionCookie,
  decrypt,
  encrypt,
  getCookie,
  setCookie,
  sign,
  unb64url,
  verify,
} from "./session.ts";

/**
 * Sign in with Google → drive.file grant → session cookie.
 *
 * Scopes are deliberately minimal. drive.file sees only files this app
 * created, which is both the trust proposition and what keeps the consent
 * screen out of Google's verification queue.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = ["openid", "email", "profile", DRIVE_SCOPE].join(" ");
const STATE_COOKIE = "pa_oauth_state";

export function oauthConfigured(env: Env): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_OAUTH_REDIRECT_URI &&
      env.SESSION_SECRET,
  );
}

/** Only same-origin paths may be a post-login destination. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  return raw.slice(0, 512);
}

export async function login(env: Env, next = "/"): Promise<Response> {
  if (!oauthConfigured(env)) return new Response("Google sign-in not configured", { status: 503 });

  // state = nonce + destination, both covered by the cookie signature.
  const state = `${b64url(crypto.getRandomValues(new Uint8Array(16)))}.${b64url(new TextEncoder().encode(safeNext(next)))}`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    // offline + consent: always receive a refresh token so the session can
    // outlive the one-hour access token. The cost is seeing the consent
    // screen on every sign-in; acceptable until there is a reason not to.
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${AUTH_URL}?${params}`,
      "Set-Cookie": setCookie(STATE_COOKIE, await sign(env, state), { maxAge: 600, path: "/auth" }),
    },
  });
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

async function exchange(env: Env, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Google token endpoint ${res.status}: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function callback(request: Request, env: Env): Promise<Response> {
  if (!oauthConfigured(env)) return new Response("Google sign-in not configured", { status: 503 });
  const url = new URL(request.url);

  if (url.searchParams.get("error")) {
    return new Response(`Sign-in cancelled: ${url.searchParams.get("error")}`, { status: 400 });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = await verify(env, getCookie(request, STATE_COOKIE));
  if (!code || !state || !expected || state !== expected) {
    return new Response("Invalid sign-in state", { status: 400 });
  }

  const tokens = await exchange(env, {
    code,
    redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
    grant_type: "authorization_code",
  });

  // The user can untick Drive on the consent screen. Without it the product
  // cannot file anything, so refuse cleanly rather than half-work.
  if (!tokens.scope?.split(" ").includes(DRIVE_SCOPE)) {
    return new Response("Google Drive access is required. Please sign in again and allow it.", { status: 403 });
  }
  if (!tokens.id_token || !tokens.refresh_token) {
    return new Response("Google did not return the expected tokens", { status: 502 });
  }
  const nextPath = (() => {
    try { return safeNext(new TextDecoder().decode(unb64url(state.split(".")[1] ?? ""))); } catch { return "/"; }
  })();

  // The id_token arrived from Google's token endpoint over TLS in this same
  // exchange, so its payload is trusted without re-verifying the JWS.
  const claims = JSON.parse(new TextDecoder().decode(unb64url(tokens.id_token.split(".")[1]))) as {
    sub: string;
    email: string;
    name?: string;
  };

  // The allow-list is enforced here, before any session or user row exists.
  if (!(await accessFor(env, claims.email)).allowed) {
    const ja = /^ja\b/i.test(request.headers.get("Accept-Language") ?? "");
    return notInvitedPage(claims.email ?? "", ja ? "ja" : "en");
  }

  const user = await upsertGoogleUser(env, {
    sub: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    refreshTokenEnc: await encrypt(env, tokens.refresh_token),
    accessToken: tokens.access_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  });

  const headers = new Headers({ Location: nextPath });
  headers.append("Set-Cookie", await createSessionCookie(env, user.id));
  headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", { maxAge: 0, path: "/auth" }));
  return new Response(null, { status: 302, headers });
}

export function logout(): Response {
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": clearSessionCookie() } });
}

/** The user revoked access, or the refresh token expired unused. */
export class ReconnectRequired extends Error {}

/** A valid Google access token for this user, refreshing if needed. */
export async function userAccessToken(env: Env, user: UserRow): Promise<string> {
  const expiresAt = user.google_token_expires_at ? new Date(user.google_token_expires_at).getTime() : 0;
  if (user.google_access_token && expiresAt > Date.now() + 60_000) return user.google_access_token;

  if (!user.google_refresh_token_enc) throw new ReconnectRequired("No Google refresh token stored");

  let tokens: TokenResponse;
  try {
    tokens = await exchange(env, {
      refresh_token: await decrypt(env, user.google_refresh_token_enc),
      grant_type: "refresh_token",
    });
  } catch (err) {
    if (err instanceof Error && /invalid_grant/.test(err.message)) {
      throw new ReconnectRequired("Google access was revoked");
    }
    throw err;
  }

  await updateUserTokens(env, user.id, tokens.access_token, new Date(Date.now() + tokens.expires_in * 1000));
  return tokens.access_token;
}
