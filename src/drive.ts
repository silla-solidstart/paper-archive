import type { Env } from "./types.ts";
import type { UserRow } from "./db.ts";
import { updateUserDriveFolder } from "./db.ts";
import { UpstreamError, withRetry } from "./retry.ts";

/**
 * The user's Google Drive is the permanent store. We hold a file id, never
 * the bytes. With drive.file we can only see what we created, so the root
 * folder id is persisted and children are found by listing under it.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
export const ROOT_FOLDER_NAME = "Paper Archive";

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  // Blob bodies can be re-sent; a stream could not. Everything here is a Blob or string.
  return withRetry("drive", async () => {
    const res = await fetch(url, { ...init, headers });
    if (!res.ok && res.status !== 404) throw new UpstreamError("drive", res.status, await res.text());
    return res;
  });
}

/** Moves a file to the user's Drive trash. Missing files are treated as done. */
export async function trashFile(token: string, id: string): Promise<void> {
  await driveFetch(token, `${API}/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

export async function createFolder(token: string, name: string, parentId?: string): Promise<string> {
  const res = await driveFetch(token, `${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return ((await res.json()) as { id: string }).id;
}

export async function findChildFolder(token: string, parentId: string, name: string): Promise<string | null> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name = '${escaped}' and mimeType = '${FOLDER}' and trashed = false`;
  const res = await driveFetch(token, `${API}/files?fields=files(id)&pageSize=1&q=${encodeURIComponent(q)}`);
  const body = (await res.json()) as { files?: Array<{ id: string }> };
  return body.files?.[0]?.id ?? null;
}

export async function folderExists(token: string, id: string): Promise<boolean> {
  const res = await driveFetch(token, `${API}/files/${id}?fields=id,trashed`);
  if (res.status === 404) return false;
  return !((await res.json()) as { trashed?: boolean }).trashed;
}

/** The user's root archive folder, recreated if they deleted it. */
export async function ensureRootFolder(env: Env, user: UserRow, token: string): Promise<string> {
  if (user.drive_folder_id && (await folderExists(token, user.drive_folder_id))) {
    return user.drive_folder_id;
  }
  const id = await createFolder(token, ROOT_FOLDER_NAME);
  await updateUserDriveFolder(env, user.id, id);
  return id;
}

export async function ensureFolderPath(token: string, rootId: string, parts: string[]): Promise<string> {
  let parent = rootId;
  for (const name of parts) {
    parent = (await findChildFolder(token, parent, name)) ?? (await createFolder(token, name, parent));
  }
  return parent;
}

export interface UploadedFile {
  id: string;
  name: string;
  webViewLink: string;
}

export async function uploadFile(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<UploadedFile> {
  const boundary = "pa-" + crypto.randomUUID();
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const CRLF = "\r\n";
  const body = new Blob([
    `--${boundary}${CRLF}Content-Type: application/json; charset=UTF-8${CRLF}${CRLF}${metadata}${CRLF}`,
    `--${boundary}${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`,
    bytes,
    `${CRLF}--${boundary}--`,
  ]);
  const res = await driveFetch(token, `${UPLOAD}?uploadType=multipart&fields=id,name,webViewLink`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()) as UploadedFile;
}

/** The bytes of a file we created. Used by re-analysis; the Worker keeps no copy. */
export async function downloadFile(token: string, id: string): Promise<{ bytes: ArrayBuffer; mimeType: string } | null> {
  const res = await driveFetch(token, `${API}/files/${id}?alt=media`);
  if (res.status === 404) return null;
  return { bytes: await res.arrayBuffer(), mimeType: (res.headers.get("Content-Type") ?? "application/octet-stream").split(";")[0] };
}

/** Rename and, when the month folder differs, move. Filed first, named once we know what it is. */
export async function renameFile(token: string, id: string, name: string, move?: { from: string; to: string }): Promise<void> {
  const params = move && move.from !== move.to ? `?addParents=${move.to}&removeParents=${move.from}` : "";
  await driveFetch(token, `${API}/files/${id}${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}
