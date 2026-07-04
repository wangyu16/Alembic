import { loadArtifactContent } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { mdHtmlResponse } from "@/lib/export";
import { getRenderTheme } from "@/lib/theme";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packageId: string; artifactId: string }> },
) {
  const { packageId, artifactId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const store = new SupabaseSandboxStore(supabase);
  const loaded = await loadArtifactContent(store, packageId, artifactId);
  if (!loaded) return new Response("Not found", { status: 404 });

  const { response, sourceHash } = await mdHtmlResponse({
    title: loaded.record.title,
    markdown: loaded.content,
    theme: await getRenderTheme(),
  });

  await supabaseEventLogger(supabase).log({
    type: "export.dual-extension",
    userId: user.id,
    packageId,
    detail: { kind: "worksheet", artifactId, format: "md.html", sourceHash },
    occurredAt: new Date().toISOString(),
  });

  return response;
}
