import { neon } from "@neondatabase/serverless";
import type { Env } from "./types.ts";

/**
 * Invite-only access.
 *
 * Who may sign in = ADMIN_EMAILS (config, bootstrap) ∪ rows in allowed_users.
 * Rows are emails or "@domain". Admins (ADMIN_EMAILS, or rows with role
 * 'admin') manage the table from the in-app admin page. ADMIN_EMAILS is checked
 * before the database so an emptied table cannot lock the operator out.
 */

export type AllowRole = "admin" | "member";

export interface AllowedRow {
  email: string;      // lower-case; "@domain" for a whole domain
  role: AllowRole;
  note: string | null;
  added_by: string | null;
  created_at: string;
}

function sql(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
  return neon(env.DATABASE_URL);
}

export function parseList(raw: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const e of (raw ?? "").split(/[\s,;]+/)) {
    const v = e.trim().toLowerCase();
    if (v && v.includes("@")) out.add(v);
  }
  return out;
}

/** Normalises an entry for storage; null if it is neither an email nor "@domain". */
export function normaliseEntry(raw: unknown): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v.length > 254) return null;
  if (/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return v;
  if (/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return v;
  return null;
}

/** Pure matcher: exact email, or its domain listed as "@domain". */
export function matches(email: string | null | undefined, entries: Iterable<string>): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  const domain = "@" + e.slice(at + 1);
  for (const x of entries) if (x === e || x === domain) return true;
  return false;
}

export function isBootstrapAdmin(env: Env, email: string | null | undefined): boolean {
  return matches(email, parseList(env.ADMIN_EMAILS));
}

export async function accessFor(env: Env, email: string | null | undefined): Promise<{ allowed: boolean; admin: boolean }> {
  if (isBootstrapAdmin(env, email)) return { allowed: true, admin: true };
  if (!email || !env.DATABASE_URL) return { allowed: false, admin: false };
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return { allowed: false, admin: false };
  const rows = (await sql(env).query(
    `SELECT email, role FROM allowed_users WHERE email = $1 OR email = $2`,
    [e, "@" + e.slice(at + 1)],
  )) as Array<{ email: string; role: AllowRole }>;
  if (!rows.length) return { allowed: false, admin: false };
  // An exact-email admin row makes you admin; a domain row never does.
  const admin = rows.some((r) => r.email === e && r.role === "admin");
  return { allowed: true, admin };
}

export async function listAllowed(env: Env): Promise<AllowedRow[]> {
  return (await sql(env).query(
    `SELECT a.email, a.role, a.note, u.email AS added_by, a.created_at
     FROM allowed_users a LEFT JOIN users u ON u.id = a.added_by
     ORDER BY a.created_at`,
    [],
  )) as AllowedRow[];
}

export async function addAllowed(
  env: Env,
  entry: string,
  role: AllowRole,
  note: string | null,
  addedBy: string | null,
): Promise<AllowedRow> {
  const rows = (await sql(env).query(
    `INSERT INTO allowed_users (email, role, note, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, note = COALESCE(EXCLUDED.note, allowed_users.note)
     RETURNING email, role, note, added_by::text, created_at`,
    [entry, role, note, addedBy],
  )) as AllowedRow[];
  return rows[0];
}

export async function removeAllowed(env: Env, entry: string): Promise<boolean> {
  const rows = await sql(env).query(`DELETE FROM allowed_users WHERE email = $1 RETURNING email`, [entry]);
  return (rows as unknown[]).length > 0;
}
