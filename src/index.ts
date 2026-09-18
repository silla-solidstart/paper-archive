import type { Env } from "./types";
import { ocr } from "./docai";
import { extract } from "./extract";
import { requireBearer } from "./auth";

/**
 * Paper Archive — Cloudflare Worker.
 *
 * Implemented: OCR → extraction, behind a bearer token. Testable with the
 * service account key, an Anthropic key, and APP_BEARER_TOKEN.
 *
 * Not yet: Google sign-in, Drive filing, Postgres indexing, MCP. Those need
 * the OAuth client, which is console-only. See docs/setup.md.
 */

// Document AI online processing accepts up to ~20 MB. Anything larger fails
// there anyway; refuse it before buffering it.
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// What both Document AI and Claude accept. HEIC — the iPhone Photos default —
// is deliberately absent: neither upstream takes it. The client must convert.
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

// Claude's per-image limit is ~5 MB. The client is expected to downscale
// photos before upload; this is the backstop that turns a confusing upstream
// error into a clear one — after OCR has already been paid for, so it is a
// backstop, not the plan.
const MAX_IMAGE_FOR_EXTRACTION = 5 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Unauthenticated: liveness only. Nothing about configuration leaks here.
    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname.startsWith("/api/")) {
      const denied = await requireBearer(request, env);
      if (denied) return denied;
    }

    // Authenticated: which credentials are present, for setup debugging.
    if (url.pathname === "/api/status") {
      return json({
        processor: `${env.GCP_DOCAI_LOCATION}/${env.GCP_DOCAI_PROCESSOR_ID}`,
        version: env.GCP_DOCAI_PROCESSOR_VERSION,
        configured: {
          service_account: Boolean(env.GCP_SA_CLIENT_EMAIL && env.GCP_SA_PRIVATE_KEY),
          anthropic: Boolean(env.ANTHROPIC_API_KEY),
          database: Boolean(env.DATABASE_URL),
          oauth: Boolean(env.GOOGLE_OAUTH_CLIENT_ID),
        },
      });
    }

    // POST a document (image or PDF) as the raw body. Returns OCR + extraction.
    // Stateless for now: nothing is filed or stored.
    if (url.pathname === "/api/process" && request.method === "POST") {
      const mimeType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
      if (!ACCEPTED_TYPES.has(mimeType)) {
        return json(
          { error: `unsupported type "${mimeType}"`, accepted: [...ACCEPTED_TYPES] },
          415,
        );
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
          {
            error: "image too large for extraction; downscale before upload",
            max_bytes: MAX_IMAGE_FOR_EXTRACTION,
          },
          413,
        );
      }

      try {
        const result = await ocr(env, bytes, mimeType);

        // PDFs are not sent as images — Document AI has already flattened them.
        const image = isImage ? { data: arrayBufferToBase64(bytes), mediaType: mimeType } : null;

        const extraction = await extract(env, result.text, image);

        return json({
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
        console.error("process failed:", err);
        const stage = err instanceof Error && /Document AI/.test(err.message) ? "ocr" : "extraction";
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
