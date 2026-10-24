/**
 * External-edit reconciliation (M20).
 *
 * Repos are the source of truth; the app's store (DB) is a rebuildable
 * projection (CLAUDE.md rule 4). An advanced user may edit the PUBLIC repo
 * directly in VS Code / on GitHub — a "foreign commit". Alembic must detect
 * that, re-validate the two-repo invariant + block-ID integrity, and absorb
 * the change into its projection ONLY if it is clean. A foreign edit that
 * broke an invariant (e.g. a `private-instructor/...` path appearing in the
 * PUBLIC repo, or a corrupted block-ID marker) is QUARANTINED: we refuse to
 * absorb it and surface the violations, leaving the projection untouched.
 *
 * This module is IO/Octokit-free. It reads repo content through the
 * `RepoReader` abstraction, which github-bridge implements app-side and tests
 * fake. Scope is the PUBLIC repo only — it is the side of the invariant whose
 * content is projected into the store. Private-repo reconciliation is future
 * work and intentionally out of scope here.
 */

import {
  assertPathAllowedInEitherContract,
  parseManifest,
  parseStudyGuide,
  validateBlockIds,
  type PackageManifest,
} from "@alembic/package-contract";
import { extractSource, hasCarrier } from "@alembic/carriers";
import type { PackageStore } from "./store";
import { MANIFEST_PATH, updateManifest } from "./manifest-ops";

export interface RepoReader {
  /** Current commit SHA of the public repo's default branch. */
  getHeadSha(): Promise<string>;
  /** Paths changed between two commits (base exclusive..head). status per file. */
  listChangedPaths(
    baseSha: string | null,
    headSha: string,
  ): Promise<Array<{ path: string; status: "added" | "modified" | "removed" }>>;
  /**
   * A file's content at a ref in the form Alembic stores it — UTF-8 text, or
   * base64 for a binary — or null if absent. Loop r4 (P5.B.3.k): never text
   * decoded with replacement characters, never "" for a file too large to be
   * inlined; text that is not valid UTF-8 throws `UnreadableFileError`.
   */
  readFileAtRef(path: string, ref: string): Promise<string | null>;
  /**
   * Optional (loop r4, P5.B.3.k): does the file at `ref` hold exactly the
   * stored copy's bytes? Compared by blob id, so an unchanged file — a large
   * binary above all — is never downloaded. False when it cannot tell.
   */
  sameAsStored?(path: string, stored: string, ref: string): Promise<boolean>;
}

/** A file whose bytes are not the text its name says (invalid UTF-8): it is
 *  held back, never stored with replacement characters (loop r4, P5.B.3.k). */
export class UnreadableFileError extends Error {
  constructor(readonly path: string) {
    super(`${path}: not readable as text`);
    this.name = "UnreadableFileError";
  }
}

export type ReconcileOutcome =
  | { status: "up-to-date"; headSha: string }
  | {
      status: "absorbed";
      headSha: string;
      /** Paths whose content at head differed from the stored copy and were
       *  brought in (loop r3: identical content is neither written nor listed). */
      changedPaths: string[];
      /**
       * Present when the foreign change included the course details file
       * (alembic.json): the manifest as it now stands, validated and written
       * through `updateManifest`. The WEB layer refreshes the
       * `packages.manifest` read cache from it — exactly as after every other
       * manifest write — so the discovery projection sees a licence or
       * listing change made on GitHub (P5.B.3.e).
       */
      manifest?: PackageManifest;
    }
  | {
      status: "quarantined";
      headSha: string;
      violations: string[];
      /** The paths the violations are about (loop r4, P5.B.3.l). */
      violationPaths: string[];
      /** Clean paths that really differ from the stored copy but were NOT
       *  brought in (a quarantine absorbs nothing) — loop r4, P5.B.3.l. */
      changedPaths: string[];
    };

/** A study-guide file whose block IDs we must keep intact — v1 `.md` or v2
 *  `.md.html` (source embedded in the carrier). */
function isStudyGuideMarkdown(path: string): boolean {
  return (
    path.startsWith("study-guide/") &&
    (path.endsWith(".md") || path.endsWith(".md.html"))
  );
}

/** The block-bearing markdown of a study-guide file: the raw `.md`, or the
 *  source extracted from a `.md.html` carrier. */
function studyGuideMarkdown(path: string, content: string): string {
  return path.endsWith(".md.html") && hasCarrier(content)
    ? extractSource(content).source
    : content;
}

/**
 * Reconcile foreign commits on the PUBLIC repo into the store projection.
 *
 * Validates the full changeset BEFORE writing anything: if any added/modified
 * path violates the two-repo invariant or corrupts study-guide block IDs, the
 * entire reconcile is rejected (quarantined) and the store is left untouched —
 * we never absorb a partially-bad state.
 */
export async function reconcilePublicRepo(
  store: PackageStore,
  packageId: string,
  opts: { lastSyncedSha: string | null; reader: RepoReader },
): Promise<ReconcileOutcome> {
  const { lastSyncedSha, reader } = opts;
  const head = await reader.getHeadSha();

  // No foreign edits since our last sync: touch nothing.
  if (head === lastSyncedSha) {
    return { status: "up-to-date", headSha: head };
  }

  // Foreign commit(s) exist (or we have never synced). Validate before absorbing.
  const listed = await reader.listChangedPaths(lastSyncedSha, head);
  const violations: string[] = [];
  // The foreign course details file, validated up front (absorbed last).
  let foreignManifest: PackageManifest | undefined;
  // Loop r3 (P5.B.3.g): only what REALLY differs from the stored copy is
  // absorbed and reported. A listed path whose content at head equals ours
  // (typically Alembic's own save, already projected) is no change at all —
  // the committer relies on this to retry a save that was refused only
  // because the synced point lagged behind Alembic's own commit.
  const changed: Array<{
    path: string;
    status: "added" | "modified" | "removed";
    content: string | null;
    /** The stored copy this change replaces (compare-and-set, loop r4). */
    ours: string | null;
  }> = [];
  const violationPaths = new Set<string>();
  const violate = (path: string, message: string) => {
    violations.push(`${path}: ${message}`);
    violationPaths.add(path);
  };

  for (const change of listed) {
    const ours = await store.readFile(packageId, "public", change.path);
    // Loop r4 (P5.B.3.k): the same bytes by blob id — nothing to read.
    if (
      ours !== null &&
      change.status !== "removed" &&
      reader.sameAsStored &&
      (await reader.sameAsStored(change.path, ours, head))
    ) {
      continue;
    }

    // The course details file is the package's identity: a foreign deletion
    // would leave a course with no manifest. Keep ours and report it.
    if (change.path === MANIFEST_PATH) {
      if (change.status === "removed") {
        violate(MANIFEST_PATH, "the course details file was deleted outside Alembic");
        continue;
      }
      try {
        const content = await reader.readFileAtRef(change.path, head);
        if (content !== null && content === ours) continue; // unchanged
        if (content === null) throw new Error(`expected content at ${head} but file was absent`);
        foreignManifest = parseManifest(JSON.parse(content));
        changed.push({ path: change.path, status: change.status, content, ours });
      } catch (err) {
        // Invalid foreign manifest: never let it reach the projection (or the
        // packages.manifest cache). Keep the old one; quarantine and report.
        const message = err instanceof Error ? err.message : String(err);
        violate(MANIFEST_PATH, `not a valid course details file: ${message}`);
      }
      continue;
    }

    if (change.status === "removed") {
      if (ours !== null) changed.push({ path: change.path, status: "removed", content: null, ours });
      continue;
    }

    // Two-repo invariant: a private-space path or disallowed location must
    // never land in the PUBLIC repo. This is the security-critical leak check.
    // Dual-mode (v1 layers or v2 spaces) — a private-space path is rejected by
    // both, so the invariant holds for v1 and v2 packages alike.
    try {
      assertPathAllowedInEitherContract(change.path, "public");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      violate(change.path, message);
      // Do not read/parse a path that should not exist in this repo.
      continue;
    }

    let content: string | null;
    try {
      content = await reader.readFileAtRef(change.path, head);
    } catch (err) {
      // Text that is not text: hold it back rather than store it mangled.
      if (!(err instanceof UnreadableFileError)) throw err;
      violate(change.path, "not readable as text");
      continue;
    }
    if (content === null) {
      if (isStudyGuideMarkdown(change.path)) {
        violate(change.path, `expected content at ${head} but file was absent`);
      }
      // Otherwise defensive: a path reported added/modified but missing at
      // head. Skip rather than write a null projection.
      continue;
    }
    if (content === ours) continue; // identical to the stored copy: no change

    // Block-ID integrity: a foreign edit must not corrupt or duplicate IDs.
    if (isStudyGuideMarkdown(change.path)) {
      // v1 `.md` is parsed directly; v2 `.md.html` has its markdown extracted
      // from the carrier first, so external commits of either format have
      // their block IDs validated identically (origin parity, door #3).
      const { blocks } = parseStudyGuide(studyGuideMarkdown(change.path, content));
      // Missing block IDs are legal anonymous sections (contract v2 §4);
      // validateBlockIds skips them and rejects only malformed or DUPLICATE
      // ids — the corruption that actually breaks block identity.
      const integrity = validateBlockIds(blocks.map((b) => ({ id: b.id })));
      if (!integrity.ok) {
        for (const e of integrity.errors) violate(change.path, e);
        continue;
      }
    }
    changed.push({ path: change.path, status: change.status, content, ours });
  }

  // Bad foreign state: refuse to absorb. Write NOTHING.
  if (violations.length > 0) {
    return {
      status: "quarantined",
      headSha: head,
      violations,
      violationPaths: [...violationPaths],
      changedPaths: changed.map((c) => c.path),
    };
  }

  // Clean: absorb the real differences into the projection — each path by
  // compare-and-set against the stored copy read above (loop r4, P5.B.3.k):
  // a save that landed while this ran is newer than `head`, and is kept.
  for (const change of changed) {
    if (change.path === MANIFEST_PATH) continue; // through the write path, below
    if (change.content === null) {
      if (store.deleteFileIf) {
        await store.deleteFileIf(packageId, { repo: "public", path: change.path }, { content: change.ours! });
      } else if ((await store.readFile(packageId, "public", change.path)) === change.ours) {
        await store.deleteFiles(packageId, [{ repo: "public", path: change.path }]);
      }
      continue;
    }
    const outcome = await store.replaceFileIf(
      packageId,
      { repo: "public", path: change.path, content: change.content },
      change.ours === null ? null : { content: change.ours },
    );
    if (outcome === "conflict") {
      console.warn(`[reconcile] ${packageId}: ${change.path} changed in Alembic meanwhile; kept that version`);
    }
  }

  // The manifest goes through the ONE manifest write path (validate → CAS the
  // projection → register), with no committer: the change is already on
  // GitHub, so nothing is committed again.
  let manifest: PackageManifest | undefined;
  if (foreignManifest !== undefined) {
    const next = foreignManifest;
    manifest = (await updateManifest(store, null, packageId, () => next)).manifest;
  }

  return {
    status: "absorbed",
    headSha: head,
    changedPaths: changed.map((c) => c.path),
    ...(manifest !== undefined ? { manifest } : {}),
  };
}

/**
 * M21 — leakage audit. Given every file path in the PUBLIC repo tree, return
 * those that violate the two-repo invariant (a private-layer path that must
 * never live in the public repo). Pure; reuses the contract's fail-closed path
 * check. A non-empty result means private content has leaked into the public
 * repo — surface it and follow docs/specs/leakage-remediation.md (history
 * purge + forced re-publication + incident note). Commit-time validation
 * (`validateCommitPlan`) makes a leak via Alembic impossible; this audits for
 * leaks introduced by foreign commits or pre-Alembic history.
 */
export function findLeakedPaths(publicRepoPaths: ReadonlyArray<string>): string[] {
  const leaked: string[] = [];
  for (const path of publicRepoPaths) {
    try {
      // Dual-mode: a v2 public-space path (assets/, slides/, …) is not a leak;
      // a private-space path in the public repo is rejected by both contracts.
      assertPathAllowedInEitherContract(path, "public");
    } catch {
      leaked.push(path);
    }
  }
  return leaked;
}
