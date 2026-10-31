"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, type Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { JOB_SIZES, MAX_TASK } from "./sizes";

const id = (p: string) => `${p}-${randomBytes(12).toString("hex").slice(0, 12)}`;
const back = (packageId: string, m?: string) => redirect(`/workspace/${packageId}/assistant${m ? `?m=${encodeURIComponent(m)}` : ""}`);

async function editor(packageId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  return { user, ok: can((role ?? "none") as Role, "agent.talk") };
}

/** Ask the assistant (C4): a waiting job the orchestrator starts; paid by the person who asks, at most the size's hold. */
export async function startAssistantAction(formData: FormData): Promise<void> {
  const packageId = String(formData.get("packageId") ?? "");
  const task = String(formData.get("task") ?? "").trim();
  const size = JOB_SIZES.find((s) => s.id === formData.get("size")) ?? JOB_SIZES[0];
  const { user, ok } = await editor(packageId);
  if (!ok) return back(packageId, "Only the course's editors can ask the assistant.");
  if (!task) return back(packageId, "Say what the assistant should do.");
  if (task.length > MAX_TASK) return back(packageId, `Please keep the request under ${MAX_TASK} characters.`);
  const sql = directDb();
  if (!sql) return back(packageId, "The assistant isn't available here.");
  const bal = await sql.query<{ b: string | null }>(
    `select public.ledger_balance(a.id)::text as b from public.ledger_accounts a where a.kind = 'user' and a.user_id = $1`, [user.id]);
  if (Number(bal.rows[0]?.b ?? 0) < size.hold) return back(packageId, `This needs up to ${size.hold} credits set aside, and you have ${Number(bal.rows[0]?.b ?? 0).toFixed(0)}. Choose a smaller size or add credit.`);
  await sql.query(`insert into public.agent_sessions (id, package_id) values ($1, $2) on conflict (package_id) do nothing`, [id("as"), packageId]);
  try {
    await sql.query(
      `insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits)
       select $1, s.id, $2, $3, 'invoker', $4, 'starting', $5 from public.agent_sessions s where s.package_id = $2`,
      [id("aj"), packageId, user.id, task, size.hold]);
  } catch {
    return back(packageId, "The assistant is already working on this course. Wait for it to finish, or stop it.");
  }
  revalidatePath(`/workspace/${packageId}/assistant`);
  back(packageId);
}

/** Stop the course's current job: a waiting one never starts; a running one is stopped and its credit settled. */
export async function stopAssistantAction(formData: FormData): Promise<void> {
  const packageId = String(formData.get("packageId") ?? "");
  const { ok } = await editor(packageId);
  if (!ok) return back(packageId);
  const sql = directDb();
  if (!sql) return back(packageId);
  await sql.query(`update public.agent_jobs set status = 'cancelled', ended_at = now(), summary = 'Stopped before it started.' where package_id = $1 and status = 'starting'`, [packageId]);
  // A running job: refused from now on by every endpoint; the orchestrator ends its process and settles its credit.
  await sql.query(`update public.agent_jobs set status = 'cancelled', summary = 'Stopped by a person.' where package_id = $1 and status = 'running'`, [packageId]);
  revalidatePath(`/workspace/${packageId}/assistant`);
  back(packageId, "Stopped. What it already handed in stays; nothing else will be changed.");
}
