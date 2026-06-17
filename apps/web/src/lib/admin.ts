import "server-only";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import { createServiceClient } from "./supabase/service";

/**
 * Gate an admin surface: require a signed-in user whose profile is `is_admin`
 * (M35). Returns the user + a service-role client for the cross-user reads
 * admin/research ops need. Redirects non-admins to the home page. The is_admin
 * check uses the USER's client (they can read their own profile), so the
 * service client is only handed out after the gate passes.
 */
export async function requireAdmin(): Promise<{
  userId: string;
  service: ReturnType<typeof createServiceClient>;
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!(data as { is_admin?: boolean } | null)?.is_admin) redirect("/");
  return { userId: user.id, service: createServiceClient() };
}

/**
 * A stable, one-way participant pseudonymizer for the de-identified export.
 * Salted SHA-256 — same id → same code, irreversible without the salt. The salt
 * is RESEARCH_EXPORT_SALT (falls back to the service key so it's never the empty
 * string in a configured deployment).
 */
export function exportPseudonymizer(): (id: string) => string {
  const salt = process.env["RESEARCH_EXPORT_SALT"] ?? process.env["SUPABASE_SECRET_KEY"] ?? "alembic";
  return (id: string) =>
    "P-" + createHash("sha256").update(`${salt}:${id}`).digest("hex").slice(0, 12);
}
