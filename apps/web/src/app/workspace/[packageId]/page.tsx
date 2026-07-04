import { redirect } from "next/navigation";

/**
 * The classic editor is retired (2026-07 workspace framework): the shell at
 * ./edit is the editor. This route survives only so old links keep working.
 */
export default async function PackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  redirect(`/workspace/${packageId}/edit`);
}
