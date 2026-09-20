import type { Env } from "./types.ts";
import { ocr } from "./docai.ts";
import { extract } from "./extract.ts";
import { requireBearer } from "./auth.ts";
import { handleMcp } from "./mcp.ts";
import {
  deleteDocument,
  ensureLocalUser,
  getDocument,
  getUserById,
  hasDatabase,
  insertDocument,
  costSummary,
  listActions,
  listRecent,
  pingDatabase,
  recordScanCost,
  searchDocuments,
  updateDocumentFiling,
  updateDocumentRetention,
  type UserRow,
} from "./db.ts";
import { RETENTION_STATUSES, type Lang, type RetentionStatus } from "./extract.ts";
import { estimateCost, PRICING_AS_OF } from "./pricing.ts";
import { callback, login, logout, ReconnectRequired } from "./oauth.ts";
import { readSession } from "./session.ts";
import { fileToDrive, type Filed } from "./filing.ts";
import {
  acceptInvite, cleanName, createInvite, createSpace, getInvite, getSpaceForUser, listInvites, listMembers,
  listSpaces, removeMember, renameSpace, revokeInvite, setCurrentSpace, currentSpace, spaceOwner,
  type SpaceWithRole,
} from "./spaces.ts";
import { trashFile } from "./drive.ts";
import { userAccessToken } from "./oauth.ts";

/**
 * Paper Archive — Cloudflare Worker.
 *
 * Auth is one of two things:
 *   - a session cookie from Sign in with Google → a real user, documents are
 *     filed to their Drive;
 *   - the shared bearer token → the single "local" user, nothing is filed.
 *     This is the pre-sign-in tester path and what MCP clients use.
 *
 *   GET  /auth/login | /auth/callback | /auth/logout
 *   GET  /api/me        current user (session only)
 *   POST /api/process   OCR → extraction → index → Drive (session)
 *   GET  /api/recent    inbox
 *   GET  /api/actions   documents needing something, soonest deadline first
 *   GET  /api/search?q= keyword search (Japanese-capable, trigram)
 *   GET  /api/documents/:id
 *   DELETE /api/documents/:id            removes the index row; trashes the Drive file
 *   PATCH /api/documents/:id/retention   { retention, reason? } — the human's call
 *   Spaces (all scoped to the caller's current space):
 *   GET  /api/spaces · POST /api/spaces {name} · POST /api/spaces/:id/select
 *   PATCH /api/spaces/:id {name} (owner) · GET /api/spaces/:id/members
 *   DELETE /api/spaces/:id/members/:userId (owner, or self)
 *   GET|POST /api/spaces/:id/invites · DELETE /api/spaces/:id/invites/:inviteId
 *   GET  /api/invites/:token (public preview) · POST /api/invites/:token/accept (session)
 *   GET  /api/costs     unit economics from the scan_costs ledger (bearer = platform-wide)
 *   GET  /api/status    which credentials are configured
 *   *    /mcp           search_documents / get_document / list_actions /
 *                     set_retention_decision (bearer only)
 *
 * Static PWA is served from public/ via Workers assets.
 */

/** Explicit X-Lang wins; otherwise the browser's Accept-Language; else English. */
function requestLang(request: Request): Lang {
  const explicit = request.headers.get("X-Lang");
  if (explicit === "ja" || explicit === "en") return explicit;
  return /^ja\b/i.test(request.headers.get("Accept-Language") ?? "") ? "ja" : "en";
}

// Document AI online processing accepts up to ~20 MB. Refuse before buffering.
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// What both Document AI and Claude accept. HEIC — the iPhone Photos default —
// is deliberately absent: neither upstream takes it. The client converts.
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

// Claude's per-image limit is ~5 MB. The client downscales before upload;
// this backstop turns a confusing upstream error into a clear one.
const MAX_IMAGE_FOR_EXTRACTION = 5 * 1024 * 1024;

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

interface Caller {
  user: UserRow | null; // null = bearer-token "local" caller
}

/** The caller as a users row (the bearer caller is the "local" user) and their current space. */
async function callerContext(env: Env, caller: Caller): Promise<{ user: UserRow; space: SpaceWithRole }> {
  const user = caller.user ?? (await getUserById(env, await ensureLocalUser(env)))!;
  const space = await currentSpace(env, user);
  return { user, space };
}

/** Session cookie first, then bearer token. Returns a Response to short-circuit. */
async function resolveCaller(request: Request, env: Env): Promise<Caller | Response> {
  const sessionUserId = await readSession(request, env);
  if (sessionUserId && hasDatabase(env)) {
    const user = await getUserById(env, sessionUserId);
    if (user) return { user };
    // Stale cookie for a user that no longer exists: fall through to bearer.
  }
  const denied = await requireBearer(request, env);
  if (denied) return denied;
  return { user: null };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    // Correlates a client-visible failure with the server log line.
    const rid = crypto.randomUUID().slice(0, 8);

    // Unauthenticated: liveness only. Nothing about configuration leaks here.
    if (path === "/health") return json({ ok: true });

    if (path === "/auth/login") return login(env);
    if (path === "/auth/callback") return callback(request, env);
    if (path === "/auth/logout") return logout();

    if (path === "/mcp") {
      // Bearer only. Assistants do not carry browser cookies.
      const denied = await requireBearer(request, env);
      if (denied) return denied;
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      return handleMcp(request, env);
    }

    // Public: the join page needs to show what it is joining before sign-in.
    const invitePreview = path.match(/^\/api\/invites\/([A-Za-z0-9_-]{20,64})$/);
    if (invitePreview && request.method === "GET") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const inv = await getInvite(env, invitePreview[1]);
      return inv ? json({ invite: inv }) : json({ error: "not found" }, 404);
    }

    if (!path.startsWith("/api/")) return json({ error: "not found" }, 404);

    const caller = await resolveCaller(request, env);
    if (caller instanceof Response) return caller;

    if (path === "/api/me") {
      if (!caller.user) return json({ error: "not signed in" }, 401);
      const { email, name, drive_folder_id } = caller.user;
      const space = hasDatabase(env) ? await currentSpace(env, caller.user) : null;
      return json({ user: { email, name, drive_folder_id }, space: space && { id: space.id, name: space.name, role: space.role } });
    }

    // ----- spaces -----
    if (path === "/api/spaces" || path.startsWith("/api/spaces/")) {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { user, space: current } = await callerContext(env, caller);

      if (path === "/api/spaces" && request.method === "GET") {
        return json({ current: current.id, spaces: await listSpaces(env, user.id) });
      }
      if (path === "/api/spaces" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
        const name = cleanName(body?.name);
        if (!name) return json({ error: "name required (1-60 chars)" }, 400);
        const created = await createSpace(env, user.id, name);
        return json({ space: { ...created, role: "owner", member_count: 1 } }, 201);
      }

      const m = path.match(/^\/api\/spaces\/([0-9a-f-]{36})(?:\/(select|members|invites)(?:\/([0-9A-Za-z_-]+))?)?$/);
      if (!m) return json({ error: "not found" }, 404);
      const space = await getSpaceForUser(env, m[1], user.id);
      if (!space) return json({ error: "not found" }, 404);
      const sub = m[2], subId = m[3];
      const isOwner = space.role === "owner";

      if (!sub && request.method === "PATCH") {
        if (!isOwner) return json({ error: "owner only" }, 403);
        const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
        const name = cleanName(body?.name);
        if (!name) return json({ error: "name required (1-60 chars)" }, 400);
        await renameSpace(env, space.id, user.id, name);
        return json({ ok: true, id: space.id, name });
      }
      if (sub === "select" && request.method === "POST") {
        await setCurrentSpace(env, user.id, space.id);
        return json({ ok: true, current: space.id });
      }
      if (sub === "members" && !subId && request.method === "GET") {
        return json({ members: await listMembers(env, space.id) });
      }
      if (sub === "members" && subId && request.method === "DELETE") {
        const r = await removeMember(env, space.id, user.id, subId);
        return r === "ok" ? json({ ok: true }) : json({ error: r }, r === "forbidden" ? 403 : 404);
      }
      if (sub === "invites" && !subId && request.method === "GET") {
        const invites = await listInvites(env, space.id);
        return json({ invites: invites.map((i) => ({ ...i, url: `${url.origin}/join/${i.token}` })) });
      }
      if (sub === "invites" && !subId && request.method === "POST") {
        const inv = await createInvite(env, space.id, user.id);
        return json({ token: inv.token, expires_at: inv.expires_at, url: `${url.origin}/join/${inv.token}` }, 201);
      }
      if (sub === "invites" && subId && request.method === "DELETE") {
        if (!isOwner) return json({ error: "owner only" }, 403);
        return (await revokeInvite(env, space.id, subId)) ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      return json({ error: "method not allowed" }, 405);
    }

    const acceptM = path.match(/^\/api\/invites\/([A-Za-z0-9_-]{20,64})\/accept$/);
    if (acceptM && request.method === "POST") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      if (!caller.user) return json({ error: "sign in to join a space" }, 401);
      const r = await acceptInvite(env, acceptM[1], caller.user.id);
      return "error" in r ? json({ error: r.error }, r.error === "expired" ? 410 : 404) : json({ space: r.space });
    }

    if (path === "/api/status") {
      return json({
        processor: `${env.GCP_DOCAI_LOCATION}/${env.GCP_DOCAI_PROCESSOR_ID}`,
        version: env.GCP_DOCAI_PROCESSOR_VERSION,
        configured: {
          service_account: Boolean(env.GCP_SA_CLIENT_EMAIL && env.GCP_SA_PRIVATE_KEY),
          anthropic: Boolean(env.ANTHROPIC_API_KEY),
          database: hasDatabase(env),
          database_reachable: hasDatabase(env) ? await pingDatabase(env) : false,
          oauth: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
          session_secret: Boolean(env.SESSION_SECRET),
        },
      });
    }

    if (path === "/api/recent") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      return json({ space: { id: space.id, name: space.name }, documents: await listRecent(env, space.id) });
    }

    if (path === "/api/costs") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      // A session user sees their own; the bearer token is the operator and sees everything.
      return json({ pricing_as_of: PRICING_AS_OF, ...(await costSummary(env, caller.user?.id ?? null)) });
    }

    if (path === "/api/actions") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      return json({ documents: await listActions(env, space.id) });
    }

    if (path === "/api/search") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json({ documents: [] });
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
      const { space } = await callerContext(env, caller);
      return json({ documents: await searchDocuments(env, space.id, q.slice(0, 200), limit) });
    }

    const doc = path.match(/^\/api\/documents\/([0-9a-f-]{36})(\/retention)?$/);
    if (doc) {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      const spaceId = space.id;
      const id = doc[1];

      if (!doc[2] && request.method === "GET") {
        const row = await getDocument(env, spaceId, id);
        return row ? json({ document: row }) : json({ error: "not found" }, 404);
      }

      if (doc[2] && request.method === "PATCH") {
        const body = (await request.json().catch(() => null)) as { retention?: string; reason?: string } | null;
        const retention = body?.retention as RetentionStatus | undefined;
        if (!retention || !(RETENTION_STATUSES as readonly string[]).includes(retention)) {
          return json({ error: "invalid retention", allowed: RETENTION_STATUSES }, 400);
        }
        const ok = await updateDocumentRetention(env, spaceId, id, retention, body?.reason?.slice(0, 500) || "Decided by user");
        return ok ? json({ ok: true, id, retention }) : json({ error: "not found" }, 404);
      }
      if (!doc[2] && request.method === "DELETE") {
        const removed = await deleteDocument(env, spaceId, id);
        if (!removed) return json({ error: "not found" }, 404);
        // Best effort: the index row is already gone; a Drive failure here
        // leaves a stray file in the owner's folder, not a broken app. The file
        // is in the space OWNER's Drive, so it is their grant that trashes it.
        let driveTrashed = false;
        const owner = removed.drive_file_id ? await spaceOwner(env, space) : null;
        if (removed.drive_file_id && owner?.google_refresh_token_enc) {
          try {
            await trashFile(await userAccessToken(env, owner), removed.drive_file_id);
            driveTrashed = true;
          } catch (err) {
            console.error(`[${rid}] trash failed:`, err);
          }
        }
        return json({ ok: true, id, drive_trashed: driveTrashed });
      }
      return json({ error: "method not allowed" }, 405);
    }

    if (path === "/api/process" && request.method === "POST") {
      const mimeType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
      if (!ACCEPTED_TYPES.has(mimeType)) {
        return json({ error: `unsupported type "${mimeType}"`, accepted: [...ACCEPTED_TYPES] }, 415);
      }

      const declared = Number(request.headers.get("Content-Length") ?? 0);
      if (declared > MAX_BODY_BYTES) {
        return json({ error: "body too large", max_bytes: MAX_BODY_BYTES }, 413);
      }

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) return json({ error: "empty body" }, 400);
      if (bytes.byteLength > MAX_BODY_BYTES) {
        return json({ error: "body too large", max_bytes: MAX_BODY_BYTES }, 413);
      }

      const isImage = mimeType.startsWith("image/");
      if (isImage && bytes.byteLength > MAX_IMAGE_FOR_EXTRACTION) {
        return json(
          { error: "image too large for extraction; downscale before upload", max_bytes: MAX_IMAGE_FOR_EXTRACTION },
          413,
        );
      }

      // Each stage can fail independently; report which one did.
      let stage: "ocr" | "extraction" | "index" | "filing" = "ocr";
      const started = Date.now();
      let ocrPages = 0;
      let spaceId: string | null = null;
      const langForLedger = requestLang(request);
      try {
        const result = await ocr(env, bytes, mimeType);
        ocrPages = result.pageCount;

        stage = "extraction";
        // PDFs are not sent as images — Document AI has already flattened them.
        const image = isImage ? { data: arrayBufferToBase64(bytes), mediaType: mimeType } : null;
        const lang = requestLang(request);
        const { extraction, usage, model } = await extract(env, result.text, image, lang);
        const cost = estimateCost(model, { pages: result.pageCount, ...usage });
        const meta = { lang, cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };

        // Index it, if there is somewhere to index it. Without DATABASE_URL the
        // endpoint still works as a pure OCR+extract tester.
        let id: string | null = null;
        let filed: Filed | null = null;
        let filingError: "reconnect_google" | "owner_no_drive" | "failed" | null = null;

        if (hasDatabase(env)) {
          stage = "index";
          const ctx = await callerContext(env, caller);
          const ledgerUser = ctx.user.id;
          spaceId = ctx.space.id;
          const filename = decodeURIComponent(request.headers.get("X-Filename") ?? "") || null;

          // Files go to the SPACE OWNER's Drive with the owner's grant, whoever scanned.
          const owner = await spaceOwner(env, ctx.space);
          if (owner?.google_refresh_token_enc) {
            id = await insertDocument(env, ctx.space.id, ledgerUser, filename, result, extraction, model, "filing", meta);
            stage = "filing";
            try {
              filed = await fileToDrive(env, owner, ctx.space, bytes, mimeType, extraction);
              await updateDocumentFiling(env, id, {
                driveFileId: filed.fileId,
                filename: filed.filename,
                status: "complete",
                error: null,
              });
            } catch (err) {
              // The document is extracted and indexed; only the Drive copy is
              // missing. That is a retryable state, not a lost scan.
              console.error(`[${rid}] filing failed:`, err);
              filingError = err instanceof ReconnectRequired ? "reconnect_google" : "failed";
              await updateDocumentFiling(env, id, {
                driveFileId: null,
                filename: null,
                status: "failed",
                error: err instanceof Error ? err.message.slice(0, 500) : String(err),
              });
            }
          } else {
            id = await insertDocument(env, ctx.space.id, ledgerUser, filename, result, extraction, model, "complete", meta);
            filingError = "owner_no_drive";
          }

          await recordScanCost(env, {
            userId: ledgerUser, spaceId, documentId: id, status: "complete", stage: null, lang,
            mimeType, bytes: bytes.byteLength, ocrPages: result.pageCount, model,
            inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
            ocrUsd: cost.ocr_usd, llmUsd: cost.llm_usd, totalUsd: cost.total_usd,
            pricingAsOf: cost.pricing_as_of, durationMs: Date.now() - started,
          });
        }

        return json({
          id,
          space_id: spaceId,
          lang,
          cost,
          filed,
          filing_error: filingError,
          ocr: {
            provider: result.provider,
            pages: result.pageCount,
            confidence: result.confidence,
            chars: result.text.length,
            text: result.text,
          },
          extraction,
        });
      } catch (err) {
        // Upstream error bodies can carry project identifiers and quota
        // details. Log them; do not echo them.
        console.error(`[${rid}] process failed at ${stage}:`, err);
        // A failure after OCR still cost money. Ledger it, best effort.
        if (hasDatabase(env) && ocrPages > 0) {
          try {
            const c = estimateCost("claude-opus-5", { pages: ocrPages, inputTokens: 0, outputTokens: 0 });
            await recordScanCost(env, {
              userId: caller.user?.id ?? (await ensureLocalUser(env)), spaceId, documentId: null,
              status: "failed", stage, lang: langForLedger, mimeType, bytes: bytes.byteLength,
              ocrPages, model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
              ocrUsd: c.ocr_usd, llmUsd: 0, totalUsd: c.ocr_usd, pricingAsOf: c.pricing_as_of,
              durationMs: Date.now() - started,
            });
          } catch (ledgerErr) {
            console.error(`[${rid}] ledger write failed:`, ledgerErr);
          }
        }
        return json({ error: "processing failed", stage, request_id: rid }, 502);
      }
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
