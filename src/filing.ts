import type { Env } from "./types";
import type { UserRow } from "./db";
import type { Extraction } from "./extract";
import { ensureFolderPath, ensureRootFolder, uploadFile } from "./drive";
import { userAccessToken } from "./oauth";

/**
 * Filing: Paper Archive / YYYY / MM / YYYY-MM-DD_issuer_title.ext
 * Folders are for the human browsing Drive. Postgres is the real index.
 */

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function buildFilename(x: Extraction, mimeType: string, fallbackDate: string): string {
  const date = x.document_date ?? fallbackDate;
  // Strip path separators, Windows-reserved punctuation, and control characters.
  const clean = (s: string | null): string =>
    (s ?? "")
      .replace(/[\\/:*?"<>|]|\p{Cc}/gu, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const stem = [date, clean(x.issuer), clean(x.title)].filter(Boolean).join("_");
  return `${stem || "document"}.${EXT[mimeType] ?? "bin"}`;
}

export interface Filed {
  fileId: string;
  filename: string;
  link: string;
  path: string;
}

export async function fileToDrive(
  env: Env,
  user: UserRow,
  bytes: ArrayBuffer,
  mimeType: string,
  x: Extraction,
): Promise<Filed> {
  const token = await userAccessToken(env, user);
  const today = new Date().toISOString().slice(0, 10);
  const filename = buildFilename(x, mimeType, today);
  const [yyyy, mm] = (x.document_date ?? today).split("-");

  const root = await ensureRootFolder(env, user, token);
  const folder = await ensureFolderPath(token, root, [yyyy, mm]);
  const uploaded = await uploadFile(token, folder, filename, mimeType, bytes);

  return {
    fileId: uploaded.id,
    filename: uploaded.name,
    link: uploaded.webViewLink,
    path: `${yyyy}/${mm}/${filename}`,
  };
}
