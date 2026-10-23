import {
  listChapters,
  loadStudyGuide,
  type PackageRecord,
  type PackageStore,
} from "@alembic/package-ops";
import type { RepoKind, RepoRef } from "@alembic/package-contract";
import { auditDoc } from "./a11y";
import { recordedPublicRepo } from "./recorded-repo";

/**
 * Which bytes the server-side accessibility check audits (security loop r2,
 * M2 residual, claim P5.S.3.g).
 *
 * The result Discover trusts (`packages.a11y_status`, service-role only) must
 * describe what readers actually get. For a PUBLISHED package that is the
 * public repository the publish path recorded, at its current head — not the
 * platform's `sandbox_files` mirror, which the owner can write directly
 * through the API (round-2 audit: write a clean copy into the mirror, run the
 * check, get "pass" recorded while the published course still fails).
 *
 * A trial package is audited from its stored copy (that IS its content), but
 * that run is the owner's own preview: only an audit of published bytes is
 * recorded as the trusted result.
 */

export interface A11yCounts {
  errorCount: number;
  warningCount: number;
}

/** Audit every chapter's study guide as `store` sees it. */
export async function auditPackageA11y(store: PackageStore, packageId: string): Promise<A11yCounts> {
  const chapters = await listChapters(store, packageId);
  let errorCount = 0;
  let warningCount = 0;
  // Empty packages have one implicit chapter; loadStudyGuide handles absence.
  const paths = chapters.length ? chapters.map((c) => c.path) : [undefined];
  for (const path of paths) {
    const report = auditDoc(await loadStudyGuide(store, packageId, path));
    errorCount += report.errorCount;
    warningCount += report.warningCount;
  }
  return { errorCount, warningCount };
}

/**
 * A READ-ONLY store whose public files come from `readPublic` (the published
 * repository at one commit). Writes are refused: an audit never writes.
 */
export function publishedReadStore(
  base: PackageStore,
  readPublic: (path: string) => Promise<string | null>,
): PackageStore {
  const refuse = async (): Promise<never> => {
    throw new Error("publishedReadStore is read-only");
  };
  return {
    getPackage: (id: string) => base.getPackage(id),
    readFile: (_id: string, repo: RepoKind, path: string) =>
      repo === "public" ? readPublic(path) : Promise.resolve(null),
    listFiles: refuse,
    listPaths: refuse,
    putFiles: refuse,
    deleteFiles: refuse,
    replaceFileIf: refuse,
    createPackage: refuse,
  } as PackageStore;
}

/** The slice of the GitHub client the audit needs (github-bridge's GitHubClient). */
export interface PublishedReader {
  getBranchHead(coords: { owner: string; repo: string }): Promise<{ commitSha: string }>;
  getFileAtRef(coords: { owner: string; repo: string }, path: string, ref: string): Promise<string | null>;
}

export type A11yAuditSource =
  | { ok: true; store: PackageStore; published: boolean; repo: RepoRef | null }
  | { ok: false; error: string };

/**
 * Decide what to audit: a published package's recorded public repository at
 * its head (through the educator's own GitHub connection), else — for a trial
 * — the stored copy. A published package whose repository cannot be read is
 * refused (never silently audited from the mirror).
 */
export async function a11yAuditSource(
  store: PackageStore,
  record: PackageRecord | null,
  connect: () => Promise<PublishedReader | null>,
): Promise<A11yAuditSource> {
  if (!record) return { ok: false, error: "We couldn't find this course." };
  if (record.storage !== "github") return { ok: true, store, published: false, repo: null };
  const repo = recordedPublicRepo(record);
  if (!repo) {
    return { ok: false, error: "This course's published copy isn't recorded yet. Publish it again, then re-run the check." };
  }
  const client = await connect();
  if (!client) return { ok: false, error: "Reconnect publishing to check the published course." };
  const coords = { owner: repo.owner, repo: repo.name };
  const head = (await client.getBranchHead(coords)).commitSha;
  return {
    ok: true,
    published: true,
    repo,
    store: publishedReadStore(store, (path) => client.getFileAtRef(coords, path, head)),
  };
}
