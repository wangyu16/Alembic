import type { NextRequest } from "next/server";
import { unzipSync } from "fflate";
import { importPackageFromFiles, type ImportFile } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { isBinaryPath } from "@/lib/collection-upload";
import { syncPackageRegistry } from "@/lib/register";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Archive size cap — a package tree is small; this bounds the unzip cost. */
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

/**
 * Import a whole package the educator authored offline (as a `.zip`), creating a
 * new TRIAL package. The archive is unzipped server-side; each file's repo is
 * derived from its path and the whole tree is validated (two-repo invariant,
 * manifest, required files) before anything is persisted — see
 * `importPackageFromFiles`. Sign-in required. Binary files are reported back
 * (a trial is text-only) so the educator can add them after publishing.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ ok: false, error: "Sign in to import a package." }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("package");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "Attach a .zip package to import." }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_ZIP_BYTES) {
    return Response.json(
      { ok: false, error: "That archive is empty or too large (max 50 MB)." },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return Response.json({ ok: false, error: "That file isn't a readable .zip archive." }, { status: 400 });
  }

  // Real file paths (skip directory entries and any traversal segment).
  const rawPaths = Object.keys(entries).filter((p) => {
    const path = p.replace(/\\/g, "/");
    return !path.endsWith("/") && entries[p].length > 0 && !path.split("/").includes("..");
  });

  // Many authors zip the containing FOLDER, nesting everything under one root
  // (`my-course/alembic.json`). If there is a single common top-level segment and
  // the manifest isn't already at the root, strip that one segment so
  // `alembic.json` lands at the tree root where the importer expects it.
  const normalized = rawPaths.map((p) => p.replace(/\\/g, "/"));
  const tops = new Set(normalized.map((p) => p.split("/")[0]));
  const alreadyRooted = normalized.includes("alembic.json");
  const rootPrefix = tops.size === 1 && !alreadyRooted ? `${[...tops][0]}/` : "";

  const files: ImportFile[] = rawPaths.map((raw) => {
    const path = raw.replace(/\\/g, "/").slice(rootPrefix && raw.startsWith(rootPrefix) ? rootPrefix.length : 0);
    const isBinary = isBinaryPath(path);
    const data = entries[raw];
    const content = isBinary
      ? Buffer.from(data).toString("base64")
      : Buffer.from(data).toString("utf8");
    return { path, content, isBinary };
  });

  const store = new SupabaseSandboxStore(supabase);
  const result = await importPackageFromFiles(store, { ownerId: user.id, files });
  if (!result.ok) {
    return Response.json({ ok: false, issues: result.issues }, { status: 422 });
  }

  // Register the imported files (origin "uploaded").
  await syncPackageRegistry(supabase, result.packageId, "uploaded");

  return Response.json({
    ok: true,
    packageId: result.packageId,
    skippedBinaries: result.skippedBinaries,
  });
}
