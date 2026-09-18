import type { Env } from "./types";
import { ocr } from "./docai";
import { extract } from "./extract";
import { requireBearer } from "./auth";
import { handleMcp } from "./mcp";
import {
  ensureLocalUser,
  getDocument,
  getUserById,
  hasDatabase,
  insertDocument,
  listRecent,
  updateDocumentFiling,
  updateDocumentRetention,
  type UserRow,
} from "./db";
import { RETENTION_STATUSES, type RetentionStatus } from "./extract";
import { callback, login, logout, ReconnectRequired } from "./oauth";
import { readSession } from "./session";
import { fileToDrive, type Filed } from "./filing";

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
 *   GET  /api/documents/:id
 *   PATCH /api/documents/:id/retention   { retention, reason? } — the human's call
 *   GET  /api/status    which credentials are configured
 *   *    /mcp           search_documents / get_document / list_actions /
 *                     set_retention_decision (bearer only)
 *
 * Static PWA is served from public/ via Workers assets.
 */

const EXTRACTION_MODEL = "claude-opus-5";

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

    if (!path.startsWith("/api/")) return json({ error: "not found" }, 404);

    const caller = await resolveCaller(request, env);
    if (caller instanceof Response) return caller;

    if (path === "/api/me") {
      if (!caller.user) return json({ error: "not signed in" }, 401);
      const { email, name, drive_folder_id } = caller.user;
      return json({ user: { email, name, drive_folder_id } });
    }

    if (path === "/api/status") {
      return json({
        processor: `${env.GCP_DOCAI_LOCATION}/${env.GCP_DOCAI_PROCESSOR_ID}`,
        version: env.GCP_DOCAI_PROCESSOR_VERSION,
        configured: {
          service_account: Boolean(env.GCP_SA_CLIENT_EMAIL && env.GCP_SA_PRIVATE_KEY),
          anthropic: Boolean(env.ANTHROPIC_API_KEY),
          database: hasDatabase(env),
          oauth: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
          session_secret: Boolean(env.SESSION_SECRET),
        },
      });
    }

    if (path === "/api/recent") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const userId = caller.user?.id ?? (await ensureLocalUser(env));
      return json({ documents: await listRecent(env, userId) });
    }

    const doc = path.match(/^\/api\/documents\/([0-9a-f-]{36})(\/retention)?$/);
    if (doc) {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const userId = caller.user?.id ?? (await ensureLocalUser(env));
      const id = doc[1];

      if (!doc[2] && request.method === "GET") {
        const row = await getDocument(env, userId, id);
        return row ? json({ document: row }) : json({ error: "not found" }, 404);
      }

      if (doc[2] && request.method === "PATCH") {
        const body = (await request.json().catch(() => null)) as { retention?: string; reason?: string } | null;
        const retention = body?.retention as RetentionStatus | undefined;
        if (!retention || !(RETENTION_STATUSES as readonly string[]).includes(retention)) {
          return json({ error: "invalid retention", allowed: RETENTION_STATUSES }, 400);
        }
        const ok = await updateDocumentRetention(env, userId, id, retention, body?.reason?.slice(0, 500) || "Decided by user");
        return ok ? json({ ok: true, id, retention }) : json({ error: "not found" }, 404);
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
      try {
        const result = await ocr(env, bytes, mimeType);

        stage = "extraction";
        // PDFs are not sent as images — Document AI has already flattened them.
        const image = isImage ? { data: arrayBufferToBase64(bytes), mediaType: mimeType } : null;
        const extraction = await extract(env, result.text, image);

        // Index it, if there is somewhere to index it. Without DATABASE_URL the
        // endpoint still works as a pure OCR+extract tester.
        let id: string | null = null;
        let filed: Filed | null = null;
        let filingError: "reconnect_google" | "failed" | null = null;

        if (hasDatabase(env)) {
          stage = "index";
          const filename = decodeURIComponent(request.headers.get("X-Filename") ?? "") || null;

          if (caller.user) {
            id = await insertDocument(env, caller.user.id, filename, result, extraction, EXTRACTION_MODEL, "filing");
            stage = "filing";
            try {
              filed = await fileToDrive(env, caller.user, bytes, mimeType, extraction);
              await updateDocumentFiling(env, id, {
                driveFileId: filed.fileId,
                filename: filed.filename,
                status: "complete",
                error: null,
              });
            } catch (err) {
              // The document is extracted and indexed; only the Drive copy is
              // missing. That is a retryable state, not a lost scan.
              console.error("filing failed:", err);
              filingError = err instanceof ReconnectRequired ? "reconnect_google" : "failed";
              await updateDocumentFiling(env, id, {
                driveFileId: null,
                filename: null,
                status: "failed",
                error: err instanceof Error ? err.message.slice(0, 500) : String(err),
              });
            }
          } else {
            const userId = await ensureLocalUser(env);
            id = await insertDocument(env, userId, filename, result, extraction, EXTRACTION_MODEL, "complete");
          }
        }

        return json({
          id,
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
        console.error(`process failed at ${stage}:`, err);
        return json({ error: "processing failed", stage }, 502);
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
