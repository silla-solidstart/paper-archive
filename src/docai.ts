import type { Env } from "./types";
import { getAccessToken } from "./google-auth";

/**
 * Document AI is the canonical OCR layer: it answers "what text is actually on
 * this page?". The LLM never does OCR. See CLAUDE.md.
 */

export interface OcrResult {
  text: string;
  pageCount: number;
  provider: string;
  /** Mean detected-language confidence across pages, when Document AI reports it. */
  confidence: number | null;
}

function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function ocr(
  env: Env,
  content: ArrayBuffer,
  mimeType: string,
): Promise<OcrResult> {
  const token = await getAccessToken(env);

  // Pin the processor version explicitly rather than calling the processor's
  // default. Google seeds new processors with the 2020 base model, which
  // misreads 令和 as 今和 — a wrong era means a wrong year on a payment
  // deadline. See docs/setup.md for the measured comparison.
  const url =
    `https://${env.GCP_DOCAI_LOCATION}-documentai.googleapis.com/v1` +
    `/projects/${env.GCP_PROJECT_NUMBER}` +
    `/locations/${env.GCP_DOCAI_LOCATION}` +
    `/processors/${env.GCP_DOCAI_PROCESSOR_ID}` +
    `/processorVersions/${env.GCP_DOCAI_PROCESSOR_VERSION}:process`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      skipHumanReview: true,
      rawDocument: { mimeType, content: toBase64(content) },
    }),
  });

  if (!res.ok) {
    throw new Error(`Document AI failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as {
    document?: {
      text?: string;
      pages?: Array<{ detectedLanguages?: Array<{ confidence?: number }> }>;
    };
  };

  const doc = body.document ?? {};
  const pages = doc.pages ?? [];

  const confidences = pages
    .map((p) => p.detectedLanguages?.[0]?.confidence)
    .filter((c): c is number => typeof c === "number");

  return {
    text: doc.text ?? "",
    pageCount: pages.length,
    provider: `documentai/${env.GCP_DOCAI_PROCESSOR_VERSION}`,
    confidence: confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null,
  };
}
