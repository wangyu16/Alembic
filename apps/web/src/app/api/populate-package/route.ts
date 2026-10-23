import type { NextRequest } from "next/server";
import { unzipSync } from "fflate";
import {
  MAX_PACKAGE_ZIP_BYTES,
  chunkChanges,
  diffPopulatePlan,
  emptyCourseChanges,
  packageTooLargeMessage,
  pendingPopulateChanges,
  planPackagePopulation,
  rewriteRelativeRefs,
  writeThrough,
  type ExistingPackageFile,
  type ImportFile,
  type PopulateDiff,
  type RepoPlannedChange,
} from "@alembic/package-ops";
import {
  assertPublicMarkdownReferences,
  livePermalink,
} from "@alembic/package-contract";
import { appBaseUrl } from "@/lib/app-url";
import { SupabaseDocumentRegistryStore } from "@/lib/document-registry-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { isBinaryPath } from "@/lib/collection-upload";
import { committerFor } from "@/lib/committer";
import {
  StagingError,
  assertOwnedStagingPath,
  deleteStagingObject,
  downloadStagingObject,
} from "@/lib/staging";
import { syncPackageRegistry } from "@/lib/register";
import { rewriteMarkdownRefs } from "@/lib/rewrite-md-refs";
import { commitInRounds } from "@/lib/populate-rounds";
import { recordedPrivateRepo, recordedPublicRepo } from "@/lib/recorded-repo";
import { flushDiscovery } from "@/lib/discovery-flush";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stop starting new commits this far into the run and hand the rest to the next
 * one. `maxDuration` is 60 s; a chunk of ~40 files takes a couple of seconds,
 * and the tail (registry rebuild, staging cleanup) needs headroom of its own.
 */
const SOFT_DEADLINE_MS = 42_000;

/** Files per commit / bytes per commit. Bounds one round-trip, not the upload. */
const CHUNK = { maxFiles: 40, maxBytes: 4 * 1024 * 1024 };

/**
 * Fill a published course from a package `.zip` the educator built offline.
 *
 * ## Shape of this route (rewritten 2026-08-28, Wave 3)
 *
 * The archive does NOT come through this function any more. The browser uploads
 * it straight to the private staging bucket (`/api/staging-url`) and posts only
 * `{ packageId, stagingPath }` here — which is what lifts the old ~4.5 MB
 * platform body cap that made every zip with images fail with an unexplained
 * error (reports/workspace-issues-2026-08-28.md, F2).
 *
 * Three modes, all against the same freshly computed plan:
 *  - `preview` — say what the upload would add, replace, leave alone and clear
 *    out, plus anything already in the course the package doesn't cover. Writes
 *    nothing. The client turns this into the confirmation the educator approves.
 *  - `apply` — do it, repos first.
 *  - `cancel` — the educator backed out; drop the staged file.
 *
 * ## Ordering (storage-and-write-paths.md §3)
 *
 * Every write goes through `writeThrough`: **commit to GitHub, then project into
 * the store**. The projection is never written first, so an interrupted run can
 * never leave content the repositories don't have — the exact defect that used
 * to poison retries.
 *
 * Assets are committed before the documents that reference them, so the
 * registry can be rebuilt in between and each document's `../assets/…` links can
 * be turned into durable `/d/{docId}` permalinks *before* that document is
 * committed. One commit per document instead of two, and the public-reference
 * guard sees only resolved links.
 *
 * ## Resumability
 *
 * Nothing here is a transaction, and it doesn't need to be. Each run re-plans
 * from the current state and writes only the difference
 * (`pendingPopulateChanges`), so re-uploading the same zip after a failure — or
 * after the function ran out of time — continues where it stopped and skips what
 * already landed. When time runs short the run returns `stage: "partial"` with
 * the staged file still in place and the client immediately posts again.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > SOFT_DEADLINE_MS;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail("Sign in to upload a package.", 401);
  }

  const body = (await req.json().catch(() => null)) as {
    packageId?: unknown;
    stagingPath?: unknown;
    mode?: unknown;
    emptyFirst?: unknown;
  } | null;

  const packageId = typeof body?.packageId === "string" ? body.packageId : "";
  const stagingPath = typeof body?.stagingPath === "string" ? body.stagingPath : "";
  const mode =
    body?.mode === "apply" || body?.mode === "cancel" ? body.mode : "preview";
  const emptyFirst = body?.emptyFirst === true;

  if (!packageId) return fail("Missing the target course.", 400);
  if (!stagingPath) return fail("Attach a .zip package to upload.", 400);

  // NEVER trust a client-supplied path: it is the one input a caller can forge.
  // The guard is segment-aware and rejects traversal outright; the bucket's RLS
  // enforces the same owner prefix again underneath.
  try {
    assertOwnedStagingPath(stagingPath, user.id);
  } catch (err) {
    return fail(
      err instanceof StagingError ? err.message : "That upload isn't available.",
      403,
    );
  }

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record || record.ownerId !== user.id) {
    return fail("We couldn't find that course.", 404);
  }

  if (mode === "cancel") {
    await deleteStagingObject(supabase, stagingPath).catch(() => {});
    return Response.json({ ok: true, stage: "cancelled" });
  }

  // The target must be published: a package holds images, and images can only
  // live in a repository (the trial store is text-only, permanently).
  // The publish-recorded repos (security loop r2, P5.S.3.e).
  const publicRepo = recordedPublicRepo(record);
  const privateRepo = recordedPrivateRepo(record);
  if (record.storage !== "github" || !publicRepo || !privateRepo) {
    return fail(
      "Publish this course to GitHub first, then upload your package into it.",
      409,
    );
  }

  /* ---------------------------------------------------------------- plan --- */

  let zipBytes: Uint8Array;
  try {
    zipBytes = await downloadStagingObject(supabase, stagingPath);
  } catch (err) {
    return fail(
      err instanceof StagingError
        ? err.message
        : "We couldn't read that uploaded file. Please upload it again.",
      409,
    );
  }
  if (zipBytes.length === 0) {
    return fail("That file is empty. Choose the .zip you exported.", 400);
  }
  if (zipBytes.length > MAX_PACKAGE_ZIP_BYTES) {
    return fail(packageTooLargeMessage(zipBytes.length), 413);
  }

  let uploaded: ImportFile[];
  try {
    uploaded = readPackageZip(zipBytes);
  } catch {
    return fail("That file isn't a readable .zip archive.", 400);
  }
  if (uploaded.length === 0) {
    return fail("That .zip has no files in it.", 400);
  }

  const existingFiles: ExistingPackageFile[] = await store.listFiles(packageId);

  const plan = planPackagePopulation({
    target: { packageId, publicRepo, privateRepo },
    existingFiles,
    uploaded,
  });
  if (!plan.ok) {
    return Response.json({ ok: false, issues: plan.issues }, { status: 422 });
  }

  const diff = diffPopulatePlan(plan, existingFiles);

  if (mode === "preview") {
    return Response.json({
      ok: true,
      stage: "preview",
      stagingPath,
      diff: summarize(diff),
      // Advisory, never blocking: e.g. a chapter with no study guide yet.
      warnings: plan.warnings,
    });
  }

  /* --------------------------------------------------------------- apply --- */

  // Content already in the course that this package doesn't cover would be
  // silently mixed into it. Name it and stop, unless the educator has said, in
  // so many words, to empty the course first.
  if (diff.blockers.length > 0 && !emptyFirst) {
    return Response.json(
      {
        ok: false,
        stage: "blocked",
        error:
          "This course already has work in it that isn't part of this package.",
        diff: summarize(diff),
      },
      { status: 409 },
    );
  }

  const resolution = await committerFor(supabase, store, user.id, packageId);
  if (resolution.kind !== "github") {
    // `trial` can't happen (storage === "github" was checked above), and
    // `unavailable` carries its own educator-facing reason.
    return fail(
      resolution.kind === "unavailable"
        ? resolution.reason
        : "This course isn't published yet, so a package can't be uploaded into it.",
      409,
    );
  }
  const committer = resolution.committer;

  const pending = pendingPopulateChanges(plan, existingFiles);
  const skipped = diff.unchanged.length;

  /** Every public file this course will hold once the upload lands. */
  const publicPaths = new Set<string>([
    ...plan.publicChanges.filter((c) => c.content !== null).map((c) => c.path),
    ...existingFiles.filter((f) => f.repo === "public").map((f) => f.path),
  ]);

  // Documents last: their relative asset links are rewritten to permalinks once
  // the assets they point at are committed and registered.
  const isDoc = (c: RepoPlannedChange) =>
    c.content !== null && c.path.toLowerCase().endsWith(".md");
  const firstPass = publicFirst([
    ...(emptyFirst ? emptyCourseChanges(diff) : []),
    ...pending.filter((c) => !isDoc(c)),
  ]);
  const docPass = pending.filter(isDoc);

  let committed = 0;
  const commitChunks = async (
    changes: RepoPlannedChange[],
    summary: string,
  ): Promise<{ done: boolean; remaining: number }> => {
    const chunks = chunkChanges(changes, CHUNK);
    for (let i = 0; i < chunks.length; i += 1) {
      if (outOfTime()) {
        const remaining = chunks.slice(i).reduce((n, c) => n + c.length, 0);
        return { done: false, remaining };
      }
      const chunk = chunks[i]!;
      await writeThrough(store, committer, packageId, {
        changes: chunk.map((c) => ({
          repo: c.repo,
          path: c.path,
          content: c.content,
          encoding: c.encoding,
        })),
        summary,
        // The write path registers every chunk it lands (loop r1b), with the
        // upload's provenance.
        origin: "uploaded",
      });
      committed += chunk.length;
    }
    return { done: true, remaining: 0 };
  };

  try {
    // Carriers and assets can carry references too; screen them with the same
    // guard so a bad link reads as a fixable problem rather than a failed run.
    const firstScreen = screenPublicRefs(firstPass);
    const first = await commitChunks(
      firstScreen.safe,
      "Upload package contents (Alembic)",
    );
    if (!first.done) {
      return partial(committed, first.remaining + docPass.length, skipped);
    }

    // Assets are in the repos now and registered by the write path (loop
    // r1b), so the registry can hand out their permalinks.

    // Rewrite each document's relative references to durable permalinks — the
    // same transform Insert and Replace apply — then commit the documents.
    //
    // In rounds: a document that links to ANOTHER document of this same upload
    // can only get that document's permalink once it is committed and
    // registered. So each round commits the documents whose links all resolve,
    // registers them, and retries the rest; a round that makes no progress
    // (a broken link, or two documents linking only to each other) reports
    // what is left as fixable problems.
    const linkIssues = [...firstScreen.issues];
    const rewritten = new Set<string>();
    const appOrigin = appBaseUrl();
    const registry = new SupabaseDocumentRegistryStore(supabase);
    const rounds = await commitInRounds(docPass, {
      outOfTime,
      resolve: async (change) => {
        const before = change.content as string;
        let content = await rewriteMarkdownRefs(
          supabase,
          packageId,
          change.repo,
          change.path,
          before,
        );
        // A public document may not reference a private file, and a link we
        // could not resolve is a link that will be broken for students.
        if (change.repo === "public" && !refsAreSafe(content)) {
          // The guard fails closed on `../…` because it cannot resolve
          // traversal. We can: a reference that lands on a REGISTERED file of
          // the public repo is provably public-safe — point it at that file's
          // platform permalink (never a raw GitHub URL; permalinks spec §7).
          content = await rewriteRelativeRefs(content, change.path, async (repoPath) => {
            if (!publicPaths.has(repoPath)) return null;
            const rec = await registry.getByLocation(packageId, "public", repoPath);
            return rec ? livePermalink(rec.docId, appOrigin) : null;
          });
          if (!refsAreSafe(content)) return null;
        }
        if (content !== before) rewritten.add(change.path);
        return { ...change, content };
      },
      commit: (changes) => commitChunks(changes, "Upload package contents (Alembic)"),
      // The documents just committed were registered by the write path
      // itself (loop r1b), so they can already be linked to by permalink.
      register: async () => {},
    });
    if (rounds.kind === "partial") return partial(committed, rounds.remaining, skipped);
    for (const change of rounds.unresolved) {
      linkIssues.push({ path: change.path, message: BROKEN_LINK });
    }
    const linksResolved = rewritten.size;

    // The registry is a projection of what the repos now hold; rebuild it once
    // the documents have landed so every uploaded file has an identity.
    await syncPackageRegistry(supabase, packageId, "uploaded");

    // The manifest file copy is the authoritative one and was just committed;
    // the column is a derived read cache, refreshed from the same value.
    await supabase.from("packages").update({ manifest: plan.manifest }).eq("id", packageId);
    await flushDiscovery(supabase, packageId);

    if (linkIssues.length > 0) {
      // Everything that could be committed was. Keep the staged file so the
      // educator can fix the links and resume without re-uploading.
      return Response.json(
        {
          ok: false,
          stage: "incomplete",
          error:
            `${committed} file${committed === 1 ? "" : "s"} went in. ` +
            `${linkIssues.length} document${linkIssues.length === 1 ? "" : "s"} ` +
            "couldn't be added because of a broken link:",
          issues: linkIssues,
          stagingPath,
        },
        { status: 422 },
      );
    }

    // Consumed: staging is never a home.
    await deleteStagingObject(supabase, stagingPath).catch(() => {});

    return Response.json({
      ok: true,
      stage: "done",
      packageId,
      filesCommitted: committed,
      imagesCommitted: diff.images,
      linksResolved,
      skipped,
    });
  } catch (err) {
    // A commit failed. Repos-first means the chunks that landed are real and
    // the rest changed nothing anywhere — so this is resumable, and the staged
    // file stays put for the retry.
    const detail =
      err instanceof Error && err.message
        ? err.message
        : "We couldn't save this package into the course.";
    const message =
      `${detail} ${committed} file${committed === 1 ? "" : "s"} went in before that, ` +
      "and they're safely saved — continuing picks up from there.";
    return Response.json(
      {
        ok: false,
        stage: "interrupted",
        error: message,
        filesCommitted: committed,
        stagingPath,
      },
      { status: 502 },
    );
  }
}

/* ------------------------------------------------------------------------- */

function fail(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

/** Public repo first, then private — fewer repo switches means fewer commits. */
function publicFirst(changes: RepoPlannedChange[]): RepoPlannedChange[] {
  return [
    ...changes.filter((c) => c.repo === "public"),
    ...changes.filter((c) => c.repo === "private"),
  ];
}

/** Text carriers whose public content is reference-scanned before it commits. */
const TEXT_CARRIER = /\.(md|md\.html|html|svg)$/i;

const BROKEN_LINK =
  "This document links to a file the package doesn't include (or to " +
  "instructor-only material). Fix the link or add the file, then upload again.";

/** The two-repo reference guard, as a question rather than an exception. */
function refsAreSafe(content: string): boolean {
  try {
    assertPublicMarkdownReferences(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hold back any public text carrier whose references would be refused by the
 * commit path, and report it as a fixable problem. Without this the whole run
 * would end on a contract exception written for developers; with it, the rest of
 * the package still lands and the educator is told which file to fix.
 */
function screenPublicRefs(changes: RepoPlannedChange[]): {
  safe: RepoPlannedChange[];
  issues: { path: string; message: string }[];
} {
  const safe: RepoPlannedChange[] = [];
  const issues: { path: string; message: string }[] = [];
  for (const change of changes) {
    const scan =
      change.repo === "public" &&
      change.content !== null &&
      change.encoding !== "base64" &&
      TEXT_CARRIER.test(change.path);
    if (scan && !refsAreSafe(change.content as string)) {
      issues.push({ path: change.path, message: BROKEN_LINK });
      continue;
    }
    safe.push(change);
  }
  return { safe, issues };
}

function partial(committed: number, remaining: number, skipped: number) {
  return Response.json({
    ok: true,
    stage: "partial",
    filesCommitted: committed,
    remaining,
    skipped,
  });
}

/** Diff for the wire: counts always, paths capped so the panel stays readable. */
const CAP = 40;
function summarize(diff: PopulateDiff) {
  const list = (entries: { repo: string; path: string }[]) =>
    entries.slice(0, CAP).map((e) => e.path);
  return {
    counts: {
      adds: diff.adds.length,
      replaces: diff.replaces.length,
      unchanged: diff.unchanged.length,
      removes: diff.removes.length,
      blockers: diff.blockers.length,
      images: diff.images,
    },
    adds: list(diff.adds),
    replaces: list(diff.replaces),
    blockers: list(diff.blockers),
  };
}

/**
 * Unzip an uploaded package into contract-relative files. A single common
 * top-level folder is stripped, so both `course.zip/alembic.json` and
 * `course.zip/my-course/alembic.json` land correctly. Directory entries, empty
 * files and any path containing `..` are dropped.
 */
function readPackageZip(bytes: Uint8Array): ImportFile[] {
  const entries = unzipSync(bytes);
  const rawPaths = Object.keys(entries).filter((p) => {
    const path = p.replace(/\\/g, "/");
    return !path.endsWith("/") && entries[p]!.length > 0 && !path.split("/").includes("..");
  });
  const normalized = rawPaths.map((p) => p.replace(/\\/g, "/"));
  const tops = new Set(normalized.map((p) => p.split("/")[0]));
  const alreadyRooted = normalized.includes("alembic.json");
  const rootPrefix = tops.size === 1 && !alreadyRooted ? `${[...tops][0]}/` : "";

  return rawPaths.map((raw) => {
    const path = raw
      .replace(/\\/g, "/")
      .slice(rootPrefix && raw.startsWith(rootPrefix) ? rootPrefix.length : 0);
    const isBinary = isBinaryPath(path);
    const data = entries[raw]!;
    const content = isBinary
      ? Buffer.from(data).toString("base64")
      : Buffer.from(data).toString("utf8");
    return { path, content, isBinary };
  });
}
