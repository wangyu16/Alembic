import { NextResponse } from "next/server";
import { renderDocument, renderPlainDocument } from "@alembic/renderer";
import { getRenderTheme } from "@/lib/theme";
import { resolveWebIncludes } from "@/lib/resolve-includes";

/**
 * Server-side markdown preview. Returns a full document the client shows in an
 * isolated iframe, so the preview matches published output exactly and
 * orz-markdown's filesystem/URL plugins never reach the client. `plain: true`
 * renders styleless (minimal base CSS, no document theme) — for plain-text
 * metadata like the course description, where a theme would be noise.
 *
 * Web transclusions (`{{md-include https://host/d/{docId}}}`) are resolved here
 * (server-side, host-allowlisted) so the preview shows included content — the
 * same resolution the publish path applies, so preview matches published output.
 */
export async function POST(request: Request) {
  let source = "";
  let heading: string | undefined;
  let plain = false;
  try {
    const body = (await request.json()) as {
      source?: unknown;
      heading?: unknown;
      plain?: unknown;
    };
    if (typeof body.source === "string") source = body.source;
    if (typeof body.heading === "string") heading = body.heading;
    if (body.plain === true) plain = true;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (source.length > 200_000) {
    return NextResponse.json({ error: "Content too large" }, { status: 413 });
  }
  const resolved = await resolveWebIncludes(source);
  if (plain) {
    return NextResponse.json({ html: renderPlainDocument("Preview", resolved, heading) });
  }
  const theme = await getRenderTheme();
  return NextResponse.json({
    html: renderDocument("Preview", resolved, theme, heading),
  });
}
