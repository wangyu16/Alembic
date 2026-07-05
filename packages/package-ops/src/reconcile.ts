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
  parseStudyGuide,
  validateBlockIds,
} from "@alembic/package-contract";
import { extractSource, hasCarrier } from "@alembic/carriers";
import type { PackageStore } from "./store";

export interface RepoReader {
  /** Current commit SHA of the public repo's default branch. */
  getHeadSha(): Promise<string>;
  /** Paths changed between two commits (base exclusive..head). status per file. */
  listChangedPaths(
    baseSha: string | null,
    headSha: string,
  ): Promise<Array<{ path: string; status: "added" | "modified" | "removed" }>>;
  /** UTF-8 file content at a ref, or null if absent. */
  readFileAtRef(path: string, ref: string): Promise<string | null>;
}

export type ReconcileOutcome =
  | { status: "up-to-date"; headSha: string }
  | { status: "absorbed"; headSha: string; changedPaths: string[] }
  | { status: "quarantined"; headSha: string; violations: string[] };

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
  const changed = await reader.listChangedPaths(lastSyncedSha, head);
  const violations: string[] = [];

  for (const change of changed) {
    if (change.status === "removed") continue;

    // Two-repo invariant: a private-space path or disallowed location must
    // never land in the PUBLIC repo. This is the security-critical leak check.
    // Dual-mode (v1 layers or v2 spaces) — a private-space path is rejected by
    // both, so the invariant holds for v1 and v2 packages alike.
    try {
      assertPathAllowedInEitherContract(change.path, "public");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      violations.push(`${change.path}: ${message}`);
      // Do not read/parse a path that should not exist in this repo.
      continue;
    }

    // Block-ID integrity: a foreign edit must not corrupt or duplicate IDs.
    if (isStudyGuideMarkdown(change.path)) {
      const content = await reader.readFileAtRef(change.path, head);
      if (content === null) {
        violations.push(
          `${change.path}: expected content at ${head} but file was absent`,
        );
        continue;
      }
      // v1 `.md` is parsed directly; v2 `.md.html` has its markdown extracted
      // from the carrier first, so external commits of either format have
      // their block IDs validated identically (origin parity, door #3).
      const { blocks } = parseStudyGuide(studyGuideMarkdown(change.path, content));
      // Missing block IDs are legal anonymous sections (contract v2 §4);
      // validateBlockIds skips them and rejects only malformed or DUPLICATE
      // ids — the corruption that actually breaks block identity.
      const integrity = validateBlockIds(blocks.map((b) => ({ id: b.id })));
      if (!integrity.ok) {
        for (const e of integrity.errors) {
          violations.push(`${change.path}: ${e}`);
        }
      }
    }
  }

  // Bad foreign state: refuse to absorb. Write NOTHING.
  if (violations.length > 0) {
    return { status: "quarantined", headSha: head, violations };
  }

  // Clean: absorb the changeset into the projection.
  for (const change of changed) {
    if (change.status === "removed") {
      await store.deleteFiles(packageId, [
        { repo: "public", path: change.path },
      ]);
      continue;
    }
    const content = await reader.readFileAtRef(change.path, head);
    if (content === null) {
      // Defensive: a path reported added/modified but missing at head. We
      // already validated; skip rather than write a null projection.
      continue;
    }
    await store.putFiles(packageId, [
      { repo: "public", path: change.path, content },
    ]);
  }

  return {
    status: "absorbed",
    headSha: head,
    changedPaths: changed.map((c) => c.path),
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
