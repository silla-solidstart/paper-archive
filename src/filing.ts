import type { Env } from "./types.ts";
import type { UserRow } from "./db.ts";
import type { Extraction } from "./extract.ts";
import { createFolder, ensureFolderPath, ensureRootFolder, folderExists, renameFile, uploadFile } from "./drive.ts";
import { userAccessToken } from "./oauth.ts";
import { updateSpaceDriveFolder, type SpaceRow } from "./spaces.ts";

/**
 * Filing: Paper Archive / <space name> / YYYY / MM / YYYY-MM-DD_issuer_title.ext
 * in the SPACE OWNER's Drive, uploaded with the owner's grant. Folders are for
 * the human browsing Drive. Postgres is the real index.
 *
 * Drive first (hard rule, 2026-09-20): the photo as sent is uploaded
 * byte-for-byte BEFORE OCR runs, under the month it was scanned, with a
 * provisional name. Once extraction succeeds the file is renamed — and moved
 * to the document's own month if that differs. Nothing is ever wrapped or
 * re-encoded; what the phone sent is what Drive holds.
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

export interface Staged extends Filed {
  token: string;
  spaceFolderId: string;
  folderId: string;
  month: string; // YYYY-MM the file currently sits under
}

/** Stage 1: the bytes reach Drive before anything is spent on reading them. */
export async function stageToDrive(
  env: Env,
  owner: UserRow,
  space: SpaceRow,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<Staged> {
  const token = await userAccessToken(env, owner);
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); // 20260920T101530Z
  const filename = `${stamp}.${EXT[mimeType] ?? "bin"}`;
  const [yyyy, mm] = now.toISOString().slice(0, 7).split("-");

  const spaceFolderId = await ensureSpaceFolder(env, owner, space, token);
  const folderId = await ensureFolderPath(token, spaceFolderId, [yyyy, mm]);
  const uploaded = await uploadFile(token, folderId, filename, mimeType, bytes);
  return {
    token, spaceFolderId, folderId, month: `${yyyy}-${mm}`,
    fileId: uploaded.id, filename: uploaded.name, link: uploaded.webViewLink,
    path: `${space.name}/${yyyy}/${mm}/${filename}`,
  };
}

/** Stage 2: once we know what it is, name it — and move it to its own month. */
export async function finishFiling(staged: Staged, space: SpaceRow, mimeType: string, x: Extraction): Promise<Filed> {
  const today = new Date().toISOString().slice(0, 10);
  const filename = buildFilename(x, mimeType, today);
  const month = (x.document_date ?? today).slice(0, 7);
  let folderId = staged.folderId;
  if (month !== staged.month) {
    const [yyyy, mm] = month.split("-");
    folderId = await ensureFolderPath(staged.token, staged.spaceFolderId, [yyyy, mm]);
  }
  await renameFile(staged.token, staged.fileId, filename, { from: staged.folderId, to: folderId });
  const [yyyy, mm] = month.split("-");
  return { fileId: staged.fileId, filename, link: staged.link, path: `${space.name}/${yyyy}/${mm}/${filename}` };
}
