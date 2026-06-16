import {
  exportCommonCartridge,
  listQuestionItems,
  loadAnswerKey,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { slugForFile } from "@/lib/export";

/**
 * M25 — one-way LMS export. Bundles the package's accepted question items with
 * their answer keys into a Common Cartridge `.imscc` (QTI 1.2 inside a zip) for
 * import into Canvas/Moodle. Owner-authenticated: the export legitimately
 * includes answers because the instructor is importing into their own LMS
 * (25.3 — owner-authorized). Answer keys are read from the private partition;
 * nothing is published to the public repo by this route.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const { packageId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return new Response("Not found", { status: 404 });

  const items = await listQuestionItems(store, packageId);
  const pairs: { item: (typeof items)[number]; key: Awaited<ReturnType<typeof loadAnswerKey>> }[] =
    [];
  for (const item of items) {
    const key = await loadAnswerKey(store, packageId, item.id);
    if (key) pairs.push({ item, key });
  }
  if (pairs.length === 0) {
    return new Response("No questions with answer keys to export yet.", { status: 400 });
  }

  const bytes = exportCommonCartridge({
    title: record.title,
    items: pairs.map((p) => ({ item: p.item, key: p.key! })),
  });

  await supabaseEventLogger(supabase).log({
    type: "export.lms",
    userId: user.id,
    packageId,
    detail: { format: "common-cartridge", items: pairs.length },
    occurredAt: new Date().toISOString(),
  });

  const filename = `${slugForFile(record.title)}.imscc`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
