import type { Env } from "./types.ts";
import type { UserRow } from "./db.ts";
import type { Extraction } from "./extract.ts";
import { createFolder, ensureFolderPath, ensureRootFolder, folderExists, uploadFile } from "./drive.ts";
import { userAccessToken } from "./oauth.ts";
import { jpegToPdf } from "./pdf.ts";
import { updateSpaceDriveFolder, type SpaceRow } from "./spaces.ts";

/**
 * Filing: Paper Archive / <space name> / YYYY / MM / YYYY-MM-DD_issuer_title.ext
 * in the SPACE OWNER's Drive, uploaded with the owner's grant. Folders are for
 * the human browsing Drive. Postgres is the real index.
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

/** The space's folder under the owner's root, recreated if the owner deleted it. */
async function ensureSpaceFolder(env: Env, owner: UserRow, space: SpaceRow, token: string): Promise<string> {
  if (space.drive_folder_id && (await folderExists(token, space.drive_folder_id))) return space.drive_folder_id;
  const root = await ensureRootFolder(env, owner, token);
  const id = await createFolder(token, space.name, root);
  await updateSpaceDriveFolder(env, space.id, id);
  return id;
}

export async function fileToDrive(
  env: Env,
  owner: UserRow,
  space: SpaceRow,
  bytes: ArrayBuffer,
  mimeType: string,
  x: Extraction,
): Promise<Filed> {
  const token = await userAccessToken(env, owner);
  const today = new Date().toISOString().slice(0, 10);

  // Photos are filed as single-page PDFs with the JPEG embedded verbatim, so
  // Drive shows a document rather than a picture. PDFs pass through. PNG and
  // WebP would need decoding, so they are uploaded as-is.
  let payload = bytes;
  let uploadType = mimeType;
  if (mimeType === "image/jpeg") {
    payload = jpegToPdf(new Uint8Array(bytes)).buffer as ArrayBuffer;
    uploadType = "application/pdf";
  }

  const filename = buildFilename(x, uploadType, today);
  const [yyyy, mm] = (x.document_date ?? today).split("-");

  const spaceFolder = await ensureSpaceFolder(env, owner, space, token);
  const folder = await ensureFolderPath(token, spaceFolder, [yyyy, mm]);
  const uploaded = await uploadFile(token, folder, filename, uploadType, payload);

  return {
    fileId: uploaded.id,
    filename: uploaded.name,
    link: uploaded.webViewLink,
    path: `${space.name}/${yyyy}/${mm}/${filename}`,
  };
}
