/**
 * The Publish job (publisher-v3 §3 with queue-and-jobs §5): pin, refuse
 * unsafe trees, detect public drift (recognising Alembic's own crashed run),
 * check units, decide, assemble with the link check, record the run as
 * pending, commit the public repo with a compare-and-swap, record it
 * committed, and hand over to the site build. Orchestration only, over seams;
 * every rule that decides what reaches students lives in publisher.ts.
 */

import { assertRegularTree, sha256Hex, type WorkingManifestV3 } from "@alembic/package-contract";
import { publishWithLinkCheck, unitKey, unitOf, type Decision, type Finding, type TreeFile } from "./publisher";

/* -------------------------------------------------------------------------- *
 * Seams
 * -------------------------------------------------------------------------- */

export interface TreeEntry { path: string; mode: string; type?: string; blobSha: string }

export interface WorkingSide {
  head(): Promise<string>;
  listTree(sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  readText(sha: string, path: string): Promise<string | null>;
}

export interface PublicSide {
  /** null when the public repo doesn't exist yet. */
  head(): Promise<string | null>;
  create(): Promise<string>; // returns the initial head
  listTree(sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  recentCommits(limit: number): Promise<Array<{ sha: string; message: string }>>;
  changedPaths(from: string, to: string): Promise<string[]>;
  commit(input: { expectedHead: string; message: string; files: Array<{ path: string; text?: string; blobSha?: string; delete?: true }> }): Promise<string>;
}

export interface PublishStore {
  acknowledged(packageId: string): Promise<string | null>;
  acknowledge(packageId: string, publicSha: string): Promise<void>;
  pendingRun(packageId: string, runId: string): Promise<{ id: string; intendedFiles: PublishedRecord[] } | null>;
  insertPendingRun(run: { id: string; packageId: string; by: string; workingSha: string; publicParent: string | null; choices: unknown; intendedFiles: PublishedRecord[] }): Promise<void>;
  markCommitted(runId: string, publicSha: string, files: PublishedRecord[], results: unknown): Promise<void>;
  publishedFiles(packageId: string): Promise<PublishedRecord[]>;
  /** Paths approved at exactly these versions (course-plan parts). */
  approvedAt(packageId: string, parts: Array<{ path: string; version: string }>): Promise<Set<string>>;
  /** Bring public drift into the working repo (a system queue row); resolves when it ended. */
  bringInDrift(packageId: string, publicSha: string, paths: string[]): Promise<"done" | "not-done">;
}

export interface PublishedRecord { path: string; unit: string; blobSha?: string; version: string | null; text?: string }

export interface UnitCheck {
  id: string;
  run(unit: string, files: Array<{ path: string; text: string | null }>): Promise<Finding[]>;
}

export interface PublishInput {
  runId: string;
  packageId: string;
  by: string;
  isFirstPublish: boolean;
  manifest: WorkingManifestV3;
  choices: { publishAnyway: string[]; approveAndPublish: string[] };
}

export type PublishOutcome =
  | { status: "committed"; runId: string; publicSha: string; decisions: Decision[]; published: string[] }
  | { status: "stopped"; reason: string; drift?: string[] };

const TRAILER = "Alembic-Publish-Run";

/* -------------------------------------------------------------------------- *
 * The job
 * -------------------------------------------------------------------------- */

export async function runPublish(i: PublishInput, w: WorkingSide, pub: PublicSide, store: PublishStore, checks: UnitCheck[]): Promise<PublishOutcome> {
  // 3. Pin and check the tree.
  const W = await w.head();
  const tree = await w.listTree(W);
  if (tree.truncated) return { status: "stopped", reason: "This course is too large to publish safely in one run" };
  try {
    assertRegularTree(tree.entries);
  } catch (e) {
    return { status: "stopped", reason: `The course contains a link or submodule that must be removed first (${(e as Error).message})` };
  }

  // 4. Public drift.
  let P = await pub.head();
  if (P !== null) {
    const ack = await store.acknowledged(i.packageId);
    if (ack !== P) {
      // Our own crashed run? Find a pending run's trailer between ack and P.
      const recent = await pub.recentCommits(50);
      let ownSha: string | null = null;
      for (const c of recent) {
        const m = new RegExp(`^${TRAILER}: ([0-9a-f-]{36})$`, "m").exec(c.message);
        if (m) {
          const pending = await store.pendingRun(i.packageId, m[1]!);
          if (pending) {
            await store.markCommitted(pending.id, c.sha, pending.intendedFiles, { recovered: true });
            await store.acknowledge(i.packageId, c.sha);
            ownSha = c.sha;
          }
          break;
        }
        if (c.sha === ack) break;
      }
      const base = ownSha ?? ack;
      if (base !== P) {
        const changed = base === null ? [] : await pub.changedPaths(base, P);
        const published = new Set((await store.publishedFiles(i.packageId)).map((f) => f.path));
        const bringable = changed.filter((p) => published.has(p) && p !== "alembic.json" && !p.startsWith(".alembic/") && !p.startsWith(".github/") && !p.startsWith("provenance/coursewerk/"));
        const landed = bringable.length ? await store.bringInDrift(i.packageId, P, bringable) : "done";
        if (landed !== "done") return { status: "stopped", reason: "The public copy was changed on GitHub and those changes couldn't be brought in yet", drift: bringable };
        await store.acknowledge(i.packageId, P);
        return { status: "stopped", reason: "The public copy was changed on GitHub — those changes were brought in; run Publish again", drift: bringable };
      }
    }
  }

  // 6. Read units at W and run the checks.
  const chapters = new Set(i.manifest.chapters.map((c) => c.slug));
  const previously = await store.publishedFiles(i.packageId);
  const everPublished = new Set(previously.filter((f) => f.unit.startsWith("chapter:")).map((f) => f.unit.slice(8)));
  const working = new Map<string, TreeFile>();
  const byUnit = new Map<string, Array<{ path: string; text: string | null }>>();
  for (const e of tree.entries) {
    if (e.type === "tree" || e.mode === "040000") continue;
    const u = unitOf(e.path, chapters, everPublished);
    if (u.kind === "none" || u.kind === "orphan") continue;
    const text = await w.readText(W, e.path);
    working.set(e.path, text === null ? { blobSha: e.blobSha } : { text });
    const key = unitKey(u);
    byUnit.set(key, [...(byUnit.get(key) ?? []), { path: e.path, text }]);
  }
  const units = [...byUnit.keys()];
  const findings: Finding[] = [];
  for (const unit of units) for (const c of checks) findings.push(...(await c.run(unit, byUnit.get(unit)!)));

  // Approvals at W: a chapter is approved when both of its plan parts are approved at their W versions.
  const parts: Array<{ path: string; version: string; slug: string }> = [];
  for (const slug of chapters) {
    for (const path of [`concepts/${slug}.md`, `assessment-support/${slug}.md`]) {
      const f = working.get(path);
      if (f?.text !== undefined) parts.push({ path, version: await sha256Hex(f.text), slug });
    }
  }
  const approvedPaths = await store.approvedAt(i.packageId, parts);
  const approved = new Set<string>();
  for (const slug of chapters) {
    const mine = parts.filter((p) => p.slug === slug);
    if (mine.length > 0 && mine.every((p) => approvedPaths.has(p.path))) approved.add(slug);
  }

  // 7–9. Decide, assemble, link check.
  const draft = new Set(i.manifest.chapters.filter((c) => c.mode === "draft").map((c) => c.slug));
  const publishedMap = new Map(previously.map((f) => [f.path, { blobSha: f.blobSha, text: f.text, unit: f.unit }]));
  const { tree: assembled, decisions } = publishWithLinkCheck(
    { working, published: publishedMap as Map<string, TreeFile & { unit: string }>, manifest: i.manifest, everPublishedChapters: everPublished },
    { units, findings, draft, approved, publishAnyway: new Set(i.choices.publishAnyway) },
  );

  // 10. Record pending, then one commit to the public repo (CAS on P).
  if (P === null) {
    if (!i.isFirstPublish) return { status: "stopped", reason: "The public copy is missing; only the owner's first Publish creates it" };
    P = await pub.create();
  }
  const current = await pub.listTree(P);
  if (current.truncated) return { status: "stopped", reason: "The public copy is too large to update safely in one run" };
  const files: Array<{ path: string; text?: string; blobSha?: string; delete?: true }> = [];
  const records: PublishedRecord[] = [];
  for (const [path, f] of assembled.files) {
    files.push(f.blobSha && f.text === undefined ? { path, blobSha: f.blobSha } : { path, text: f.text ?? "" });
    records.push({ path, unit: f.unit, ...(f.blobSha ? { blobSha: f.blobSha } : {}), version: f.text === undefined ? null : await sha256Hex(f.text), ...(f.text !== undefined ? { text: f.text } : {}) });
  }
  for (const e of current.entries) {
    if (e.type === "tree" || e.mode === "040000") continue;
    if (!assembled.files.has(e.path)) files.push({ path: e.path, delete: true });
  }
  await store.insertPendingRun({ id: i.runId, packageId: i.packageId, by: i.by, workingSha: W, publicParent: P, choices: i.choices, intendedFiles: records });
  const message = `Publish\n\n${TRAILER}: ${i.runId}`;
  const publicSha = await pub.commit({ expectedHead: P, message, files });

  // 11. Record committed immediately (before any site build).
  await store.markCommitted(i.runId, publicSha, records, { decisions: [...decisions.values()] });
  await store.acknowledge(i.packageId, publicSha);
  return {
    status: "committed",
    runId: i.runId,
    publicSha,
    decisions: [...decisions.values()],
    published: [...assembled.publishedChapters],
  };
}
