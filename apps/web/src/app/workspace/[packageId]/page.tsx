import { redirect } from "next/navigation";

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

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) qs.set(key, value[0]);
  }
  const query = qs.toString();
  redirect(`/workspace/${packageId}/edit${query ? `?${query}` : ""}`);
}
