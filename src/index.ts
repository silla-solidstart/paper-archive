import type { Env } from "./types.ts";
import { ocr } from "./docai.ts";
import { extract } from "./extract.ts";
import { requireBearer } from "./auth.ts";
import { handleMcp } from "./mcp.ts";
import {
  applyExtraction,
  deleteDocument,
  ensureLocalUser,
  getDocument,
  getExpense,
  getUserById,
  hasDatabase,
  insertStagedDocument,
  costSummary,
  listActions,
  listExpenseItems,
  listIssuers,
  listRecent,
  listStale,
  markDocumentFailed,
  pingDatabase,
  recordScanCost,
  searchDocuments,
  setDocumentOcr,
  spendingSummary,
  updateDocumentFiling,
  updateDocumentIssuer,
  updateDocumentRetention,
  type UserRow,
} from "./db.ts";
import { EXTRACTION_MODEL, EXTRACTION_VERSION, ITEM_CATEGORIES, RETENTION_STATUSES, type Extraction, type Lang, type RetentionStatus } from "./extract.ts";
import { estimateCost, PRICING_AS_OF, type Cost } from "./pricing.ts";
import type { OcrResult } from "./docai.ts";
import { callback, login, logout, ReconnectRequired } from "./oauth.ts";
import { readSession } from "./session.ts";
import { accessFor, addAllowed, listAllowed, normaliseEntry, removeAllowed } from "./allow.ts";
import { sharePage, signInPage } from "./gate.ts";
import { buildFilename, finishFiling, stageToDrive, type Filed, type Staged } from "./filing.ts";
import {
  acceptInvite, cleanName, createInvite, createSpace, getInvite, getSpaceForUser, listInvites, listMembers,
  listSpaces, removeMember, renameSpace, revokeInvite, setCurrentSpace, currentSpace, spaceOwner, getSpaceById,
  type SpaceWithRole,
} from "./spaces.ts";
import { downloadFile, renameFile, trashFile } from "./drive.ts";
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
 *   POST /api/process   Drive (original, first) → OCR → extraction → index → rename
 *                       ?dry=1 (operator): OCR + extraction only, nothing stored
 *   POST /api/documents/:id/reanalyze   re-run extraction (original from Drive) — versioned, ledgered
 *   GET  /api/issuers   senders seen in this archive ("who is it from?" chips)
 *   GET  /api/spending?month=YYYY-MM    expense ledger summary
 *   GET  /api/expense-items?month=&category=&q=   line items ("snacks in August")
 *   GET  /api/admin/stale               documents below the current extraction version
 *   GET  /api/recent    inbox
 *   GET  /api/actions   documents needing something, soonest deadline first
 *   GET  /api/search?q= keyword search (Japanese-capable, trigram)
 *   GET  /api/documents/:id
 *   DELETE /api/documents/:id            removes the index row; trashes the Drive file
 *   PATCH /api/documents/:id/retention   { retention, reason? } — the human's call
 *   PATCH /api/documents/:id/issuer      { issuer } — the human names the sender; survives re-analysis
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
  admin: boolean;       // bootstrap/admin-row session, or the bearer token (operator)
}

/** The caller as a users row (the bearer caller is the "local" user) and their current space. */
async function callerContext(env: Env, caller: Caller): Promise<{ user: UserRow; space: SpaceWithRole }> {
  const user = caller.user ?? (await getUserById(env, await ensureLocalUser(env)))!;
  const space = await currentSpace(env, user);
  return { user, space };
}

/** The signed-in user, if the cookie is valid AND the email is still allowed. */
async function sessionUser(request: Request, env: Env): Promise<{ user: UserRow; admin: boolean } | null> {
  const sessionUserId = await readSession(request, env);
  if (!sessionUserId || !hasDatabase(env)) return null;
  const user = await getUserById(env, sessionUserId);
  if (!user) return null;
  // Removal from the allow-list takes effect on the next request, not at next sign-in.
  const access = await accessFor(env, user.email);
  return access.allowed ? { user, admin: access.admin } : null;
}

// Paths anyone may fetch without a session. Everything else is gated.
const PUBLIC_PATH = /^\/(health|privacy|auth\/|icons\/|manifest\.webmanifest$|sw\.js$)/;

/** Session cookie first, then bearer token. Returns a Response to short-circuit. */
async function resolveCaller(request: Request, env: Env): Promise<Caller | Response> {
  const s = await sessionUser(request, env);
  if (s) return { user: s.user, admin: s.admin };
  const denied = await requireBearer(request, env);
  if (denied) return denied;
  return { user: null, admin: true };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    // Correlates a client-visible failure with the server log line.
    const rid = crypto.randomUUID().slice(0, 8);

    // Unauthenticated: liveness only. Nothing about configuration leaks here.
    if (path === "/health") return json({ ok: true });

    if (path === "/share") {
      const q = url.searchParams.get("lang");
      return sharePage(q === "ja" || q === "en" ? q : requestLang(request));
    }
    if (path === "/auth/login") return login(env, url.searchParams.get("next") ?? "/");
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

    if (!path.startsWith("/api/")) {
      // Static app: public paths pass through; everything else needs an allowed session.
      if (PUBLIC_PATH.test(path) || (await sessionUser(request, env))) return env.ASSETS.fetch(request);
      const q = url.searchParams.get("lang");
      const lang = q === "ja" || q === "en" ? q : requestLang(request);
      const nextParam = url.searchParams.get("next");
      return signInPage(nextParam && nextParam.startsWith("/") ? nextParam : path + url.search, lang);
    }

    const caller = await resolveCaller(request, env);
    if (caller instanceof Response) return caller;

    if (path === "/api/me") {
      if (!caller.user) return json({ error: "not signed in" }, 401);
      const { email, name, drive_folder_id } = caller.user;
      const space = hasDatabase(env) ? await currentSpace(env, caller.user) : null;
      return json({ user: { email, name, drive_folder_id }, admin: caller.admin, space: space && { id: space.id, name: space.name, role: space.role } });
    }

    // ----- admin: the allow-list -----
    if (path === "/api/admin/allowlist" || path.startsWith("/api/admin/allowlist/")) {
      if (!caller.admin) return json({ error: "admin only" }, 403);
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      if (path === "/api/admin/allowlist" && request.method === "GET") {
        return json({ bootstrap: env.ADMIN_EMAILS ?? "", entries: await listAllowed(env) });
      }
      if (path === "/api/admin/allowlist" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { email?: unknown; role?: unknown; note?: unknown } | null;
        const entry = normaliseEntry(body?.email);
        if (!entry) return json({ error: "email or @domain required" }, 400);
        const role = body?.role === "admin" ? "admin" : "member";
        if (role === "admin" && entry.startsWith("@")) return json({ error: "a domain cannot be admin" }, 400);
        const note = typeof body?.note === "string" ? body.note.slice(0, 200) : null;
        return json({ entry: await addAllowed(env, entry, role, note, caller.user?.id ?? null) }, 201);
      }
      const m = path.match(/^\/api\/admin\/allowlist\/(.+)$/);
      if (m && request.method === "DELETE") {
        const entry = normaliseEntry(decodeURIComponent(m[1]));
        if (!entry) return json({ error: "invalid entry" }, 400);
        return (await removeAllowed(env, entry)) ? json({ ok: true }) : json({ error: "not found" }, 404);
      }
      return json({ error: "method not allowed" }, 405);
    }

    // ----- spaces -----
    if (path === "/api/spaces" || path.startsWith("/api/spaces/")) {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { user, space: current } = await callerContext(env, caller);

      if (path === "/api/spaces" && request.method === "GET") {
        return json({ current: current.id, spaces: await listSpaces(env, user.id) });
      }
      if (path === "/api/spaces" && request.method === "POST") {
        // Product decision (2026-09-20): everyone has exactly one archive of their own and can
        // share it or join others'. Extra spaces are operator-only, to keep the model clear.
        if (!caller.admin) return json({ error: "creating spaces is not enabled" }, 403);
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
      // Admins (and the bearer operator) see everything; a member sees their own.
      return json({ pricing_as_of: PRICING_AS_OF, ...(await costSummary(env, caller.admin ? null : caller.user!.id)) });
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

    const doc = path.match(/^\/api\/documents\/([0-9a-f-]{36})(\/retention|\/issuer)?$/);
    if (doc) {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      const spaceId = space.id;
      const id = doc[1];

      if (!doc[2] && request.method === "GET") {
        const row = await getDocument(env, spaceId, id);
        return row ? json({ document: row, expense: await getExpense(env, id) }) : json({ error: "not found" }, 404);
      }

      if (doc[2] === "/issuer" && request.method === "PATCH") {
        const body = (await request.json().catch(() => null)) as { issuer?: string } | null;
        const issuer = cleanName(body?.issuer);
        if (!issuer) return json({ error: "issuer required (1–60 chars)" }, 400);
        const row = await updateDocumentIssuer(env, spaceId, id, issuer);
        if (!row) return json({ error: "not found" }, 404);
        // Best effort: the Drive file was named before the sender was known.
        let renamed: string | null = null;
        if (row.drive_file_id && row.mime_type) {
          try {
            const owner = await spaceOwner(env, space);
            if (owner?.google_refresh_token_enc) {
              renamed = buildFilename({ document_date: row.document_date, issuer: row.issuer, title: row.title } as Extraction, row.mime_type, row.created_at.slice(0, 10));
              await renameFile(await userAccessToken(env, owner), row.drive_file_id, renamed);
              await updateDocumentFiling(env, id, { driveFileId: row.drive_file_id, filename: renamed, status: row.status as "complete" | "failed", error: row.error });
            }
          } catch (err) {
            console.error(`[${rid}] rename after issuer edit failed:`, err);
            renamed = null;
          }
        }
        return json({ ok: true, id, issuer, filename: renamed });
      }

      if (doc[2] === "/retention" && request.method === "PATCH") {
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
      if (declared > MAX_BODY_BYTES) return json({ error: "body too large", max_bytes: MAX_BODY_BYTES }, 413);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) return json({ error: "empty body" }, 400);
      if (bytes.byteLength > MAX_BODY_BYTES) return json({ error: "body too large", max_bytes: MAX_BODY_BYTES }, 413);
      const isImage = mimeType.startsWith("image/");
      if (isImage && bytes.byteLength > MAX_IMAGE_FOR_EXTRACTION) {
        return json({ error: "image too large for extraction; downscale before upload", max_bytes: MAX_IMAGE_FOR_EXTRACTION }, 413);
      }

      const lang = requestLang(request);
      const from = decodeURIComponent(request.headers.get("X-From") ?? "").trim().slice(0, 120) || null;
      const started = Date.now();

      // Dry run (operator only): OCR + extraction, nothing stored anywhere —
      // the prompt-tuning path (scripts/eval-extract.ts). Also the behaviour
      // without a database. Nothing is kept, so the Drive-first rule has
      // nothing to protect.
      if (!hasDatabase(env) || (url.searchParams.get("dry") === "1" && caller.admin)) {
        try {
          const result = await ocr(env, bytes, mimeType);
          const image = isImage ? { data: arrayBufferToBase64(bytes), mediaType: mimeType } : null;
          const { extraction, usage, model } = await extract(env, result.text, image, lang, { from });
          const cost = estimateCost(model, { pages: result.pageCount, ...usage });
          return json({ id: null, dry: true, lang, cost, filed: null, filing_error: null, ocr: ocrSummary(result), extraction });
        } catch (err) {
          console.error(`[${rid}] dry run failed:`, err);
          return json({ error: "processing failed", stage: "ocr_or_extraction", request_id: rid }, 502);
        }
      }

      // Hard rule (2026-09-20): the photo is in the owner's Drive before we
      // read it. No grant, no scan — the photo is still on the phone, and
      // nothing has been spent.
      const ctx = await callerContext(env, caller);
      const owner = await spaceOwner(env, ctx.space);
      if (!owner?.google_refresh_token_enc) {
        return json({ error: "owner_no_drive", filing_error: "owner_no_drive", stage: "filing" }, 409);
      }
      let staged: Staged;
      try {
        staged = await stageToDrive(env, owner, ctx.space, bytes, mimeType);
      } catch (err) {
        console.error(`[${rid}] staging to Drive failed:`, err);
        if (err instanceof ReconnectRequired) return json({ error: "reconnect_google", filing_error: "reconnect_google", stage: "filing" }, 409);
        return json({ error: "filing failed", stage: "filing", request_id: rid }, 502);
      }
      const filename = decodeURIComponent(request.headers.get("X-Filename") ?? "") || staged.filename;
      const id = await insertStagedDocument(env, ctx.space.id, ctx.user.id, {
        driveFileId: staged.fileId, filename: staged.filename, mimeType, bytes: bytes.byteLength, lang,
      });
      void filename;

      try {
        const out = await interpret(env, {
          id, spaceId: ctx.space.id, userId: ctx.user.id, bytes, mimeType, ocrText: null, lang, from,
          trigger: "ingest", started, rid,
          finish: (x) => finishFiling(staged, ctx.space, mimeType, x),
        });
        return json({ id, space_id: ctx.space.id, lang, cost: out.cost, filed: out.filed, filing_error: null, ocr: out.ocr, extraction: out.extraction });
      } catch (err) {
        const stage = err instanceof InterpretError ? err.stage : "extraction";
        // The photo is filed and the row exists; the interpretation can be
        // re-run later (Re-analyze), so this is a degraded document, not a lost scan.
        return json({
          error: "processing failed", stage, request_id: rid, id, space_id: ctx.space.id,
          filed: { fileId: staged.fileId, filename: staged.filename, link: staged.link, path: staged.path },
        }, 502);
      }
    }

    const re = path.match(/^\/api\/documents\/([0-9a-f-]{36})\/reanalyze$/);
    if (re && request.method === "POST") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      const id = re[1];
      // Admins may re-analyse across archives (bulk re-enrichment); members only their current one.
      const doc = await getDocument(env, caller.admin ? null : space.id, id);
      if (!doc) return json({ error: "not found" }, 404);
      const docSpace = doc.space_id === space.id ? space : await getSpaceById(env, doc.space_id);
      if (!docSpace) return json({ error: "not found" }, 404);

      // The original comes back from the owner's Drive. If that is impossible
      // (grant lapsed, file gone) the stored OCR text still allows a text-only run.
      let bytes: ArrayBuffer | null = null;
      let mimeType = doc.mime_type ?? "application/octet-stream";
      if (doc.drive_file_id) {
        try {
          const owner = await spaceOwner(env, docSpace);
          if (owner?.google_refresh_token_enc) {
            const dl = await downloadFile(await userAccessToken(env, owner), doc.drive_file_id);
            if (dl) { bytes = dl.bytes; mimeType = dl.mimeType; }
          }
        } catch (err) {
          console.error(`[${rid}] reanalyze: could not fetch original:`, err);
        }
      }
      if (!bytes && !doc.ocr_text) return json({ error: "nothing to analyse: no file and no OCR text" }, 409);
      const lang = requestLang(request);
      const from = decodeURIComponent(request.headers.get("X-From") ?? "").trim().slice(0, 120) || null;
      try {
        const out = await interpret(env, {
          id, spaceId: doc.space_id, userId: caller.user?.id ?? (await ensureLocalUser(env)), bytes, mimeType,
          ocrText: doc.ocr_text, lang, from, trigger: "reanalyze", started: Date.now(), rid,
        });
        return json({ id, cost: out.cost, with_image: out.withImage, document: await getDocument(env, null, id), expense: await getExpense(env, id) });
      } catch (err) {
        const stage = err instanceof InterpretError ? err.stage : "extraction";
        return json({ error: "re-analysis failed", stage, request_id: rid }, 502);
      }
    }

    if (path === "/api/issuers") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      return json({ issuers: await listIssuers(env, space.id) });
    }

    if (path === "/api/spending") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "") ? url.searchParams.get("month")! : new Date().toISOString().slice(0, 7);
      return json(await spendingSummary(env, space.id, month));
    }

    if (path === "/api/expense-items") {
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const { space } = await callerContext(env, caller);
      const month = url.searchParams.get("month") ?? undefined;
      if (month && !/^\d{4}-\d{2}$/.test(month)) return json({ error: "month must be YYYY-MM" }, 400);
      const category = url.searchParams.get("category") ?? undefined;
      if (category && !(ITEM_CATEGORIES as readonly string[]).includes(category)) return json({ error: "unknown category", allowed: ITEM_CATEGORIES }, 400);
      return json({ items: await listExpenseItems(env, space.id, { month, category, query: url.searchParams.get("q")?.slice(0, 100) || undefined }) });
    }

    if (path === "/api/admin/stale") {
      if (!caller.admin) return json({ error: "forbidden" }, 403);
      if (!hasDatabase(env)) return json({ error: "database not configured" }, 503);
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
      return json({ current_version: EXTRACTION_VERSION, documents: await listStale(env, null, limit) });
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

class InterpretError extends Error {
  stage: "ocr" | "extraction" | "index" | "filing";
  constructor(stage: "ocr" | "extraction" | "index" | "filing", cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.stage = stage;
  }
}

const ocrSummary = (r: OcrResult) => ({ provider: r.provider, pages: r.pageCount, confidence: r.confidence, chars: r.text.length, text: r.text });

/**
 * The read-and-understand half of the pipeline, shared by ingest and
 * re-analysis: OCR (unless the text is already stored) → Claude → apply to the
 * row → optional filing step → ledger. Every attempt is ledgered, success or
 * not, because OCR was paid for either way.
 */
async function interpret(
  env: Env,
  p: {
    id: string; spaceId: string; userId: string;
    bytes: ArrayBuffer | null; mimeType: string; ocrText: string | null;
    lang: Lang; from: string | null; trigger: "ingest" | "reanalyze"; started: number; rid: string;
    finish?: (x: Extraction) => Promise<Filed>;
  },
): Promise<{ extraction: Extraction; cost: Cost; ocr: ReturnType<typeof ocrSummary> | null; filed: Filed | null; withImage: boolean }> {
  let stage: "ocr" | "extraction" | "index" | "filing" = "ocr";
  let ocrPages = 0;
  const isImage = p.mimeType.startsWith("image/");
  const withImage = Boolean(p.bytes && isImage && p.bytes.byteLength <= MAX_IMAGE_FOR_EXTRACTION);
  try {
    let result: OcrResult | null = null;
    let text = p.ocrText;
    if (!text) {
      if (!p.bytes) throw new Error("no bytes to OCR");
      result = await ocr(env, p.bytes, p.mimeType);
      ocrPages = result.pageCount;
      text = result.text;
      await setDocumentOcr(env, p.id, result);
    }

    stage = "extraction";
    const image = withImage ? { data: arrayBufferToBase64(p.bytes!), mediaType: p.mimeType } : null;
    const { extraction, usage, model } = await extract(env, text, image, p.lang, { from: p.from });
    const cost = estimateCost(model, { pages: ocrPages, ...usage });

    stage = "index";
    await applyExtraction(env, p.id, p.spaceId, extraction, model, { lang: p.lang, cost, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, p.trigger, withImage);

    let filed: Filed | null = null;
    if (p.finish) {
      stage = "filing";
      try {
        filed = await p.finish(extraction);
        await updateDocumentFiling(env, p.id, { driveFileId: filed.fileId, filename: filed.filename, status: "complete", error: null });
      } catch (err) {
        // The file is in Drive under its provisional name; only the rename failed.
        console.error(`[${p.rid}] rename after extraction failed:`, err);
      }
    }

    await recordScanCost(env, {
      userId: p.userId, spaceId: p.spaceId, documentId: p.id, status: "complete", stage: null, lang: p.lang,
      mimeType: p.mimeType, bytes: p.bytes?.byteLength ?? 0, ocrPages, model,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
      ocrUsd: cost.ocr_usd, llmUsd: cost.llm_usd, totalUsd: cost.total_usd,
      pricingAsOf: cost.pricing_as_of, durationMs: Date.now() - p.started, kind: p.trigger,
    });
    return { extraction, cost, ocr: result ? ocrSummary(result) : null, filed, withImage };
  } catch (err) {
    // Upstream error bodies can carry project identifiers and quota details. Log; do not echo.
    console.error(`[${p.rid}] ${p.trigger} failed at ${stage}:`, err);
    try {
      if (p.trigger === "ingest") await markDocumentFailed(env, p.id, `${stage}: ${err instanceof Error ? err.message : String(err)}`);
      const c = estimateCost(EXTRACTION_MODEL, { pages: ocrPages, inputTokens: 0, outputTokens: 0 });
      await recordScanCost(env, {
        userId: p.userId, spaceId: p.spaceId, documentId: p.id, status: "failed", stage, lang: p.lang,
        mimeType: p.mimeType, bytes: p.bytes?.byteLength ?? 0, ocrPages, model: null,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        ocrUsd: c.ocr_usd, llmUsd: 0, totalUsd: c.ocr_usd, pricingAsOf: c.pricing_as_of,
        durationMs: Date.now() - p.started, kind: p.trigger,
      });
    } catch (ledgerErr) {
      console.error(`[${p.rid}] ledger write failed:`, ledgerErr);
    }
    throw new InterpretError(stage, err);
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
