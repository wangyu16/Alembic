"use server";

import { canWritePath, normalizePath, type Role } from "@alembic/package-contract";
import { newElementId } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";

/**
 * Share a figure or a section of a page at a permanent address (element-sharing-v3 §2), or stop sharing it.
 * Anyone who may edit the page; written with the server's connection (members only read).
 */
export async function shareElementAction(packageId: string, page: string, kind: "figure" | "section", target: string, anchor: string | null, title: string): Promise<{ ok: boolean; id?: string; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const { data: roleRaw } = await supabase.rpc("course_role", { p: packageId });
  let pagePath: string; let path: string;
  try { pagePath = normalizePath(page); path = normalizePath(target); } catch { return { ok: false, message: "That can't be shared." }; }
  if (!canWritePath((roleRaw ?? "none") as Role, pagePath)) return { ok: false, message: "Only people who may edit this page share from it." };
  if (kind === "section" && (path !== pagePath || !anchor || !/^blk-[a-z0-9-]{1,60}$/.test(anchor))) return { ok: false, message: "That section can't be shared." };
  const sql = directDb();
  if (!sql) return { ok: false, message: "Sharing isn't available right now." };
  const clean = title.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 200) || path.split("/").pop()!;
  // Already shared: the same address (one active share per element).
  const { rows: existing } = await sql.query<{ id: string }>(
    `select id from public.shared_elements where package_id = $1 and path = $2 and coalesce(anchor, '') = $3 and stopped_at is null`, [packageId, path, anchor ?? ""]);
  if (existing[0]) return { ok: true, id: existing[0].id };
  const id = newElementId();
  await sql.query(`insert into public.shared_elements (id, package_id, path, kind, anchor, page, title, shared_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, packageId, path, kind, kind === "section" ? anchor : null, pagePath, clean, user.id]);
  return { ok: true, id };
}

export async function stopSharingAction(packageId: string, id: string): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const sql = directDb();
  if (!sql || !/^el-[a-z0-9]{12}$/.test(id)) return { ok: false, message: "That can't be changed right now." };
  const { rows } = await sql.query<{ page: string }>(`select page from public.shared_elements where id = $1 and package_id = $2 and stopped_at is null`, [id, packageId]);
  if (!rows[0]) return { ok: true };
  const { data: roleRaw } = await supabase.rpc("course_role", { p: packageId });
  if (!canWritePath((roleRaw ?? "none") as Role, rows[0].page)) return { ok: false, message: "Only people who may edit this page stop sharing from it." };
  await sql.query(`update public.shared_elements set stopped_at = now() where id = $1`, [id]);
  return { ok: true };
}
