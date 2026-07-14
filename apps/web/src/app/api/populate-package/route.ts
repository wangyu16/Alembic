import type { NextRequest } from "next/server";
import { unzipSync } from "fflate";
import {
  isPristinePackage,
  planPackagePopulation,
  type ImportFile,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { isBinaryPath } from "@/lib/collection-upload";
import {
  mirrorManifestToSandbox,
  syncFilesToGitHub,
  syncPrivateFilesToGitHub,
} from "@/lib/github";
import { syncPackageRegistry } from "@/lib/register";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Archive size cap — a package tree is small; this bounds the unzip cost. */
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

/**
 * Populate a PUBLISHED, EMPTY package from an uploaded `.zip` ("Case A"). Upload
 * never creates a package: the target must already be published to GitHub and
 * still hold only its as-created placeholders. Because it is GitHub-backed, every
 * valid file — text AND images/PDFs — is committed to the paired repos (images as
 * real blobs), so nothing is left behind. The placeholders the upload doesn't
 * itself provide are removed. Replacing a package that already has content is a
 * separate, future feature (refused here).
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, error: "Sign in to upload a package." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("package");
  const packageId = form?.get("packageId");
  if (typeof packageId !== "string" || !packageId) {
    return Response.json({ ok: false, error: "Missing the target course." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "Attach a .zip package to upload." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_ZIP_BYTES) {
    return Response.json(
      { ok: false, error: "That archive is empty or too large (max 50 MB)." },
      { status: 400 },
    );
  }

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record || record.ownerId !== user.id) {
    return Response.json({ ok: false, error: "We couldn't find that course." }, { status: 404 });
  }

  // Guard 1: the target must be published to GitHub (so binaries can be committed).
  const publicRepo = record.manifest.publicRepo;
  const privateRepo = record.manifest.privateRepo;
  if (record.storage !== "github" || !publicRepo || !privateRepo) {
    return Response.json(
      { ok: false, error: "Publish this course to GitHub first, then upload your package into it." },
      { status: 409 },
    );
  }

  // Guard 2: the target must still be empty (only its as-created placeholders).
  const existingFiles = await store.listFiles(packageId);
  if (!isPristinePackage(existingFiles)) {
    return Response.json(
      {
        ok: false,
        error:
          "This course already has content. Uploading to replace an existing course isn't available yet.",
      },
      { status: 409 },
    );
  }

  // Unzip; strip a single common top-level folder so alembic.json lands at root.
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return Response.json({ ok: false, error: "That file isn't a readable .zip archive." }, { status: 400 });
  }
  const rawPaths = Object.keys(entries).filter((p) => {
    const path = p.replace(/\\/g, "/");
    return !path.endsWith("/") && entries[p].length > 0 && !path.split("/").includes("..");
  });
  const normalized = rawPaths.map((p) => p.replace(/\\/g, "/"));
  const tops = new Set(normalized.map((p) => p.split("/")[0]));
  const alreadyRooted = normalized.includes("alembic.json");
  const rootPrefix = tops.size === 1 && !alreadyRooted ? `${[...tops][0]}/` : "";
  const uploaded: ImportFile[] = rawPaths.map((raw) => {
    const path = raw.replace(/\\/g, "/").slice(rootPrefix && raw.startsWith(rootPrefix) ? rootPrefix.length : 0);
    const isBinary = isBinaryPath(path);
    const data = entries[raw];
    const content = isBinary ? Buffer.from(data).toString("base64") : Buffer.from(data).toString("utf8");
    return { path, content, isBinary };
  });

  // Plan the population (validate + build the per-repo change sets).
  const plan = planPackagePopulation({
    target: { packageId, publicRepo, privateRepo },
    existingFiles,
    uploaded,
  });
  if (!plan.ok) {
    return Response.json({ ok: false, issues: plan.issues }, { status: 422 });
  }

  // Update the DB projection first (mirrors the single-file replace path), then
  // commit to GitHub (the source of truth). Reconcile/rebuild reconcile from the
  // repos if a later step fails, so repos remain authoritative.
  const tagged = [
    ...plan.publicChanges.map((c) => ({ repo: "public" as const, c })),
    ...plan.privateChanges.map((c) => ({ repo: "private" as const, c })),
  ];
  const puts = tagged
    .filter(({ c }) => c.content !== null)
    .map(({ repo, c }) => ({ repo, path: c.path, content: c.content as string }));
  const dels = tagged
    .filter(({ c }) => c.content === null)
    .map(({ repo, c }) => ({ repo, path: c.path }));
  await store.putFiles(packageId, puts);
  if (dels.length > 0) await store.deleteFiles(packageId, dels);

  // Commit to the paired repos (images committed as blobs via the encoding flag).
  await syncFilesToGitHub(
    supabase,
    store,
    user.id,
    packageId,
    plan.publicChanges,
    "Upload package contents (Alembic)",
  );
  if (plan.privateChanges.length > 0) {
    await syncPrivateFilesToGitHub(
      supabase,
      store,
      user.id,
      packageId,
      plan.privateChanges,
      "Upload package contents (Alembic)",
    );
  }

  // Adopt the uploaded manifest metadata (title/chapters/license/…) on the record.
  await supabase.from("packages").update({ manifest: plan.manifest }).eq("id", packageId);
  await mirrorManifestToSandbox(store, packageId, plan.manifest);

  // Re-project the registry from the now-populated repos.
  await syncPackageRegistry(supabase, packageId, "uploaded");

  return Response.json({
    ok: true,
    packageId,
    filesCommitted: plan.publicChanges.length + plan.privateChanges.length,
    imagesCommitted: plan.binaryPaths.length,
  });
}
