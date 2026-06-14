import { NextResponse } from "next/server";
import { renderDocument } from "@alembic/renderer";

/**
 * Server-side markdown preview. Returns a full themed (dark-elegant) document
 * the client shows in an isolated iframe, so the preview matches published
 * output exactly and orz-markdown's filesystem/URL plugins never reach the
 * client. Single render path shared with the site build and `.md.html` export.
 */
export async function POST(request: Request) {
  let source = "";
  try {
    const body = (await request.json()) as { source?: unknown };
    if (typeof body.source === "string") source = body.source;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (source.length > 200_000) {
    return NextResponse.json({ error: "Content too large" }, { status: 413 });
  }
  return NextResponse.json({ html: renderDocument("Preview", source) });
}
