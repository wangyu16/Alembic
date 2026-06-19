import { serializeStudyGuide } from "@alembic/package-contract";
import { listChapters, loadStudyGuide } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { mdHtmlResponse } from "@/lib/export";
import { getRenderTheme } from "@/lib/theme";

export async function GET(
  request: Request,
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

  // Export the requested chapter (?chapter=<slug>), else the first chapter — not
  // a hardcoded default file (which breaks for multi-chapter / renamed packages).
  const requested = new URL(request.url).searchParams.get("chapter");
  const chapters = await listChapters(store, packageId);
  const chapter =
    chapters.find((c) => c.slug === requested) ?? chapters[0] ?? null;

  const doc = await loadStudyGuide(store, packageId, chapter?.path);
  const markdown = serializeStudyGuide(doc.preamble, doc.blocks);
  const { response, sourceHash } = mdHtmlResponse({
    // The chapter title is the document heading; falls back to the package title.
    title: chapter?.title ?? record.title,
    markdown,
    theme: await getRenderTheme(),
  });

  await supabaseEventLogger(supabase).log({
    type: "export.dual-extension",
    userId: user.id,
    packageId,
    detail: {
      kind: "study-guide",
      format: "md.html",
      sourceHash,
      ...(chapter ? { chapter: chapter.slug } : {}),
    },
    occurredAt: new Date().toISOString(),
  });

  return response;
}
