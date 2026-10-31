import { redirect } from "next/navigation";
import { v3Enabled } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The classic editor is retired (2026-07 workspace framework): the shell at
 * ./edit is the editor. This route survives only so old links keep working —
 * and it must forward the query string, or a link like `?chapter=<slug>` loses
 * its selection on the way through (it silently did, until 2026-07-09).
 * The legacy `?cat=` param rides along too; `edit/nav.ts` maps it forward.
 */
export default async function PackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ packageId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { packageId } = await params;
  const sp = await searchParams;
  // v3 courses (where enabled) have their own home.
  if (v3Enabled()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from("packages").select("schema:manifest->schemaVersion").eq("id", packageId).maybeSingle();
    if ((data as { schema?: unknown } | null)?.schema === 3) redirect(`/workspace/${packageId}/course`);
  }

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) qs.set(key, value[0]);
  }
  const query = qs.toString();
  redirect(`/workspace/${packageId}/edit${query ? `?${query}` : ""}`);
}
