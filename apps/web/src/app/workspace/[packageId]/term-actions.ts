"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  collectionItemPath,
  listTerms,
  planCarryOver,
  type TermInfo,
} from "@alembic/package-ops";
import {
  currentSpaceDir,
  isValidTermId,
  parseManifest,
} from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { mirrorManifestToSandbox, syncFilesToGitHub } from "@/lib/github";
import { syncPackageRegistry } from "@/lib/register";

/**
 * Term operations for the Current collection (CF5.3), the thin server layer
 * over the durable pointer model (package-ops `listTerms`/`planCarryOver`,
 * contract `currentSpaceDir`). Every write goes through the manifest mirror +
 * the one public-repo commit path — the Current space is public (two-repo
 * invariant), so nothing here ever touches the private repo.
 */

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

type Result = { ok: boolean; error?: string };

/** Every term in the package (current first). Drives the term switcher. */
export async function listTermsAction(packageId: string): Promise<TermInfo[]> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  return listTerms(store, packageId);
}

/** Persist the manifest's term pointer + label, mirror it, and commit
 *  alembic.json. Shared by every action that moves the pointer. */
async function writePointer(
  packageId: string,
  currentTerm: string,
  currentTermLabel: string | undefined,
): Promise<Result> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "Package not found." };

  const manifest = parseManifest({
    ...record.manifest,
    currentTerm,
    currentTermLabel: currentTermLabel?.trim() || undefined,
  });
  await supabase.from("packages").update({ manifest }).eq("id", packageId);
  await mirrorManifestToSandbox(store, packageId, manifest);
  await syncFilesToGitHub(
    supabase,
    store,
    user.id,
    packageId,
    [{ path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" }],
    "Set current term (Alembic)",
  );
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true };
}

/**
 * Start a NEW term: validate the id, optionally carry over the previous term's
 * non-announcement files, then point the manifest at it. The id is immutable
 * (it names the folder); the label is the free-text display name.
 */
export async function startTermAction(
  packageId: string,
  input: { termId: string; label: string; carryOver: boolean },
): Promise<Result> {
  const termId = input.termId.trim().toLowerCase();
  if (!isValidTermId(termId)) {
    return {
      ok: false,
      error: "Use lowercase letters, numbers, and single hyphens (e.g. 2026-fall).",
    };
  }
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "Package not found." };

  const terms = await listTerms(store, packageId);
  if (terms.some((t) => t.id === termId)) {
    return { ok: false, error: "A term with that id already exists." };
  }

  // Carry over from the term the manifest currently points at (if any).
  const fromTerm = record.manifest.currentTerm;
  if (input.carryOver && fromTerm && fromTerm !== termId) {
    const plan = await planCarryOver(store, packageId, fromTerm, termId);
    if (plan.length > 0) {
      const files = plan.map((e) => ({
        repo: "public" as const,
        path: e.toPath,
        content: e.content,
      }));
      await store.putFiles(packageId, files);
      await syncFilesToGitHub(
        supabase,
        store,
        user.id,
        packageId,
        files.map((f) => ({ path: f.path, content: f.content })),
        `Carry materials into ${termId} (Alembic)`,
      );
      await syncPackageRegistry(supabase, packageId);
    }
  }

  return writePointer(packageId, termId, input.label);
}

/**
 * Point the active term at an EXISTING one (reactivate an archived term). No
 * file moves — just the pointer + a fresh label.
 */
export async function activateTermAction(
  packageId: string,
  input: { termId: string; label?: string },
): Promise<Result> {
  const termId = input.termId.trim().toLowerCase();
  if (!isValidTermId(termId)) return { ok: false, error: "That term id isn't valid." };
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const terms = await listTerms(store, packageId);
  if (!terms.some((t) => t.id === termId)) {
    return { ok: false, error: "That term doesn't exist yet." };
  }
  return writePointer(packageId, termId, input.label ?? termId);
}

/** Rename the active term's display label (never moves a file). */
export async function setTermLabelAction(
  packageId: string,
  label: string,
): Promise<Result> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "Package not found." };
  if (!record.manifest.currentTerm) {
    return { ok: false, error: "Start a term first." };
  }
  return writePointer(packageId, record.manifest.currentTerm, label);
}

/**
 * Set the CURRENT term's miscellaneous external links — an instructor-managed
 * list of `{label, url}` shown on the student site, each opening in a new tab.
 * Stored in the manifest (`currentTermLinks`); the URL is validated by the
 * schema (an invalid link is rejected rather than published).
 */
export async function setTermLinksAction(
  packageId: string,
  links: Array<{ label: string; url: string }>,
): Promise<Result> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "Package not found." };
  if (!record.manifest.currentTerm) {
    return { ok: false, error: "Start a term first." };
  }

  const cleaned = links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.label || l.url);
  for (const l of cleaned) {
    if (!l.label || !l.url) {
      return { ok: false, error: "Each link needs both a label and a URL." };
    }
  }

  let manifest;
  try {
    manifest = parseManifest({
      ...record.manifest,
      currentTermLinks: cleaned.length ? cleaned : undefined,
    });
  } catch {
    return { ok: false, error: "One of the links isn't a valid URL (include https://)." };
  }

  await supabase.from("packages").update({ manifest }).eq("id", packageId);
  await mirrorManifestToSandbox(store, packageId, manifest);
  await syncFilesToGitHub(
    supabase,
    store,
    user.id,
    packageId,
    [{ path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" }],
    "Update this-term links (Alembic)",
  );
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true };
}

/** Lowercase-hyphen slug for an announcement filename (never empty). */
function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "note";
}

/**
 * Post a dated announcement to the CURRENT term: a markdown file at
 * `current/<term-id>/announcements/<stamp>-<slug>.md` (title as an H1, body
 * below). Announcements are the newest-first list on the published "This term"
 * area. Only the active term can receive one (you don't post to an archive).
 */
export async function postAnnouncementAction(
  packageId: string,
  input: { termId: string; title: string; body: string },
): Promise<{ ok: boolean; error?: string; path?: string }> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { ok: false, error: "Give the announcement a title." };

  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "Package not found." };
  if (record.manifest.currentTerm !== input.termId) {
    return { ok: false, error: "You can only post to the current term." };
  }
  if (!isValidTermId(input.termId)) return { ok: false, error: "That term id isn't valid." };

  // A sortable, unique-per-second stamp; the date also shows on the card.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const filename = `announcements/${stamp}-${slugify(title)}.md`;
  const spaceDir = currentSpaceDir(input.termId);

  let target: string;
  try {
    target = collectionItemPath(spaceDir, { kind: "course" }, filename);
  } catch {
    return { ok: false, error: "Couldn't build the announcement path." };
  }

  const content = `# ${title}\n\n${body}\n`;
  await store.putFiles(packageId, [{ repo: "public", path: target, content }]);
  await syncFilesToGitHub(
    supabase,
    store,
    user.id,
    packageId,
    [{ path: target, content }],
    "Post announcement (Alembic)",
  );
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: target };
}
