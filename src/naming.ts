import type { Extraction } from "./extract.ts";
import { extensionFor } from "./storage.ts";

/**
 * The human-facing filename: YYYY-MM-DD_issuer_title.ext. Shown in the app
 * and used as the download name; the R2 key is the document id, never this.
 */
export function buildFilename(x: Pick<Extraction, "document_date" | "issuer" | "title">, mimeType: string, fallbackDate: string): string {
  const date = x.document_date ?? fallbackDate;
  // Strip path separators, Windows-reserved punctuation, and control characters.
  const clean = (s: string | null): string =>
    (s ?? "")
      .replace(/[\\/:*?"<>|]|\p{Cc}/gu, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const stem = [date, clean(x.issuer), clean(x.title)].filter(Boolean).join("_");
  return `${stem || "document"}.${extensionFor(mimeType)}`;
}
