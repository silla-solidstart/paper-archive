import type { Env } from "./types";
import { ocr } from "./docai";
import { extract } from "./extract";

/**
 * Paper Archive — Cloudflare Worker.
 *
 * Implemented: OCR → extraction. That path is testable with only the service
 * account key and an Anthropic key.
 *
 * Not yet implemented: Google sign-in, Drive filing, Postgres indexing, MCP.
 * Those need the OAuth client, which is console-only. See docs/setup.md.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
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
    // Deliberately stateless for now: nothing is filed or stored yet.
    if (url.pathname === "/api/process" && request.method === "POST") {
      const mimeType = request.headers.get("Content-Type") ?? "application/octet-stream";
      const bytes = await request.arrayBuffer();

      if (bytes.byteLength === 0) return json({ error: "empty body" }, 400);

      try {
        const result = await ocr(env, bytes, mimeType);

        // Pass the original image alongside the OCR text. PDFs are not sent as
        // images — Document AI has already flattened them to text.
        const isImage = mimeType.startsWith("image/");
        const image = isImage
          ? { data: arrayBufferToBase64(bytes), mediaType: mimeType }
          : null;

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
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
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
