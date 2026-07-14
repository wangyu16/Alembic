"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  serializeStudyGuide,
  parseStudyGuide,
  type License,
} from "@alembic/package-contract";
import {
  adaptBlocksInto,
  adaptGivenBlocksInto,
  adaptAssetInto,
  computeSourceHash,
  forkPackage,
  loadStudyGuide,
  saveStudyGuide,
  detectUpstreamUpdates,
  applyUpstreamUpdate,
  loadAdaptationProvenance,
  chapterStudyGuidePath,
  DEFAULT_STUDY_GUIDE_PATH,
  AdaptationNotAllowedError,
  ADAPTATIONS_PROVENANCE_PATH,
  type UpstreamUpdate,
  type PullUpdateMode,
} from "@alembic/package-ops";
import { fetchPublicRepoFile } from "@alembic/github-bridge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { SupabaseDocumentRegistryStore } from "@/lib/document-registry-store";
import { fetchDocBytes } from "@/lib/doc-content";
import { registerAdaptedFile } from "@/lib/register";
import { supabaseEventLogger } from "@/lib/events";
import { syncFilesToGitHub } from "@/lib/github";
import { recordChange } from "@/lib/changes";
import {
  sendSuggestion,
  listIncomingSuggestions,
  getSuggestion,
  setSuggestionStatus,
} from "@/lib/suggestions";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface ForkResult {
  ok: boolean;
  packageId?: string;
  error?: string;
}

/**
 * Whole-package fork (G4): create a NEW package from one of the educator's own
 * packages — cloned public content with re-minted block ids, `adaptedFrom`
 * lineage, and a fresh private partition. The "Adapted from another project"
 * new-course entry point. (Cross-owner fork from a published source reads the
 * public repo tree; same shape, different read — a follow-up.)
 */
export async function forkOwnPackageAction(
  sourcePackageId: string,
  title?: string,
): Promise<ForkResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const record = await store.getPackage(sourcePackageId);
    if (!record) return { ok: false, error: "Source package not found." };
    const publicFiles = (await store.listFiles(sourcePackageId)).filter(
      (f) => f.repo === "public",
    );

    const forked = forkPackage({
      source: { packageId: sourcePackageId, manifest: record.manifest, publicFiles },
      target: { ownerId: user.id, title: title?.trim() || undefined, license: record.manifest.license },
      attribution: `${record.manifest.title} (adapted within Alembic)`,
    });

    await store.createPackage(
      {
        packageId: forked.packageId,
        ownerId: user.id,
        title: forked.manifest.title,
        manifest: forked.manifest,
        storage: "sandbox",
      },
      forked.files,
    );

    await supabaseEventLogger(supabase).log({
      type: "adaptation.completed",
      userId: user.id,
      packageId: forked.packageId,
      detail: { mode: "fork", source: sourcePackageId, blocks: forked.lineage.length },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath("/workspace");
    return { ok: true, packageId: forked.packageId };
  } catch (e) {
    if (e instanceof AdaptationNotAllowedError) return { ok: false, error: e.reason };
    return { ok: false, error: "Couldn't create the adapted package. Please try again." };
  }
}

export interface AdaptSource {
  id: string;
  title: string;
  license: License;
}

/** The user's OTHER packages, offered as adaptation sources. */
export async function listAdaptSourcesAction(packageId: string): Promise<AdaptSource[]> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("packages")
    .select("id, title, manifest")
    .neq("id", packageId)
    .order("created_at", { ascending: false });
  return (
    (data as { id: string; title: string; manifest: { license?: License } }[] | null) ?? []
  ).map((p) => ({ id: p.id, title: p.title, license: p.manifest?.license ?? "CC-BY-4.0" }));
}

export interface AdaptResult {
  ok: boolean;
  adapted?: number;
  error?: string;
}

/**
 * Adapt the source package's first chapter into the current package's active
 * chapter: license-gated, with new ids + recorded lineage + attribution. The
 * adapted sections are appended (the educator can then edit/curate them).
 */
export async function adaptChapterAction(
  packageId: string,
  sourcePackageId: string,
  targetPath: string,
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const target = await store.getPackage(packageId);
    const sourceRec = await store.getPackage(sourcePackageId);
    if (!target || !sourceRec) return { ok: false, error: "Package not found." };

    const res = await adaptBlocksInto(store, {
      source: { packageId: sourcePackageId }, // source default chapter, all blocks
      target: { packageId, path: targetPath, license: target.manifest.license },
      attribution: {
        packageId: sourcePackageId,
        title: sourceRec.title,
        license: sourceRec.manifest.license,
        attribution: `Adapted from "${sourceRec.title}"`,
        adaptedAt: new Date().toISOString(),
      },
    });
    if (res.newBlockIds.length === 0) return { ok: false, error: "The source has no sections to adapt." };

    // Sync the updated target chapter + the provenance record to GitHub.
    const doc = await loadStudyGuide(store, packageId, targetPath);
    const provFile = (await store.listFiles(packageId)).find(
      (f) => f.repo === "public" && f.path === ADAPTATIONS_PROVENANCE_PATH,
    );
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [
        { path: targetPath, content: serializeStudyGuide(doc.preamble, doc.blocks) },
        ...(provFile ? [{ path: ADAPTATIONS_PROVENANCE_PATH, content: provFile.content }] : []),
      ],
      `Adapt sections from "${sourceRec.title}" (Alembic)`,
    );
    await supabaseEventLogger(supabase).log({
      type: "adaptation.completed",
      userId: user.id,
      packageId,
      detail: { sourcePackageId, blocks: res.newBlockIds.length },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, adapted: res.newBlockIds.length };
  } catch (e) {
    if (e instanceof AdaptationNotAllowedError) return { ok: false, error: e.reason };
    return { ok: false, error: "Couldn't adapt that content. Please try again." };
  }
}

export interface PortalAdaptSource {
  packageId: string;
  title: string;
  license: License;
  publicRepoUrl: string;
  siteUrl: string;
}

/** M31 — portal-registered packages (other educators') offered as adapt sources. */
export async function listPortalAdaptSourcesAction(
  packageId: string,
): Promise<PortalAdaptSource[]> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("portal_registrations")
    .select("package_id, title, license, public_repo_url, site_url")
    .neq("package_id", packageId)
    .order("registered_at", { ascending: false });
  return (
    (data as
      | { package_id: string; title: string; license: License; public_repo_url: string; site_url: string }[]
      | null) ?? []
  ).map((r) => ({
    packageId: r.package_id,
    title: r.title,
    license: r.license,
    publicRepoUrl: r.public_repo_url,
    siteUrl: r.site_url,
  }));
}

/** Parse `owner/repo` from a GitHub repo URL. */
function repoCoordsFromUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/**
 * M31.1 — adapt a stranger's PUBLIC, portal-registered package into the current
 * chapter. Reads the source's content from its public GitHub repo (no RLS bypass,
 * no token — the content is genuinely public), then writes via the shared
 * `adaptGivenBlocksInto` primitive (license-gated, new ids, recorded lineage +
 * attribution). Adapts the source's first chapter.
 */
export async function adaptFromPortalAction(
  packageId: string,
  sourcePackageId: string,
  targetPath: string,
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const target = await store.getPackage(packageId);
    if (!target) return { ok: false, error: "Package not found." };

    // The source must be portal-registered (= public + consented to discovery).
    const { data: reg } = await supabase
      .from("portal_registrations")
      .select("title, license, public_repo_url, site_url")
      .eq("package_id", sourcePackageId)
      .maybeSingle();
    if (!reg) return { ok: false, error: "That package isn't listed in the portal." };
    const r = reg as { title: string; license: License; public_repo_url: string; site_url: string };
    const coords = repoCoordsFromUrl(r.public_repo_url);
    if (!coords) return { ok: false, error: "Couldn't resolve the source repository." };

    // Read the source's first chapter from its public repo (tokenless).
    const manifestRaw = await fetchPublicRepoFile(coords, "alembic.json");
    let sourcePath = DEFAULT_STUDY_GUIDE_PATH;
    if (manifestRaw) {
      try {
        const m = JSON.parse(manifestRaw) as { chapters?: { slug: string }[] };
        if (m.chapters?.length) sourcePath = chapterStudyGuidePath(m.chapters[0]!.slug);
      } catch { /* fall back to the default chapter path */ }
    }
    const md = await fetchPublicRepoFile(coords, sourcePath);
    if (md == null) return { ok: false, error: "Couldn't read the source content." };
    const parsed = parseStudyGuide(md);
    const blocks = parsed.blocks
      .filter((b) => b.id)
      .map((b) => ({ sourceBlockId: b.id!, title: b.title, body: b.body }));
    if (blocks.length === 0) return { ok: false, error: "The source has no sections to adapt." };

    const res = await adaptGivenBlocksInto(store, {
      target: { packageId, path: targetPath, license: target.manifest.license },
      source: {
        packageId: sourcePackageId,
        title: r.title,
        license: r.license,
        attribution: `Adapted from "${r.title}"`,
        url: r.site_url,
        adaptedAt: new Date().toISOString(),
      },
      sourcePath,
      blocks,
    });

    const doc = await loadStudyGuide(store, packageId, targetPath);
    const provFile = (await store.listFiles(packageId)).find(
      (f) => f.repo === "public" && f.path === ADAPTATIONS_PROVENANCE_PATH,
    );
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [
        { path: targetPath, content: serializeStudyGuide(doc.preamble, doc.blocks) },
        ...(provFile ? [{ path: ADAPTATIONS_PROVENANCE_PATH, content: provFile.content }] : []),
      ],
      `Adapt sections from "${r.title}" (Alembic)`,
    );
    await supabaseEventLogger(supabase).log({
      type: "adaptation.completed",
      userId: user.id,
      packageId,
      detail: { sourcePackageId, blocks: res.newBlockIds.length, crossOwner: true },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, adapted: res.newBlockIds.length };
  } catch (e) {
    if (e instanceof AdaptationNotAllowedError) return { ok: false, error: e.reason };
    return { ok: false, error: "Couldn't adapt from the portal. Please try again." };
  }
}

/** Extract a docId from a permalink URL or a bare `doc-…` id. */
function parseDocId(input: string): string | null {
  const m = input.trim().match(/doc-[a-z0-9]+/i);
  return m ? m[0].toLowerCase() : null;
}

interface SourceDocRow {
  doc_id: string;
  package_id: string;
  repo: "public" | "private";
  path: string;
  kind: string;
  permalink_class: "document" | "object";
  discoverable: boolean;
  tombstoned: boolean;
}

export interface AdaptElementResult {
  ok: boolean;
  /** Permalink of the copy in THIS package (its own docId). */
  permalink?: string;
  path?: string;
  /** True when the element was already present (no duplicate written). */
  already?: boolean;
  error?: string;
}

/**
 * P4 — adapt one shared OBJECT (a structure/plot/figure) into this package by
 * its permalink. Byte-for-byte copy under `materials/adapted/`, license-gated
 * (`canAdapt`), registered with `adaptedFrom` lineage pointing at the source
 * docId; the copy gets its OWN permalink (content identity is per-package).
 *
 * The source must be a PUBLIC object that is either shared ("share this") or one
 * the educator owns. Documents (final views) are never adapted this way — they
 * are cited/opened, not inserted. Cross-owner reads go through the service
 * client (the object is public); the write is the owner's own package.
 */
export async function adaptElementAction(
  packageId: string,
  sourcePermalink: string,
): Promise<AdaptElementResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);

  const docId = parseDocId(sourcePermalink);
  if (!docId) return { ok: false, error: "That doesn't look like a shareable link." };

  try {
    const target = await store.getPackage(packageId);
    if (!target) return { ok: false, error: "Package not found." };

    // Read the source doc — service client for cross-owner public reads,
    // falling back to the session (owners can always read their own).
    const db = createServiceClient() ?? supabase;
    const { data } = await db
      .from("documents")
      .select("doc_id, package_id, repo, path, kind, permalink_class, discoverable, tombstoned")
      .eq("doc_id", docId)
      .maybeSingle();
    const doc = data as SourceDocRow | null;
    if (!doc || doc.tombstoned) return { ok: false, error: "That element isn't available." };
    if (doc.package_id === packageId) {
      return { ok: false, error: "That element is already in this package." };
    }
    if (doc.repo !== "public" || doc.permalink_class !== "object") {
      return {
        ok: false,
        error: "Only shared objects (structures, plots, figures) can be added this way.",
      };
    }
    // Must be shared, or a package the educator owns (getPackage is RLS-scoped).
    if (!doc.discoverable && !(await store.getPackage(doc.package_id))) {
      return { ok: false, error: "That element isn't shared." };
    }

    // Source license from the source package manifest (gates `canAdapt`).
    const { data: srcPkg } = await db
      .from("packages")
      .select("manifest")
      .eq("id", doc.package_id)
      .maybeSingle();
    const sourceLicense = (srcPkg?.manifest as { license?: License } | null)?.license;
    if (!sourceLicense) return { ok: false, error: "Couldn't read the source's license." };

    // A carrier is a self-contained HTML doc (text); decode the bytes as UTF-8.
    const carrier = (await fetchDocBytes(db, doc))?.toString("utf8") ?? null;
    if (carrier == null) return { ok: false, error: "Couldn't read that element." };

    // Already have this exact object here? Return its permalink, don't duplicate.
    const registry = new SupabaseDocumentRegistryStore(supabase);
    const dup = await registry.getByContentHash(packageId, computeSourceHash(carrier));
    if (dup) {
      return { ok: true, already: true, path: dup.path, permalink: `/d/${dup.docId}` };
    }

    const existingPaths = (await store.listFiles(packageId))
      .filter((f) => f.repo === "public")
      .map((f) => f.path);

    const res = await adaptAssetInto(store, {
      target: { packageId, license: target.manifest.license },
      source: { license: sourceLicense, carrier, path: doc.path },
      existingPaths,
    });

    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: res.path, content: carrier }],
      `Adapt shared ${res.kind} (Alembic)`,
    );
    const newDocId = await registerAdaptedFile(supabase, packageId, {
      repo: "public",
      path: res.path,
      content: carrier,
      adaptedFrom: doc.doc_id,
      author: user.id,
    });

    await supabaseEventLogger(supabase).log({
      type: "adaptation.completed",
      userId: user.id,
      packageId,
      detail: { mode: "element", sourceDocId: doc.doc_id, sourcePackageId: doc.package_id, kind: res.kind },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, path: res.path, permalink: newDocId ? `/d/${newDocId}` : undefined };
  } catch (e) {
    if (e instanceof AdaptationNotAllowedError) return { ok: false, error: e.reason };
    return { ok: false, error: "Couldn't add that element. Please try again." };
  }
}

export interface AdaptedBlock {
  targetBlockId: string;
  title: string;
}

/** M28 — adapted blocks in this chapter that have an upstream source to suggest back to. */
export async function listAdaptedBlocksAction(
  packageId: string,
  path: string,
): Promise<AdaptedBlock[]> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const lineage = await loadAdaptationProvenance(store, packageId);
    if (lineage.length === 0) return [];
    const bySource = new Map(lineage.map((r) => [r.targetBlockId, r]));
    const doc = await loadStudyGuide(store, packageId, path);
    return doc.blocks
      .filter((b) => b.id && bySource.has(b.id) && bySource.get(b.id)!.sourcePath)
      .map((b) => ({ targetBlockId: b.id!, title: b.title }));
  } catch {
    return [];
  }
}

/**
 * M28 — suggest the adapter's improved version of an adapted block BACK to the
 * upstream source author. Platform-mediated (goal.md): records a Tier-3
 * `suggest-back` change ON the upstream package's review queue; the author
 * accepts/rejects it there. Optional GitHub-PR materialization is a follow-up.
 */
export async function suggestBackAction(
  packageId: string,
  targetBlockId: string,
  note: string,
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const lineage = await loadAdaptationProvenance(store, packageId);
    const ref = lineage.find((r) => r.targetBlockId === targetBlockId);
    if (!ref || !ref.sourcePath) return { ok: false, error: "No upstream source recorded for that section." };

    // The adapter's current (improved) version of the block.
    const files = await store.listFiles(packageId);
    const here = await store.getPackage(packageId);
    let suggested: { title: string; body: string } | null = null;
    for (const f of files) {
      if (f.repo !== "public" || !f.path.startsWith("study-guide/")) continue;
      const doc = await loadStudyGuide(store, packageId, f.path);
      const b = doc.blocks.find((x) => x.id === targetBlockId);
      if (b) { suggested = { title: b.title, body: b.body }; break; }
    }
    if (!suggested) return { ok: false, error: "That section no longer exists." };

    // Same-owner vs cross-owner: getPackage returns null for a package the user
    // doesn't own (RLS), which routes us to the cross-owner suggestions inbox.
    const upstream = await store.getPackage(ref.sourcePackageId);
    if (upstream) {
      // Same-owner: queue a Tier-3 suggest-back on the upstream's review queue (M28).
      await recordChange(supabase, {
        packageId: ref.sourcePackageId,
        userId: user.id,
        tier: 3,
        kind: "suggest-back",
        summary: `Suggested edit to "${suggested.title}"${here ? ` from "${here.title}"` : ""}`,
        detail: {
          path: ref.sourcePath,
          suggestBlockId: ref.sourceBlockId,
          suggestedTitle: suggested.title,
          suggestedBody: suggested.body,
          fromPackageId: packageId,
          note,
        },
        status: "pending",
      });
    } else {
      // Cross-owner (M31.2): send to the upstream owner's suggestions inbox. RLS
      // gates on the target being portal-registered (consent) + sender identity.
      const sent = await sendSuggestion(supabase, {
        targetPackageId: ref.sourcePackageId,
        fromPackageId: packageId,
        fromUserId: user.id,
        chapterPath: ref.sourcePath,
        sourceBlockId: ref.sourceBlockId,
        suggestedTitle: suggested.title,
        suggestedBody: suggested.body,
        note,
      });
      if (!sent) {
        return { ok: false, error: "Couldn't send — the source package may not be accepting suggestions." };
      }
    }
    await supabaseEventLogger(supabase).log({
      type: "suggestion.sent",
      userId: user.id,
      packageId,
      detail: { toPackageId: ref.sourcePackageId, crossOwner: !upstream },
      occurredAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't send the suggestion. Please try again." };
  }
}

/** M31.2 — pending cross-owner suggestions in this package's inbox (owner-only via RLS). */
export async function listIncomingSuggestionsAction(
  packageId: string,
): Promise<{ id: number; title: string; body: string; note: string }[]> {
  const { supabase } = await requireUser();
  try {
    const rows = await listIncomingSuggestions(supabase, packageId);
    return rows.map((s) => ({
      id: s.id,
      title: s.suggested_title ?? "(untitled)",
      body: s.suggested_body,
      note: s.note,
    }));
  } catch {
    return [];
  }
}

/**
 * M31.2 — the upstream owner resolves an incoming suggestion: "accept" applies
 * the suggested title/body to the addressed block (via saveStudyGuide, synced),
 * "reject" discards it. RLS ensures only the owner can resolve.
 */
export async function resolveSuggestionAction(
  packageId: string,
  suggestionId: number,
  mode: "accept" | "reject",
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const s = await getSuggestion(supabase, suggestionId);
    if (!s || s.target_package_id !== packageId || s.status !== "pending") {
      return { ok: false, error: "That suggestion is no longer available." };
    }
    if (mode === "reject") {
      await setSuggestionStatus(supabase, suggestionId, "rejected");
      revalidatePath(`/workspace/${packageId}`);
      return { ok: true };
    }
    // accept: apply the suggested content to the addressed block.
    const doc = await loadStudyGuide(store, packageId, s.chapter_path);
    const block = doc.blocks.find((b) => b.id === s.source_block_id);
    if (!block) {
      await setSuggestionStatus(supabase, suggestionId, "rejected");
      return { ok: false, error: "The targeted section no longer exists; the suggestion was dismissed." };
    }
    if (s.suggested_title) block.title = s.suggested_title;
    block.body = s.suggested_body;
    const { blocks } = await saveStudyGuide(store, packageId, doc);
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: s.chapter_path, content: serializeStudyGuide(doc.preamble, blocks) }],
      "Accept suggested edit (Alembic)",
    );
    await setSuggestionStatus(supabase, suggestionId, "accepted");
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't resolve the suggestion. Please try again." };
  }
}

/** M27 — list adapted blocks whose upstream source has changed. */
export async function listUpstreamUpdatesAction(
  packageId: string,
  targetPath: string,
): Promise<UpstreamUpdate[]> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    return await detectUpstreamUpdates(store, packageId, targetPath);
  } catch {
    return [];
  }
}

/**
 * M27 — resolve one upstream update: "take" the upstream content or "keep" your
 * own (recorded divergence). Syncs the changed chapter + the provenance record.
 */
export async function applyUpstreamUpdateAction(
  packageId: string,
  targetPath: string,
  targetBlockId: string,
  mode: PullUpdateMode,
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const res = await applyUpstreamUpdate(store, packageId, targetPath, targetBlockId, mode);
    if (!res.applied) return { ok: false, error: "That update is no longer available." };

    const provFile = (await store.listFiles(packageId)).find(
      (f) => f.repo === "public" && f.path === ADAPTATIONS_PROVENANCE_PATH,
    );
    const changes = [
      ...(res.content ? [{ path: targetPath, content: res.content }] : []),
      ...(provFile ? [{ path: ADAPTATIONS_PROVENANCE_PATH, content: provFile.content }] : []),
    ];
    await syncFilesToGitHub(
      supabase, store, user.id, packageId, changes,
      mode === "take" ? "Take upstream update (Alembic)" : "Keep local version (Alembic)",
    );
    await supabaseEventLogger(supabase).log({
      type: "upstream.update.applied",
      userId: user.id,
      packageId,
      detail: { mode, targetBlockId },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't apply that update. Please try again." };
  }
}
