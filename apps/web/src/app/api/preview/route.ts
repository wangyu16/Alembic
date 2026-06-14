import { NextResponse } from "next/server";
import { renderMarkdown } from "@alembic/renderer";

/**
 * Server-side markdown preview. Rendering runs here (not in the browser) so
 * there is a single render path shared with the eventual site build, and so
 * orz-markdown's filesystem/URL-touching plugins never reach the client.
 */
export async function POST(request: Request) {
  let source = "";
  try {
    const body = (await request.json()) as { source?: unknown };
    if (typeof body.source === "string") source = body.source;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  // Cap input to keep a single preview request cheap.
  if (source.length > 200_000) {
    return NextResponse.json({ error: "Content too large" }, { status: 413 });
  }
  return NextResponse.json({ html: renderMarkdown(source) });
}
