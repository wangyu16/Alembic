import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { StagingError, createStagingUploadUrl } from "@/lib/staging";
import {
  MAX_PACKAGE_ZIP_BYTES,
  packageTooLargeMessage,
} from "@alembic/package-ops";

export const dynamic = "force-dynamic";

/**
 * Mint a signed upload URL so the browser can put a big file **straight into the
 * staging bucket**, instead of posting it through a serverless function.
 *
 * This route exists because of a hard platform ceiling: a Vercel Function
 * rejects any request body over ~4.5 MB at the edge, before a single line of our
 * code runs. The old zip upload posted the archive as form data, so every
 * package with images failed with a bare 413 that the client could only report
 * as "that package couldn't be uploaded" — the "sometimes fails, no reason"
 * bug (reports/workspace-issues-2026-08-28.md, F2). The bytes now bypass the
 * function entirely; the function receives only a short JSON reference to them.
 *
 * What it does NOT do: create anything, or trust anything. The caller must be
 * signed in and must own the target course, the object path is minted here (the
 * client never proposes one) and is namespaced by user id, and the bucket's RLS
 * enforces that prefix a second time. See `lib/staging.ts` and
 * `supabase/migrations/0020_staging_bucket.sql`.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json(
      { ok: false, error: "Sign in to upload a package." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    packageId?: unknown;
    filename?: unknown;
    sizeBytes?: unknown;
  } | null;

  const packageId = typeof body?.packageId === "string" ? body.packageId : "";
  const filename = typeof body?.filename === "string" ? body.filename : "package.zip";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : null;

  if (!packageId) {
    return Response.json(
      { ok: false, error: "Missing the target course." },
      { status: 400 },
    );
  }

  // Ownership, not just authentication: a signed-in user may stage a file only
  // against a course that is theirs.
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record || record.ownerId !== user.id) {
    return Response.json(
      { ok: false, error: "We couldn't find that course." },
      { status: 404 },
    );
  }

  // Refuse an over-size file before a single byte moves — the browser knows the
  // size, so saying so now is faster and kinder than failing after the upload.
  if (sizeBytes !== null && sizeBytes > MAX_PACKAGE_ZIP_BYTES) {
    return Response.json(
      { ok: false, error: packageTooLargeMessage(sizeBytes) },
      { status: 413 },
    );
  }
  if (sizeBytes !== null && sizeBytes <= 0) {
    return Response.json(
      { ok: false, error: "That file is empty. Choose the .zip you exported." },
      { status: 400 },
    );
  }

  try {
    const { path, signedUrl, token } = await createStagingUploadUrl(
      supabase,
      user.id,
      filename,
    );
    return Response.json({ ok: true, path, signedUrl, token });
  } catch (err) {
    const message =
      err instanceof StagingError
        ? err.message
        : "We couldn't start that upload. Please try again.";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
