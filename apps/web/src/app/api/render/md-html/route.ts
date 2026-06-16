import { NextResponse } from "next/server";
import { buildMdHtml } from "@alembic/renderer";

/**
 * Build a self-contained `.md.html` carrier from Markdown (M17 studio save).
 *
 * Stateless and unauthenticated: the studio is anonymous and stores nothing —
 * this only renders the carrier and returns it so the client can write it to
 * the user's own disk. Rendering runs server-side because orz-markdown's
 * plugins are not browser-safe; nothing is persisted.
 */
export async function POST(request: Request) {
  let markdown = "";
  let title = "Document";
  try {
    const body = (await request.json()) as { markdown?: unknown; title?: unknown };
    if (typeof body.markdown === "string") markdown = body.markdown;
    if (typeof body.title === "string" && body.title.trim()) title = body.title;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (markdown.length > 500_000) {
    return NextResponse.json({ error: "Content too large" }, { status: 413 });
  }
  try {
    return NextResponse.json({ html: buildMdHtml({ title, markdown }) });
  } catch (e) {
    // Never throw an HTML error page — return JSON so the studio can show why.
    return NextResponse.json(
      { error: `Render failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
