import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";
const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Present (RC.25): the slideshow the member's own page assembled, served back as its own document under a
 * sandbox policy — an opaque origin, so its scripts (the deck's engine, and anything in the course text)
 * can't act as Alembic, while the deck still plays (inline scripts allowed only here). Same-site form
 * posts from a course member only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if ((site && site !== "same-origin") || (origin && origin !== requestOrigin(req))) return new Response("Not allowed.", { status: 403 });
  // A declared, bounded size only (a chunked body has none, audit r4 L-1).
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length)) return new Response("Length required.", { status: 411 });
  if (length > MAX_BYTES) return new Response("Too large.", { status: 413 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in again.", { status: 401 });
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) return new Response("Not found.", { status: 404 });
  const form = await req.formData().catch(() => null);
  const html = form?.get("html");
  if (typeof html !== "string" || !html) return new Response("Bad request.", { status: 400 });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": [
        "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net blob:",
        "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
        "img-src data: blob: https:",
        "media-src data: blob: https:",
        "connect-src https://cdn.jsdelivr.net",
        "frame-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
      ].join("; "),
    },
  });
}
