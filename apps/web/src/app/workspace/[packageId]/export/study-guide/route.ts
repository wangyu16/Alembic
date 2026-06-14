import { serializeStudyGuide } from "@alembic/package-contract";
import { loadStudyGuide } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { mdHtmlResponse } from "@/lib/export";

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

  const doc = await loadStudyGuide(store, packageId);
  const markdown = serializeStudyGuide(doc.preamble, doc.blocks);
  const { response, sourceHash } = mdHtmlResponse({
    title: record.title,
    markdown,
  });

  await supabaseEventLogger(supabase).log({
    type: "export.dual-extension",
    userId: user.id,
    packageId,
    detail: { kind: "study-guide", format: "md.html", sourceHash },
    occurredAt: new Date().toISOString(),
  });

  return response;
}
