import { neon } from "@neondatabase/serverless";
import type { Env } from "./types.ts";
import type { UserRow } from "./db.ts";

/**
 * Spaces: the unit of sharing. See migrations/0004_spaces.sql for the model.
 * Files for a space live in the OWNER's Google Drive; members upload through
 * the owner's grant. The owner is therefore the one whose Drive access matters.
 */

export interface SpaceRow {
  id: string;
  name: string;
  owner_user_id: string;
  drive_folder_id: string | null;
  created_at: string;
  updated_at: string;
}
export type Role = "owner" | "member";
export interface SpaceWithRole extends SpaceRow {
  role: Role;
  member_count: number;
  owner_name: string | null;
}

const INVITE_TTL_DAYS = 7;
const INVITE_MAX_USES = 10;
export const MAX_NAME = 60;

function sql(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return neon(env.DATABASE_URL);
}

export function cleanName(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= MAX_NAME ? s : null;
}

export async function listSpaces(env: Env, userId: string): Promise<SpaceWithRole[]> {
  const rows = await sql(env).query(
    `SELECT s.*, m.role,
            (SELECT count(*)::int FROM space_members mm WHERE mm.space_id = s.id) AS member_count,
            coalesce(o.name, o.email) AS owner_name
     FROM spaces s JOIN space_members m ON m.space_id = s.id JOIN users o ON o.id = s.owner_user_id
     WHERE m.user_id = $1
     ORDER BY (m.role = 'owner') DESC, s.created_at`,
    [userId],
  );
  return rows as SpaceWithRole[];
}

export async function getSpaceForUser(env: Env, spaceId: string, userId: string): Promise<SpaceWithRole | null> {
  const rows = await sql(env).query(
    `SELECT s.*, m.role,
            (SELECT count(*)::int FROM space_members mm WHERE mm.space_id = s.id) AS member_count,
            coalesce(o.name, o.email) AS owner_name
     FROM spaces s JOIN space_members m ON m.space_id = s.id JOIN users o ON o.id = s.owner_user_id
     WHERE s.id = $1 AND m.user_id = $2`,
    [spaceId, userId],
  );
  return (rows as SpaceWithRole[])[0] ?? null;
}

export async function getSpaceById(env: Env, spaceId: string): Promise<SpaceRow | null> {
  const rows = await sql(env).query(`SELECT * FROM spaces WHERE id = $1`, [spaceId]);
  return (rows as SpaceRow[])[0] ?? null;
}

export async function createSpace(env: Env, userId: string, name: string): Promise<SpaceRow> {
  const q = sql(env);
  const [space] = (await q.query(
    `INSERT INTO spaces (name, owner_user_id) VALUES ($1, $2) RETURNING *`,
    [name, userId],
  )) as SpaceRow[];
  await q.query(`INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'owner')`, [space.id, userId]);
  await q.query(`UPDATE users SET current_space_id = $2 WHERE id = $1`, [userId, space.id]);
  return space;
}

/** The caller's current space, creating a personal one if they somehow have none. */
export async function currentSpace(env: Env, user: { id: string; name: string | null; email: string; current_space_id?: string | null }): Promise<SpaceWithRole> {
  if (user.current_space_id) {
    const s = await getSpaceForUser(env, user.current_space_id, user.id);
    if (s) return s;
  }
  const mine = await listSpaces(env, user.id);
  if (mine.length) {
    await sql(env).query(`UPDATE users SET current_space_id = $2 WHERE id = $1`, [user.id, mine[0].id]);
    return mine[0];
  }
  const created = await createSpace(env, user.id, user.name?.trim() || user.email.split("@")[0]);
  return { ...created, role: "owner", member_count: 1, owner_name: user.name?.trim() || user.email };
}

export async function setCurrentSpace(env: Env, userId: string, spaceId: string): Promise<boolean> {
  const s = await getSpaceForUser(env, spaceId, userId);
  if (!s) return false;
  await sql(env).query(`UPDATE users SET current_space_id = $2 WHERE id = $1`, [userId, spaceId]);
  return true;
}

export async function renameSpace(env: Env, spaceId: string, userId: string, name: string): Promise<boolean> {
  const rows = await sql(env).query(
    `UPDATE spaces SET name = $3 WHERE id = $1 AND owner_user_id = $2 RETURNING id`,
    [spaceId, userId, name],
  );
  return (rows as unknown[]).length > 0;
}

export async function updateSpaceDriveFolder(env: Env, spaceId: string, folderId: string): Promise<void> {
  await sql(env).query(`UPDATE spaces SET drive_folder_id = $2 WHERE id = $1`, [spaceId, folderId]);
}

export interface MemberRow {
  user_id: string;
  email: string;
  name: string | null;
  role: Role;
  joined_at: string;
}

export async function listMembers(env: Env, spaceId: string): Promise<MemberRow[]> {
  const rows = await sql(env).query(
    `SELECT m.user_id, u.email, u.name, m.role, m.joined_at
     FROM space_members m JOIN users u ON u.id = m.user_id
     WHERE m.space_id = $1 ORDER BY (m.role = 'owner') DESC, m.joined_at`,
    [spaceId],
  );
  return rows as MemberRow[];
}

/** Owner removes anyone but themselves; a member may remove only themselves. */
export async function removeMember(
  env: Env,
  spaceId: string,
  actorId: string,
  targetId: string,
): Promise<"ok" | "forbidden" | "not_found"> {
  const actor = await getSpaceForUser(env, spaceId, actorId);
  if (!actor) return "not_found";
  const isOwner = actor.role === "owner";
  if (targetId === actor.owner_user_id) return "forbidden"; // the owner cannot be removed; transfer first
  if (!isOwner && targetId !== actorId) return "forbidden";
  const rows = await sql(env).query(
    `DELETE FROM space_members WHERE space_id = $1 AND user_id = $2 RETURNING user_id`,
    [spaceId, targetId],
  );
  if (!(rows as unknown[]).length) return "not_found";
  // If they were looking at this space, point them somewhere they can still see.
  await sql(env).query(
    `UPDATE users SET current_space_id = (
       SELECT space_id FROM space_members WHERE user_id = $1 ORDER BY joined_at LIMIT 1
     ) WHERE id = $1 AND current_space_id = $2`,
    [targetId, spaceId],
  );
  return "ok";
}

export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createInvite(env: Env, spaceId: string, byUserId: string): Promise<{ token: string; expires_at: string }> {
  const token = newInviteToken();
  const rows = await sql(env).query(
    `INSERT INTO space_invites (space_id, token, created_by, expires_at, max_uses)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5) RETURNING token, expires_at`,
    [spaceId, token, byUserId, String(INVITE_TTL_DAYS), INVITE_MAX_USES],
  );
  return (rows as Array<{ token: string; expires_at: string }>)[0];
}

export async function listInvites(env: Env, spaceId: string): Promise<Array<{ id: string; token: string; expires_at: string; uses: number; max_uses: number; created_by_name: string | null }>> {
  const rows = await sql(env).query(
    `SELECT i.id, i.token, i.expires_at, i.uses, i.max_uses, u.name AS created_by_name
     FROM space_invites i LEFT JOIN users u ON u.id = i.created_by
     WHERE i.space_id = $1 AND i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses
     ORDER BY i.created_at DESC`,
    [spaceId],
  );
  return rows as Array<{ id: string; token: string; expires_at: string; uses: number; max_uses: number; created_by_name: string | null }>;
}

export async function revokeInvite(env: Env, spaceId: string, inviteId: string): Promise<boolean> {
  const rows = await sql(env).query(
    `UPDATE space_invites SET revoked_at = now() WHERE id = $2 AND space_id = $1 AND revoked_at IS NULL RETURNING id`,
    [spaceId, inviteId],
  );
  return (rows as unknown[]).length > 0;
}

export interface InvitePreview {
  space_id: string;
  space_name: string;
  inviter_name: string | null;
  expires_at: string;
  valid: boolean;
}

export async function getInvite(env: Env, token: string): Promise<InvitePreview | null> {
  const rows = await sql(env).query(
    `SELECT i.space_id, s.name AS space_name, u.name AS inviter_name, i.expires_at,
            (i.revoked_at IS NULL AND i.expires_at > now() AND i.uses < i.max_uses) AS valid
     FROM space_invites i JOIN spaces s ON s.id = i.space_id LEFT JOIN users u ON u.id = i.created_by
     WHERE i.token = $1`,
    [token],
  );
  return (rows as InvitePreview[])[0] ?? null;
}

export async function acceptInvite(env: Env, token: string, userId: string): Promise<{ space: SpaceWithRole } | { error: "invalid" | "expired" }> {
  const q = sql(env);
  const inv = await getInvite(env, token);
  if (!inv) return { error: "invalid" };
  if (!inv.valid) return { error: "expired" };
  const existing = await getSpaceForUser(env, inv.space_id, userId);
  if (!existing) {
    await q.query(
      `INSERT INTO space_members (space_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
      [inv.space_id, userId],
    );
    await q.query(`UPDATE space_invites SET uses = uses + 1 WHERE token = $1`, [token]);
  }
  await q.query(`UPDATE users SET current_space_id = $2 WHERE id = $1`, [userId, inv.space_id]);
  const space = (await getSpaceForUser(env, inv.space_id, userId))!;
  return { space };
}

/** Resolves the user whose Drive receives this space's files. */
export async function spaceOwner(env: Env, space: SpaceRow): Promise<UserRow | null> {
  const rows = await sql(env).query(`SELECT * FROM users WHERE id = $1`, [space.owner_user_id]);
  return (rows as UserRow[])[0] ?? null;
}
